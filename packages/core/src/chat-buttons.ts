// Chat buttons: a small floating button on the store that opens a chat with the store on WhatsApp
// or Telegram, with a first message naming the page the shopper is on. Many buyers would rather
// ask a quick question there than fill in a contact form.
import { eq } from "drizzle-orm";
import { schema, type ChatButtons, type Db } from "@sf/db";
import { UserError } from "./errors";

/** The WhatsApp number as digits with the country code ("+44 7700 900123" is "447700900123"), or null. */
export function whatsappNumber(input: string | null | undefined) {
  const raw = input?.trim() ?? "";
  if (!raw) return null;
  const digits = raw.replace(/^\+|^00/, "").replace(/[\s().-]/g, "");
  if (!/^[1-9]\d{7,14}$/.test(digits)) throw new UserError("Enter the WhatsApp number with its country code, like +44 7700 900123.");
  return digits;
}

/** The Telegram username without "@" or a t.me link, or null. */
export function telegramUsername(input: string | null | undefined) {
  const raw = input?.trim().replace(/^(https?:\/\/)?(www\.)?t\.me\//i, "").replace(/^@/, "").replace(/\/$/, "") ?? "";
  if (!raw) return null;
  if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(raw)) throw new UserError("Enter the Telegram username, like @glowlamps (5 to 32 letters, numbers or _).");
  return raw;
}

/** Saves the store's chat buttons; with neither filled in, there's no button. */
export async function setChatButtons(db: Db, shopId: string, input: { whatsapp?: string | null; telegram?: string | null }) {
  const whatsapp = whatsappNumber(input.whatsapp);
  const telegram = telegramUsername(input.telegram);
  const value: ChatButtons | null = whatsapp || telegram ? { whatsapp, telegram } : null;
  await db.update(schema.shops).set({ chatButtons: value, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
  return value;
}

/** Links that open each chat, with `text` as the first message where the app takes one. */
export function chatLinks(buttons: ChatButtons | null, text: string) {
  const links: { kind: "whatsapp" | "telegram"; href: string }[] = [];
  if (buttons?.whatsapp) links.push({ kind: "whatsapp", href: `https://wa.me/${buttons.whatsapp}?text=${encodeURIComponent(text)}` });
  if (buttons?.telegram) links.push({ kind: "telegram", href: `https://t.me/${buttons.telegram}` });
  return links;
}

/** Store pages where a floating button would cover the buttons that matter. */
export const CHAT_BUTTON_QUIET = /\/(checkout|pay)(\/|$)/;
