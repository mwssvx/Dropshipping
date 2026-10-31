import { dueLabel, listTasks, TASKS_OPEN_MAX } from "@sf/core";
import { requireShop } from "@/lib/server";
import { PageHeader } from "../PageHeader";
import { AddTaskForm, TaskRow } from "./TaskForms";

export const metadata = { title: "To do" };

const BY = { owner: "You", assistant: "The Assistant", watch: "The store watch" } as const;

export default async function TasksPage() {
  const { shop, db } = await requireShop("home");
  const now = new Date();
  const [open, done] = await Promise.all([listTasks(db, shop.id, "open"), listTasks(db, shop.id, "done", 30)]);
  const row = (t: (typeof open)[number]) => (
    <TaskRow key={`${t.id}-${t.status}`} id={t.id} title={t.title} note={t.note} due={dueLabel(t.dueAt, now)} overdue={!!t.dueAt && t.dueAt < now} href={t.href} done={t.status === "done"} by={BY[t.source]} />
  );
  return (
    <main className="pb-12">
      <PageHeader title="To do" />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-3xl">
        <p className="hint max-w-2xl">
          Your list for the store. Write things down here, or tell the Assistant &ldquo;remind me to…&rdquo; and it adds them. What&apos;s due shows on Today, here and in the app.
        </p>
        <section className="card p-5" aria-labelledby="add-heading">
          <h2 id="add-heading" className="font-semibold mb-3">Add to the list</h2>
          <AddTaskForm />
        </section>
        <section className="card p-5 flex flex-col gap-2" aria-labelledby="open-heading">
          <div className="flex justify-between items-baseline gap-3">
            <h2 id="open-heading" className="font-semibold">To do</h2>
            <span className="hint num">{open.length} of {TASKS_OPEN_MAX}</span>
          </div>
          {open.length === 0 ? <p className="hint text-sm">Nothing on the list.</p> : <ul className="divide-y divide-border">{open.map(row)}</ul>}
        </section>
        {done.length > 0 && (
          <details className="card p-5">
            <summary className="font-semibold cursor-pointer">Done ({done.length})</summary>
            <ul className="divide-y divide-border mt-2">{done.map(row)}</ul>
          </details>
        )}
      </div>
    </main>
  );
}
