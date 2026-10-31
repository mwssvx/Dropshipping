import { describe, expect, it } from "vitest";
import { applyThemePreset, defaultTheme, isSocialLink, parseTheme, socialHref, socialLinks } from "../src/theme-doc";

const withSocial = (social: Record<string, string>) => {
  const doc = defaultTheme("Shop");
  return parseTheme({ ...doc, settings: { ...doc.settings, social } });
};

describe("social media links", () => {
  it("turns an @name or a link without https into the full address", () => {
    expect(socialHref("instagram", " @my.store ")).toBe("https://www.instagram.com/my.store");
    expect(socialHref("tiktok", "@mystore")).toBe("https://www.tiktok.com/@mystore");
    expect(socialHref("youtube", "@mystore")).toBe("https://www.youtube.com/@mystore");
    expect(socialHref("x", "@mystore")).toBe("https://x.com/mystore");
    expect(socialHref("facebook", "facebook.com/mystore")).toBe("https://facebook.com/mystore");
    expect(socialHref("pinterest", "http://www.pinterest.com/mystore/")).toBe("https://www.pinterest.com/mystore/");
    expect(socialHref("instagram", "")).toBe("");
  });

  it("only takes a page on the network's own site", () => {
    expect(isSocialLink("instagram", "https://www.instagram.com/mystore")).toBe(true);
    expect(isSocialLink("x", "https://twitter.com/mystore")).toBe(true);
    expect(isSocialLink("pinterest", "https://www.pinterest.co.uk/mystore")).toBe(true);
    expect(isSocialLink("facebook", "https://m.facebook.com/mystore")).toBe(true);
    // The network's home page, another site, a look-alike or plain http aren't.
    expect(isSocialLink("instagram", "https://www.instagram.com/")).toBe(false);
    expect(isSocialLink("instagram", "https://www.facebook.com/mystore")).toBe(false);
    expect(isSocialLink("instagram", "https://instagram.com.evil.example/mystore")).toBe(false);
    expect(isSocialLink("instagram", "https://notinstagram.com/mystore")).toBe(false);
    expect(isSocialLink("instagram", "http://instagram.com/mystore")).toBe(false);
    expect(isSocialLink("instagram", "javascript:alert(1)")).toBe(false);
    expect(isSocialLink("instagram", "https://user@instagram.com/mystore")).toBe(false);
  });

  it("are saved with the theme, cleaned up, and listed in icon order", () => {
    const doc = withSocial({ x: "@mystore", instagram: "instagram.com/mystore", tiktok: "" });
    expect(doc.settings.social).toEqual({ instagram: "https://instagram.com/mystore", facebook: "", tiktok: "", youtube: "", pinterest: "", x: "https://x.com/mystore" });
    expect(socialLinks(doc.settings.social)).toEqual([
      { network: "instagram", label: "Instagram", href: "https://instagram.com/mystore" },
      { network: "x", label: "X", href: "https://x.com/mystore" },
    ]);
    // A ready-made theme keeps them.
    expect(applyThemePreset(doc, "bold", { replaceSections: true, shopName: "Shop" }).settings.social.x).toBe("https://x.com/mystore");
  });

  it("refuse a link that isn't the network's, and are empty for stores saved before they existed", () => {
    expect(() => withSocial({ instagram: "https://www.facebook.com/mystore" })).toThrow(/link to your Instagram page/);
    const old = defaultTheme("Shop") as { settings: Record<string, unknown> };
    delete old.settings.social;
    expect(socialLinks(parseTheme(old).settings.social)).toEqual([]);
  });
});
