"use client";
import { useEffect, useState } from "react";
import type { StorefrontCatalog } from "@sf/core";
import type { ThemeDoc } from "@sf/core/theme";
import { HomeSections } from "@/theme/Sections";
import { StoreShell } from "@/theme/StoreShell";
import type { PreviewMessage } from "../(shop)/theme/ThemeEditor";

export function PreviewClient({ initial, shopName, currency, catalog, base }: {
  initial: ThemeDoc;
  shopName: string;
  currency: string;
  catalog: StorefrontCatalog;
  base: string;
}) {
  const [doc, setDoc] = useState(initial);
  const [highlight, setHighlight] = useState<string | null>(null);

  useEffect(() => {
    const onMessage = (e: MessageEvent<PreviewMessage>) => {
      if (e.origin !== window.location.origin || e.data?.type !== "sf-theme") return;
      setDoc(e.data.doc);
      setHighlight(e.data.highlight);
    };
    window.addEventListener("message", onMessage);
    window.parent.postMessage({ type: "sf-preview-ready" }, window.location.origin);
    // Links stay put in the preview, so a click never leaves the editor.
    const stop = (e: MouseEvent) => {
      if ((e.target as Element).closest("a")) e.preventDefault();
    };
    document.addEventListener("click", stop, true);
    return () => {
      window.removeEventListener("message", onMessage);
      document.removeEventListener("click", stop, true);
    };
  }, []);

  useEffect(() => {
    if (highlight) document.querySelector(`[data-section="${highlight}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [highlight]);

  return (
    <StoreShell doc={doc} shopName={shopName} currency={currency} base={base} cartCount={0}>
      <main>
        <HomeSections sections={doc.home} data={{ base, currency, catalog }} highlight={highlight} />
      </main>
    </StoreShell>
  );
}
