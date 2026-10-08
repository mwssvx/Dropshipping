import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import {
  applyThemePreset, audienceSizes, confirmNewsletterSignup, contrastRatio, currentPreset, defaultTheme, DemoModel, listCustomers, parseTheme,
  requestNewsletterSignup, THEME_PRESET_IDS, THEME_PRESETS,
} from "../src";
import { makeFixture } from "../evals/fixture";

describe("ready-made themes", () => {
  it("every theme is valid, readable and has a starter home page", () => {
    for (const id of THEME_PRESET_IDS) {
      const doc = applyThemePreset(defaultTheme("Glow"), id, { replaceSections: true, shopName: "Glow" });
      const { colors } = doc.settings;
      expect(contrastRatio(colors.text, colors.background), `${id} text`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(colors.accentText, colors.accent), `${id} buttons`).toBeGreaterThanOrEqual(4.5);
      expect(doc.home.some((s) => s.type === "featured_products"), id).toBe(true);
      expect(currentPreset(doc)).toBe(id);
      expect(THEME_PRESETS[id].about.length).toBeGreaterThan(10);
    }
  });

  it("keeps the logo, menus, search settings and sections unless asked to replace them", () => {
    const mine = parseTheme({
      ...defaultTheme("Glow"),
      settings: { ...defaultTheme("Glow").settings, logoText: "GLOW", seo: { title: "Glow lamps", description: "Lamps" } },
      menus: { header: [{ label: "Lamps", href: "/collections/lamps" }], footer: [] },
      home: [{ id: "mine0001", type: "rich_text", hidden: false, settings: { heading: "Our story", text: "Hi" } }],
    });
    const kept = applyThemePreset(mine, "boutique", { replaceSections: false, shopName: "Glow" });
    expect(kept.settings).toMatchObject({ logoText: "GLOW", seo: { title: "Glow lamps" }, headingFont: "playfair", layout: { header: "centered", buttons: "outline" } });
    expect(kept.menus.header).toEqual([{ label: "Lamps", href: "/collections/lamps" }]);
    expect(kept.home.map((s) => s.id)).toEqual(["mine0001"]);
    const replaced = applyThemePreset(mine, "boutique", { replaceSections: true, shopName: "Glow" });
    expect(replaced.home.map((s) => s.type)).toContain("newsletter");
    expect(replaced.settings.logoText).toBe("GLOW");
    // Changing one color means it's no longer that theme.
    expect(currentPreset(parseTheme({ ...kept, settings: { ...kept.settings, colors: { ...kept.settings.colors, accent: "#123456" } } }))).toBeNull();
  });

  it("reads themes saved before layouts existed, and checks the new sections", () => {
    const old = JSON.parse(JSON.stringify(defaultTheme("Glow")));
    delete old.settings.layout;
    expect(parseTheme(old).settings.layout).toEqual({ header: "classic", productImage: "square", columns: 4, cards: "plain", buttons: "filled" });
    const withSection = (type: string, settings: unknown) => parseTheme({ ...old, home: [{ id: "abcd1234", type, settings }] });
    expect(() => withSection("testimonials", { items: [{ quote: " ", name: "Ada" }] })).toThrow("Every quote needs text.");
    expect(() => withSection("trust_badges", { items: [{ icon: "rocket", title: "Fast" }] })).toThrow();
    expect(() => withSection("trust_badges", { items: Array(7).fill({ title: "x" }) })).toThrow();
    expect(withSection("newsletter", {}).home[0]).toMatchObject({ type: "newsletter", settings: { heading: "", buttonLabel: "" } });
    expect(() => parseTheme({ ...old, settings: { ...old.settings, layout: { columns: 5 } } })).toThrow();
  });
});

describe("email signup on the store", () => {
  it("adds someone only after they confirm by email, and never floods an inbox", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const ctx = { db: f.db, mailer: f.mailer, storeAddress: () => "https://glow.example", now: () => new Date() };
    await expect(requestNewsletterSignup(ctx, shop, "not an email")).rejects.toThrow("Enter your email");
    expect(await requestNewsletterSignup(ctx, shop, " Linus@Example.com ")).toEqual({ status: "sent" });
    const confirm = f.mailer.sent.at(-1)!;
    expect(confirm).toMatchObject({ to: "linus@example.com", subject: "Confirm your signup to Glow Lamps" });
    const token = confirm.text.match(/https:\/\/glow\.example\/subscribe\/([0-9a-f]{64})/)![1]!;

    // Not on the list, and not in the customer list, until they confirm.
    expect(await audienceSizes(f.db, shop.id)).toMatchObject({ subscribers: 0 });
    expect((await listCustomers(f.db, shop.id)).some((c) => c.email === "linus@example.com")).toBe(false);
    // Asking again within the hour sends nothing more.
    const sent = f.mailer.sent.length;
    await requestNewsletterSignup(ctx, shop, "linus@example.com");
    expect(f.mailer.sent).toHaveLength(sent);

    expect(await confirmNewsletterSignup(f.db, "00000000-0000-0000-0000-000000000000", token)).toBeNull();
    expect(await confirmNewsletterSignup(f.db, shop.id, "nope")).toBeNull();
    expect(await confirmNewsletterSignup(f.db, shop.id, token)).toEqual({ email: "linus@example.com" });
    expect(await audienceSizes(f.db, shop.id)).toMatchObject({ subscribers: 1 });
    expect(await requestNewsletterSignup(ctx, shop, "linus@example.com")).toEqual({ status: "already_subscribed" });
    const row = await f.db.query.customers.findFirst({ where: eq(schema.customers.email, "linus@example.com") });
    expect(row!.marketingConsentAt).toBeInstanceOf(Date);
  });
});
