// Reads the order edit form (components/OrderEditForm.tsx) into editOrder's input.
export function readOrderEdit(form: FormData) {
  const text = (k: string) => String(form.get(k) ?? "").trim();
  const lines: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (k.startsWith("line:") && typeof v === "string") lines[k.slice(5)] = v;
  return {
    address: { name: text("name"), line1: text("line1"), line2: text("line2") || undefined, city: text("city"), region: text("region") || undefined, postalCode: text("postalCode"), phone: text("phone") || undefined },
    lines,
  };
}
