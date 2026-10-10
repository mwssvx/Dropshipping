"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSizeChart, deleteSizeChart, draftSizeChartWithAi, updateSizeChart, UserError } from "@sf/core";
import { agents, requireShop } from "@/lib/server";

export type ChartState = { error?: string; message?: string };

function refresh(handle: string) {
  revalidatePath("/admin/size-charts", "layout");
  revalidatePath(`/s/${handle}`, "layout");
}

/** The editor sends the table as JSON; everything is checked again in core. */
function readChart(form: FormData) {
  let table: { columns?: unknown; rows?: unknown } = {};
  try {
    table = JSON.parse(String(form.get("table") ?? "{}"));
  } catch {
    throw new UserError("The table couldn't be read. Reload the page and try again.");
  }
  return {
    name: String(form.get("name") ?? ""),
    unit: String(form.get("unit") ?? "cm") === "in" ? ("in" as const) : ("cm" as const),
    columns: Array.isArray(table.columns) ? table.columns.map(String) : [],
    rows: Array.isArray(table.rows) ? table.rows.map((r) => (Array.isArray(r) ? r.map(String) : [])) : [],
    note: String(form.get("note") ?? ""),
    productIds: form.getAll("productIds").map(String),
    collectionIds: form.getAll("collectionIds").map(String),
    published: form.get("published") === "on",
  };
}

export async function saveSizeChartAction(id: string | null, _: ChartState, form: FormData): Promise<ChartState> {
  const { shop, db } = await requireShop("products");
  let newId: string | null = null;
  try {
    const input = readChart(form);
    if (id) await updateSizeChart(db, shop.id, id, input);
    else newId = (await createSizeChart(db, shop.id, input)).id;
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  refresh(shop.handle);
  if (newId) redirect(`/admin/size-charts/${newId}?saved=1`);
  return { message: form.get("published") === "on" ? "Saved. It shows on the products it's attached to." : "Saved. It's hidden from the store." };
}

export async function deleteSizeChartAction(id: string) {
  const { shop, db } = await requireShop("products");
  await deleteSizeChart(db, shop.id, id).catch((e) => {
    if (!(e instanceof UserError)) throw e;
  });
  refresh(shop.handle);
  redirect("/admin/size-charts");
}

export async function draftSizeChartAction(_: ChartState, form: FormData): Promise<ChartState> {
  const { shop } = await requireShop("products");
  let chartId: string | null = null;
  try {
    const run = await draftSizeChartWithAi(await agents(), shop, String(form.get("productId") ?? ""));
    revalidatePath("/admin", "layout");
    if (run.status === "over_budget") return { error: "This month's AI budget is used up. You can raise it in AI settings." };
    chartId = run.chartId;
    if (!chartId) return { error: run.error ?? "The AI couldn't draft a chart for that product. Try again, or make one yourself." };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  redirect(`/admin/size-charts/${chartId}?drafted=1`);
}
