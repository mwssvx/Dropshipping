import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { AGENT_SPECS, askAssistant, DemoModel, listAiReports, recordSearch, ScriptedModel, setAiSettings, skillMenu, SKILL_NAMES, text, toolCall } from "../src";
import { makeFixture } from "../evals/fixture";

describe("assistant skills", () => {
  it("lists each skill that's on in the assistant's instructions, and leaves out the ones switched off", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const system = AGENT_SPECS.assistant.system(shop);
    for (const s of SKILL_NAMES) expect(system).toContain(`\n- ${s}: `);
    await setAiSettings(f.db, shop, { skillsOff: ["marketing", "not_a_skill"] });
    const after = await f.shop();
    expect(after.aiSkillsOff).toEqual(["marketing"]);
    expect(AGENT_SPECS.assistant.system(after)).not.toContain("- marketing:");
    expect(skillMenu(SKILL_NAMES)).toBe("");
  });

  it("reads a playbook, and won't read one the owner switched off", async () => {
    const model = new ScriptedModel([[toolCall("use_skill", { skill: "pricing" })], [toolCall("use_skill", { skill: "marketing" })], [text("Done.")]]);
    const f = await makeFixture(model);
    await f.setShop({ aiSkillsOff: ["marketing"] });
    await askAssistant(f.ctx, await f.shop(), "How should I price my lamp?");
    const results = model.requests[2]!.messages.at(-1)!.content as { content: string; is_error?: boolean }[];
    const msgs = model.requests[1]!.messages.at(-1)!.content as { content: string }[];
    expect(msgs[0]!.content).toContain("Charm prices");
    expect(results[0]).toMatchObject({ is_error: true, content: expect.stringContaining("switched this skill off") });
  });

  it("in demo mode, a 'what should I sell' question loads trend research and starts the trend scout", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    await recordSearch(f.db, shop.id, "cat bed", 0);
    const run = await askAssistant(f.ctx, shop, "What's trending that I should sell?");
    expect((await f.actions()).filter((a) => a.agent === "assistant").map((a) => a.tool)).toEqual(["use_skill", "find_trends"]);
    expect(run.text).toContain("Cat bed");
    expect(run.text).toContain("Insights page");
    expect(await listAiReports(f.db, shop.id, "trends")).toHaveLength(1);

    // Asked again the same day, it answers from the ideas it already saved instead of searching again.
    const again = await askAssistant(f.ctx, shop, "Any viral products for me?");
    expect(again.text).toMatch(/in the last 24 hours/);
    expect(again.text).toContain("Cat bed");
    expect(await listAiReports(f.db, shop.id, "trends")).toHaveLength(1);
  });

  it("in demo mode, 'review my store' runs the business analyst without the skill when it's off", async () => {
    const f = await makeFixture(new DemoModel());
    await f.setShop({ aiSkillsOff: ["data_analysis"] });
    const shop = await f.shop();
    const run = await askAssistant(f.ctx, shop, "Can you review my store and tell me how to improve?");
    expect((await f.actions()).filter((a) => a.agent === "assistant").map((a) => a.tool)).toEqual(["review_store"]);
    expect(run.text).toContain("Get your first visitors");
    const runs = await f.db.query.agentRuns.findMany({ where: eq(schema.agentRuns.agent, "analyst") });
    expect(runs).toHaveLength(1);
  });
});
