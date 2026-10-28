import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaContentBlock,
  BetaMessageParam,
  BetaStopReason,
  BetaTool,
} from "@anthropic-ai/sdk/resources/beta/messages";
import type { AgentName } from "@sf/db";

export type { BetaContentBlock, BetaMessageParam, BetaTool };

export type ModelRequest = {
  agent: AgentName;
  /** Which Claude model answers; picked per agent by the client's modelFor. */
  model: string;
  system: string;
  tools: BetaTool[];
  messages: BetaMessageParam[];
  /** How hard the model thinks. Bulk work runs low; talking to people runs medium. */
  effort: "low" | "medium" | "high";
  maxTokens: number;
  /** Web searches the model may run on Anthropic's side in one call (the trend scout). None when unset. */
  webSearches?: number;
};

export type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Web searches run in the call; each is billed on top of tokens. */
  webSearches?: number;
};

export type ModelResponse = {
  content: BetaContentBlock[];
  stopReason: BetaStopReason | null;
  usage: ModelUsage;
  /** The model that actually answered (a fallback model can take over a declined request). */
  model: string;
};

export interface ModelClient {
  /** The fallback model, for agents with no model of their own. */
  readonly model: string;
  /** The model this agent runs on. Recorded on each run, and used to price it. */
  modelFor(agent: AgentName): string;
  /** False for the built-in demo brain, so the admin can say answers are canned. */
  readonly live: boolean;
  create(req: ModelRequest): Promise<ModelResponse>;
}

export const DEFAULT_MODEL = "claude-opus-5-5";

/**
 * Each agent runs on the cheapest model that does its job well. Short, checked writing jobs
 * (listings, translations, size charts, answer drafts, margins, review summaries) and the storefront's shopping
 * assistant, which answers many shoppers from read-only tools, run on Haiku; the ones that write
 * to buyers, untangle orders or weigh a store's numbers on Sonnet; the open-ended Assistant on Opus.
 */
export const AGENT_MODELS: Record<AgentName, string> = {
  listing: "claude-haiku-5-5",
  translator: "claude-haiku-5-5",
  sizer: "claude-haiku-5-5",
  answerer: "claude-haiku-5-5",
  margin: "claude-haiku-5-5",
  shopper: "claude-haiku-5-5",
  summarizer: "claude-haiku-5-5",
  writer: "claude-sonnet-5-5",
  analyst: "claude-sonnet-5-5",
  scout: "claude-sonnet-5-5",
  buyer_support: "claude-sonnet-5-5",
  fulfilment: "claude-sonnet-5-5",
  assistant: "claude-opus-5-5",
};

/**
 * Models per agent from the environment: AI_MODEL puts every agent on one model, and
 * AI_MODEL_<AGENT> (like AI_MODEL_WRITER) sets one agent.
 */
export function agentModelsFromEnv(env: Record<string, string | undefined>): Record<AgentName, string> {
  const all = env.AI_MODEL?.trim();
  return Object.fromEntries(
    (Object.keys(AGENT_MODELS) as AgentName[]).map((a) => [a, env[`AI_MODEL_${a.toUpperCase()}`]?.trim() || all || AGENT_MODELS[a]]),
  ) as Record<AgentName, string>;
}

/** Display names for the AI settings page. */
export const MODEL_LABEL: Record<string, string> = {
  "claude-opus-5-5": "Claude Opus 5.5",
  "claude-sonnet-5-5": "Claude Sonnet 5.5",
  "claude-haiku-5-5": "Claude Haiku 5.5",
  "claude-opus-4-8": "Claude Opus 4.8",
};

/** US dollars per million tokens. Cache writes are 1.25x input for the default 5-minute cache. */
const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
};

/** A web search costs $10 per 1,000, on any model. */
export const WEB_SEARCH_MICROS = 10_000;

/** Cost of one model call in millionths of a dollar (a token at $4 per million costs 4 micros). */
export function costMicros(model: string, u: ModelUsage): number {
  const p = PRICES[model] ?? PRICES[DEFAULT_MODEL]!;
  return Math.ceil(u.inputTokens * p.input + u.outputTokens * p.output + u.cacheReadTokens * p.cacheRead + u.cacheWriteTokens * p.cacheWrite) + (u.webSearches ?? 0) * WEB_SEARCH_MICROS;
}

/** Haiku has no server-side fallback; the API rejects the parameter there. */
const hasFallbacks = (model: string) => !model.startsWith("claude-haiku");

/**
 * Claude through the Messages API. Thinking is adaptive (always on for these models); effort sets
 * how much. The tools and system prompt are fixed per agent, so the request prefix is cached
 * between the turns of a run. If the model declines a request, the API retries it on a fallback
 * model instead of failing (Opus and Sonnet).
 */
export class AnthropicModel implements ModelClient {
  readonly live = true;
  private readonly client: Anthropic;
  private readonly models: Partial<Record<AgentName, string>>;

  constructor(
    readonly model = DEFAULT_MODEL,
    opts: { apiKey?: string; client?: Anthropic; models?: Partial<Record<AgentName, string>> } = {},
  ) {
    this.client = opts.client ?? new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {});
    this.models = opts.models ?? {};
  }

  modelFor(agent: AgentName) {
    return this.models[agent] ?? this.model;
  }

  async create(req: ModelRequest): Promise<ModelResponse> {
    const res = await this.client.beta.messages.create({
      model: req.model,
      max_tokens: req.maxTokens,
      ...(hasFallbacks(req.model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      cache_control: { type: "ephemeral" },
      output_config: { effort: req.effort },
      system: req.system,
      // Web search runs on Anthropic's side; its results come back in the reply and go back unchanged.
      tools: req.webSearches ? [...req.tools, { type: "web_search_20260209" as const, name: "web_search" as const, max_uses: req.webSearches }] : req.tools,
      tool_choice: { type: "auto" },
      messages: req.messages,
    });
    return {
      content: res.content,
      stopReason: res.stop_reason,
      model: res.model,
      usage: {
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
        webSearches: res.usage.server_tool_use?.web_search_requests ?? 0,
      },
    };
  }
}

/** One scripted reply: what the "model" says, given the request so far. */
export type ScriptStep = (req: ModelRequest) => BetaContentBlock[] | { content: BetaContentBlock[]; stopReason: BetaStopReason };

/** Plays back fixed replies, for tests. Each call uses the next step. */
export class ScriptedModel implements ModelClient {
  readonly live = false;
  readonly requests: ModelRequest[] = [];
  private i = 0;

  constructor(
    private readonly steps: (ScriptStep | BetaContentBlock[])[],
    readonly model = DEFAULT_MODEL,
    private readonly usagePerCall: ModelUsage = { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 },
  ) {}

  modelFor() {
    return this.model;
  }

  async create(req: ModelRequest): Promise<ModelResponse> {
    this.requests.push(structuredClone(req));
    const step = this.steps[this.i++];
    const out = step === undefined ? [text("Done.")] : typeof step === "function" ? step(req) : step;
    const content = Array.isArray(out) ? out : out.content;
    const stopReason = Array.isArray(out) ? (content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn") : out.stopReason;
    return { content, stopReason, usage: this.usagePerCall, model: req.model };
  }
}

let toolCallSeq = 0;
/** A tool call block, as the model would send it. */
export function toolCall(name: string, input: Record<string, unknown>): BetaContentBlock {
  return { type: "tool_use", id: `toolu_${(++toolCallSeq).toString(36).padStart(6, "0")}`, name, input } as BetaContentBlock;
}

export function text(t: string): BetaContentBlock {
  return { type: "text", text: t, citations: null } as BetaContentBlock;
}

/** Rough token count for text, for the demo brain's usage estimates. */
export const estimateTokens = (s: string) => Math.ceil(s.length / 4);
