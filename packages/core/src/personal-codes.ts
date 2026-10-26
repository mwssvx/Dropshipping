// Personal codes: the merchant sends one customer a code from their page, to say sorry for a late
// parcel or thank a good customer. It works once, only with that customer's email, until a date.
import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { z } from "zod";
import type { CampaignContext } from "./campaigns";
import { NotFoundError, UserError } from "./errors";
import { formatMoney } from "./money";

type Shop = typeof schema.shops.$inferSelect;

const DAY = 86_400_000;
const PAID = ["paid", "partially_refunded", "refunded"] as const;
// No 0/O or 1/I, so codes can be read out and typed from a phone.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = () => `FOR-${[...randomBytes(6)].map((b) => ALPHABET[b % ALPHABET.length]).join("")}`;

const input = z
  .object({
    kind: z.enum(["percent", "amount"]),
    value: z.number().int(),
    days: z.number().int().min(1, "The code works for 1 to 90 days.").max(90, "The code works for 1 to 90 days."),
    note: z.string().trim().max(500, "Keep the message under 500 characters.").optional(),
  })
  .superRefine((d, ctx) => {
    if (d.kind === "percent" && (d.value < 1 || d.value > 100)) ctx.addIssue({ code: "custom", message: "A percentage is between 1 and 100." });
    if (d.kind === "amount" && d.value < 1) ctx.addIssue({ code: "custom", message: "Enter the amount to take off." });
  });

const firstName = (name: string | null) => name?.trim().split(/\s+/)[0] || "there";

/** Makes a one-time code for one customer and emails it to them with the merchant's message. */
export async function sendPersonalCode(ctx: CampaignContext, shop: Shop, customerId: string, raw: z.input<typeof input>) {
  const parsed = input.safeParse(raw);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const d = parsed.data;
  const customer = await ctx.db.query.customers.findFirst({ where: and(eq(schema.customers.id, customerId), eq(schema.customers.shopId, shop.id)) });
  if (!customer) throw new NotFoundError("Customer");
  const now = ctx.now?.() ?? new Date();
  const endsAt = new Date(now.getTime() + d.days * DAY);
  let row: typeof schema.discounts.$inferSelect | undefined;
  for (let i = 0; i < 5 && !row; i++) {
    [row] = await ctx.db
      .insert(schema.discounts)
      .values({ shopId: shop.id, code: newCode(), kind: d.kind, value: d.value, usageLimit: 1, oncePerCustomer: true, endsAt, source: "personal", email: customer.email.toLowerCase() })
      .onConflictDoNothing()
      .returning();
  }
  if (!row) throw new Error("Couldn't make a unique code");
  const off = d.kind === "percent" ? `${d.value}%` : formatMoney(d.value, shop.currency);
  const base = await ctx.storeAddress(shop);
  const until = endsAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  await ctx.mailer.send({
    to: customer.email,
    subject: `${off} off your next order at ${shop.name}`,
    text: [
      `Hi ${firstName(customer.name)},`,
      ``,
      ...(d.note ? [d.note, ``] : []),
      `Here's ${off} off your next order from ${shop.name}:`,
      ``,
      `    ${row.code}`,
      ``,
      `Type it in your cart before ${until}. It works once, with this email address.`,
      ``,
      `Shop now: ${base}/discount/${row.code}`,
    ].join("\n"),
  });
  return row;
}

/** Codes sent to this customer from their page, newest first, with whether they used it. */
export async function personalCodesFor(db: Db, shopId: string, email: string, now = new Date()) {
  const rows = await db.query.discounts.findMany({
    where: and(eq(schema.discounts.shopId, shopId), eq(schema.discounts.source, "personal"), eq(schema.discounts.email, email.toLowerCase())),
    orderBy: desc(schema.discounts.createdAt),
    limit: 20,
  });
  const used = rows.length
    ? await db
        .select({ discountId: schema.orders.discountId, number: schema.orders.number })
        .from(schema.orders)
        .where(and(eq(schema.orders.shopId, shopId), inArray(schema.orders.paymentStatus, [...PAID]), inArray(schema.orders.discountId, rows.map((r) => r.id))))
    : [];
  return rows.map((r) => {
    const order = used.find((u) => u.discountId === r.id);
    return {
      id: r.id,
      code: r.code,
      kind: r.kind as "percent" | "amount",
      value: r.value,
      sentAt: r.createdAt,
      endsAt: r.endsAt,
      status: order ? ("used" as const) : r.endsAt && r.endsAt <= now ? ("expired" as const) : ("open" as const),
      orderNumber: order?.number ?? null,
    };
  });
}
