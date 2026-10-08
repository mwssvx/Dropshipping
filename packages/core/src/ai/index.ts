import { DemoModel } from "./demo";
import { AnthropicModel, DEFAULT_MODEL, type ModelClient } from "./model";

export * from "./model";
export * from "./context";
export * from "./conversations";
export * from "./tools";
export * from "./runtime";
export * from "./agents";
export { DemoModel } from "./demo";

/** Claude when ANTHROPIC_API_KEY is set (model from AI_MODEL), otherwise the built-in demo brain. */
export function modelFromEnv(env: Record<string, string | undefined>): ModelClient {
  const model = env.AI_MODEL?.trim() || DEFAULT_MODEL;
  return env.ANTHROPIC_API_KEY ? new AnthropicModel(model, { apiKey: env.ANTHROPIC_API_KEY }) : new DemoModel(model);
}
