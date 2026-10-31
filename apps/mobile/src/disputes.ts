import type { Tone } from "./theme";

/** A dispute's state, as the website shows it. */
export const DISPUTE_STATUS: Record<"needs_response" | "under_review" | "won" | "lost" | "closed", { label: string; tone: Tone }> = {
  needs_response: { label: "Needs your answer", tone: "critical" },
  under_review: { label: "Bank reviewing", tone: "info" },
  won: { label: "Won", tone: "success" },
  lost: { label: "Lost", tone: "critical" },
  closed: { label: "Closed", tone: "neutral" },
};
