import { describe, expect, it } from "vitest";
import { agentModelsFromEnv, AnthropicModel, DemoModel, type ModelClient } from "../src";
import { CASES, runCase } from "../evals/cases";

// CI runs every case against the demo brain. With EVAL_LIVE=1 and ANTHROPIC_API_KEY set, the
// behaviour cases run against Claude instead (pnpm --filter @sf/core evals:live). That spends
// real money: about 40 short agent runs, each on its agent's model (AI_MODEL or AI_MODEL_<AGENT>
// to try others).
const live = process.env.EVAL_LIVE === "1";
if (live && !process.env.ANTHROPIC_API_KEY) throw new Error("EVAL_LIVE=1 needs ANTHROPIC_API_KEY");
const model: ModelClient = live ? new AnthropicModel(undefined, { models: agentModelsFromEnv(process.env) }) : new DemoModel();

describe(`agent evals (${live ? "Claude" : "demo brain"})`, () => {
  it("has at least 50 cases with unique ids", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(50);
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
  });

  for (const c of CASES) {
    it.concurrent(`[${c.kind}] ${c.agent}: ${c.what}`, async () => {
      const r = await runCase(c, model);
      expect(r.error, c.id).toBeNull();
    }, live ? 180_000 : 60_000);
  }
});
