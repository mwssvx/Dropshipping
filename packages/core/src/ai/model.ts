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
  system: string;
  tools: BetaTool[];
  messages: BetaMessageParam[];
  /** How hard the model thinks. Bulk work runs low; talking to people runs medium. */
  effort: "low" | "medium" | "high";
  maxTokens: number;
};

export type ModelUsage = { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };

export type ModelResponse = {
  content: BetaContentBlock[];
  stopReason: BetaStopReason | null;
  usage: ModelUsage;
  /** The model that actually answered (a fallback model can take over a declined request). */
  model: string;
};

export interface ModelClient {
  /** Model id recorded on each run, and used to price it. */
  readonly model: string;
  /** False for the built-in demo brain, so the admin can say answers are canned. */
  readonly live: boolean;
  create(req: ModelRequest): Promise<ModelResponse>;
}

export const DEFAULT_MODEL = "claude-opus-5-5";

/** US dollars per million tokens. Cache writes are 1.25x input for the default 5-minute cache. */
const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
};

/** Cost of one model call in millionths of a dollar (a token at $4 per million costs 4 micros). */
export function costMicros(model: string, u: ModelUsage): number {
  const p = PRICES[model] ?? PRICES[DEFAULT_MODEL]!;
  return Math.ceil(u.inputTokens * p.input + u.outputTokens * p.output + u.cacheReadTokens * p.cacheRead + u.cacheWriteTokens * p.cacheWrite);
}

/**
 * Claude through the Messages API. Thinking is adaptive (always on for this model); effort sets
 * how much. The tools and system prompt are fixed per agent, so the request prefix is cached
 * between the turns of a run. If the model declines a request, the API retries it on a fallback
 * model instead of failing.
 */
export class AnthropicModel implements ModelClient {
  readonly live = true;
  private readonly client: Anthropic;

  constructor(
    readonly model = DEFAULT_MODEL,
    opts: { apiKey?: string; client?: Anthropic } = {},
  ) {
    this.client = opts.client ?? new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {});
  }

  async create(req: ModelRequest): Promise<ModelResponse> {
    const res = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: req.maxTokens,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      cache_control: { type: "ephemeral" },
      output_config: { effort: req.effort },
      system: req.system,
      tools: req.tools,
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

  async create(req: ModelRequest): Promise<ModelResponse> {
    this.requests.push(structuredClone(req));
    const step = this.steps[this.i++];
    const out = step === undefined ? [text("Done.")] : typeof step === "function" ? step(req) : step;
    const content = Array.isArray(out) ? out : out.content;
    const stopReason = Array.isArray(out) ? (content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn") : out.stopReason;
    return { content, stopReason, usage: this.usagePerCall, model: this.model };
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
