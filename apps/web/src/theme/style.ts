import type { CSSProperties } from "react";
import { THEME_FONTS, type ThemeDoc } from "@sf/core/theme";

const RADIUS = { square: ["0px", "0px", "0px"], soft: ["4px", "8px", "12px"], round: ["8px", "16px", "24px"] } as const;

/** CSS variables the `.store` class turns into the storefront's colors, fonts and corners. */
export function themeStyle(settings: ThemeDoc["settings"]): CSSProperties {
  const [sm, md, lg] = RADIUS[settings.corners];
  return {
    "--store-bg": settings.colors.background,
    "--store-text": settings.colors.text,
    "--store-accent": settings.colors.accent,
    "--store-accent-text": settings.colors.accentText,
    "--store-heading-font": THEME_FONTS[settings.headingFont].family,
    "--store-body-font": THEME_FONTS[settings.bodyFont].family,
    "--radius-sm": sm,
    "--radius-md": md,
    "--radius-lg": lg,
  } as CSSProperties;
}

/** Layout choices as data attributes; globals.css turns them into grid, card, image and button styles. */
export function themeLayoutAttrs(settings: ThemeDoc["settings"]) {
  const l = settings.layout;
  return {
    "data-header": l.header, "data-image": l.productImage, "data-cols": String(l.columns), "data-cards": l.cards, "data-buttons": l.buttons,
    "data-sticky": settings.stickyHeader ? "on" : "off",
  };
}

/** Turns a theme link into a real address: store paths get the store's base, others pass through. */
export function storeHref(base: string, href: string) {
  if (!href) return base || "/";
  if (href.startsWith("/")) return href === "/" ? base || "/" : `${base}${href}`;
  return href;
}
