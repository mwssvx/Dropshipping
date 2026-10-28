import type { BetaContentBlock, BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages";
import type { AgentName } from "@sf/db";
import { brandProblems } from "./brand";
import { AGENT_MODELS, DEFAULT_MODEL, estimateTokens, text, toolCall, type ModelClient, type ModelRequest, type ModelResponse } from "./model";

/**
 * A stand-in for Claude so every agent works before an Anthropic API key is added. It follows each
 * agent's instructions with simple rules: it reads, then takes the obvious action. Its usage is an
 * estimate of what the real model would use, so budgets and costs behave the same way.
 */
export class DemoModel implements ModelClient {
  readonly live = false;
  constructor(
    readonly model = DEFAULT_MODEL,
    private readonly models: Partial<Record<AgentName, string>> = AGENT_MODELS,
  ) {}

  modelFor(agent: AgentName) {
    return this.models[agent] ?? this.model;
  }

  async create(req: ModelRequest): Promise<ModelResponse> {
    const state = readState(req.messages);
    const content = BRAINS[req.agent](state, req);
    const input = estimateTokens(req.system) + estimateTokens(JSON.stringify(req.tools)) + estimateTokens(JSON.stringify(req.messages));
    const output = estimateTokens(JSON.stringify(content)) + 150;
    return {
      content,
      stopReason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn",
      model: req.model,
      usage: { inputTokens: input, outputTokens: output, cacheReadTokens: 0, cacheWriteTokens: 0 },
    };
  }
}

type Called = { name: string; input: Record<string, unknown>; result: any; isError: boolean };
type State = { prompt: string; called: Called[]; has: (name: string) => Called | undefined };

function readState(messages: BetaMessageParam[]): State {
  const prompt = messages
    .filter((m) => m.role === "user")
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .filter(Boolean)
    .at(-1) ?? "";
  const calls = new Map<string, { name: string; input: Record<string, unknown> }>();
  const called: Called[] = [];
  for (const m of messages) {
    if (typeof m.content === "string") continue;
    for (const b of m.content) {
      if (b.type === "tool_use") calls.set(b.id, { name: b.name, input: b.input as Record<string, unknown> });
      if (b.type === "tool_result") {
        const c = calls.get(b.tool_use_id);
        if (!c) continue;
        const raw = typeof b.content === "string" ? b.content : "";
        let result: unknown = raw;
        try {
          result = JSON.parse(raw);
        } catch {}
        called.push({ ...c, result, isError: !!b.is_error });
      }
    }
  }
  return { prompt, called, has: (name) => [...called].reverse().find((c) => c.name === name) };
}

const strip = (s: unknown) => String(s ?? "").replace(/<\/?untrusted_data[^>]*>/g, "").trim();
const waiting = (c: Called | undefined) => c?.result?.status === "waiting_for_merchant";
const minor = (n: number) => `$${(n / 100).toFixed(2)}`;

/* ───────────── Listing writer ───────────── */

const JUNK = /\b(hot sale|new arrival|20\d\d new|free shipping|dropshipping|wholesale|high quality|best seller|cheap|factory)\b/gi;

/** The demo's rewrite after a draft broke the store's writing rules: drop banned words and the lines with made-up numbers. */
function keepToRules(req: ModelRequest, refused: Called) {
  const banned = [...(req.system.match(/Never use these words or phrases: (.*)\./)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
  const max = Number(req.system.match(/Product titles are at most (\d+) characters/)?.[1] ?? 120);
  const made = [...(strip(refused.result).match(/has ((?:"\d+"(?:, )?)+), which/)?.[1] ?? "").matchAll(/"(\d+)"/g)].map((m) => m[1]!);
  const clean = (t: unknown) =>
    banned.reduce((acc, w) => acc.replace(new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), ""), String(t ?? "")).replace(/[ \t]{2,}/g, " ").replace(/ ([,.:])/g, "$1").trim();
  const lines = (t: unknown) => String(t ?? "").split("\n").filter((l) => !made.some((n) => new RegExp(`\\b${n}\\b`).test(l))).join("\n");
  const i = refused.input;
  return { title: clean(i.title).slice(0, max).trim(), description: clean(lines(i.description)), search_description: clean(lines(i.search_description)) };
}

function listing(s: State, req: ModelRequest): BetaContentBlock[] {
  const product = s.has("get_product");
  if (!product) return [toolCall("get_product", {})];
  const saved = s.has("save_listing");
  if (saved?.isError) {
    if (s.called.filter((c) => c.name === "save_listing").length < 2) return [toolCall("save_listing", keepToRules(req, saved))];
    return [text(`I couldn't write a listing that keeps to your writing rules (${strip(saved.result)}). Nothing was changed.`)];
  }
  if (!saved) {
    const p = product.result;
    const source = p.supplier_listing && typeof p.supplier_listing === "object" ? p.supplier_listing : null;
    const raw = strip(source?.title ?? p.title).replace(JUNK, "").replace(/[A-Z]{2,}\d+[A-Z\d-]*/g, "").replace(/\s{2,}/g, " ").trim();
    const title = raw.toLowerCase().replace(/\b\w/g, (c: string) => c.toUpperCase()).slice(0, 70) || p.title;
    const notes = strip(source?.description ?? p.description)
      .split(/\n+|(?<=\.)\s+/)
      .map((l: string) => l.replace(/^[•*-]\s*/, "").trim())
      .filter((l: string) => l.length > 3 && !l.toLowerCase().startsWith(title.toLowerCase()));
    const options = (p.options as { name: string; ships_in_days: string | null }[]).map((o) => o.name).filter((n) => n !== "Default");
    const days = p.options.find((o: { ships_in_days: string | null }) => o.ships_in_days)?.ships_in_days;
    const bullets = [
      ...notes.slice(0, 3),
      options.length ? `Available in ${options.join(" and ").toLowerCase()}` : null,
      days ? `Delivered in about ${days.replace("-", " to ")} days` : null,
    ].filter(Boolean);
    while (bullets.length < 3) bullets.push(bullets.length ? "Easy returns through our store" : `A ${title.toLowerCase()} that's ready to use out of the box`);
    const description = `${title}: a simple, good-looking pick for everyday use${options.length ? `, in ${options.length} options` : ""}.\n\n${bullets.map((b) => `• ${b}`).join("\n")}`;
    const search = `${title}${options.length ? `, in ${options.join(" or ").toLowerCase()}` : ""}${days ? `. Delivered in about ${days.replace("-", " to ")} days` : ""}.`.slice(0, 160);
    return [toolCall("save_listing", { title, description, search_description: search })];
  }
  return [text(waiting(saved) ? `I wrote a new title (“${saved.input.title}”) and description. The product is on sale, so it's waiting for your OK.` : `I saved a new title (“${saved.input.title}”) and a clearer description with bullet points. The product is still a draft.`)];
}

/* ───────────── Blog writer ───────────── */

function writer(s: State): BetaContentBlock[] {
  const read = s.has("read_products");
  const picked = s.prompt.match(/Feature these products: (.+)/)?.[1]?.split(/,\s*/) ?? [];
  if (!read) return [toolCall("read_products", picked.length ? { product_ids: picked } : {})];
  const saved = s.has("save_post_draft");
  if (!saved || saved.isError) {
    const topic = strip(s.prompt.match(/Topic: (.+)/)?.[1] ?? "our favourite things").replace(/[.?!]+$/, "");
    const title = topic.charAt(0).toUpperCase() + topic.slice(1);
    const products = (read.result?.products ?? []).slice(0, 3) as { id: string; title: string; price_from: string }[];
    const store = read.result?.store?.name ?? "our store";
    const body = [
      `If you've been wondering about ${topic.toLowerCase()}, you're not alone. It's one of the questions we hear most at ${store}, so here's a short, practical guide.`,
      "## Start with what you need",
      "Think about where and how you'll use it before you think about looks. A quick list of must-haves saves a lot of second-guessing later, and makes it easier to compare options side by side.",
      "## What to look for",
      "• Something that fits the space and the way you live\n• Simple to set up and easy to look after\n• A price that feels right for how often you'll use it",
      ...(products.length
        ? ["## Our picks", products.map((p) => `• ${p.title}, from ${p.price_from}`).join("\n"), "Each of these is one we'd happily recommend to a friend. Tap any of them below to see the details."]
        : []),
      "## The short version",
      "Keep it simple, buy for the way you actually live, and don't be afraid to ask us if you're unsure. We read every message.",
    ].join("\n\n");
    return [toolCall("save_post_draft", { title, excerpt: `A short, practical guide to ${topic.toLowerCase()}, with a few of our favourite picks.`, body, product_ids: products.map((p) => p.id) })];
  }
  return [text(`I drafted “${saved.input.title}”. It's saved as a draft, so read it over, change anything you like, and publish when you're happy.`)];
}

/* ───────────── Translator ───────────── */

// The demo can't really translate, so it marks each text with the language, which is enough to
// see translations flow through the admin and the store.
function translator(s: State): BetaContentBlock[] {
  const saved = s.has("save_translations");
  const language = s.prompt.match(/language code ([a-z]{2})/)?.[1] ?? "de";
  if (!saved) {
    let items: { kind: string; ref_id: string; source: Record<string, string> }[] = [];
    try {
      items = JSON.parse(strip(s.prompt.slice(s.prompt.indexOf("<untrusted_data"))).replace(/^source="[^"]*">/, "").trim());
    } catch {
      return [text("I couldn't read the items to translate.")];
    }
    const tag = `[${language.toUpperCase()}]`;
    return [
      toolCall("save_translations", {
        language,
        items: items.map((i) => ({ kind: i.kind, ref_id: i.ref_id, fields: Object.fromEntries(Object.entries(i.source).map(([k, v]) => [k, `${tag} ${v}`])) })),
      }),
    ];
  }
  const n = saved.result?.saved ?? 0;
  return [text(`I translated ${n} item${n === 1 ? "" : "s"}. Read them over on the Languages page and change anything that doesn't sound right.`)];
}

/* ───────────── Question answerer ───────────── */

// Answers what the listing data can answer (delivery, options, stock, price) and marks the rest
// for the merchant to check, like the real model is told to.
function answerer(s: State): BetaContentBlock[] {
  const id = s.prompt.match(/question ([0-9a-f-]{36})/)?.[1] ?? "";
  const q = s.has("read_question");
  if (!q) return [toolCall("read_question", { question_id: id })];
  if (q.isError) return [text("I couldn't find that question.")];
  const ask = strip(q.result.question).toLowerCase();
  const policyQuestion = /\b(return|refund|ship|shipping|deliver|delivery|arrive|pay|payment)/.test(ask);
  if (policyQuestion && !s.has("read_store_policies")) return [toolCall("read_store_policies", {})];
  if (!s.has("save_answer_draft")) {
    const p = q.result.product;
    const options: { name: string; price: string; in_stock: boolean; delivery_days: string | null }[] = p.options ?? [];
    const parts: string[] = [];
    if (/\b(ship|shipping|deliver|delivery|arrive|how long|when)/.test(ask)) {
      const days = options.find((o) => o.delivery_days)?.delivery_days;
      if (days) parts.push(`It usually arrives in ${days.replace("-", " to ")} days after you order.`);
    }
    if (/\b(size|sizes|colou?r|option|options|version|come in)/.test(ask) && options.length) {
      parts.push(options.length === 1 && options[0]!.name === "Default" ? "It comes in one version." : `It comes in ${options.map((o) => o.name).join(", ")}.`);
    }
    if (/\b(stock|available|sold out|back)/.test(ask)) {
      const inStock = options.filter((o) => o.in_stock);
      parts.push(inStock.length ? `${inStock.length === options.length ? "Every option is" : `${inStock.map((o) => o.name).join(", ")} ${inStock.length === 1 ? "is" : "are"}`} in stock right now.` : "It's sold out at the moment; leave your email on the product page and we'll tell you when it's back.");
    }
    if (/\b(price|cost|how much)/.test(ask) && options.length) parts.push(`It's ${options[0]!.price}.`);
    const answer = parts.length ? `Thanks for asking! ${parts.join(" ")}` : `[Check: the listing doesn't say, so ask your supplier] Thanks for asking about the ${p.title}! `;
    return [toolCall("save_answer_draft", { question_id: id, answer: answer.padEnd(10, " ") })];
  }
  return [text("I drafted an answer. Read it over, change anything you need, and send it.")];
}

/* ───────────── Size chart drafter ───────────── */

const SIZE_NAME = /^\s*(?:size\s*)?(XXS|XS|S|M|L|XL|XXL|XXXL|[2-5]XL|\d{1,2})\s*[:\-–]\s*(.+)$/i;
const MEASURE = /([A-Za-z][A-Za-z ]{1,20}?)\s*:?\s*(\d+(?:\.\d+)?(?:\s*[-–~]\s*\d+(?:\.\d+)?)?)\s*(cm|in|inch|inches|")?/g;

// Reads "S: Bust 86cm Length 62cm" style lines from the description; without any, drafts the
// sizes from the options with empty cells and asks the merchant to check, like the real model.
function sizer(s: State): BetaContentBlock[] {
  const read = s.has("read_product_sizes");
  if (!read) return [toolCall("read_product_sizes", {})];
  if (read.isError) return [text("I couldn't find that product.")];
  if (!s.has("save_size_chart_draft")) {
    const p = read.result;
    const lines = strip(p.product.description).split(/\n|;/);
    const columns = ["Size"];
    const rows: string[][] = [];
    let inches = false;
    for (const line of lines) {
      const m = line.match(SIZE_NAME);
      if (!m) continue;
      const cells: Record<string, string> = {};
      for (const [, label, value, unit] of m[2]!.matchAll(MEASURE)) {
        const name = label!.trim().replace(/^bust$/i, "Chest").replace(/^\w/, (c) => c.toUpperCase());
        if (!columns.includes(name)) columns.push(name);
        cells[name] = value!.replace(/\s*[-–~]\s*/, "-");
        if (unit && /^(in|inch|inches|")$/.test(unit)) inches = true;
      }
      if (Object.keys(cells).length) rows.push([m[1]!.toUpperCase(), ...columns.slice(1).map((c) => cells[c] ?? "")]);
    }
    const title = strip(p.product.title);
    if (rows.length) {
      for (const r of rows) while (r.length < columns.length) r.push("");
      return [toolCall("save_size_chart_draft", { name: `${title.slice(0, 48)} sizes`, unit: inches ? "in" : "cm", columns, rows, note: "Measured flat, garment laid out. Compare with a piece that fits you well." })];
    }
    const options: Record<string, string[]> = p.options ?? {};
    const sizes = Object.entries(options).find(([k]) => /size/i.test(k))?.[1] ?? (p.option_names as string[]).filter((n) => n !== "Default");
    return [
      toolCall("save_size_chart_draft", {
        name: `${title.slice(0, 48)} sizes`,
        unit: "cm",
        columns: ["Size", "Chest", "Length"],
        rows: (sizes.length ? sizes : ["One size"]).slice(0, 30).map((n) => [n, "", ""]),
        note: "[Check: the description has no measurements, so ask your supplier for each size] Measured flat, garment laid out.",
      }),
    ];
  }
  const saved = s.has("save_size_chart_draft")!;
  if (saved.isError) return [text(`I couldn't save the chart: ${strip(saved.result)}`)];
  return [text("I drafted a size chart from the description. Check the measurements, fill in anything empty, and show it on your store.")];
}

/* ───────────── Buyer support ───────────── */

function buyerSupport(s: State): BetaContentBlock[] {
  const order = s.has("read_order");
  if (!order) return [toolCall("read_order", {})];
  const ask = strip(s.prompt.split("The buyer's new message:").at(-1)).toLowerCase();
  const o = order.result;
  const name = o.buyer_first_name ?? "there";

  if (/\b(scam|fraud|police|lawyer|sue|court)\b/.test(ask)) {
    if (!s.has("hand_over")) return [toolCall("hand_over", { to: "platform", reason: "The buyer says the store is a scam or mentions legal action." })];
    return [text("The buyer raised fraud or legal concerns, so I sent this to the platform's trust team and didn't reply.")];
  }
  if (/\b(refund|money back|cancel|chargeback|exchange|change (my|the) address|wrong|broken|damaged|angry|terrible|awful|complain|ignore)/.test(ask) || /ignore (all|previous|your)/.test(ask)) {
    if (!s.has("hand_over")) return [toolCall("hand_over", { to: "merchant", reason: "The buyer wants a refund, a change, or is unhappy. A person should answer." })];
    return [text("The buyer asked for something only you can decide (refund, change or complaint), so I handed it to you without replying.")];
  }

  const isReturns = /\b(return|send it back|policy)\b/.test(ask);
  const isShipping = /\b(how long|shipping time|delivery time|when will)\b/.test(ask);
  const isStatus = /\b(where|track|tracking|arrive|status|shipped|received|haven't got|not got)\b/.test(ask);
  if (!isReturns && !isShipping && !isStatus) {
    if (!s.has("hand_over")) return [toolCall("hand_over", { to: "merchant", reason: "The question isn't something the order data or policies answer." })];
    return [text("I couldn't answer this from the order or policies, so I handed it to you.")];
  }
  if (isReturns && !s.has("read_store_policies")) return [toolCall("read_store_policies", {})];

  const reply = s.has("send_reply");
  if (!reply) {
    let body: string;
    let topic: string;
    if (isReturns) {
      topic = "returns";
      const page = (s.has("read_store_policies")!.result.pages as { title: string; text: string }[]).find((p) => /return|refund/i.test(p.title));
      if (!page) {
        return s.has("hand_over")
          ? [text("The store has no returns page, so I handed this to you.")]
          : [toolCall("hand_over", { to: "merchant", reason: "The buyer asked about returns and the store hasn't published a returns policy." })];
      }
      body = `Hi ${name},\n\nThanks for getting in touch. Here's our returns policy: ${strip(page.text).slice(0, 400)}\n\nJust reply here if you'd like to start a return.`;
    } else {
      topic = isStatus ? "order_status" : "shipping_time";
      const parcel = (o.parcels as { status: string; carrier: string | null; tracking_number: string | null; tracking_link: string | null }[]).find((p) => p.tracking_number);
      if (parcel) {
        body = `Hi ${name},\n\nGood news: order #${o.order_number} is on its way with ${parcel.carrier}. Your tracking number is ${parcel.tracking_number}${parcel.tracking_link ? ` and you can follow it here: ${parcel.tracking_link}` : ""}.${o.usual_delivery_time ? ` Delivery usually takes ${o.usual_delivery_time.split(" after")[0]}.` : ""}`;
      } else if (o.delivery === "problem") {
        return s.has("hand_over")
          ? [text("This order has a supplier problem, so I handed it to you.")]
          : [toolCall("hand_over", { to: "merchant", reason: "The order has a supplier problem that needs fixing before we can answer." })];
      } else {
        body = `Hi ${name},\n\nThanks for your patience. Order #${o.order_number} is being prepared by our supplier and hasn't shipped yet.${o.usual_delivery_time ? ` Once it's sent, delivery usually takes ${o.usual_delivery_time.split(" after")[0]}.` : ""} We'll email you the tracking number as soon as it ships.`;
      }
    }
    return [toolCall("send_reply", { topic, message: `${body}\n\nBest wishes,\nThe team` })];
  }
  return [text(waiting(reply) ? "I drafted a reply for you to check in the inbox." : "I answered the buyer's question with their order details.")];
}

/* ───────────── Fulfilment ───────────── */

function fulfilment(s: State): BetaContentBlock[] {
  const read = s.has("read_problem_order");
  if (!read) return [toolCall("read_problem_order", {})];
  const o = read.result;
  const code: string | null = o.problem;
  if (code === "supplier_unreachable" || code === "unknown" || code === "insufficient_balance") {
    const retry = s.has("retry_supplier_order");
    if (!retry) return [toolCall("retry_supplier_order", {})];
    return [text(retry.result?.fixed ? `The supplier didn't answer the first time. I sent order #${o.order_number} again and it went through.` : `I tried order #${o.order_number} again but the supplier still refuses it. ${o.suggested_fix ?? ""}`)];
  }
  if (code === "out_of_stock" || code === "product_unavailable") {
    const same = (o.alternatives as { order_line_id: string; options: { variant_id: string; same_price_and_cost: boolean; stock: number | null; name: string }[] }[])
      .flatMap((a) => a.options.filter((x) => x.same_price_and_cost && (x.stock ?? 1) > 0).map((x) => ({ line: a.order_line_id, ...x })))
      .find((x) => x.name === o.items.find((i: { order_line_id: string; title: string }) => i.order_line_id)?.title?.split(" – ").at(-1));
    if (same && !s.has("swap_variant")) return [toolCall("swap_variant", { order_line_id: same.line, variant_id: same.variant_id })];
    if (!s.has("propose_refund")) return [toolCall("propose_refund", { reason: "The supplier is out of stock and there's no identical option to send instead." })];
    if (!s.has("message_buyer")) {
      return [toolCall("message_buyer", { message: `Hi ${o.buyer_first_name},\n\nI'm sorry: the item you ordered (order #${o.order_number}) has sold out at our supplier and we can't send it. We're refunding your payment in full; it usually shows on your card within 5 to 10 days.\n\nSorry again for the trouble.` })];
    }
    return [text(`Order #${o.order_number} can't be sent: the supplier is out of stock and there's no identical option. I proposed a full refund of ${o.refundable} and drafted an apology to the buyer. Both wait for your OK.`)];
  }
  if (code === "address_unsupported") {
    if (!s.has("message_buyer")) {
      return [toolCall("message_buyer", { message: `Hi ${o.buyer_first_name},\n\nOur supplier can't deliver order #${o.order_number} to the address you gave (${o.ship_to_country}). Could you reply with a different delivery address? If that's not possible we'll refund you in full.` })];
    }
    if (!s.has("propose_refund")) return [toolCall("propose_refund", { reason: "The supplier can't ship to the buyer's address." })];
    return [text(`The supplier can't ship order #${o.order_number} to ${o.ship_to_country}. I drafted a message asking the buyer for another address and proposed a refund in case they can't. Both wait for your OK.`)];
  }
  return [text(`Order #${o.order_number} has a problem I can't fix on my own. ${o.suggested_fix ?? "Check it on the order page."}`)];
}

/* ───────────── Margin watch ───────────── */

function margin(s: State): BetaContentBlock[] {
  const read = s.has("read_costs");
  if (!read) return [toolCall("read_costs", {})];
  type Row = { product_id: string; variant_id: string; product: string; on_sale: boolean; price_minor: number; supplier_cost_minor: number | null; fees_minor: number; margin_pct: number | null };
  const thin = (read.result.products as Row[]).filter((r) => r.on_sale && r.margin_pct !== null && r.margin_pct < 10);
  for (const r of thin) {
    const done = s.called.some((c) => (c.name === "change_price" && c.input.variant_id === r.variant_id) || (c.name === "pause_product" && c.input.product_id === r.product_id));
    if (done) continue;
    // Price for about 30% left after cost and fees, ending in .99.
    const target = Math.ceil(((r.supplier_cost_minor ?? 0) + 30) / (1 - 0.3 - 0.029 - 0.02) / 100) * 100 - 1;
    if (r.supplier_cost_minor !== null && target < r.price_minor * 3) {
      return [toolCall("change_price", { variant_id: r.variant_id, price_minor: target, reason: `It keeps ${r.margin_pct}% after the supplier and fees; ${minor(target)} keeps about 30%.` })];
    }
    return [toolCall("pause_product", { product_id: r.product_id, reason: "It loses money and a sensible price can't fix it." })];
  }
  const acts = s.called.filter((c) => c.name !== "read_costs");
  if (!acts.length) return [text("All products on sale keep a healthy margin. Nothing to change.")];
  return [
    text(
      acts
        .map((c) => `• ${c.name === "change_price" ? `Price change to ${minor(Number(c.input.price_minor))}` : "Take a product off sale"}: ${c.input.reason} ${waiting(c) ? "(waiting for your OK)" : c.isError ? "(not allowed)" : "(done)"}`)
        .join("\n"),
    ),
  ];
}

/* ───────────── Merchant assistant ───────────── */

function assistant(s: State, req: ModelRequest): BetaContentBlock[] {
  const ask = s.prompt.split("\n\n(Today is")[0]!.toLowerCase();
  const num = ask.match(/#?\b(\d{4,})\b/)?.[1];
  // A skill is on when it's listed in the instructions.
  const skill = (name: string) => req.system.includes(`\n- ${name}: `);
  const trends = () => {
    const focus = ask.match(/\bfor ([a-z0-9 '&-]{3,60})/)?.[1]?.trim();
    return toolCall("find_trends", focus ? { focus } : {});
  };
  if (!s.called.length) {
    const original = s.prompt.split("\n\n(Today is")[0]!.trim();
    const forget = original.match(/^(?:please\s+)?forget(?: that| about)?\s+(.{3,200})$/i);
    if (forget) return [toolCall("forget", { note: forget[1]!.replace(/[.!]+$/, "") })];
    const remember = original.match(/^(?:please\s+)?(?:remember|note)(?: that)?[:,]?\s+(.{3,200})$/i);
    if (remember) return [toolCall("remember", { note: remember[1]!.replace(/[.!]+$/, "").replace(/^\w/, (ch) => ch.toUpperCase()) })];
    const code = original.match(/\b(?:code|coupon|discount)\s+(?:called\s+|named\s+)?([A-Z0-9_-]{3,30})\b/)?.[1];
    const pct = ask.match(/(\d{1,3})\s*%/)?.[1];
    if (code && (pct || /free shipping/.test(ask))) {
      const over = ask.match(/\b(?:over|above|of at least)\s+\$?(\d+(?:\.\d+)?)/)?.[1];
      const days = ask.match(/\b(?:for|lasts?)\s+(\d{1,3})\s+days?\b/)?.[1] ?? (/\b(this|for a|one) week\b/.test(ask) ? "7" : null);
      return [
        toolCall("create_discount", { code, kind: pct ? "percent" : "free_shipping", value: pct ? Number(pct) : 0, min_order: over ? Number(over) : null, days: days ? Number(days) : null, usage_limit: null, once_per_customer: /once (per|a) (customer|buyer)/.test(ask) }),
      ];
    }
    const coll = ask.match(/\b(?:collection|page) (?:of|for|with) (?:all )?(?:my |the |our )?([a-z0-9 '&-]{3,40}?)s?(?: products)?(?: called ["“]?([^"”]{2,60})["”]?)?[.!]?$/);
    if (coll && /\b(make|create|add|start|build)\b/.test(ask)) return [toolCall("find_products", { search: coll[1]!.trim() })];
    if (/\b(human|person|support team|ticket|payout|hold|frozen|bug)\b/.test(ask)) {
      return [toolCall("open_ticket", { subject: ask.slice(0, 80).replace(/^\w/, (c) => c.toUpperCase()), details: `The merchant asked: “${ask.slice(0, 1500)}”. Please get in touch with them.` })];
    }
    if (/resend|didn't get|never got|no email/.test(ask) && num) {
      return [toolCall("resend_email", { order_number: Number(num), email: /ship|track/.test(ask) ? "shipping_update" : "order_confirmation" })];
    }
    if (/\b(tax|vat)\b/.test(ask) && /\b(include|included|including|inclusive|add|added|on top)\b/.test(ask)) {
      return [toolCall("change_setting", { setting: "prices_include_tax", value: /on top|added|add\b|exclud/.test(ask) ? "false" : "true" })];
    }
    if (/\b(trend(s|ing)?|viral|sell next|what (should|could|to) i sell|what to sell|product ideas?)\b/.test(ask)) {
      return [skill("trend_research") ? toolCall("use_skill", { skill: "trend_research" }) : trends()];
    }
    if (/\b(review|improve|analy[sz]e|analysis|grow)\b/.test(ask) && /\b(store|shop|business|sales|customers?)\b/.test(ask)) {
      return [skill("data_analysis") ? toolCall("use_skill", { skill: "data_analysis" }) : toolCall("review_store", {})];
    }
    if (num) return [toolCall("read_order", { order_number: Number(num) })];
    if (/\b(sell|selling|sales|best ?sellers?|visitors?|conversion)\b/.test(ask)) return [toolCall("read_sales", { days: /\bweek\b|7 days/.test(ask) ? 7 : /90|quarter|3 months/.test(ask) ? 90 : 30 })];
    if (/\b(search|searching|looking for|shoppers? (want|ask))/.test(ask)) return [toolCall("read_shopper_interest", {})];
    if (/\b(stock|inventory|run(ning)? (out|low)|restock)\b/.test(ask)) return [toolCall("read_stock", {})];
    if (/\b(problem|stuck|fail|issue)\b/.test(ask)) return [toolCall("find_orders", { filter: "problem" })];
    if (/\b(product|margin|price|cost)\b/.test(ask)) return [toolCall("find_products", {})];
    if (/\b(orders?)\b/.test(ask)) return [toolCall("find_orders", { filter: /unfulfilled|not sent|waiting/.test(ask) ? "unfulfilled" : "all" })];
    return [toolCall("read_store", {})];
  }
  const c = s.called.at(-1)!;
  if (c.isError) return [text(`I couldn't do that: ${strip(c.result)}`)];
  const r = c.result;
  switch (c.name) {
    case "create_discount":
    case "create_collection":
      return [text(waiting(c) ? `I've set that up; it's waiting for your OK next to this chat, with a preview of what it will do.` : `Done.`)];
    case "remember":
      return [text(`Got it, I'll remember that: “${c.input.note}”. You can see and edit what I remember in AI settings.`)];
    case "forget":
      return [text(`Done, I've forgotten “${r.forgot}”.`)];
    case "use_skill":
      return [c.input.skill === "trend_research" ? trends() : toolCall("review_store", {})];
    case "review_store":
    case "find_trends": {
      const rep = r.latest ?? r;
      const items = (rep.items as { title: string; action: string }[]).slice(0, 3).map((i) => `• ${i.title}: ${i.action}`);
      return [
        text(
          `${r.note ? `${r.note} Here's the latest one, from ${rep.made_on}.` : rep.summary}\n${items.join("\n")}\n\nThe full ${c.name === "review_store" ? "review" : "list, with sources,"} is on the Insights page.`,
        ),
      ];
    }
    case "open_ticket":
      return [text("I've asked our support team to look into it. They usually reply within one working day, right here in this chat.")];
    case "resend_email":
    case "change_setting":
      return [text(`Nothing has changed yet: that change waits for your OK in the list on the right.`)];
    case "read_order": {
      const parcel = r.parcels?.find((p: { tracking_number: string | null }) => p.tracking_number);
      return [
        text(
          `Order #${r.order_number} (${r.total}) from ${r.buyer_first_name}, placed ${r.placed_on}: payment ${r.payment}, delivery ${r.delivery.replace(/_/g, " ")}.` +
            (parcel ? ` Tracking: ${parcel.carrier} ${parcel.tracking_number}.` : "") +
            (r.how_to_fix ? ` To fix it: ${r.how_to_fix}` : ""),
        ),
      ];
    }
    case "find_orders": {
      const rows = r as { order_number: number; buyer: string; total: string; delivery: string }[];
      if (!rows.length) return [text(c.input.filter === "problem" ? "No orders have a delivery problem right now." : "No orders match that yet.")];
      return [text(`${rows.length === 10 ? "The 10 most recent" : rows.length} order${rows.length === 1 ? "" : "s"}:\n${rows.map((o) => `• #${o.order_number}, ${o.buyer}, ${o.total}, ${o.delivery.replace(/_/g, " ")}`).join("\n")}`)];
    }
    case "read_sales": {
      const best = (r.best_sellers ?? []).slice(0, 3).map((p: { product: string; units: number; sales: string }) => `${p.product} (${p.units} sold, ${p.sales})`);
      return [
        text(
          `In the last ${r.days} days: ${r.orders} order${r.orders === 1 ? "" : "s"}, ${r.sales} in sales from ${r.visitors} visitor${r.visitors === 1 ? "" : "s"}.` +
            (best.length ? ` Best sellers: ${best.join(", ")}.` : " Nothing has sold yet."),
        ),
      ];
    }
    case "read_shopper_interest": {
      const nothing: string[] = r.searches_that_found_nothing ?? [];
      const top: string[] = r.top_searches ?? [];
      if (!r.searches && !r.shopping_assistant_questions) return [text("Nobody has searched your store in the last 30 days yet.")];
      return [
        text(
          (top.length ? `Top searches: ${top.slice(0, 5).join("; ")}.` : "") +
            (nothing.length ? ` These found nothing, so they may be products to add or listings to reword: ${nothing.slice(0, 5).join("; ")}.` : ""),
        ),
      ];
    }
    case "read_stock": {
      if (r.note) return [text(r.note)];
      const low = (r.soonest_to_run_out ?? []).filter((x: { running_low: boolean }) => x.running_low);
      const first = r.soonest_to_run_out?.[0];
      return [
        text(
          `You keep ${r.options_counted} option${r.options_counted === 1 ? "" : "s"} in stock, worth ${r.value_at_cost} at cost.` +
            (low.length ? ` Running low: ${low.map((x: { option: string; in_stock: number }) => `${x.option} (${x.in_stock} left)`).join(", ")}.` : "") +
            (first?.lasts_about_days != null ? ` ${first.option} runs out first, in about ${first.lasts_about_days} days.` : ""),
        ),
      ];
    }
    case "find_products": {
      const rows = r as { product_id: string; product: string; option: string; price: string; margin_pct: number | null; on_sale: boolean }[];
      if (!rows.length) return [text(c.input.search ? `I couldn't find products matching “${c.input.search}”.` : "You don't have any products yet. Import one from a supplier link to get started.")];
      if (/\b(collection|page) (of|for|with)\b/.test(ask) && /\b(make|create|add|start|build)\b/.test(ask)) {
        const named = s.prompt.match(/called ["“]?([^"”\n]{2,60}?)["”]?[.!]?(?:\n|$)/)?.[1];
        const term = String(c.input.search ?? "");
        const title = named ?? `${term.charAt(0).toUpperCase()}${term.slice(1)}s`;
        return [toolCall("create_collection", { title, description: `Our ${term}s, all in one place.`, product_ids: [...new Set(rows.map((x) => x.product_id))] })];
      }
      const worst = [...rows].filter((x) => x.margin_pct !== null).sort((a, b) => a.margin_pct! - b.margin_pct!)[0];
      return [
        text(
          `${rows.map((p) => `• ${p.product}${p.option === "Default" ? "" : ` (${p.option})`}: ${p.price}, keeps ${p.margin_pct ?? "?"}%${p.on_sale ? "" : ", draft"}`).join("\n")}` +
            (worst && worst.margin_pct! < 10 ? `\n\n${worst.product} keeps only ${worst.margin_pct}% after costs and fees; consider raising its price.` : ""),
        ),
      ];
    }
    default: {
      const d = r.last_30_days;
      return [
        text(
          `In the last 30 days ${r.store} had ${d.orders} order${d.orders === 1 ? "" : "s"} and ${d.sales} in sales, keeping ${d.profit_after_costs_and_fees} after costs and fees. ${r.balance.ready_to_pay_out} is ready to pay out.` +
            (r.problem_orders ? ` ${r.problem_orders} order${r.problem_orders === 1 ? " has" : "s have"} a delivery problem.` : "") +
            (r.cheaper_plan ? ` Switching to ${r.cheaper_plan.plan} would save ${r.cheaper_plan.saves_per_month} a month.` : "") +
            (req.tools.length && /\b(hi|hello|hey|help|what can you)\b/.test(ask) ? "\n\nAsk me about orders, products and margins, or to change a setting." : ""),
        ),
      ];
    }
  }
}

/* ───────────── Review summarizer ───────────── */

function summarizer(s: State): BetaContentBlock[] {
  const r = s.has("read_reviews");
  if (!r) return [toolCall("read_reviews", {})];
  if (r.isError) return [text("I couldn't read the reviews.")];
  if (!s.has("save_review_summary")) {
    const lines = strip(r.result.reviews).split("\n").filter(Boolean);
    const happy = lines.filter((l) => /^[45]\//.test(l)).length;
    const unhappy = lines.filter((l) => /^[12]\//.test(l)).length;
    const tone = happy >= lines.length * 0.7 ? "Most buyers are happy with it" : unhappy >= lines.length * 0.5 ? "Many buyers are disappointed with it" : "Buyers' opinions are mixed";
    const summary = `${tone}, rating it ${r.result.average_stars} out of 5 on average across ${r.result.count} reviews.${unhappy ? ` ${unhappy === 1 ? "One buyer" : `${unhappy} buyers`} had a bad experience.` : ""}`;
    return [toolCall("save_review_summary", { summary })];
  }
  return [text("I wrote a short summary of the reviews. You can edit or remove it on the product page.")];
}

/* ───────────── Business analyst ───────────── */

const ANALYST_READS: [string, Record<string, unknown>][] = [
  ["read_sales", { days: 30 }],
  ["read_profit", { days: 30 }],
  ["read_product_funnel", { days: 30 }],
  ["read_customers", { days: 30 }],
  ["read_returns", { days: 30 }],
  ["read_shopper_interest", {}],
];

type Suggestion = { title: string; finding: string; action: string; impact: "high" | "medium" | "low"; area: string | null };

function analyst(s: State): BetaContentBlock[] {
  const next = ANALYST_READS.find(([name]) => !s.has(name));
  if (next) return [toolCall(next[0], next[1])];
  if (!s.has("save_review")) {
    const r = (name: string) => (s.has(name)?.isError ? {} : s.has(name)!.result) as Record<string, any>;
    const sales = r("read_sales");
    const profit = r("read_profit");
    const funnel = r("read_product_funnel");
    const customers = r("read_customers");
    const returns = r("read_returns");
    const interest = r("read_shopper_interest");
    const out: Suggestion[] = [];
    const losing = (profit.losing_money ?? []) as string[];
    if (losing.length) {
      out.push({ title: "Stop losing money on some products", finding: `${losing.slice(0, 3).join(", ")} made a loss over the last 30 days after supplier costs, fees and ads.`, action: "Raise their price or pause their ads; if the supplier cost went up, look for another supplier.", impact: "high", area: "pricing" });
    }
    const viewed = (funnel.viewed_but_rarely_added ?? [])[0];
    if (viewed) {
      out.push({ title: `Make “${viewed.product}” easier to say yes to`, finding: `${viewed.viewers} visitors looked at it but only ${viewed.added_to_cart} added it to the cart.`, action: "Check the price against similar shops, add more photos, and put the delivery time near the top of the description.", impact: "high", area: "products" });
    }
    const added = (funnel.added_but_rarely_bought ?? [])[0];
    if (added) {
      out.push({ title: "Find out why carts don't turn into orders", finding: `${added.added_to_cart} visitors added “${added.product}” to the cart but only ${added.orders} bought it.`, action: "Check what shipping costs at checkout; free shipping over a set amount often helps.", impact: "medium", area: "shipping" });
    }
    const nothing = (interest.searches_that_found_nothing ?? []) as string[];
    if (nothing.length) {
      out.push({ title: "Sell what shoppers search for", finding: `Searches that found nothing: ${nothing.slice(0, 3).join("; ")}.`, action: "Add products that match, or point those words at products you already sell with a search fix.", impact: "medium", area: "search" });
    }
    if ((customers.lapsed_buyers ?? 0) > 0) {
      out.push({ title: "Win back buyers who haven't returned", finding: `${customers.lapsed_buyers} buyers last ordered 3 to 12 months ago; ${customers.bought_twice_or_more ?? "few"} of all buyers ever ordered twice.`, action: "Turn on a win-back offer so they get a code by email.", impact: "medium", area: "marketing" });
    }
    const reason = (returns.reasons ?? [])[0] as string | undefined;
    if (reason && (returns.return_requests ?? 0) >= 2) {
      out.push({ title: "Fix the main reason for returns", finding: `${returns.return_requests} return requests in 30 days; the most common reason: ${reason}.`, action: reason.startsWith("wrong size") ? "Add a size chart to the products that come back." : "Check the listings and photos of the most returned products against what arrives.", impact: "medium", area: "returns" });
    }
    if ((funnel.almost_never_seen_count ?? 0) > 0) {
      out.push({ title: "Help shoppers find more of your products", finding: `${funnel.almost_never_seen_count} products on sale were seen by almost nobody in 30 days.`, action: "Put them in a collection on the home page, or write a better search description for them.", impact: "low", area: "seo" });
    }
    if (!(sales.orders > 0) && out.length < 2) {
      out.push({ title: "Get your first visitors", finding: `The store had ${sales.visitors ?? 0} visitors and no orders in the last 30 days.`, action: "Share the store with friends and on social media, and email a launch offer to anyone on your list.", impact: "high", area: "campaigns" });
    }
    if (!out.length) {
      out.push({ title: "Collect more reviews", finding: "Nothing stands out as a problem in the last 30 days.", action: "Turn on review request emails so happy buyers leave reviews that help the next shoppers decide.", impact: "low", area: "reviews" });
    }
    const summary = sales.orders > 0
      ? `In the last 30 days the store took ${sales.orders} order${sales.orders === 1 ? "" : "s"} worth ${sales.sales} from ${sales.visitors} visitors, with a profit of ${profit.total?.profit ?? "unknown"}.`
      : `The store has no orders in the last 30 days yet, from ${sales.visitors ?? 0} visitors, so most suggestions are about getting found.`;
    return [toolCall("save_review", { summary, suggestions: out.slice(0, 5) })];
  }
  return [text("I reviewed your store and saved a few suggestions on the Insights page.")];
}

/* ───────────── Reply checker ───────────── */

// Without a model, the check is the one code can do: every number in the reply must be in what
// the helper read (order numbers, dates, tracking, prices).
function replyChecker(s: State): BetaContentBlock[] {
  if (s.has("give_verdict")) return [text("Checked.")];
  const part = (tag: string) => s.prompt.match(new RegExp(`<untrusted_data source="${tag}"[^>]*>([\\s\\S]*?)</untrusted_data>`))?.[1] ?? "";
  const problems = brandProblems(null, [{ name: "reply", text: part("draft_reply") }], { facts: [part("store_data"), part("buyer")] });
  return [toolCall("give_verdict", { safe: !problems.length, problems: problems.map((p) => p.replace("the product data", "the order or policies")) })];
}

/* ───────────── Store watch ───────────── */

// Without a model, each signal gets the usual causes to check; the figures come from the signal itself.
const WATCH_TEMPLATES: Record<string, { title: string; cause: string; todo: string; area: string | null }> = {
  sales_drop: { title: "Sales fell yesterday", cause: "The data doesn't show one clear cause. The usual ones: an ad that stopped, a best seller that ran out, or a checkout setting that changed.", todo: "Check that your best sellers are in stock and your ads are running, then place a test order.", area: "sales" },
  sales_jump: { title: "Sales jumped yesterday", cause: "More buyers than usual found the store, most likely from an ad or a post that took off.", todo: "Check stock on the best seller and reorder early if it's low; keep whatever ad brought them running.", area: "inventory" },
  visitors_drop: { title: "Fewer visitors yesterday", cause: "Fewer people reached the store; an ad, a post or a link that usually sends visitors may have stopped.", todo: "Check where visitors came from on the Sales page and restart anything that stopped.", area: "campaigns" },
  checkout_drop: { title: "Shoppers stopped paying at checkout", cause: "Shoppers reached checkout but didn't finish, which usually points to payment or the shipping price.", todo: "Place a test order to check payment works, and look at what shipping costs at checkout.", area: "shipping" },
  refunds_up: { title: "More refunds than usual", cause: "More refunds than usual this week; a product that arrives different from its listing is the usual reason.", todo: "Open Returns to see which product comes back most and read the buyers' reasons.", area: "returns" },
};

function watch(s: State): BetaContentBlock[] {
  if (!s.has("save_alerts")) {
    const kinds = [...s.prompt.matchAll(/^- (\w+) \(/gm)].map((m) => m[1]!).filter((k) => WATCH_TEMPLATES[k]);
    const alerts = kinds.slice(0, 5).map((k) => ({ signal: k, title: WATCH_TEMPLATES[k]!.title, likely_cause: WATCH_TEMPLATES[k]!.cause, what_to_do: WATCH_TEMPLATES[k]!.todo, area: WATCH_TEMPLATES[k]!.area }));
    if (alerts.length) return [toolCall("save_alerts", { alerts })];
    return [text("Nothing to flag.")];
  }
  return [text("I flagged what moved yesterday on the Insights page.")];
}

/* ───────────── Trend scout ───────────── */

// The demo brain can't search the web, so beyond the store's own unmet searches it offers a few
// seasonal examples, and says plainly that they're examples.
const SEASONAL: Record<string, { product: string; search: string }[]> = {
  winter: [
    { product: "Wearable heated blanket", search: "wearable heated blanket" },
    { product: "Warm-white LED fairy lights", search: "led fairy lights" },
  ],
  spring: [
    { product: "Self-watering herb planter", search: "self watering planter" },
    { product: "Portable mini fan", search: "portable neck fan" },
  ],
  summer: [
    { product: "Portable neck fan", search: "portable neck fan" },
    { product: "Collapsible water bottle", search: "collapsible water bottle" },
  ],
  autumn: [
    { product: "Sunset projection lamp", search: "sunset projection lamp" },
    { product: "Weighted throw blanket", search: "weighted blanket" },
  ],
};
const season = (d: Date) => ["winter", "winter", "spring", "spring", "spring", "summer", "summer", "summer", "autumn", "autumn", "autumn", "winter"][d.getUTCMonth()]!;

function scout(s: State): BetaContentBlock[] {
  const profile = s.has("read_store_profile");
  if (!profile) return [toolCall("read_store_profile", {})];
  if (!s.has("save_trend_ideas")) {
    const missing = ((profile.result?.searches_that_found_nothing ?? []) as string[]).slice(0, 3);
    const today = new Date(s.prompt.match(/Today is (\d{4}-\d{2}-\d{2})/)?.[1] ?? Date.now());
    const ideas = [
      ...missing.map((line) => {
        const [term, count] = line.split(": ");
        return {
          product: term!.charAt(0).toUpperCase() + term!.slice(1),
          why_now: `Your own shoppers searched for “${term}” ${count === "1" ? "once" : `${count} times`} and found nothing in your store.`,
          how_to_sell_it: "Find a well-reviewed version at your supplier and price it in line with your other products.",
          confidence: "medium",
          supplier_search: term!.slice(0, 60),
          sources: [],
        };
      }),
      ...SEASONAL[season(today)]!.map((x) => ({
        product: x.product,
        why_now: "An example of a seasonal best seller. Demo mode can't search the web, so this isn't checked against live trends.",
        how_to_sell_it: "Show it in use in the photos and mention gifting in the description.",
        confidence: "low",
        supplier_search: x.search,
        sources: [],
      })),
    ];
    const summary = `Demo mode: these ideas come from what your shoppers searched for${missing.length ? "" : " (nothing unmet yet)"} and from seasonal examples. With an Anthropic API key, the trend scout searches TikTok, Google, Amazon and Reddit trends and links its sources.`;
    return [toolCall("save_trend_ideas", { summary, ideas: ideas.slice(0, 6) })];
  }
  return [text("I saved a few product ideas on the Insights page.")];
}

/* ───────────── Shopping assistant ───────────── */

const STOP_WORDS = new Set("a an and any are as at be can could do does for from have i in is it me my of on or please show something that the there this to want what which with you your yours looking need find buy get got tell about sell store shop".split(" "));

function shopper(s: State): BetaContentBlock[] {
  const handle = s.prompt.match(/with handle "([a-z0-9-]+)"/)?.[1] ?? null;
  const ask = s.prompt.replace(/^\(The shopper is on the page[^)]*\)\s*/, "").toLowerCase();
  const policyQuestion = /\b(return|refund|exchange|shipping cost|ship to|pay|payment)/.test(ask);
  if (policyQuestion) {
    const pol = s.has("read_store_policies");
    if (!pol) return [toolCall("read_store_policies", {})];
    const page = (pol.result.pages ?? []).find((p: { title: string }) => /return|refund|ship/i.test(p.title));
    if (!page) return [text("The store hasn't published its policy on that yet. You can ask them on the contact page.")];
    return [text(`Here's what the store's “${page.title}” page says: ${page.text.slice(0, 240).trim()}${page.text.length > 240 ? "…" : ""}`)];
  }
  const aboutThis = handle && /\b(this|it|its|size|sizes|deliver|delivery|arrive|stock|price|cost|colou?r|option)/.test(ask);
  if (aboutThis) {
    const p = s.has("read_product");
    if (!p) return [toolCall("read_product", { handle })];
    if (p.isError) return [text("I couldn't find that product. Try searching the store.")];
    const options: { name: string; price: string; in_stock: boolean; delivery_days: string | null }[] = p.result.options ?? [];
    const parts: string[] = [];
    if (/\b(deliver|delivery|arrive|how long|when)/.test(ask)) {
      const days = options.find((o) => o.delivery_days)?.delivery_days;
      parts.push(days ? `It usually arrives ${days.replace("-", " to ")} days after you order.` : "The listing doesn't say how long delivery takes; the store can tell you on its contact page.");
    }
    if (/\b(size|sizes|colou?r|option|come in)/.test(ask)) parts.push(options.length > 1 ? `It comes in ${options.map((o) => o.name).join(", ")}.` : "It comes in one version.");
    if (/\b(stock|available|sold out)/.test(ask)) parts.push(options.some((o) => o.in_stock) ? "It's in stock right now." : "It's sold out at the moment.");
    if (/\b(price|cost|how much)/.test(ask) && options[0]) parts.push(`It's ${options[0].price}.`);
    return [text(parts.length ? `[${p.result.title}](/products/${p.result.handle}): ${parts.join(" ")}` : `I don't know that from the listing for [${p.result.title}](/products/${p.result.handle}). You can ask the store on its contact page.`)];
  }
  const found = s.has("search_products");
  if (!found) {
    const words = ask.match(/[a-z0-9]+/g)?.filter((w) => w.length > 2 && !STOP_WORDS.has(w)) ?? [];
    return [toolCall("search_products", { query: words.slice(0, 4).join(" ") })];
  }
  const products: { title: string; handle: string; price: string | null; in_stock: boolean }[] = found.result.products ?? [];
  if (!products.length) return [text("Sorry, this store doesn't seem to have that. Try different words, or ask the store on its contact page.")];
  const list = products.slice(0, 3).map((p) => `[${p.title}](/products/${p.handle})${p.price ? ` (${p.price})` : ""}${p.in_stock ? "" : " (sold out)"}`);
  return [text(`Here's what I found: ${list.join(", ")}.`)];
}

const BRAINS: Record<ModelRequest["agent"], (s: State, req: ModelRequest) => BetaContentBlock[]> = {
  listing,
  writer,
  translator,
  answerer,
  sizer,
  buyer_support: buyerSupport,
  fulfilment,
  margin,
  assistant,
  shopper,
  summarizer,
  analyst,
  scout,
  watch,
  reply_checker: replyChecker,
};
