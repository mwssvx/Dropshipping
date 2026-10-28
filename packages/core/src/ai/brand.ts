import { isLanguage, LANGUAGES, type Language } from "../languages";

/**
 * The store's writing rules. They go into the instructions of every helper that writes for the
 * store, and code checks each draft against them before it's saved, so a rule can't be "forgotten"
 * the way a prompt alone can be.
 */
export type BrandRules = {
  /** How the store sounds, in the merchant's words ("warm and playful, never pushy"). */
  voice?: string;
  /** Words and phrases that must never appear. */
  banned?: string[];
  /** Write for buyers in this language instead of English. */
  language?: Language | null;
  /** Longest product title, in characters. */
  titleMax?: number | null;
};

export const BRAND_VOICE_MAX = 400;
export const BRAND_BANNED_MAX = 40;

/** Cleans what the merchant typed into rules worth keeping; null when nothing is set. */
export function normalizeBrandRules(input: { voice?: string; banned?: string | string[]; language?: string | null; titleMax?: number | string | null }): BrandRules | null {
  const voice = (input.voice ?? "").replace(/\s+/g, " ").trim().slice(0, BRAND_VOICE_MAX);
  const list = Array.isArray(input.banned) ? input.banned : (input.banned ?? "").split(/[,\n]/);
  const banned = [...new Set(list.map((w) => w.replace(/\s+/g, " ").trim()).filter((w) => w.length >= 2 && w.length <= 60))].slice(0, BRAND_BANNED_MAX);
  const language = isLanguage(input.language) ? input.language : null;
  const n = Number(input.titleMax);
  const titleMax = Number.isFinite(n) && n >= 20 && n <= 120 ? Math.round(n) : null;
  const rules: BrandRules = { ...(voice ? { voice } : {}), ...(banned.length ? { banned } : {}), ...(language ? { language } : {}), ...(titleMax ? { titleMax } : {}) };
  return Object.keys(rules).length ? rules : null;
}

/** The lines for a writing helper's instructions; empty when the store has no rules. */
export function brandInstructions(b: BrandRules | null | undefined) {
  if (!b) return "";
  const lines = [
    b.voice ? `- Sound like this: ${b.voice}` : null,
    b.banned?.length ? `- Never use these words or phrases: ${b.banned.map((w) => `"${w}"`).join(", ")}.` : null,
    b.language ? `- Write everything buyers will read in ${LANGUAGES[b.language].english}.` : null,
    b.titleMax ? `- Product titles are at most ${b.titleMax} characters.` : null,
  ].filter(Boolean);
  return lines.length ? `The store's writing rules (the owner set these; drafts that break them are refused):\n${lines.join("\n")}` : "";
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ENGLISH = new Set("the and with for your you this that is are to of it our in on be".split(" "));
// "5,000" and "5000" are the same number; "19.99" is two runs either way.
const digitRuns = (s: string) => s.replace(/(\d)[,.](?=\d{3}(?!\d))/g, "$1").match(/\d+/g) ?? [];

export type Draft = { name: string; text: string; isTitle?: boolean };

/**
 * What's wrong with a draft, in words the model can act on. `facts` is what the helper read from
 * its tools this run: a number or code that isn't in them was made up, so it's refused. Small
 * counts ("3 colors") and the years around today are fine.
 */
export function brandProblems(b: BrandRules | null | undefined, drafts: Draft[], opts: { facts?: string[]; now?: Date } = {}) {
  const problems: string[] = [];
  const known = opts.facts ? new Set(opts.facts.flatMap(digitRuns)) : null;
  const year = (opts.now ?? new Date()).getUTCFullYear();
  for (const d of drafts) {
    if (!d.text) continue;
    for (const w of b?.banned ?? []) {
      if (new RegExp(`(^|[^\\p{L}\\p{N}])${escape(w)}($|[^\\p{L}\\p{N}])`, "iu").test(d.text)) problems.push(`the ${d.name} uses "${w}", which the owner banned`);
    }
    if (d.isTitle && b?.titleMax && d.text.trim().length > b.titleMax) problems.push(`the ${d.name} is ${d.text.trim().length} characters; the limit is ${b.titleMax}`);
    if (b?.language && !d.isTitle) {
      const words = d.text.toLowerCase().match(/\p{L}+/gu) ?? [];
      const english = words.filter((w) => ENGLISH.has(w)).length;
      if (words.length >= 20 && english / words.length > 0.12) problems.push(`the ${d.name} looks like English; write it in ${LANGUAGES[b.language].english}`);
    }
    if (known) {
      const made = [...new Set(digitRuns(d.text))].filter((n) => !known.has(n) && !(Number(n) <= 12 && n.length <= 2) && Math.abs(Number(n) - year) > 1);
      if (made.length) problems.push(`the ${d.name} has ${made.map((n) => `"${n}"`).join(", ")}, which isn't in the product data (don't invent numbers, codes or specs)`);
    }
  }
  return problems;
}
