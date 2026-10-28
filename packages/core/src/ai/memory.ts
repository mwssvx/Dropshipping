/**
 * What the owner asked the assistant to remember: short notes about how they run the store
 * ("we only ship from the US warehouse", "call me Muaz", "report profit, not sales"). They go into
 * the assistant's instructions in every chat, and the owner can read and edit them in AI settings.
 */
export const MEMORY_MAX_NOTES = 30;
export const MEMORY_NOTE_MAX = 200;

const key = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Clean notes: one per line, trimmed, no repeats, within the limits. */
export function normalizeMemory(input: string | string[]) {
  const lines = (Array.isArray(input) ? input : input.split("\n")).map((l) => l.replace(/^\s*[-•*]\s*/, "").replace(/\s+/g, " ").trim()).filter((l) => l.length >= 3);
  const seen = new Set<string>();
  return lines
    .map((l) => l.slice(0, MEMORY_NOTE_MAX))
    .filter((l) => !seen.has(key(l)) && !!seen.add(key(l)))
    .slice(0, MEMORY_MAX_NOTES);
}

/** The notes that best match `text`, for forgetting one by what the owner said about it. */
export function findNote(notes: string[], text: string) {
  const want = key(text).split(" ").filter((w) => w.length > 2);
  let best = -1;
  let score = 0;
  notes.forEach((n, i) => {
    const words = new Set(key(n).split(" "));
    const s = want.filter((w) => words.has(w)).length / Math.max(want.length, 1);
    if (s > score) [best, score] = [i, s];
  });
  return score >= 0.5 ? best : -1;
}

export function memoryInstructions(notes: string[]) {
  if (!notes.length) return "";
  return `\nWhat the owner asked you to remember (follow these unless they say otherwise now):\n${notes.map((n) => `- ${n}`).join("\n")}`;
}
