import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { AnthropicModel, costMicros, DemoModel, findTrendsWithAi, listAiReports, recordSearch, safeSourceUrl, ScriptedModel, text, toolCall, TRENDS_MAX_SEARCHES, UserError } from "../src";
import { makeFixture } from "../evals/fixture";

describe("the trend scout", () => {
  it("in demo mode, suggests what shoppers searched for and didn't find, and says it's a demo", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    await recordSearch(f.db, shop.id, "cat bed", 0);
    await recordSearch(f.db, shop.id, "cat bed", 0);
    const run = await findTrendsWithAi(f.ctx, shop);
    expect(run.status).toBe("done");
    expect((await f.actions()).map((a) => a.tool)).toEqual(["read_store_profile", "save_trend_ideas"]);
    const r = run.report!;
    expect(r.kind).toBe("trends");
    expect(r.summary).toMatch(/^Demo mode/);
    expect(r.items[0]).toMatchObject({ title: "Cat bed", impact: "medium", area: "suppliers", search: "cat bed" });
    expect(r.items[0]!.finding).toContain("searched for “cat bed” 2 times");
    expect(r.items.length).toBeGreaterThan(1);
    expect((await f.db.query.agentRuns.findFirst({ where: eq(schema.agentRuns.id, run.runId) }))!.model).toBe("claude-sonnet-5-5");
    expect(await listAiReports(f.db, shop.id, "trends")).toHaveLength(1);
    expect(await listAiReports(f.db, shop.id, "review")).toHaveLength(0);
  });

  it("runs at most once a day", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    await findTrendsWithAi(f.ctx, shop);
    await expect(findTrendsWithAi(f.ctx, shop)).rejects.toThrow(UserError);
  });

  it("searches the web with a capped number of searches and keeps only safe source links", async () => {
    const model = new ScriptedModel([
      [toolCall("read_store_profile", {})],
      // A long search turn pauses, and the run carries on with the same messages.
      () => ({ content: [text("Searching…")], stopReason: "pause_turn" }),
      [
        toolCall("save_trend_ideas", {
          summary: "Cosy lighting is rising ahead of the holidays.",
          ideas: [
            {
              product: "Moon lamp <b>3D</b>",
              why_now: "Videos tagged #moonlamp passed 200M views this month.",
              how_to_sell_it: "Gift for teens, around $29.99, photo in a dark bedroom.",
              confidence: "high",
              supplier_search: "3d moon lamp",
              sources: [
                { title: "TikTok", url: "https://www.tiktok.com/tag/moonlamp" },
                { title: "Old", url: "http://example.com/x" },
                { title: "Bad", url: "javascript:alert(1)" },
              ],
            },
          ],
        }),
      ],
      [text("Saved one idea.")],
    ]);
    const f = await makeFixture(model);
    const run = await findTrendsWithAi(f.ctx, await f.shop(), { focus: "  gifts   for teens " });
    expect(run.status).toBe("done");
    expect(model.requests.every((r) => r.webSearches === TRENDS_MAX_SEARCHES)).toBe(true);
    expect(model.requests[0]!.messages[0]!.content).toContain("The owner wants ideas for: gifts for teens");
    expect(model.requests).toHaveLength(4);
    // After the pause, the paused turn goes back as the last message so the server can resume it.
    expect(model.requests[2]!.messages.at(-1)!.role).toBe("assistant");
    const item = run.report!.items[0]!;
    expect(item.title).toBe("Moon lamp 3D");
    expect(item.sources).toEqual([{ title: "TikTok", url: "https://www.tiktok.com/tag/moonlamp" }]);
  });

  it("prices web searches on top of tokens and sends the search tool only when asked", async () => {
    const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    expect(costMicros("claude-sonnet-5-5", { ...usage, webSearches: 3 })).toBe(30_000);
    const calls: Record<string, any>[] = [];
    const client = {
      beta: {
        messages: {
          create: async (body: Record<string, unknown>) => (
            calls.push(body), { content: [], stop_reason: "end_turn", model: body.model, usage: { input_tokens: 1, output_tokens: 1, server_tool_use: { web_search_requests: 2, web_fetch_requests: 0 } } }
          ),
        },
      },
    };
    const m = new AnthropicModel(undefined, { client: client as never });
    const req = { agent: "scout" as const, model: "claude-sonnet-5-5", system: "s", tools: [], messages: [], effort: "low" as const, maxTokens: 10 };
    const res = await m.create({ ...req, webSearches: 5 });
    await m.create(req);
    expect(calls[0]!.tools).toEqual([{ type: "web_search_20260209", name: "web_search", max_uses: 5 }]);
    expect(calls[1]!.tools).toEqual([]);
    expect(res.usage.webSearches).toBe(2);
  });

  it("accepts only plain https links as sources", () => {
    expect(safeSourceUrl("https://trends.google.com/explore?q=x")).toBe("https://trends.google.com/explore?q=x");
    expect(safeSourceUrl("ftp://x.com")).toBeNull();
    expect(safeSourceUrl("https://user:pw@example.com/")).toBeNull();
    expect(safeSourceUrl("https://x.com:8443/")).toBeNull();
    expect(safeSourceUrl("not a url")).toBeNull();
  });
});
