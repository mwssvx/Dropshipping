/**
 * Skills: playbooks the Assistant loads when a question needs them. Only each skill's name and one
 * line sit in the Assistant's instructions; the playbook itself is read with use_skill, so a long
 * list of skills costs almost nothing until one is used. A merchant can switch skills off in AI
 * settings. New skills are added here: a playbook is plain text, and any tools it names must be
 * the Assistant's.
 */
export type Skill = {
  /** Shown to the merchant. */
  title: string;
  /** One line: when the Assistant should load it. */
  when: string;
  playbook: string;
};

export const SKILLS = {
  data_analysis: {
    title: "Data analyst",
    when: "questions about how the store is doing, why sales changed, which products or customers matter most, or what to improve",
    playbook: `How to analyse the store's numbers:
1. Start broad: read_sales for 30 days (and 90 to compare), read_profit for the same period.
2. Find where money is lost: read_product_funnel (viewed but not added: price, photos, description or delivery time; added but not bought: shipping cost or checkout), read_returns (a repeated reason points at the listing or the supplier).
3. Look at customers: read_customers. Under 20% of buyers ordering twice means retention is the cheapest growth (win-back offer, email campaign, bundles). Lapsed buyers are the easiest to win back.
4. Look at demand: read_shopper_interest. Searches that found nothing are products to add or search fixes to make.
5. Compare like with like: a 7-day period against the 7 days before, not against 30 days. Say when a number is too small to mean much (fewer than about 10 orders or 100 visitors).
Answer with: the one or two numbers that matter, what they mean, and at most three actions in order of money at stake. For a full written review the owner can keep, offer review_store.`,
  },
  trend_research: {
    title: "Trend research",
    when: "what to sell next, what's trending or viral, new product ideas, or seasonal opportunities",
    playbook: `How to find products to sell:
1. Start from the store's own demand: read_shopper_interest (searches that found nothing are proven demand) and read_sales (what already sells, so ideas fit the niche).
2. For what's trending online right now, call find_trends with a short focus if the owner gave one. It searches TikTok, Instagram, Google, Amazon and Reddit, costs a few cents, and runs once a day; it saves the ideas on the Insights page.
3. Judge each idea: does it fit the store's niche and price range, can it ship in a reasonable time, is the margin at least 30% after supplier cost and fees, is it safe and not branded or trademarked.
4. Seasonal timing: start selling 4 to 8 weeks before the moment (holidays, back to school, summer).
Never present an idea as trending without a source; say what's a guess.`,
  },
  pricing: {
    title: "Pricing",
    when: "setting or changing prices, discounts, margins, or competing on price",
    playbook: `How to think about prices:
- Floor: supplier cost + shipping + payment fees + about 30% margin. find_products shows the margin per sale after fees.
- Charm prices (ending in .99 or .95) suit impulse products; round prices suit premium ones.
- A compare-at price must be a real earlier price, never invented.
- A sale beats a permanent cut: it gives a reason to buy now and the price comes back. Keep sales to 10-30% off and a few days long.
- Free shipping over a threshold set about 20-30% above the average order raises order value.
- Bundles and "buy more, save more" raise order value without cutting the price of the main product.
- If a product sells well at its price, test 10% higher before cutting anything.
Price changes on products on sale wait for the owner's OK.`,
  },
  marketing: {
    title: "Marketing",
    when: "getting more visitors, email campaigns, social media, ads, launch plans, or growing sales",
    playbook: `How to grow sales, cheapest first:
1. Keep the buyers you have: win-back offers for lapsed buyers, review request emails, a thank-you code on the next order.
2. Email the list: one campaign a week at most; one product or one idea per email; a clear subject line under 50 characters; send when buyers usually order.
3. Social media: short videos showing the product in use do best on TikTok, Reels and Shorts. Post often, reply to comments, and use the hook in the first two seconds. Real buyers' photos beat studio shots.
4. Search: product titles that use the words people search for, a search description for each product, and blog posts that answer buyers' questions.
5. Paid ads last: only for products with at least 30% margin. read_profit shows the return on ad spend and the level below which ads lose money; stop ads that stay below it for a week.
Never suggest fake reviews, fake urgency or misleading claims.`,
  },
  listings: {
    title: "Product listings",
    when: "improving product titles, descriptions, photos, or search engine visibility",
    playbook: `What makes a listing sell:
- Title: what it is, in the words buyers search for, under 70 characters, without supplier filler ("hot sale", model codes).
- First lines of the description: who it's for and the problem it solves. Then short bullet points with facts: size, materials, what's in the box, delivery time.
- Photos: at least 4, one in use, one showing size, plain background for the first.
- Delivery time near the top: uncertainty about delivery is the most common reason people leave.
- A size chart for anything worn, and answers to repeated questions added to the description.
The listing writer rewrites a product's title and description when the owner presses "Write with AI" on the product page.`,
  },
  customer_service: {
    title: "Customer service",
    when: "handling buyer messages, complaints, refunds, returns, or reviews",
    playbook: `How to handle buyers well:
- Answer within a day; a quick honest answer beats a slow perfect one.
- For "where is my order": give the tracking link and the expected window, and apologise for waits beyond it.
- For a complaint: acknowledge, say what you'll do and by when, then do it. Offer a replacement or refund before the buyer has to ask twice; a chargeback costs more.
- Negative reviews: reply publicly, briefly and politely, with what you changed. Never argue.
- Repeated questions belong in the product description or the FAQ page.
Refunds and messages to buyers wait for the owner's OK.`,
  },
} satisfies Record<string, Skill>;

export type SkillName = keyof typeof SKILLS;
export const SKILL_NAMES = Object.keys(SKILLS) as SkillName[];

/** The skills a store has on: all of them unless the merchant switched some off. */
export const enabledSkills = (off: readonly string[] | null | undefined) => SKILL_NAMES.filter((s) => !off?.includes(s));

/** The lines for the Assistant's instructions: one per skill that's on. */
export function skillMenu(off: readonly string[] | null | undefined) {
  const on = enabledSkills(off);
  if (!on.length) return "";
  return `Skills: before answering a question in one of these areas, call use_skill with its name to read the playbook, then follow it.\n${on.map((s) => `- ${s}: ${SKILLS[s].when}`).join("\n")}`;
}
