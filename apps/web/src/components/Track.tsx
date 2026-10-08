"use client";
// Counts visits for the store's analytics. No personal data: a random id in a cookie that expires
// after 30 minutes without activity, so one visit is one "visitor".
import { usePathname } from "next/navigation";
import { useEffect } from "react";

export const VISIT_COOKIE = "sf_vid";

function visitId() {
  const found = document.cookie.match(/(?:^|; )sf_vid=([A-Za-z0-9_-]{8,64})/)?.[1];
  // getRandomValues works on plain http too (randomUUID needs https).
  const id = found ?? Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
  document.cookie = `${VISIT_COOKIE}=${id}; path=/; max-age=1800; samesite=lax`;
  return id;
}

export function Track({ shopId, kind, productId }: { shopId: string; kind: "page_view" | "product_view"; productId?: string }) {
  const path = usePathname();
  useEffect(() => {
    // Counting visits must never break the page.
    try {
      const body = JSON.stringify({ shopId, kind, productId, sessionId: visitId(), referrer: document.referrer || null });
      if (!navigator.sendBeacon?.("/api/events", new Blob([body], { type: "application/json" }))) {
        void fetch("/api/events", { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true }).catch(() => {});
      }
    } catch {}
  }, [shopId, kind, productId, path]);
  return null;
}
