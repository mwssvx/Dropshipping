// Drafts of the legal pages, written in plain language. They are NOT reviewed by a lawyer and must
// be before launch (see docs/launch.md). Placeholders in [brackets] need real details.

export type LegalDoc = { slug: string; title: string; short: string; summary: string; sections: { heading: string; body: string[] }[] };

export const LEGAL_DOCS: LegalDoc[] = [
  {
    slug: "terms",
    title: "Terms of Service",
    short: "Terms",
    summary: "The agreement between you and us when you use the platform, as a merchant or as a visitor.",
    sections: [
      { heading: "Who we are", body: ["The platform is run by [company legal name], [company address] (\"we\", \"us\"). By creating an account or using the platform you agree to these terms."] },
      { heading: "Your account", body: ["You must be at least 18 and able to form a contract. Keep your password safe; you're responsible for what happens in your account. Tell us at once at [support email] if you think someone else has access."] },
      { heading: "Your store", body: ["You're the seller to your buyers. You set your prices, describe products honestly, ship what you sell (through your supplier), and handle returns and refunds under the law where you and your buyers are.", "You must follow our Acceptable Use Policy and, if you take payments, the Merchant Agreement."] },
      { heading: "Fees", body: ["Plans and fees are on the pricing page. The Free plan takes 2% of each sale; paid plans are billed monthly in advance and take no share of sales. Card processing fees are charged by our payment partner. We'll give at least 30 days' notice before raising a price you pay."] },
      { heading: "Your content and data", body: ["You own your store's content. You give us the permission we need to host and show it to run your store. You can export your store at any time and close your account whenever you like."] },
      { heading: "AI features", body: ["AI features suggest and, where you allow it, take actions in your store. Actions that move money or change what buyers see wait for your approval unless you turn that off. Check what the AI writes before you rely on it."] },
      { heading: "If something goes wrong", body: ["We may pause a store that breaks these terms or puts buyers at risk. Except for urgent cases (like fraud or illegal goods), we'll warn you first, tell you why, and give you a way to appeal to a person.", "The platform is provided \"as is\". To the extent the law allows, our total liability to you for any claim is limited to the fees you paid us in the 12 months before it. [Lawyer to review limits and exclusions for each launch country.]"] },
      { heading: "Changes and contact", body: ["We'll tell you about material changes to these terms at least 30 days before they apply. Questions: [support email]. These terms are governed by the laws of [jurisdiction]."] },
    ],
  },
  {
    slug: "privacy",
    title: "Privacy Policy",
    short: "Privacy",
    summary: "What personal data we collect, why, who we share it with, and your rights.",
    sections: [
      { heading: "Who is responsible", body: ["For merchants' accounts, [company legal name] is the controller. For buyers' details in a store, the merchant is the controller and we process them on the merchant's behalf."] },
      { heading: "What we collect", body: ["Merchants: name, email, password (stored only as a secure hash), business and payout details collected by our payment partner, and how you use the platform.", "Buyers: the name, email, shipping address and order details needed to fulfil an order. Card details go straight to our payment partner; we never see or store them.", "Visitors: store analytics use a random visit id in a cookie that expires after 30 minutes. It isn't linked to a person or used across sites."] },
      { heading: "Why we use it", body: ["To run stores and process orders (contract), keep the platform safe and prevent fraud (legitimate interests), meet legal duties such as tax records (legal obligation), and send service emails. We don't sell personal data."] },
      { heading: "Who we share it with", body: ["Service providers that help us run the platform: payments (Stripe), hosting and database (Vercel, Supabase), email (Resend), suppliers who ship orders, push notifications (Expo), and AI processing (Anthropic) when AI features are used. Each is bound to protect the data. [List to be confirmed before launch.]"] },
      { heading: "How long we keep it", body: ["Account data while your account is open and for up to [period] afterwards; order and tax records as long as the law requires; visitor analytics for up to 13 months; sign-in attempts for a day."] },
      { heading: "Your rights", body: ["Depending on where you live, you can ask to see, correct, export or delete your data, or object to some uses. Merchants can export their store at any time. Buyers should contact the store first; we'll help the store respond. Contact: [privacy email]. You can also complain to your data protection authority."] },
      { heading: "International transfers", body: ["Some providers are outside your country. Where required, we use safeguards such as the EU Standard Contractual Clauses."] },
    ],
  },
  {
    slug: "acceptable-use",
    title: "Acceptable Use Policy",
    short: "Acceptable use",
    summary: "What can't be sold or done on the platform, and what happens if it is.",
    sections: [
      { heading: "Not allowed", body: ["Illegal goods or services; counterfeits and goods that infringe others' rights; weapons, drugs and drug paraphernalia; adult content; products making false health claims; anything our payment partner prohibits.", "Deceptive selling: fake reviews, fake countdowns or scarcity, hiding the real delivery time, or not shipping what was paid for.", "Abuse of the platform: attacking or overloading it, scraping other stores, spam, or using it to collect data for other purposes."] },
      { heading: "Delivery promises", body: ["Show realistic delivery times from your supplier, ship within them, and answer buyers. Stores with many late shipments, refunds or disputes get a warning with a date to fix things."] },
      { heading: "What happens", body: ["We usually warn first, say exactly what's wrong, and give a date. Serious or illegal cases may be paused at once. You can always appeal, and a person will review it."] },
    ],
  },
  {
    slug: "merchant-agreement",
    title: "Merchant Agreement",
    short: "Merchant agreement",
    summary: "Extra terms for stores that take payments: payouts, holds, refunds and disputes.",
    sections: [
      { heading: "Payments", body: ["Payments are processed by Stripe through a connected account in your name. You also agree to the Stripe Connected Account Agreement. We collect our fee (on the Free plan) as part of each payment."] },
      { heading: "Payouts and holds", body: ["Money is paid to your bank on a regular schedule after it clears. Our payment partner may pause payouts to check your identity or business, or when risk is high. When that happens we show you the reason, what's needed and how to send it, and we'll release the hold as soon as it's resolved."] },
      { heading: "Refunds and disputes", body: ["You're responsible for refunds and chargebacks on your sales. When you refund in full, our fee is returned too. Card disputes are handled through our payment partner; we'll show you what's needed to respond."] },
      { heading: "Taxes", body: ["You're responsible for registering for and paying sales tax and VAT where required. The platform can calculate and show tax where you've told us you're registered, and lists what you collected."] },
      { heading: "Ending", body: ["You can stop taking payments and close your store at any time; refunds and disputes on past orders stay your responsibility. [Lawyer to review notice periods and reserve terms.]"] },
    ],
  },
];
