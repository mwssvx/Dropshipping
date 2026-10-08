export function ConversationStatus({ status, drafts }: { status: string; drafts: number }) {
  if (drafts) return <span className="pill pill-warning">Reply ready to check</span>;
  if (status === "needs_merchant") return <span className="pill pill-warning">Needs you</span>;
  if (status === "escalated") return <span className="pill pill-critical">With our trust team</span>;
  if (status === "resolved") return <span className="pill pill-success">Answered</span>;
  return <span className="pill pill-info">New</span>;
}
