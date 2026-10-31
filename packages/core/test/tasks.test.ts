import { describe, expect, it } from "vitest";
import { addTask, askAssistant, DemoModel, dueLabel, findTask, listTasks, parseDueDate, setTaskDone, taskCounts, TASKS_OPEN_MAX, todaySummary, UserError } from "../src";
import { makeFixture } from "../evals/fixture";

const DAY = 86_400_000;

describe("the to-do list", () => {
  it("keeps the owner's tasks, due ones first, and counts what's due for Today", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const now = new Date("2026-11-10T12:00:00Z");
    await addTask(f.db, shop.id, { title: "  Write the   November newsletter ", by: "owner@example.com" });
    await addTask(f.db, shop.id, { title: "Add a backup supplier for the lamp", dueAt: new Date(now.getTime() - 2 * DAY), href: "/admin/suppliers", source: "assistant" });
    await addTask(f.db, shop.id, { title: "Check the Black Friday prices", dueAt: new Date(now.getTime() + 6 * 3_600_000) });
    await expect(addTask(f.db, shop.id, { title: "x" })).rejects.toThrow(/what needs doing/i);
    await expect(addTask(f.db, shop.id, { title: "Open this", href: "https://evil.example" })).rejects.toThrow(UserError);

    const open = await listTasks(f.db, shop.id);
    expect(open.map((t) => t.title)).toEqual(["Add a backup supplier for the lamp", "Check the Black Friday prices", "Write the November newsletter"]);
    expect(await taskCounts(f.db, shop.id, now)).toEqual({ open: 3, overdue: 1, today: 1 });
    expect(dueLabel(open[0]!.dueAt, now)).toBe("2 days overdue");
    expect(dueLabel(open[1]!.dueAt, now)).toBe("Today");
    expect(dueLabel(null)).toBeNull();

    const today = await todaySummary(f.db, shop, now);
    expect(today.attention.find((a) => a.kind === "tasks")).toMatchObject({ title: "3 on your to-do list", body: "1 overdue, 1 due today.", url: "/tasks", tone: "warning" });
    // Staff see the list too: it's part of the home page.
    expect((await todaySummary(f.db, shop, now, "staff")).attention.some((a) => a.kind === "tasks")).toBe(true);

    await setTaskDone(f.db, shop.id, open[0]!.id, true);
    expect((await listTasks(f.db, shop.id, "done")).map((t) => t.title)).toEqual(["Add a backup supplier for the lamp"]);
    expect(await taskCounts(f.db, shop.id, now)).toEqual({ open: 2, overdue: 0, today: 1 });
    await setTaskDone(f.db, shop.id, open[0]!.id, false);
    expect(await listTasks(f.db, shop.id)).toHaveLength(3);
    expect(findTask(open, "the backup supplier")?.title).toBe("Add a backup supplier for the lamp");
    expect(findTask(open, "something else entirely")).toBeNull();
  });

  it("stops at the limit, and reads dates the Assistant gives", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    for (let i = 0; i < TASKS_OPEN_MAX; i++) await addTask(f.db, shop.id, { title: `Task ${i}` });
    await expect(addTask(f.db, shop.id, { title: "One more" })).rejects.toThrow(/100 open tasks/);
    expect(parseDueDate("2026-11-15")?.toISOString()).toBe("2026-11-15T23:59:59.000Z");
    expect(parseDueDate("")).toBeNull();
    expect(() => parseDueDate("next week")).toThrow(/2026-11-15/);
    expect(() => parseDueDate("2026-02-30")).toThrow(/doesn't exist/);
  });

  it("the Assistant adds, reads and ticks off tasks when the owner asks", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const added = await askAssistant(f.ctx, shop, "Remind me to order new packaging by 2026-12-01");
    expect(added.text).toContain("Added to your list: “Order new packaging”, due 2026-12-01");
    const list = await askAssistant(f.ctx, shop, "What's on my list?");
    expect(list.text).toContain("Order new packaging");
    const done = await askAssistant(f.ctx, shop, "I've done the packaging order");
    expect(done.text).toContain("Ticked off “Order new packaging”. Your list is clear.");
    expect((await f.actions()).filter((a) => a.agent === "assistant").map((a) => [a.tool, a.status])).toEqual([["add_task", "done"], ["read_tasks", "done"], ["complete_task", "done"]]);
    expect(await listTasks(f.db, shop.id, "done")).toHaveLength(1);
  });
});
