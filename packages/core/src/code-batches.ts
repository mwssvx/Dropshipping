// One-time codes: the merchant makes many codes with the same offer at once, for a giveaway, a
// creator to hand out, or a card in every parcel ("10% off your next order"). Each code works for
// one paid order, by anyone, and the batch is downloaded as a spreadsheet to print or share.
import { randomBytes } from "node:crypto";
import { and, asc, count, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { z } from "zod";
import { csvCell } from "./payouts";
import { NotFoundError, UserError } from "./errors";

export const MAX_BATCH = 1000;
const PAID = ["paid", "partially_refunded", "refunded"] as const;
// No 0/O or 1/I, so a printed code can be typed from a phone.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const suffix = () => [...randomBytes(8)].map((b) => ALPHABET[b % ALPHABET.length]).join("");

const batchInput = z
  .object({
    name: z.string().trim().min(1, "Give the batch a name, like Parcel cards.").max(60, "Keep the name under 60 characters."),
    prefix: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{2,12}$/, "The start of each code is 2 to 12 letters or numbers, like THANKS."),
    count: z.number().int().min(1, `Make 1 to ${MAX_BATCH} codes.`).max(MAX_BATCH, `Make 1 to ${MAX_BATCH} codes.`),
    kind: z.enum(["percent", "amount", "free_shipping"]),
    value: z.number().int().min(0).default(0),
    minSubtotalMinor: z.number().int().min(0).default(0),
    endsAt: z.date().nullish(),
  })
  .superRefine((d, ctx) => {
    if (d.kind === "percent" && (d.value < 1 || d.value > 100)) ctx.addIssue({ code: "custom", message: "A percentage is between 1 and 100." });
    if (d.kind === "amount" && d.value < 1) ctx.addIssue({ code: "custom", message: "Enter the amount to take off." });
  });

export type CodeBatchInput = z.input<typeof batchInput>;

/** Makes a batch of one-time codes, like THANKS-7KQ2M9XA, all with the same offer. */
export async function createCodeBatch(db: Db, shopId: string, input: CodeBatchInput, now = new Date()) {
  const parsed = batchInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const d = parsed.data;
  if (d.endsAt && d.endsAt <= now) throw new UserError("Pick an end date in the future.");
  return db.transaction(async (tx) => {
    const [batch] = await tx.insert(schema.codeBatches).values({ shopId, name: d.name, prefix: d.prefix, count: d.count }).returning();
    const offer = {
      shopId,
      kind: d.kind,
      value: d.kind === "free_shipping" ? 0 : d.value,
      minSubtotalMinor: d.minSubtotalMinor,
      endsAt: d.endsAt ?? null,
      usageLimit: 1,
      source: "batch" as const,
      batchId: batch!.id,
    };
    // 32^8 codes per prefix, so a clash is rare; the few that clash are made again.
    let made = 0;
    for (let round = 0; made < d.count && round < 5; round++) {
      const codes = [...new Set(Array.from({ length: d.count - made }, () => `${d.prefix}-${suffix()}`))];
      const rows = await tx.insert(schema.discounts).values(codes.map((code) => ({ ...offer, code }))).onConflictDoNothing().returning({ id: schema.discounts.id });
      made += rows.length;
    }
    if (made < d.count) throw new Error("Couldn't make unique codes");
    return batch!;
  });
}

/** The store's batches, newest first, with how many of their codes paid orders have used. */
export async function listCodeBatches(db: Db, shopId: string) {
  const batches = await db.query.codeBatches.findMany({ where: eq(schema.codeBatches.shopId, shopId), orderBy: desc(schema.codeBatches.createdAt) });
  if (!batches.length) return [];
  const [offers, used] = await Promise.all([
    db
      .selectDistinctOn([schema.discounts.batchId], { batchId: schema.discounts.batchId, kind: schema.discounts.kind, value: schema.discounts.value, minSubtotalMinor: schema.discounts.minSubtotalMinor, endsAt: schema.discounts.endsAt })
      .from(schema.discounts)
      .where(inArray(schema.discounts.batchId, batches.map((b) => b.id))),
    db
      .select({ batchId: schema.discounts.batchId, n: count() })
      .from(schema.orders)
      .innerJoin(schema.discounts, eq(schema.orders.discountId, schema.discounts.id))
      .where(and(eq(schema.orders.shopId, shopId), inArray(schema.orders.paymentStatus, [...PAID]), inArray(schema.discounts.batchId, batches.map((b) => b.id))))
      .groupBy(schema.discounts.batchId),
  ]);
  return batches.map((b) => {
    const offer = offers.find((o) => o.batchId === b.id);
    return {
      ...b,
      kind: offer?.kind ?? "percent",
      value: offer?.value ?? 0,
      minSubtotalMinor: offer?.minSubtotalMinor ?? 0,
      endsAt: offer?.endsAt ?? null,
      used: Number(used.find((u) => u.batchId === b.id)?.n ?? 0),
    };
  });
}

/** Turns every code in a batch off or back on. Codes already used stay used. */
export async function setCodeBatchActive(db: Db, shopId: string, batchId: string, active: boolean) {
  return db.transaction(async (tx) => {
    const [batch] = await tx
      .update(schema.codeBatches)
      .set({ active })
      .where(and(eq(schema.codeBatches.id, batchId), eq(schema.codeBatches.shopId, shopId)))
      .returning();
    if (!batch) throw new NotFoundError("Batch");
    await tx.update(schema.discounts).set({ active }).where(and(eq(schema.discounts.batchId, batchId), eq(schema.discounts.shopId, shopId)));
    return batch;
  });
}

/** A batch's codes as a spreadsheet: each code, and the order that used it, if one has. */
export async function codeBatchCsv(db: Db, shopId: string, batchId: string) {
  const batch = await db.query.codeBatches.findFirst({ where: and(eq(schema.codeBatches.id, batchId), eq(schema.codeBatches.shopId, shopId)) });
  if (!batch) throw new NotFoundError("Batch");
  const codes = await db.query.discounts.findMany({ where: eq(schema.discounts.batchId, batchId), columns: { id: true, code: true }, orderBy: asc(schema.discounts.code) });
  const orders = await db
    .select({ discountId: schema.orders.discountId, number: schema.orders.number, paidAt: schema.orders.paidAt })
    .from(schema.orders)
    .where(and(eq(schema.orders.shopId, shopId), inArray(schema.orders.paymentStatus, [...PAID]), isNotNull(schema.orders.discountId), inArray(schema.orders.discountId, codes.map((c) => c.id))));
  const byCode = new Map(orders.map((o) => [o.discountId!, o]));
  const lines = [["Code", "Used", "Order", "Used on"].join(",")];
  for (const c of codes) {
    const o = byCode.get(c.id);
    lines.push([c.code, o ? "yes" : "no", o ? `#${o.number}` : "", o?.paidAt ? o.paidAt.toISOString().slice(0, 10) : ""].map(csvCell).join(","));
  }
  return { batch, csv: `${lines.join("\n")}\n` };
}
