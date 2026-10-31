"use client";
import { useActionState, useTransition } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { addTaskAction, deleteTaskAction, setTaskDoneAction } from "../../task-actions";

export function AddTaskForm() {
  const [state, action] = useActionState(addTaskAction, {});
  return (
    <form action={action} className="flex flex-col gap-3" aria-label="Add a task" key={state.saved ? Date.now() : "form"}>
      <FormError message={state.error} />
      <div className="flex flex-wrap gap-3 items-end">
        <div className="field flex-1 min-w-[16rem]">
          <label className="label" htmlFor="task-title">What needs doing</label>
          <input className="input" id="task-title" name="title" required maxLength={160} placeholder="Add a backup supplier for the lamp" />
        </div>
        <div className="field">
          <label className="label" htmlFor="task-due">By (optional)</label>
          <input className="input" id="task-due" name="due" type="date" />
        </div>
        <SubmitButton pendingText="Adding…">Add</SubmitButton>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer hint">Add a note</summary>
        <div className="field mt-2">
          <label className="label" htmlFor="task-note">Note</label>
          <textarea className="input min-h-16" id="task-note" name="note" maxLength={1000} />
        </div>
      </details>
    </form>
  );
}

export function TaskRow(props: { id: string; title: string; note: string | null; due: string | null; overdue: boolean; href: string | null; done: boolean; by: string }) {
  const [pending, start] = useTransition();
  return (
    <li className={`flex items-start gap-3 py-2 ${pending ? "opacity-50" : ""}`}>
      <input
        type="checkbox"
        className="mt-1 size-4"
        defaultChecked={props.done}
        aria-label={props.title}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.checked;
          start(() => setTaskDoneAction(props.id, next));
        }}
      />
      <span className="flex-1 min-w-0 text-sm">
        <span className={props.done ? "line-through hint" : "font-medium"}>{props.title}</span>
        {props.note && <span className="hint block whitespace-pre-line">{props.note}</span>}
        <span className="hint block text-xs">
          {props.due && <span className={props.overdue && !props.done ? "text-critical" : ""}>{props.due} · </span>}
          {props.by}
          {props.href && (
            <>
              {" · "}
              <a className="link" href={props.href}>Open ↗</a>
            </>
          )}
        </span>
      </span>
      <button type="button" className="btn btn-secondary btn-sm shrink-0" aria-label={`Delete ${props.title}`} disabled={pending} onClick={() => start(() => deleteTaskAction(props.id))}>
        Delete
      </button>
    </li>
  );
}
