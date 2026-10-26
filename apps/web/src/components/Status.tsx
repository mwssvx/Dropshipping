const PAYMENT: Record<string, [string, string]> = {
  pending: ["Awaiting payment", "pill-warning"],
  paid: ["Paid", "pill-success"],
  partially_refunded: ["Partly refunded", "pill-info"],
  refunded: ["Refunded", "pill-neutral"],
  failed: ["Payment failed", "pill-critical"],
};
const FULFILMENT: Record<string, [string, string]> = {
  unfulfilled: ["To send", "pill-warning"],
  sent_to_supplier: ["Sent to supplier", "pill-info"],
  partially_shipped: ["Partly shipped", "pill-info"],
  shipped: ["Shipped", "pill-success"],
  delivered: ["Delivered", "pill-success"],
  problem: ["Problem", "pill-critical"],
};
const PRODUCT: Record<string, [string, string]> = {
  active: ["Active", "pill-success"],
  draft: ["Draft", "pill-neutral"],
  // A draft that goes on sale by itself later.
  scheduled: ["Scheduled", "pill-info"],
  archived: ["Archived", "pill-neutral"],
};

function Pill({ map, value }: { map: Record<string, [string, string]>; value: string }) {
  const [label, cls] = map[value] ?? [value, "pill-neutral"];
  return <span className={`pill ${cls}`}>{label}</span>;
}

export const PaymentStatus = ({ value }: { value: string }) => <Pill map={PAYMENT} value={value} />;
export const FulfilmentStatus = ({ value }: { value: string }) => <Pill map={FULFILMENT} value={value} />;
export const ProductStatus = ({ value }: { value: string }) => <Pill map={PRODUCT} value={value} />;
