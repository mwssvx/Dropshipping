// Holiday checklist: the season's settings in one place, each ticked from the store's own state,
// so a merchant getting ready for Black Friday and Christmas finds what's there and what's left:
// delivery dates and an order-by date, longer returns for gifts, gift cards and wrapping, a sale,
// checkout reminders, a sign-up offer, "running late" emails, and backup suppliers for best sellers.
import { and, desc, eq, gte, inArray, isNotNull, isNull, ne, or, gt, sql } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { holidayReturnsDates } from "./holiday-returns";

type Shop = typeof schema.shops.$inferSelect;
const DAY = 86_400_000;
/** Best sellers over this many days get checked for a backup supplier. */
const BEST_SELLER_DAYS = 60;
const BEST_SELLERS = 5;

export type HolidayCheck = { key: string; title: string; done: boolean; detail: string; href: string };

/** True from October 1 to December 24, when the home page points at the checklist. */
export function holidaySeason(now = new Date()) {
  const m = now.getUTCMonth();
  return m === 9 || m === 10 || (m === 11 && now.getUTCDate() <= 24);
}

export async function holidayChecklist(db: Db, shop: Shop, now = new Date()): Promise<HolidayCheck[]> {
  const today = now.toISOString().slice(0, 10);
  const o = schema.orders;
  const [giftCards, sale, best] = await Promise.all([
    db.query.products.findFirst({ where: and(eq(schema.products.shopId, shop.id), eq(schema.products.giftCard, true), eq(schema.products.status, "active")), columns: { id: true } }),
    db.query.sales.findFirst({ where: and(eq(schema.sales.shopId, shop.id), or(isNull(schema.sales.endsAt), gt(schema.sales.endsAt, now))), columns: { id: true } }),
    db
      .select({ id: schema.products.id, title: schema.products.title, backup: schema.products.backup })
      .from(schema.orderLines)
      .innerJoin(o, eq(o.id, schema.orderLines.orderId))
      .innerJoin(schema.variants, eq(schema.variants.id, schema.orderLines.variantId))
      .innerJoin(schema.products, eq(schema.products.id, schema.variants.productId))
      .where(
        and(
          eq(o.shopId, shop.id),
          inArray(o.paymentStatus, ["paid", "partially_refunded"]),
          ne(o.source, "replacement"),
          gte(o.paidAt, new Date(now.getTime() - BEST_SELLER_DAYS * DAY)),
          isNotNull(schema.products.supplierId),
          ne(schema.products.status, "archived"),
        ),
      )
      .groupBy(schema.products.id)
      .orderBy(desc(sql`sum(${schema.orderLines.quantity})`))
      .limit(BEST_SELLERS),
  ]);
  const noBackup = best.filter((p) => !p.backup || p.backup.gone);
  const holiday = shop.holidayDeadline && shop.holidayDeadline.arriveBy >= today ? shop.holidayDeadline : null;
  const returns = holidayReturnsDates(shop, now);
  const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

  return [
    {
      key: "delivery",
      title: "Show delivery dates",
      done: shop.deliveryEstimates,
      detail: shop.deliveryEstimates ? "Product pages, the cart and receipts say when orders arrive." : "Buyers ordering gifts want to know when they'll arrive.",
      href: "/admin/shipping#delivery-heading",
    },
    {
      key: "order-by",
      title: "Set a last day to order",
      done: holiday !== null,
      detail: holiday ? `Product pages count back from ${fmt(holiday.arriveBy)} for ${holiday.name}.` : `"Order by Dec 15 to get it in time for Christmas" on product pages, the cart and checkout reminders.`,
      href: "/admin/shipping#holiday-heading",
    },
    {
      key: "returns",
      title: "Keep returns open for gifts",
      done: returns !== null,
      detail: returns
        ? `Orders from ${fmt(shop.holidayReturns!.from)} to ${fmt(shop.holidayReturns!.to)} can come back until ${fmt(shop.holidayReturns!.until)}.`
        : shop.returnWindowDays
          ? "Gifts get opened weeks later. Let holiday orders come back until the end of January."
          : "Set a return window first, then keep it open longer for holiday orders.",
      href: "/admin/returns#holiday-returns",
    },
    {
      key: "gift-cards",
      title: "Sell gift cards",
      done: !!giftCards,
      detail: giftCards ? "Your gift cards are on sale, for the buyer or sent to someone on a day they pick." : "The last-minute gift that never ships late.",
      href: "/admin/gift-cards#gc-sell",
    },
    {
      key: "gift-wrap",
      title: "Offer gift wrapping",
      done: !!shop.giftWrap,
      detail: shop.giftWrap ? "Buyers can add gift wrapping at checkout." : "A small charge at checkout for wrapping, with a note for the packer.",
      href: "/admin/shipping#gift-wrap",
    },
    {
      key: "sale",
      title: "Plan a Black Friday sale",
      done: !!sale,
      detail: sale ? "You have a sale running or coming up." : "Schedule it now; it starts and ends by itself, with a countdown if you like.",
      href: "/admin/sales",
    },
    {
      key: "reminders",
      title: "Remind buyers who leave at checkout",
      done: shop.abandonedCartEmails,
      detail: shop.abandonedCartEmails ? "Buyers who leave get a reminder, with the order-by date when there is one." : "Busy shoppers leave carts behind; one email brings many back.",
      href: "/admin/marketing#reminders-heading",
    },
    {
      key: "popup",
      title: "Collect emails with a sign-up offer",
      done: shop.signupPopupSeconds !== null,
      detail: shop.signupPopupSeconds !== null ? "New visitors are asked for their email." : "Holiday visitors who don't buy today can still hear about your sale.",
      href: "/admin/marketing#popup-heading",
    },
    {
      key: "late",
      title: "Email buyers when an order runs late",
      done: !!shop.lateOrderNotice,
      detail: shop.lateOrderNotice ? `Buyers hear from you when their order hasn't shipped after ${shop.lateOrderNotice.days} days.` : "Suppliers slow down in December. Buyers who hear first rarely open a dispute.",
      href: "/admin/shipping#late-heading",
    },
    {
      key: "backups",
      title: "Give best sellers a backup supplier",
      done: noBackup.length === 0,
      detail: best.length === 0
        ? "Once you sell, your best sellers show here."
        : noBackup.length === 0
          ? "Your best sellers can go to another supplier if theirs runs out."
          : `${noBackup.map((p) => p.title).slice(0, 3).join(", ")}${noBackup.length > 3 ? ` and ${noBackup.length - 3} more` : ""} ${noBackup.length === 1 ? "has" : "have"} no backup if the supplier runs out.`,
      href: noBackup[0] ? `/admin/products/${noBackup[0].id}#backup-heading` : "/admin/products",
    },
  ];
}
