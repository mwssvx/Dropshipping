export function toHandle(text: string): string {
  return (
    text
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/g, "") || "item"
  );
}

/** First free handle: base, base-2, base-3... */
export async function uniqueHandle(base: string, taken: (h: string) => Promise<boolean>): Promise<string> {
  const root = toHandle(base);
  if (!(await taken(root))) return root;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${root}-${n}`;
    if (!(await taken(candidate))) return candidate;
  }
  throw new Error("Could not find a free handle");
}
