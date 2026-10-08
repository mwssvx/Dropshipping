export function money(minor: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100);
}

export function parseMoney(input: string): number | null {
  const clean = input.replace(/[^0-9.]/g, "");
  if (!clean || !/^\d+(\.\d{0,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

export function when(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date();
  return d.toDateString() === today.toDateString() ? time.format(d) : day.format(d);
}

export const FULFILMENT: Record<string, { label: string; tone: "neutral" | "info" | "success" | "warning" | "critical" }> = {
  unfulfilled: { label: "Not sent yet", tone: "warning" },
  sent_to_supplier: { label: "With supplier", tone: "info" },
  partially_shipped: { label: "Partly shipped", tone: "info" },
  shipped: { label: "Shipped", tone: "success" },
  delivered: { label: "Delivered", tone: "success" },
  problem: { label: "Needs you", tone: "critical" },
};

export const PAYMENT: Record<string, string> = {
  pending: "Not paid",
  paid: "Paid",
  partially_refunded: "Partly refunded",
  refunded: "Refunded",
  failed: "Payment failed",
};
