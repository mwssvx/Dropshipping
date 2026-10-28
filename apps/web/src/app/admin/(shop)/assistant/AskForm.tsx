"use client";
import { useActionState, useEffect, useRef } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import { askAssistantAction } from "../../ai-actions";

const SUGGESTIONS = ["How am I doing this month?", "What are shoppers searching for?", "What's trending that I could sell?", "Are any orders stuck?", "Which products make the least?"];

export function AskForm() {
  const [state, action] = useActionState(askAssistantAction, {});
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.saved) form.current?.reset();
  }, [state]);
  return (
    <div className="flex flex-col gap-3">
      <form ref={form} action={action} className="flex flex-col gap-2">
        <FormError message={state.error} />
        <label className="sr-only" htmlFor="ask">Message the assistant</label>
        <textarea id="ask" name="message" className="input" rows={2} required maxLength={4000} placeholder="Ask about orders, products, money, or say what to change…"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }} />
        <div className="flex justify-end"><SubmitButton pendingText="Thinking…">Send</SubmitButton></div>
      </form>
      <div className="flex gap-2 flex-wrap" aria-label="Suggestions">
        {SUGGESTIONS.map((s) => (
          <form key={s} action={action}>
            <input type="hidden" name="message" value={s} />
            <button className="chip text-sm">{s}</button>
          </form>
        ))}
      </div>
    </div>
  );
}
