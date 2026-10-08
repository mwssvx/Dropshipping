import Link from "next/link";
import { BRAND } from "@/lib/brand";

export const metadata = {
  title: { absolute: `${BRAND}: start a dropshipping store for free` },
  description: "Import products by link, let orders go to the supplier on their own, and get paid with no surprises. Reviews, discount codes, analytics, an app and AI help are built in.",
};

const INCLUDED = [
  ["Import by link", "Paste a supplier link and the product, photos, options and costs come in. AI writes the listing if you want."],
  ["Orders ship themselves", "Paid orders go to the supplier on their own, and tracking reaches your buyer. Problems land in one list with a fix."],
  ["Sell more, built in", "Discount codes, checkout reminder emails, reviews from real buyers and \"goes well with\" suggestions."],
  ["Know what works", "Sales, visitors, the path from visit to sale and your best sellers, without adding anything."],
  ["Your look, your domain", "A visual theme editor with a draft you publish when ready, collections, pages and your own domain."],
  ["Run it from your phone", "Today's sales, orders that need you, approvals and edits, with notifications, even on a train."],
  ["AI that asks first", "Agents answer buyers, fix stuck orders and watch your margins, and wait for your OK before anything that matters."],
  ["Connect anything", "An API and signed webhooks for your own tools. No app store between you and your data."],
];

const FIXES = [
  ["Payouts paused? You see why.", "Every hold shows the reason, what we need, and when money moves again. Send a document from your phone."],
  ["People when it matters", "The assistant handles routine questions and hands anything serious to a person, in the same chat."],
  ["No surprise shutdowns", "If something's wrong you get a warning, a reason and a date, and you can appeal to a person."],
  ["Leave whenever you like", "Export your whole store in one file, at any time, for free."],
];

const FAQ = [
  ["Do I need to hold stock?", "No. You list products from a supplier, and each paid order goes to them to pack and ship to your buyer."],
  ["What does it cost?", "Free costs $0 a month and takes 2% of each sale. Paid plans start at $19 a month and take nothing from your sales. Card processing fees are separate and the same on every plan."],
  ["How do I get paid?", "Through Stripe, straight to your bank. The Money page shows what each sale nets after fees and when the next payout lands."],
  ["Where can I sell?", "Stores can be based in the US, UK, EU and Canada at launch, and sell to buyers wherever your supplier ships."],
  ["Can I take my store elsewhere?", "Yes. One click downloads everything: products, collections, pages, your theme and settings."],
];

export default function Home() {
  return (
    <main>
      <section className="px-4 sm:px-8 pt-10 pb-16 max-w-6xl mx-auto grid gap-10 lg:grid-cols-[1.2fr_1fr] items-center">
        <div className="flex flex-col gap-6">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-[1.05]">Start a dropshipping store for $0. Keep more of every sale.</h1>
          <p className="text-lg text-muted max-w-xl">
            Import products by link, let orders go to the supplier on their own, and get paid with no surprises. Everything other
            platforms sell as extra apps is already here.
          </p>
          <div className="flex gap-3 flex-wrap">
            <Link href="/signup" className="btn btn-primary btn-lg">Open your store free</Link>
            <Link href="/pricing" className="btn btn-secondary btn-lg">See pricing</Link>
          </div>
          <p className="hint">No card needed. Free plan: $0 a month, 2% per sale.</p>
        </div>
        <ul className="card p-6 flex flex-col gap-4 text-sm">
          {FIXES.map(([t, d]) => (
            <li key={t} className="flex flex-col gap-1">
              <span className="font-semibold">{t}</span>
              <span className="text-muted">{d}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="px-4 sm:px-8 py-12 max-w-6xl mx-auto flex flex-col gap-6" aria-labelledby="included">
        <h2 id="included" className="text-2xl sm:text-3xl font-bold tracking-tight">Everything in the box</h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {INCLUDED.map(([t, d]) => (
            <li key={t} className="card p-5 flex flex-col gap-2">
              <h3 className="font-semibold">{t}</h3>
              <p className="text-sm text-muted">{d}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="px-4 sm:px-8 py-12 max-w-3xl mx-auto flex flex-col gap-4" aria-labelledby="faq">
        <h2 id="faq" className="text-2xl sm:text-3xl font-bold tracking-tight">Questions</h2>
        {FAQ.map(([q, a]) => (
          <details key={q} className="card p-4 group">
            <summary className="font-semibold cursor-pointer">{q}</summary>
            <p className="text-muted pt-2">{a}</p>
          </details>
        ))}
      </section>

      <section className="px-4 sm:px-8 py-12 max-w-3xl mx-auto text-center flex flex-col gap-4 items-center">
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Open your store in a few minutes.</h2>
        <Link href="/signup" className="btn btn-primary btn-lg">Start free</Link>
      </section>
    </main>
  );
}
