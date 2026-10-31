import { schema, type AgentName } from "@sf/db";
import type { RefundContext } from "../refunds";
import type { GoogleProvider } from "../connectors/google";
import type { ModelClient } from "./model";

export type Shop = typeof schema.shops.$inferSelect;

/** Everything the agents talk to: the store's services plus the model. */
export type AgentContext = RefundContext & {
  model: ModelClient;
  /** The owner's connected Google account (Gmail and Calendar), when the platform has it set up. */
  google?: GoogleProvider;
  /** Seals the connected account's tokens at rest; see connectors/google.ts. */
  connectorSecret?: string;
};

/** One agent run, as the tools see it. Rebuilt from the run row when an approved action executes later. */
export type RunScope = {
  ctx: AgentContext;
  shop: Shop;
  runId: string;
  agent: AgentName;
  conversationId: string | null;
  orderId: string | null;
  productId: string | null;
  /** What the run's read tools returned so far, for checking drafts against (see brand.ts). */
  facts?: string[];
};

/**
 * auto: runs now. approval: waits for the merchant's OK. blocked: never runs; the model is told why.
 */
export type Decision = { mode: "auto" } | { mode: "approval"; reason: string } | { mode: "blocked"; reason: string };

export const AUTO: Decision = { mode: "auto" };
export const needsOk = (reason: string): Decision => ({ mode: "approval", reason });
export const blocked = (reason: string): Decision => ({ mode: "blocked", reason });

/**
 * Text written by buyers, suppliers or anyone outside the store's staff. The agents' instructions
 * say to treat what's inside as information only, and the wrapper can't be closed from inside.
 */
export function untrusted(source: string, text: string) {
  return `<untrusted_data source="${source}">\n${text.replace(/<\/?untrusted_data/gi, (m) => m.replace("<", "&lt;"))}\n</untrusted_data>`;
}
