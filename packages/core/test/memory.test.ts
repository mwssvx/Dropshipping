import { describe, expect, it } from "vitest";
import { AGENT_SPECS, askAssistant, DemoModel, findNote, MEMORY_MAX_NOTES, normalizeMemory, ScriptedModel, setAiSettings, text, toolCall } from "../src";
import { makeFixture } from "../evals/fixture";

describe("assistant memory", () => {
  it("cleans notes: one per line, no repeats, within the limits", () => {
    expect(normalizeMemory("- Ships from the US warehouse\n\nships from the US warehouse!\n• Call me Muaz\nx")).toEqual(["Ships from the US warehouse", "Call me Muaz"]);
    expect(normalizeMemory(Array.from({ length: 40 }, (_, i) => `Note number ${i}`))).toHaveLength(MEMORY_MAX_NOTES);
    expect(findNote(["Ships from the US warehouse", "Call me Muaz"], "the warehouse thing")).toBe(0);
    expect(findNote(["Call me Muaz"], "shipping prices")).toBe(-1);
  });

  it("remembers what the owner says and uses it in every later chat", async () => {
    const model = new ScriptedModel([[toolCall("remember", { note: "Report profit, not sales" })], [text("Noted.")], [text("Your profit was $120.")]]);
    const f = await makeFixture(model);
    await askAssistant(f.ctx, await f.shop(), "When I ask how I'm doing, tell me profit, not sales.");
    const shop = await f.shop();
    expect(shop.aiMemory).toEqual(["Report profit, not sales"]);
    await askAssistant(f.ctx, shop, "How am I doing?");
    expect(model.requests[2]!.system).toContain("What the owner asked you to remember");
    expect(model.requests[2]!.system).toContain("- Report profit, not sales");
    // Only the Assistant: buyer-facing helpers never see the owner's notes.
    expect(AGENT_SPECS.buyer_support.system(shop)).not.toContain("Report profit");
  });

  it("stops at a full memory, and the owner can edit the notes in settings", async () => {
    const f = await makeFixture(new ScriptedModel([[toolCall("remember", { note: "One more thing" })], [text("It's full.")]]));
    await setAiSettings(f.db, await f.shop(), { memory: Array.from({ length: MEMORY_MAX_NOTES }, (_, i) => `Note number ${i}`) });
    await askAssistant(f.ctx, await f.shop(), "Remember one more thing");
    const [a] = (await f.actions()).filter((x) => x.tool === "remember");
    expect(a).toMatchObject({ status: "failed" });
    await setAiSettings(f.db, await f.shop(), { memory: ["Call me Muaz", "call me muaz"] });
    expect((await f.shop()).aiMemory).toEqual(["Call me Muaz"]);
  });

  it("in demo mode, remembers and forgets on request", async () => {
    const f = await makeFixture(new DemoModel());
    const first = await askAssistant(f.ctx, await f.shop(), "Remember that we only ship from the US warehouse.");
    expect(first.text).toContain("I'll remember that");
    expect((await f.shop()).aiMemory).toEqual(["We only ship from the US warehouse"]);
    const second = await askAssistant(f.ctx, await f.shop(), "Forget the US warehouse note");
    expect(second.text).toContain("forgotten “We only ship from the US warehouse”");
    expect((await f.shop()).aiMemory).toEqual([]);
  });
});
