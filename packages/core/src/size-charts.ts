// Size charts: a table of measurements per size, made once and shown on every product page it's
// attached to, directly or through a collection. A product's own chart wins over a collection's.
// Buyers can switch between centimetres and inches; the first column (the size name) never
// converts, since sizes like "8" or "32" aren't measurements.
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { z } from "zod";
import { NotFoundError, UserError } from "./errors";

export const MAX_SIZE_CHARTS = 50;
export type SizeChart = typeof schema.sizeCharts.$inferSelect;
export type SizeUnit = "cm" | "in";

const cell = z.string().trim().max(30, "Keep each cell under 30 characters.");
const chartInput = z
  .object({
    name: z.string().trim().min(1, "Give the chart a name, like \"T-shirts\".").max(60, "Keep the name under 60 characters."),
    unit: z.enum(["cm", "in"]).default("cm"),
    columns: z.array(cell.min(1, "Give every column a heading.")).min(2, "Add at least one measurement column.").max(8, "A chart has up to 8 columns."),
    rows: z.array(z.array(cell)).min(1, "Add at least one size.").max(30, "A chart has up to 30 sizes."),
    note: z.string().trim().max(500, "Keep the note under 500 characters.").nullish().transform((v) => v || null),
    productIds: z.array(z.string().uuid()).max(500).default([]),
    collectionIds: z.array(z.string().uuid()).max(100).default([]),
    published: z.boolean().default(true),
  })
  .superRefine((c, ctx) => {
    for (const r of c.rows) {
      if (r.length !== c.columns.length) ctx.addIssue({ code: "custom", message: "Every size needs a cell for each column." });
      else if (!r[0]) ctx.addIssue({ code: "custom", message: "Give every row a size name." });
    }
    const names = c.rows.map((r) => r[0]?.toLowerCase());
    if (new Set(names).size !== names.length) ctx.addIssue({ code: "custom", message: "Each size can only be in the chart once." });
  });
export type SizeChartInput = z.input<typeof chartInput>;

async function parse(db: Db, shopId: string, input: SizeChartInput) {
  const parsed = chartInput.safeParse(input);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]!.message);
  const c = parsed.data;
  const productIds = [...new Set(c.productIds)];
  const collectionIds = [...new Set(c.collectionIds)];
  if (productIds.length) {
    const found = await db.query.products.findMany({ where: and(eq(schema.products.shopId, shopId), inArray(schema.products.id, productIds)), columns: { id: true } });
    if (found.length !== productIds.length) throw new UserError("Pick products from your store.");
  }
  if (collectionIds.length) {
    const found = await db.query.collections.findMany({ where: and(eq(schema.collections.shopId, shopId), inArray(schema.collections.id, collectionIds)), columns: { id: true } });
    if (found.length !== collectionIds.length) throw new UserError("Pick collections from your store.");
  }
  return { ...c, productIds, collectionIds };
}

export async function createSizeChart(db: Db, shopId: string, input: SizeChartInput) {
  const data = await parse(db, shopId, input);
  const [{ n }] = (await db.select({ n: count() }).from(schema.sizeCharts).where(eq(schema.sizeCharts.shopId, shopId))) as [{ n: number }];
  if (n >= MAX_SIZE_CHARTS) throw new UserError(`A store can have up to ${MAX_SIZE_CHARTS} size charts. Delete one you no longer use first.`);
  const [row] = await db.insert(schema.sizeCharts).values({ shopId, ...data }).returning();
  return row!;
}

export async function updateSizeChart(db: Db, shopId: string, id: string, input: SizeChartInput) {
  const data = await parse(db, shopId, input);
  const [row] = await db
    .update(schema.sizeCharts)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(schema.sizeCharts.id, id), eq(schema.sizeCharts.shopId, shopId)))
    .returning();
  if (!row) throw new NotFoundError("Size chart");
  return row;
}

export async function deleteSizeChart(db: Db, shopId: string, id: string) {
  const [row] = await db.delete(schema.sizeCharts).where(and(eq(schema.sizeCharts.id, id), eq(schema.sizeCharts.shopId, shopId))).returning({ id: schema.sizeCharts.id });
  if (!row) throw new NotFoundError("Size chart");
}

export async function getSizeChart(db: Db, shopId: string, id: string) {
  const row = /^[0-9a-f-]{36}$/i.test(id) ? await db.query.sizeCharts.findFirst({ where: and(eq(schema.sizeCharts.id, id), eq(schema.sizeCharts.shopId, shopId)) }) : undefined;
  if (!row) throw new NotFoundError("Size chart");
  return row;
}

export async function listSizeCharts(db: Db, shopId: string) {
  return db.query.sizeCharts.findMany({ where: eq(schema.sizeCharts.shopId, shopId), orderBy: asc(schema.sizeCharts.name) });
}

/** The chart shown on a product's page: its own, else one of its collections', oldest first. */
export async function sizeChartForProduct(db: Db, shopId: string, productId: string) {
  const charts = await db.query.sizeCharts.findMany({
    where: and(eq(schema.sizeCharts.shopId, shopId), eq(schema.sizeCharts.published, true)),
    orderBy: asc(schema.sizeCharts.createdAt),
  });
  if (!charts.length) return null;
  const own = charts.find((c) => c.productIds.includes(productId));
  if (own) return own;
  const memberOf = new Set(
    (await db.query.collectionProducts.findMany({ where: eq(schema.collectionProducts.productId, productId), columns: { collectionId: true } })).map((r) => r.collectionId),
  );
  return charts.find((c) => c.collectionIds.some((id) => memberOf.has(id))) ?? null;
}

const fmt = (n: number, unit: SizeUnit) => String(unit === "in" ? Math.round(n * 4) / 4 : Math.round(n));

/**
 * One cell in the other unit: every number in it is converted ("86-91" → "34-36"), anything else
 * stays. Inches round to the nearest quarter and centimetres to the nearest whole number.
 */
export function convertSizeCell(text: string, from: SizeUnit, to: SizeUnit) {
  if (from === to) return text;
  return text.replace(/\d+(?:[.,]\d+)?/g, (m) => {
    const n = Number(m.replace(",", "."));
    return fmt(from === "cm" ? n / 2.54 : n * 2.54, to);
  });
}

/** The chart's rows in a unit; the first column (the size) stays as it is. */
export function sizeChartRows(chart: Pick<SizeChart, "rows" | "unit">, unit: SizeUnit) {
  return chart.rows.map((r) => r.map((c, i) => (i === 0 ? c : convertSizeCell(c, chart.unit, unit))));
}
