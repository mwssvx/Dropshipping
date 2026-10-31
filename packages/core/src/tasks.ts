// The store's to-do list. The owner writes things down on the To do page, or tells the Assistant
// "remind me to…" and it adds them. Open tasks show on Today (web and app), overdue ones first.
import { and, asc, desc, eq, lt, sql } from "drizzle-orm";
import { schema, type Db } from "@sf/db";
import { UserError } from "./errors";

export type Task = typeof schema.tasks.$inferSelect;
export const TASK_TITLE_MAX = 160;
export const TASK_NOTE_MAX = 1000;
export const TASKS_OPEN_MAX = 100;
const DAY = 86_400_000;

export type TaskInput = { title: string; note?: string | null; dueAt?: Date | null; href?: string | null; source?: Task["source"]; by?: string | null };

export async function addTask(db: Db, shopId: string, input: TaskInput) {
  const title = input.title.replace(/\s+/g, " ").trim();
  if (title.length < 2) throw new UserError("Write what needs doing.");
  if (title.length > TASK_TITLE_MAX) throw new UserError(`Keep it under ${TASK_TITLE_MAX} characters; the details can go in the note.`);
  const note = input.note?.trim().slice(0, TASK_NOTE_MAX) || null;
  if (input.dueAt && Number.isNaN(input.dueAt.getTime())) throw new UserError("That date isn't right. Use a date like 2026-11-15.");
  const href = input.href?.trim() || null;
  if (href && !/^\/admin(\/|$)/.test(href)) throw new UserError("A task can only link to a page in this admin.");
  const [{ open }] = (await db.select({ open: sql<number>`count(*)::int` }).from(schema.tasks).where(and(eq(schema.tasks.shopId, shopId), eq(schema.tasks.status, "open")))) as [{ open: number }];
  if (Number(open) >= TASKS_OPEN_MAX) throw new UserError(`The list already has ${TASKS_OPEN_MAX} open tasks. Tick some off first.`);
  const [task] = await db
    .insert(schema.tasks)
    .values({ shopId, title, note, dueAt: input.dueAt ?? null, href, source: input.source ?? "owner", createdBy: input.by ?? null })
    .returning();
  return task!;
}

/** Open tasks: overdue and due soon first, then the rest newest first. Done tasks newest first. */
export async function listTasks(db: Db, shopId: string, status: Task["status"] = "open", limit = 100) {
  return db.query.tasks.findMany({
    where: and(eq(schema.tasks.shopId, shopId), eq(schema.tasks.status, status)),
    orderBy: status === "open" ? [sql`${schema.tasks.dueAt} asc nulls last`, desc(schema.tasks.createdAt)] : [desc(schema.tasks.doneAt), asc(schema.tasks.createdAt)],
    limit,
  });
}

export async function setTaskDone(db: Db, shopId: string, id: string, done: boolean) {
  const [task] = await db
    .update(schema.tasks)
    .set(done ? { status: "done", doneAt: new Date() } : { status: "open", doneAt: null })
    .where(and(eq(schema.tasks.id, id), eq(schema.tasks.shopId, shopId)))
    .returning();
  if (!task) throw new UserError("That task is gone.");
  return task;
}

export async function deleteTask(db: Db, shopId: string, id: string) {
  await db.delete(schema.tasks).where(and(eq(schema.tasks.id, id), eq(schema.tasks.shopId, shopId)));
}

/** How the list stands, for Today: how many are open and how many are past their date. */
export async function taskCounts(db: Db, shopId: string, now = new Date()) {
  const [row] = (await db
    .select({
      open: sql<number>`count(*)::int`,
      overdue: sql<number>`count(*) filter (where ${schema.tasks.dueAt} < ${now})::int`,
      today: sql<number>`count(*) filter (where ${schema.tasks.dueAt} >= ${now} and ${schema.tasks.dueAt} < ${new Date(now.getTime() + DAY)})::int`,
    })
    .from(schema.tasks)
    .where(and(eq(schema.tasks.shopId, shopId), eq(schema.tasks.status, "open")))) as [{ open: number; overdue: number; today: number }];
  return { open: Number(row?.open ?? 0), overdue: Number(row?.overdue ?? 0), today: Number(row?.today ?? 0) };
}

/** Tasks whose date has passed, for the Assistant and Today. */
export const overdueTasks = (db: Db, shopId: string, now = new Date()) =>
  db.query.tasks.findMany({ where: and(eq(schema.tasks.shopId, shopId), eq(schema.tasks.status, "open"), lt(schema.tasks.dueAt, now)), orderBy: asc(schema.tasks.dueAt) });

const key = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Open tasks that share at least half the words of a description, best first. */
export function matchTasks<T extends Pick<Task, "id" | "title">>(tasks: T[], text: string) {
  const want = key(text).split(" ").filter((w) => w.length > 2);
  return tasks
    .map((task) => {
      const words = new Set(key(task.title).split(" "));
      return { task, score: want.filter((w) => words.has(w)).length / Math.max(want.length, 1) };
    })
    .filter((m) => m.score >= 0.5)
    .sort((a, b) => b.score - a.score);
}

/** The one open task that best matches a few of its words, for ticking one off by describing it. Null when none or several match equally. */
export function findTask<T extends Pick<Task, "id" | "title">>(tasks: T[], text: string) {
  const m = matchTasks(tasks, text);
  if (!m.length || (m.length > 1 && m[1]!.score === m[0]!.score)) return null;
  return m[0]!.task;
}

/** "Tomorrow", "in 3 days", "overdue by 2 days", for lists. Counts calendar days (UTC), so a task due at the end of today is "Today" all day. */
export function dueLabel(dueAt: Date | null, now = new Date()) {
  if (!dueAt) return null;
  const days = Math.floor(dueAt.getTime() / DAY) - Math.floor(now.getTime() / DAY);
  if (days < -1) return `${-days} days overdue`;
  if (days === -1) return "1 day overdue";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days <= 14) return `In ${days} days`;
  return dueAt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** A date like 2026-11-15 as the end of that day (UTC), or null for none. */
export function parseDueDate(text: string | null | undefined) {
  const t = text?.trim();
  if (!t) return null;
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new UserError("Use a date like 2026-11-15.");
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59));
  if (Number.isNaN(d.getTime()) || d.getUTCDate() !== Number(m[3])) throw new UserError("That date doesn't exist.");
  return d;
}
