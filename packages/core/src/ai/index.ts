import { DemoModel } from "./demo";
import { agentModelsFromEnv, AnthropicModel, DEFAULT_MODEL, type ModelClient } from "./model";

export * from "./model";
export * from "./context";
export * from "./conversations";
export * from "./tools";
export * from "./runtime";
export * from "./agents";
export * from "./skills";
export * from "./brand";
export { DemoModel } from "./demo";

/** Claude when ANTHROPIC_API_KEY is set (models per agent, see agentModelsFromEnv), otherwise the built-in demo brain. */
export function modelFromEnv(env: Record<string, string | undefined>): ModelClient {
  const model = env.AI_MODEL?.trim() || DEFAULT_MODEL;
  const models = agentModelsFromEnv(env);
  return env.ANTHROPIC_API_KEY ? new AnthropicModel(model, { apiKey: env.ANTHROPIC_API_KEY, models }) : new DemoModel(model, models);
}
export * from "./memory";
export * from "./examples";
export * from "./impact";
