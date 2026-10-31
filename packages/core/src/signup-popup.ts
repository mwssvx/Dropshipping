// The sign-up pop-up: a small window asking new visitors for their email, with the welcome offer
// when there is one. It opens once, a few seconds after they arrive, never on the cart, checkout or
// account pages, and not again once they close it or sign up. Signups go through the same
// confirm-by-email step as the home page form.
import { eq } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { UserError } from "./errors";

/** Seconds after arriving that the pop-up can open. */
export const SIGNUP_POPUP_SECONDS = [5, 15, 30, 60] as const;

/**
 * Stored instead of a number of seconds: open when the visitor looks about to leave (the mouse
 * heads for the tabs or the address bar). Phones have no mouse, so there it opens after
 * SIGNUP_POPUP_LEAVE_FALLBACK seconds instead.
 */
export const SIGNUP_POPUP_ON_LEAVE = 0;
export const SIGNUP_POPUP_LEAVE_FALLBACK = 30;

/** Turns the pop-up on after this many seconds (or SIGNUP_POPUP_ON_LEAVE), or off with null. */
export async function setSignupPopup(db: Db, shopId: string, seconds: number | null) {
  if (seconds !== null && seconds !== SIGNUP_POPUP_ON_LEAVE && !(SIGNUP_POPUP_SECONDS as readonly number[]).includes(seconds)) {
    throw new UserError("Pick when the pop-up opens: when a visitor is about to leave, or after 5, 15, 30 or 60 seconds.");
  }
  await db.update(schema.shops).set({ signupPopupSeconds: seconds, updatedAt: new Date() }).where(eq(schema.shops.id, shopId));
  return seconds;
}

/** Store pages where the pop-up would get in the way of buying or signing in. */
export const SIGNUP_POPUP_QUIET = /\/(cart|checkout|pay|account|orders|subscribe|unsubscribe|password|track|gift-cards|subscriptions|saved|discount|r|refer)(\/|$)/;

/** Whether the pop-up may open on this store path ("/products/lamp", "/de/cart"). */
export function signupPopupAllowed(path: string) {
  return !SIGNUP_POPUP_QUIET.test(path);
}
