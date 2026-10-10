"use client";
import { useEffect } from "react";

const MAX = 12;

/**
 * Puts the product the shopper is looking at first in their "recently viewed" cookie. It lives on
 * their device only and holds product ids, so it isn't sent anywhere but this store.
 */
export function RememberView({ cookie, productId }: { cookie: string; productId: string }) {
  useEffect(() => {
    let ids: string[] = [];
    const raw = document.cookie.split("; ").find((c) => c.startsWith(`${cookie}=`))?.slice(cookie.length + 1);
    try {
      const parsed = raw ? JSON.parse(decodeURIComponent(raw)) : [];
      if (Array.isArray(parsed)) ids = parsed.filter((x) => typeof x === "string");
    } catch {
      // A broken cookie starts over.
    }
    const next = [productId, ...ids.filter((id) => id !== productId)].slice(0, MAX);
    document.cookie = `${cookie}=${encodeURIComponent(JSON.stringify(next))}; path=/; max-age=${60 * 60 * 24 * 60}; samesite=lax`;
  }, [cookie, productId]);
  return null;
}
