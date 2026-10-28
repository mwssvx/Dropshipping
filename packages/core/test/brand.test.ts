import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { AGENT_SPECS, brandProblems, DemoModel, normalizeBrandRules, ScriptedModel, setAiSettings, text, toolCall, writeListing } from "../src";
import { makeFixture } from "../evals/fixture";

describe("brand rules", () => {
  it("keeps only rules worth keeping", () => {
    expect(normalizeBrandRules({ voice: "  ", banned: " , ", language: "xx", titleMax: 5 })).toBeNull();
    expect(normalizeBrandRules({ voice: " Warm,  never pushy ", banned: "cheap, Cheap,best ever\nx", language: "es", titleMax: "60" })).toEqual({
      voice: "Warm, never pushy",
      banned: ["cheap", "Cheap", "best ever"],
      language: "es",
      titleMax: 60,
    });
  });

  it("catches banned words, long titles, English in a Spanish store and made-up numbers", () => {
    const rules = { banned: ["cheap", "best ever"], titleMax: 30, language: "es" as const };
    const facts = [JSON.stringify({ title: "Lámpara LED", options: [{ ships_in_days: "5-10" }], supplier: "Battery 5,000 mAh" })];
    expect(brandProblems(rules, [{ name: "title", text: "Lámpara de luna", isTitle: true }, { name: "description", text: "Una lámpara de 5000 mAh que llega en 5 a 10 días." }], { facts })).toEqual([]);
    const problems = brandProblems(
      rules,
      [
        { name: "title", text: "The best ever cheap moon lamp for your bedroom", isTitle: true },
        { name: "description", text: "This is the lamp that you need for your room and it is great with the light and the color and the size for the family. Model MX4471, 48 hours of light." },
      ],
      { facts, now: new Date("2026-10-28") },
    );
    expect(problems).toEqual([
      'the title uses "cheap", which the owner banned',
      'the title uses "best ever", which the owner banned',
      "the title is 46 characters; the limit is 30",
      "the description looks like English; write it in Spanish",
      'the description has "4471", "48", which isn\'t in the product data (don\'t invent numbers, codes or specs)',
    ]);
    // Banned words match whole words only, in any case.
    expect(brandProblems({ banned: ["cheap"] }, [{ name: "reply", text: "Not cheaply made. CHEAP!" }])).toEqual(['the reply uses "cheap", which the owner banned']);
  });

  it("goes into the writing helpers' instructions, not the others'", async () => {
    const f = await makeFixture(new DemoModel());
    await setAiSettings(f.db, await f.shop(), { brand: normalizeBrandRules({ voice: "Playful and kind", banned: "cheap" }) });
    const shop = await f.shop();
    expect(AGENT_SPECS.listing.system(shop)).toContain("Sound like this: Playful and kind");
    expect(AGENT_SPECS.buyer_support.system(shop)).toContain('Never use these words or phrases: "cheap"');
    expect(AGENT_SPECS.margin.system(shop)).not.toContain("writing rules");
    await setAiSettings(f.db, shop, { brand: null });
    expect(AGENT_SPECS.listing.system(await f.shop())).not.toContain("writing rules");
  });

  it("refuses a listing that breaks the rules, and saves the rewrite", async () => {
    const model = new ScriptedModel([
      [toolCall("get_product", {})],
      [toolCall("save_listing", { title: "Cheap Galaxy Projector", description: "A galaxy projector for calm nights. Runs 72 hours on one charge.\n\n• Easy to use" })],
      [toolCall("save_listing", { title: "Galaxy Projector", description: "A galaxy projector for calm nights in any bedroom.\n\n• Easy to use" })],
      [text("Saved.")],
    ]);
    const f = await makeFixture(model);
    await f.setShop({ aiBrand: { banned: ["cheap"] } });
    await f.db.update(schema.products).set({ status: "draft" }).where(eq(schema.products.id, f.products.projector.id));
    const run = await writeListing(f.ctx, await f.shop(), f.products.projector.id);
    expect(run.status).toBe("done");
    const actions = await f.actions();
    expect(actions.map((a) => [a.tool, a.status])).toEqual([
      ["get_product", "done"],
      ["save_listing", "blocked"],
      ["save_listing", "done"],
    ]);
    expect(actions[1]!.reason).toContain('uses "cheap"');
    expect(actions[1]!.reason).toContain('"72"');
    const p = await f.db.query.products.findFirst({ where: eq(schema.products.id, f.products.projector.id) });
    expect(p!.title).toBe("Galaxy Projector");
  });
});

describe("brand rules in demo mode", () => {
  it("rewrites a listing that used a banned word", async () => {
    const f = await makeFixture(new DemoModel());
    await f.setShop({ aiBrand: { banned: ["projector"], titleMax: 40 } });
    await f.db.update(schema.products).set({ status: "draft" }).where(eq(schema.products.id, f.products.projector.id));
    const run = await writeListing(f.ctx, await f.shop(), f.products.projector.id);
    const p = await f.db.query.products.findFirst({ where: eq(schema.products.id, f.products.projector.id) });
    expect(run.status).toBe("done");
    expect(p!.title.toLowerCase()).not.toContain("projector");
    expect(p!.descriptionHtml.toLowerCase()).not.toContain("projector");
    expect((await f.actions()).map((a) => a.status)).toEqual(["done", "blocked", "done"]);
  });
});
