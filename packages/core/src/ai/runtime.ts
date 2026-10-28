import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { BetaContentBlock, BetaMessageParam, BetaToolResultBlockParam } from "@anthropic-ai/sdk/resources/beta/messages";
import { schema, type AgentName, type Db } from "@sf/db";
import { NotFoundError, UserError } from "../errors";
import type { AgentContext, Decision, RunScope, Shop } from "./context";
import { costMicros } from "./model";
import { AGENT_TOOLS, findTool, PLAN_AI_BUDGET_MINOR, toolSpecs } from "./tools";

type Run = typeof schema.agentRuns.$inferSelect;
type Action = typeof schema.agentActions.$inferSelect;

/** A run stops after this many model calls, so a confused agent can't loop and spend. */
export const MAX_TURNS = 8;
/** Approvals one run may ask for; more than that is a sign something's off. */
export const MAX_PENDING_PER_RUN = 3;

export type AgentSpec = {
  agent: AgentName;
  system: (shop: Shop) => string;
  effort: "low" | "medium" | "high";
  maxTokens: number;
  /** Most web searches per model call, for agents that look things up online. */
  webSearches?: number;
};

export type RunInput = {
  trigger: Run["trigger"];
  messages: BetaMessageParam[];
  conversationId?: string | null;
  orderId?: string | null;
  productId?: string | null;
};

export type RunResult = {
  runId: string;
  status: Run["status"];
  /** What the agent said at the end, for the merchant (or an internal note, for buyer support). */
  text: string;
  actions: Action[];
  error: string | null;
};

const startOfMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

/** This calendar month's AI spend against the store's budget. */
export async function aiBudget(db: Db, shop: Pick<Shop, "id" | "plan" | "aiBudgetMinor">, now = new Date()) {
  const planMax = PLAN_AI_BUDGET_MINOR[shop.plan];
  const limitMinor = shop.aiBudgetMinor === null ? planMax : Math.min(shop.aiBudgetMinor, planMax);
  const rows = await db
    .select({ agent: schema.agentRuns.agent, micros: sql<number>`coalesce(sum(${schema.agentRuns.costMicros}), 0)::bigint`, runs: sql<number>`count(*)::int` })
    .from(schema.agentRuns)
    .where(and(eq(schema.agentRuns.shopId, shop.id), gte(schema.agentRuns.createdAt, startOfMonth(now))))
    .groupBy(schema.agentRuns.agent);
  const spentMicros = rows.reduce((s, r) => s + Number(r.micros), 0);
  return {
    planMaxMinor: planMax,
    limitMinor,
    spentMicros,
    /** Whole cents, rounded up, for display. */
    spentMinor: Math.ceil(spentMicros / 10_000),
    left: spentMicros < limitMinor * 10_000,
    byAgent: Object.fromEntries(rows.map((r) => [r.agent, { micros: Number(r.micros), runs: Number(r.runs) }])) as Partial<Record<AgentName, { micros: number; runs: number }>>,
    resetsOn: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Run one agent: call the model, carry out the tools it asks for (or queue them for approval),
 * and loop until it answers in words. Every call and its cost is recorded.
 */
export async function runAgent(ctx: AgentContext, spec: AgentSpec, shop: Shop, input: RunInput): Promise<RunResult> {
  const { db } = ctx;
  const budget = await aiBudget(db, shop);
  const base = {
    shopId: shop.id,
    agent: spec.agent,
    trigger: input.trigger,
    model: ctx.model.modelFor(spec.agent),
    conversationId: input.conversationId ?? null,
    orderId: input.orderId ?? null,
    productId: input.productId ?? null,
  };
  if (!budget.left) {
    const [run] = await db
      .insert(schema.agentRuns)
      .values({ ...base, status: "over_budget", error: "Monthly AI budget used up", finishedAt: new Date() })
      .returning();
    return { runId: run!.id, status: "over_budget", text: "", actions: [], error: "This month's AI budget is used up." };
  }
  const [run] = await db.insert(schema.agentRuns).values(base).returning();
  const scope: RunScope = { ctx, shop, runId: run!.id, agent: spec.agent, conversationId: base.conversationId, orderId: base.orderId, productId: base.productId, facts: [] };
  const messages = [...input.messages];
  const tools = toolSpecs(spec.agent);
  const system = spec.system(shop);
  let finalText = "";
  let status: Run["status"] = "done";
  let error: string | null = null;
  let spent = budget.spentMicros;

  try {
    for (let turn = 0; ; turn++) {
      if (turn >= MAX_TURNS) {
        status = "failed";
        error = "The assistant took too many steps and was stopped.";
        break;
      }
      const res = await ctx.model.create({ agent: spec.agent, model: base.model, system, tools, messages, effort: spec.effort, maxTokens: spec.maxTokens, webSearches: spec.webSearches });
      const cost = costMicros(res.model, res.usage);
      spent += cost;
      await db
        .update(schema.agentRuns)
        .set({
          inputTokens: sql`${schema.agentRuns.inputTokens} + ${res.usage.inputTokens}`,
          outputTokens: sql`${schema.agentRuns.outputTokens} + ${res.usage.outputTokens}`,
          cacheReadTokens: sql`${schema.agentRuns.cacheReadTokens} + ${res.usage.cacheReadTokens}`,
          cacheWriteTokens: sql`${schema.agentRuns.cacheWriteTokens} + ${res.usage.cacheWriteTokens}`,
          costMicros: sql`${schema.agentRuns.costMicros} + ${cost}`,
        })
        .where(eq(schema.agentRuns.id, scope.runId));

      // Thinking and tool calls go back to the model unchanged, in order.
      messages.push({ role: "assistant", content: res.content as BetaMessageParam["content"] });
      const words = res.content.filter((b): b is Extract<BetaContentBlock, { type: "text" }> => b.type === "text").map((b) => b.text).join("\n").trim();
      if (words) finalText = words;

      if (res.stopReason === "refusal") {
        status = "failed";
        error = "The model declined this request.";
        break;
      }
      const calls = res.content.filter((b): b is Extract<BetaContentBlock, { type: "tool_use" }> => b.type === "tool_use");
      if (res.stopReason === "max_tokens") {
        // A cut-off tool call may have half its input; don't run anything from this turn.
        status = "failed";
        error = "The answer was too long and got cut off.";
        break;
      }
      // A long web search turn pauses; sending it back as is lets the server carry on.
      if (res.stopReason === "pause_turn" && spent < budget.limitMinor * 10_000) continue;
      if (res.stopReason === "pause_turn") {
        status = "over_budget";
        error = "This month's AI budget ran out part way through.";
        break;
      }
      if (!calls.length) break;

      const results: BetaToolResultBlockParam[] = [];
      for (const call of calls) results.push(await callTool(scope, call.name, call.id, call.input));
      messages.push({ role: "user", content: results });

      if (spent >= budget.limitMinor * 10_000) {
        status = "over_budget";
        error = "This month's AI budget ran out part way through.";
        break;
      }
    }
  } catch (e) {
    status = "failed";
    error = errText(e);
  }

  await db.update(schema.agentRuns).set({ status, error, finishedAt: new Date() }).where(eq(schema.agentRuns.id, scope.runId));
  const actions = await db.query.agentActions.findMany({ where: eq(schema.agentActions.runId, scope.runId), orderBy: schema.agentActions.createdAt });
  return { runId: scope.runId, status, text: finalText, actions, error };
}

async function callTool(scope: RunScope, name: string, id: string, rawInput: unknown): Promise<BetaToolResultBlockParam> {
  const { db } = scope.ctx;
  const t = findTool(scope.agent, name);
  const reply = (content: unknown, isError = false): BetaToolResultBlockParam => ({
    type: "tool_result",
    tool_use_id: id,
    content: typeof content === "string" ? content : JSON.stringify(content),
    ...(isError ? { is_error: true } : {}),
  });
  const log = (v: Omit<typeof schema.agentActions.$inferInsert, "shopId" | "runId" | "agent">) =>
    db.insert(schema.agentActions).values({ shopId: scope.shop.id, runId: scope.runId, agent: scope.agent, ...v }).returning();

  if (!t) {
    await log({ tool: name, input: (rawInput ?? {}) as Record<string, unknown>, summary: `Tried an unknown tool “${name}”`, status: "blocked", reason: "Not one of this agent's tools" });
    return reply(`There is no tool called ${name}. Use only the tools you were given.`, true);
  }
  const parsed = t.input.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return reply(`Invalid input for ${name}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}`, true);
  }
  let input = parsed.data;
  let summary: string;
  let decision: Decision;
  try {
    summary = await t.summary(input, scope);
    const problems = t.check ? await t.check(input, scope) : [];
    if (problems.length) {
      await log({ tool: name, input, summary, status: "blocked", reason: `Broke the store's writing rules: ${problems.join("; ")}` });
      return reply(`Not saved, because ${problems.join("; ")}. Fix that and call ${name} again.`, true);
    }
    decision = t.kind === "read" ? { mode: "auto" } : t.policy ? await t.policy(input, scope) : { mode: "approval", reason: "It changes the store." };
  } catch (e) {
    return reply(errText(e), true);
  }

  if (decision.mode === "blocked") {
    await log({ tool: name, input, summary, status: "blocked", reason: decision.reason });
    return reply(`Not allowed: ${decision.reason}`, true);
  }
  if (decision.mode === "approval") {
    const [{ n }] = (await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.agentActions)
      .where(and(eq(schema.agentActions.runId, scope.runId), eq(schema.agentActions.status, "pending")))) as [{ n: number }];
    if (Number(n) >= MAX_PENDING_PER_RUN) {
      await log({ tool: name, input, summary, status: "blocked", reason: "Too many requests for approval in one go" });
      return reply("Not allowed: you've already asked the merchant to approve several things. Stop and summarise.", true);
    }
    if (t.propose) {
      try {
        input = await t.propose(input, scope);
      } catch (e) {
        // A proposal that can't be made (a code that's taken, a product that isn't there) goes back to the model to fix.
        if (!(e instanceof UserError)) throw e;
        await log({ tool: name, input, summary, status: "failed", error: e.message });
        return reply(e.message, true);
      }
    }
    const [row] = await log({ tool: name, input, summary, status: "pending", reason: decision.reason });
    return reply({ status: "waiting_for_merchant", why: decision.reason, action_id: row!.id, note: "Don't try another way to do this. Tell the merchant what you proposed." });
  }

  try {
    const result = await t.run(input, scope);
    if (t.kind === "read") scope.facts?.push(typeof result === "string" ? result : JSON.stringify(result ?? null));
    await log({ tool: name, input, summary, status: "done", result: t.kind === "read" ? null : (result ?? null) });
    return reply(result ?? { done: true });
  } catch (e) {
    await log({ tool: name, input, summary, status: "failed", error: errText(e) });
    if (e instanceof UserError) return reply(e.message, true);
    return reply("That didn't work because of an error on our side. Don't retry it; tell the merchant.", true);
  }
}

/** The merchant approves or turns down something an agent proposed. Approving carries it out now. */
export async function decideAction(ctx: AgentContext, shopId: string, actionId: string, d: { approve: boolean; by: string; message?: string }) {
  const { db } = ctx;
  const action = await db.query.agentActions.findFirst({ where: and(eq(schema.agentActions.id, actionId), eq(schema.agentActions.shopId, shopId)) });
  if (!action) throw new NotFoundError("Request");
  if (action.status !== "pending") throw new UserError("This was already decided.");
  // Claim it first so a double click can't carry it out twice.
  const [claimed] = await db
    .update(schema.agentActions)
    .set({ status: d.approve ? "approved" : "rejected", decidedBy: d.by, decidedAt: new Date() })
    .where(and(eq(schema.agentActions.id, action.id), eq(schema.agentActions.status, "pending")))
    .returning();
  if (!claimed) throw new UserError("This was already decided.");

  const input = { ...action.input };
  if (!d.approve) {
    if (typeof input.message_id === "string") {
      await db.update(schema.messages).set({ status: "discarded" }).where(and(eq(schema.messages.id, input.message_id), eq(schema.messages.status, "draft")));
    }
    return { status: "rejected" as const };
  }

  const run = (await db.query.agentRuns.findFirst({ where: eq(schema.agentRuns.id, action.runId) }))!;
  const shop = (await db.query.shops.findFirst({ where: eq(schema.shops.id, shopId) }))!;
  const t = findTool(action.agent, action.tool);
  if (!t) throw new UserError("This kind of request isn't supported any more.");
  if (d.message !== undefined && "message" in input) input.message = d.message.trim();
  const parsed = t.input.safeParse(input);
  if (!parsed.success) {
    await db.update(schema.agentActions).set({ status: "failed", error: parsed.error.issues[0]?.message ?? "Invalid" }).where(eq(schema.agentActions.id, action.id));
    throw new UserError(`Can't do this: ${parsed.error.issues[0]?.message}`);
  }
  const scope: RunScope = { ctx, shop, runId: run.id, agent: action.agent, conversationId: run.conversationId, orderId: run.orderId, productId: run.productId };
  try {
    const result = await t.run({ ...parsed.data, ...(input.message_id ? { message_id: input.message_id } : {}) }, scope);
    await db.update(schema.agentActions).set({ input, result: (result ?? null) as never }).where(eq(schema.agentActions.id, action.id));
    return { status: "approved" as const, result };
  } catch (e) {
    await db.update(schema.agentActions).set({ status: "failed", error: errText(e) }).where(eq(schema.agentActions.id, action.id));
    if (e instanceof UserError) throw new UserError(`It didn't work: ${e.message}`);
    throw e;
  }
}

export async function listPendingActions(db: Db, shopId: string) {
  return db.query.agentActions.findMany({
    where: and(eq(schema.agentActions.shopId, shopId), eq(schema.agentActions.status, "pending")),
    orderBy: desc(schema.agentActions.createdAt),
    limit: 50,
  });
}

/** Approvals the merchant decided in the last few minutes, so the page can confirm what happened. */
export async function listRecentDecisions(db: Db, shopId: string, withinMs = 10 * 60_000) {
  return db.query.agentActions.findMany({
    where: and(
      eq(schema.agentActions.shopId, shopId),
      inArray(schema.agentActions.status, ["approved", "rejected", "failed"]),
      gte(schema.agentActions.decidedAt, new Date(Date.now() - withinMs)),
    ),
    orderBy: desc(schema.agentActions.decidedAt),
    limit: 10,
  });
}

export async function listAgentActivity(db: Db, shopId: string, limit = 60) {
  return db.query.agentActions.findMany({
    where: and(eq(schema.agentActions.shopId, shopId), inArray(schema.agentActions.status, ["done", "approved", "rejected", "failed", "blocked"])),
    orderBy: desc(schema.agentActions.createdAt),
    limit,
  });
}

export async function listAgentRuns(db: Db, shopId: string, limit = 30) {
  return db.query.agentRuns.findMany({ where: eq(schema.agentRuns.shopId, shopId), orderBy: desc(schema.agentRuns.createdAt), limit });
}

export const agentToolNames = (agent: AgentName) => AGENT_TOOLS[agent].map((t) => t.name);
