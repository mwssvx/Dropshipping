import Link from "next/link";
import { abandonedCartStats, birthdaysKnown, birthdayStats, customerTags, describeDiscount, listCodeBatches, MAX_BATCH, formatMoney, listDiscounts, productChoices, POST_PURCHASE_MINUTES, postPurchaseStats, referralStats, SIGNUP_POPUP_SECONDS, THANK_YOU_NOTE_MAX, SUBSCRIBE_WITHIN_DAYS, subscriptionStats, welcomeOfferStats, winbackDueCount, winbackStats } from "@sf/core";
import { requireShop, testPayments } from "@/lib/server";
import { sendOffersNowAction, sendRemindersNowAction, setDiscountActiveAction, setRemindersAction } from "../../growth-actions";
import { ReminderOfferForm } from "./ReminderOfferForm";
import { PageHeader } from "../PageHeader";
import { DiscountForm } from "./DiscountForm";
import { CodeBatchForm } from "./CodeBatchForm";
import { setCodeBatchActiveAction } from "../../code-batch-actions";
import { WelcomeOfferForm } from "./WelcomeOfferForm";
import { WinbackForm } from "./WinbackForm";
import { BirthdayForm } from "./BirthdayForm";
import { SignupPopupForm } from "./SignupPopupForm";
import { ThankYouForm } from "./ThankYouForm";
import { ReferralForm } from "./ReferralForm";
import { PostPurchaseForm } from "./PostPurchaseForm";
import { SubscriptionOfferForm } from "./SubscriptionOfferForm";

export const metadata = { title: "Marketing" };

const DAY = 86_400_000;
const date = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export default async function MarketingPage() {
  const { shop, db } = await requireShop("marketing");
  const [discounts, stats, welcome, referrals, products, afterCheckout, subs, winback, winbackDue, batches, tags, collections, birthdays, birthdayKnown] = await Promise.all([
    listDiscounts(db, shop.id),
    abandonedCartStats(db, shop.id, new Date(Date.now() - 30 * DAY)),
    welcomeOfferStats(db, shop.id),
    referralStats(db, shop.id),
    productChoices(db, shop.id),
    postPurchaseStats(db, shop.id),
    subscriptionStats(db, shop.id),
    winbackStats(db, shop.id),
    shop.winbackOffer ? winbackDueCount(db, shop, shop.winbackOffer) : null,
    listCodeBatches(db, shop.id),
    customerTags(db, shop.id),
    db.query.collections.findMany({ where: (c, { eq }) => eq(c.shopId, shop.id), columns: { id: true, title: true }, orderBy: (c, { asc }) => asc(c.title) }),
    birthdayStats(db, shop.id),
    birthdaysKnown(db, shop.id),
  ]);
  const collectionTitle = new Map(collections.map((c) => [c.id, c.title]));
  const money = (m: number) => formatMoney(m, shop.currency);
  const now = new Date();
  const state = (d: (typeof discounts)[number]) =>
    !d.active ? "Turned off" : d.endsAt && d.endsAt <= now ? "Expired" : d.startsAt && d.startsAt > now ? `Starts ${date(d.startsAt)}` : d.usageLimit !== null && d.used >= d.usageLimit ? "Used up" : "Live";

  return (
    <main className="pb-12">
      <PageHeader title="Marketing" />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-3xl">
        <section className="card p-5 flex flex-wrap items-center gap-3" aria-labelledby="campaigns-link-heading">
          <div className="flex-1 min-w-56">
            <h2 id="campaigns-link-heading" className="font-semibold">Email campaigns</h2>
            <p className="hint">Write to buyers who said yes to emails, and see the clicks and sales each email brings.</p>
          </div>
          <Link href="/admin/campaigns" className="btn btn-secondary">Open campaigns</Link>
        </section>
        <section className="card p-5 flex flex-wrap items-center gap-3" aria-labelledby="quiz-link-heading">
          <div className="flex-1 min-w-56">
            <h2 id="quiz-link-heading" className="font-semibold">Product quiz</h2>
            <p className="hint">{shop.productQuiz?.on ? `"${shop.productQuiz.title}" is on your store.` : "A few questions that point shoppers to the right products, using your product tags."}</p>
          </div>
          <Link href="/admin/quiz" className="btn btn-secondary">{shop.productQuiz ? "Edit the quiz" : "Make a quiz"}</Link>
        </section>
        <section className="card p-5 flex flex-wrap items-center gap-3" aria-labelledby="cart-links-heading">
          <div className="flex-1 min-w-56">
            <h2 id="cart-links-heading" className="font-semibold">Cart links</h2>
            <p className="hint">One link that fills a shopper&apos;s cart with the products you pick, and a code, for a DM, an ad or a creator.</p>
          </div>
          <Link href="/admin/cart-links" className="btn btn-secondary">Open cart links</Link>
        </section>
        <section className="card p-5 flex flex-col gap-4" aria-labelledby="codes-heading">
          <div>
            <h2 id="codes-heading" className="font-semibold">Discount codes</h2>
            <p className="hint">Buyers type a code in the cart. Only paid orders count toward a code's limit.</p>
          </div>
          {discounts.length ? (
            <ul className="divide-y divide-border border-y border-border">
              {discounts.map((d) => {
                const s = state(d);
                return (
                  <li key={d.id} className="py-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <span className="font-mono font-semibold">{d.code}</span>
                    <span className="flex-1 min-w-40">
                      {describeDiscount({ ...d, collectionTitle: d.collectionId ? (collectionTitle.get(d.collectionId) ?? "a deleted collection") : null }, shop.currency)}
                      <span className="hint">
                        {d.collectionId && !collectionTitle.has(d.collectionId) && " · stopped working when its collection was deleted"}
                        {d.usageLimit !== null && ` · ${d.usageLimit} uses`}
                        {d.oncePerCustomer && " · once per buyer"}
                        {d.firstOrderOnly && " · first orders only"}
                        {d.customerTag && ` · customers tagged “${d.customerTag}”`}
                        {d.automatic && " · automatic, no code needed"}
                        {d.endsAt && ` · until ${date(d.endsAt)}`}
                      </span>
                    </span>
                    <span className={`pill ${s === "Live" ? "pill-success" : "pill-neutral"}`}>{s}</span>
                    <span className="hint num w-full sm:w-auto">
                      Used {d.used} {d.used === 1 ? "time" : "times"}
                      {d.used > 0 && ` · ${money(d.salesMinor)} in sales · ${money(d.discountedMinor)} off`}
                      {d.used > 0 && <> · <Link href={`/admin/orders?code=${d.id}`} className="underline" aria-label={`See orders that used ${d.code}`}>See orders</Link> · <Link href={`/admin/customers?code=${d.id}`} className="underline" aria-label={`See customers who used ${d.code}`}>See customers</Link></>}
                    </span>
                    <form action={setDiscountActiveAction.bind(null, d.id, !d.active)}>
                      <button className="hint hover:text-ink" aria-label={`${d.active ? "Turn off" : "Turn on"} ${d.code}`}>{d.active ? "Turn off" : "Turn on"}</button>
                    </form>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="hint">No codes yet. A code to share on social media is a good start.</p>
          )}
          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <h3 className="font-medium text-sm">New code</h3>
            <DiscountForm currency={shop.currency} products={products.filter((p) => !p.giftCard && p.status !== "archived").map((p) => ({ id: p.id, title: p.title }))} tags={tags.map((t) => t.tag)} collections={collections} />
          </div>
        </section>

        <section id="one-time-codes" className="card p-5 flex flex-col gap-4" aria-labelledby="batches-heading">
          <div>
            <h2 id="batches-heading" className="font-semibold">One-time codes</h2>
            <p className="hint">Make many codes with the same offer, each good for one order, to print on a card in the parcel, give away at an event or hand to a creator. Download them as a spreadsheet.</p>
          </div>
          {batches.length > 0 && (
            <ul className="divide-y divide-border border-y border-border">
              {batches.map((b) => {
                const s = !b.active ? "Turned off" : b.endsAt && b.endsAt <= now ? "Expired" : b.used >= b.count ? "Used up" : "Live";
                return (
                  <li key={b.id} className="py-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <span className="font-medium">{b.name}</span>
                    <span className="flex-1 min-w-40">
                      {describeDiscount(b, shop.currency)}
                      <span className="hint">
                        {` · ${b.prefix}-…`}
                        {b.endsAt && ` · until ${date(b.endsAt)}`}
                      </span>
                    </span>
                    <span className={`pill ${s === "Live" ? "pill-success" : "pill-neutral"}`}>{s}</span>
                    <span className="hint num w-full sm:w-auto">{b.used} of {b.count} used</span>
                    <a className="hint hover:text-ink underline" href={`/admin/marketing/batches/${b.id}/codes.csv`} aria-label={`Download the ${b.name} codes`}>Download</a>
                    <form action={setCodeBatchActiveAction.bind(null, b.id, !b.active)}>
                      <button className="hint hover:text-ink" aria-label={`${b.active ? "Turn off" : "Turn on"} the ${b.name} codes`}>{b.active ? "Turn off" : "Turn on"}</button>
                    </form>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <h3 className="font-medium text-sm">New batch</h3>
            <CodeBatchForm currency={shop.currency} max={MAX_BATCH} />
          </div>
        </section>

        <section className="card p-5 flex flex-col gap-3" aria-labelledby="popup-heading">
          <h2 id="popup-heading" className="font-semibold">Sign-up pop-up</h2>
          <p className="text-sm">
            A small window asks new visitors for their email{shop.welcomeOffer ? `, with your welcome offer of ${shop.welcomeOffer.percentOff}% off` : ""}.
            It opens once, never on the cart, checkout or account pages, and not again after they close it or sign up. Signups confirm by
            email, like the form on your home page.
          </p>
          <SignupPopupForm seconds={shop.signupPopupSeconds} choices={SIGNUP_POPUP_SECONDS} />
        </section>

        <section className="card p-5 flex flex-col gap-3" aria-labelledby="thank-you-heading">
          <h2 id="thank-you-heading" className="font-semibold">Thank-you note</h2>
          <p className="text-sm">
            A few words for buyers who just paid, on their order page and in the order confirmation email. Point them to your
            social pages, say how long handmade items take, or just thank them.
          </p>
          <ThankYouForm note={shop.thankYouNote} max={THANK_YOU_NOTE_MAX} />
        </section>

        <section className="card p-5 flex flex-col gap-3" aria-labelledby="welcome-heading">
          <h2 id="welcome-heading" className="font-semibold">Welcome offer</h2>
          <p className="text-sm">
            When someone confirms their email signup on your store, we email them a code of their own. It works once, only with
            their email, until it expires. The signup form shows the offer, and people who have already bought from you don&apos;t
            get one.
          </p>
          <WelcomeOfferForm offer={shop.welcomeOffer} currency={shop.currency} />
          <dl className="grid grid-cols-3 gap-3 border-t border-border pt-3 text-sm">
            <div><dt className="hint">Codes sent</dt><dd className="text-lg font-semibold num">{welcome.sent}</dd></div>
            <div><dt className="hint">Used</dt><dd className="text-lg font-semibold num">{welcome.used}</dd></div>
            <div><dt className="hint">Sales</dt><dd className="text-lg font-semibold num">{money(welcome.salesMinor)}</dd></div>
          </dl>
        </section>

        <section className="card p-5 flex flex-col gap-3" aria-labelledby="winback-heading">
          <h2 id="winback-heading" className="font-semibold">Win-back emails</h2>
          <p className="text-sm">
            When someone who said yes to your emails hasn&apos;t ordered for a while, we email them a code of their own to come back. It
            works once, only with their email. Each person gets one per quiet spell: another only after they order again. Nobody who
            last ordered more than six months before that is emailed.
          </p>
          <WinbackForm offer={shop.winbackOffer} />
          {winbackDue !== null && (
            <p className="text-sm hint" role="note">
              {winbackDue === 0 ? "Nobody is due one right now." : `${winbackDue} ${winbackDue === 1 ? "person is" : "people are"} due one. It goes out with the next daily emails.`}
            </p>
          )}
          <dl className="grid grid-cols-3 gap-3 border-t border-border pt-3 text-sm" aria-label="Win-back results">
            <div><dt className="hint">Codes sent</dt><dd className="text-lg font-semibold num">{winback.sent}</dd></div>
            <div><dt className="hint">Came back</dt><dd className="text-lg font-semibold num">{winback.used}</dd></div>
            <div><dt className="hint">Sales</dt><dd className="text-lg font-semibold num">{money(winback.salesMinor)}</dd></div>
          </dl>
        </section>

        <section className="card p-5 flex flex-col gap-3" aria-labelledby="birthday-heading">
          <h2 id="birthday-heading" className="font-semibold">Birthday codes</h2>
          <p className="text-sm">
            Buyers can add their birthday (just the month and day) on their account page. On the day, everyone who said yes to your
            emails gets a code of their own, good once, only with their email. Each person gets one a year.
          </p>
          <BirthdayForm offer={shop.birthdayOffer} />
          <p className="text-sm hint" role="note">
            {birthdayKnown === 0 ? "No subscriber has added their birthday yet." : `${birthdayKnown} ${birthdayKnown === 1 ? "subscriber has" : "subscribers have"} added their birthday.`}
          </p>
          <dl className="grid grid-cols-3 gap-3 border-t border-border pt-3 text-sm" aria-label="Birthday code results">
            <div><dt className="hint">Codes sent</dt><dd className="text-lg font-semibold num">{birthdays.sent}</dd></div>
            <div><dt className="hint">Used</dt><dd className="text-lg font-semibold num">{birthdays.used}</dd></div>
            <div><dt className="hint">Sales</dt><dd className="text-lg font-semibold num">{money(birthdays.salesMinor)}</dd></div>
          </dl>
        </section>

        <section className="card p-5 flex flex-col gap-3" aria-labelledby="after-checkout-heading">
          <h2 id="after-checkout-heading" className="font-semibold">After-checkout offer</h2>
          <p className="text-sm">
            For {POST_PURCHASE_MINUTES} minutes after paying, the buyer&apos;s order page offers one more product at a discount. One click adds
            it to the card they just used, with no shipping charge, as its own order sent to the supplier.
          </p>
          <PostPurchaseForm offer={shop.postPurchaseOffer} products={products.filter((p) => p.status === "active" && !p.giftCard).map((p) => ({ id: p.id, title: p.title }))} />
          <dl className="grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm">
            <div><dt className="hint">Times added</dt><dd className="text-lg font-semibold num">{afterCheckout.orders}</dd></div>
            <div><dt className="hint">Extra sales</dt><dd className="text-lg font-semibold num">{money(afterCheckout.revenueMinor)}</dd></div>
          </dl>
        </section>

        <section className="card p-5 flex flex-col gap-3" aria-labelledby="subscribe-heading">
          <h2 id="subscribe-heading" className="font-semibold">Subscribe and save</h2>
          <p className="text-sm">
            For {SUBSCRIBE_WITHIN_DAYS} days after paying, the buyer&apos;s order page offers to send the same items again every 2 weeks,
            month or 2 months, for less. Each delivery is its own order, charged to the card they paid with and sent to the supplier.
            Buyers get an email 3 days before each charge and can skip, change, pause or cancel from a link. A card that fails three
            times pauses the subscription and tells the buyer.
          </p>
          <SubscriptionOfferForm offer={shop.subscriptionOffer} />
          <dl className="grid grid-cols-3 gap-3 border-t border-border pt-3 text-sm">
            <div><dt className="hint">Active</dt><dd className="text-lg font-semibold num">{subs.active}</dd></div>
            <div><dt className="hint">Repeat deliveries</dt><dd className="text-lg font-semibold num">{subs.orders}</dd></div>
            <div><dt className="hint">Repeat sales</dt><dd className="text-lg font-semibold num">{money(subs.salesMinor)}</dd></div>
          </dl>
          <Link href="/admin/subscriptions" className="text-sm underline self-start">See all subscriptions</Link>
        </section>

        <section className="card p-5 flex flex-col gap-3" aria-labelledby="refer-heading">
          <h2 id="refer-heading" className="font-semibold">Refer a friend</h2>
          <p className="text-sm">
            Buyers get a link to share on their order page and account. A friend who opens it asks for a code by email that works
            once, on a first order. When that order is delivered, the buyer who shared the link gets store credit as a gift card.
            Waiting for delivery means you never pay credit on an order that&apos;s refunded or charged back.
          </p>
          <ReferralForm program={shop.referralProgram} currency={shop.currency} />
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 border-t border-border pt-3 text-sm">
            <div><dt className="hint">Friends sent a code</dt><dd className="text-lg font-semibold num">{referrals.friends}</dd></div>
            <div><dt className="hint">Orders</dt><dd className="text-lg font-semibold num">{referrals.orders}</dd></div>
            <div><dt className="hint">Sales</dt><dd className="text-lg font-semibold num">{money(referrals.salesMinor)}</dd></div>
            <div><dt className="hint">Credit given</dt><dd className="text-lg font-semibold num">{money(referrals.creditMinor)}</dd></div>
          </dl>
        </section>

        <section className="card p-5 flex flex-col gap-3" aria-labelledby="reminders-heading">
          <h2 id="reminders-heading" className="font-semibold">Checkout reminders</h2>
          <p className="text-sm">
            When a buyer starts checkout but doesn't pay, we email them about an hour later with a link straight back to
            payment. Nobody gets more than one a day, and buyers who paid in the meantime are skipped. You can also send a
            second reminder a day later with a code.
          </p>
          <form action={setRemindersAction} className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="abandonedCartEmails" defaultChecked={shop.abandonedCartEmails} />
              Send checkout reminders
            </label>
            <button className="btn btn-secondary">Save</button>
          </form>
          <ReminderOfferForm percentOff={shop.abandonedCartOffer?.percentOff ?? null} />
          <dl className="grid grid-cols-3 gap-3 border-t border-border pt-3 text-sm">
            <div><dt className="hint">Sent, last 30 days</dt><dd className="text-lg font-semibold num">{stats.sent}</dd></div>
            <div><dt className="hint">Then paid</dt><dd className="text-lg font-semibold num">{stats.recovered}</dd></div>
            <div><dt className="hint">Sales won back</dt><dd className="text-lg font-semibold num">{money(stats.recoveredMinor)}</dd></div>
          </dl>
          {testPayments() && (
            <form action={sendRemindersNowAction} className="flex items-center gap-3 border-t border-border pt-3">
              <button className="btn btn-secondary">Send reminders now</button>
              <span className="hint">Test mode: sends as if an hour had passed.</span>
            </form>
          )}
          {testPayments() && shop.abandonedCartOffer && (
            <form action={sendOffersNowAction} className="flex items-center gap-3">
              <button className="btn btn-secondary">Send second reminders now</button>
              <span className="hint">Test mode: sends as if a day had passed.</span>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
