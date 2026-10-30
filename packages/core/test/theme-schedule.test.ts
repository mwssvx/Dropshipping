import { describe, expect, it } from "vitest";
import { cancelThemeSchedule, DemoModel, getPublishedTheme, getTheme, keepScheduledTheme, saveThemeDraft, scheduleTheme } from "../src";
import { makeFixture } from "../evals/fixture";

const H = 3_600_000;
const heroText = (doc: { home: { type: string; settings: unknown }[] }) => (doc.home.find((s) => s.type === "hero")!.settings as { heading: string }).heading;

describe("scheduled store looks", () => {
  it("puts a holiday look live by itself and switches back after", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    // Days ahead of the real clock, since the editor's view checks the time itself.
    const now = new Date();
    const { draft, published } = await getTheme(f.db, shop);
    const usual = heroText(published);
    const hero = draft.home.find((s) => s.type === "hero")!;
    if (hero.type === "hero") hero.settings.heading = "Black Friday: 30% off";
    await saveThemeDraft(f.db, shop, draft);

    await expect(scheduleTheme(f.db, shop, { at: new Date(now.getTime() - H), until: null }, now)).rejects.toThrow("still to come");
    await expect(scheduleTheme(f.db, shop, { at: new Date(now.getTime() + H), until: now }, now)).rejects.toThrow("Switch back after");
    await expect(scheduleTheme(f.db, shop, { at: new Date(Number.NaN), until: null }, now)).rejects.toThrow("Pick when");
    const friday = new Date(now.getTime() + 7 * 24 * H);
    const tuesday = new Date(now.getTime() + 11 * 24 * H);
    expect(await scheduleTheme(f.db, shop, { at: friday, until: tuesday }, now)).toEqual({ at: friday.toISOString(), until: tuesday.toISOString() });

    // Edits after scheduling stay in the draft; what was scheduled doesn't change.
    if (hero.type === "hero") hero.settings.heading = "Still thinking";
    await saveThemeDraft(f.db, shop, draft);
    expect(heroText(await getPublishedTheme(f.db, shop, now))).toBe(usual);
    expect(heroText(await getPublishedTheme(f.db, shop, new Date(friday.getTime() + 1)))).toBe("Black Friday: 30% off");
    const during = await getTheme(f.db, shop);
    expect(during.schedule).toBeNull();
    expect(during.revertAt).toBe(tuesday.toISOString());
    expect(heroText(during.draft)).toBe("Still thinking");
    expect(heroText(await getPublishedTheme(f.db, shop, new Date(tuesday.getTime() + 1)))).toBe(usual);
    expect((await getTheme(f.db, shop)).revertAt).toBeNull();
  });

  it("can be cancelled, kept, or missed entirely", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const now = new Date();
    const { draft, published } = await getTheme(f.db, shop);
    const usual = heroText(published);
    const hero = draft.home.find((s) => s.type === "hero")!;
    if (hero.type === "hero") hero.settings.heading = "Winter look";
    await saveThemeDraft(f.db, shop, draft);

    await scheduleTheme(f.db, shop, { at: new Date(now.getTime() + H), until: null }, now);
    await cancelThemeSchedule(f.db, shop.id);
    expect(heroText(await getPublishedTheme(f.db, shop, new Date(now.getTime() + 2 * H)))).toBe(usual);

    // Kept: the switch back is dropped and the new look stays.
    await scheduleTheme(f.db, shop, { at: new Date(now.getTime() + H), until: new Date(now.getTime() + 5 * H) }, now);
    expect(heroText(await getPublishedTheme(f.db, shop, new Date(now.getTime() + 2 * H)))).toBe("Winter look");
    await keepScheduledTheme(f.db, shop.id);
    expect(heroText(await getPublishedTheme(f.db, shop, new Date(now.getTime() + 6 * H)))).toBe("Winter look");

    // A window nobody visited during leaves what was live.
    if (hero.type === "hero") hero.settings.heading = "Flash look";
    await saveThemeDraft(f.db, shop, draft);
    await scheduleTheme(f.db, shop, { at: new Date(now.getTime() + H), until: new Date(now.getTime() + 2 * H) }, now);
    expect(heroText(await getPublishedTheme(f.db, shop, new Date(now.getTime() + 3 * H)))).toBe("Winter look");
    expect((await getTheme(f.db, shop)).schedule).toBeNull();
  });
});
