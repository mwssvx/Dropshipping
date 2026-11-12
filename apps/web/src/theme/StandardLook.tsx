"use client";
import { useEffect } from "react";

/**
 * Turns the store's custom CSS off while this page is open, for pages that must always look and work
 * the standard way (checkout, paying an order). The layout leaves the CSS out when one of these pages
 * is loaded directly; this covers arriving from another store page, where the layout stays as it was.
 */
export function StandardLook() {
  useEffect(() => {
    const styles = [...document.querySelectorAll<HTMLStyleElement>("style[data-custom-css]")];
    for (const s of styles) s.media = "not all";
    return () => {
      for (const s of styles) s.media = "";
    };
  }, []);
  return null;
}
