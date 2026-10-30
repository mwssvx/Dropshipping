"use client";
import { startTransition, useActionState, useState } from "react";
import { FormError } from "@/components/FormError";
import { SubmitButton } from "@/components/SubmitButton";
import type { FormState } from "../../actions";
import { bulkGiftCardsAction, giftCardBonusAction, issueGiftCardAction, resendGiftCardAction, sellGiftCardsAction, setGiftCardDisabledAction, type BulkGiftCardState } from "../../gift-card-actions";

export function SellForm({ currencySymbol }: { currencySymbol: string }) {
  const [state, action] = useActionState(sellGiftCardsAction, {} as FormState);
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormError message={state.error} />
      <div className="field max-w-sm">
        <label className="label" htmlFor="amounts">Amounts ({currencySymbol})</label>
        <input className="input num" id="amounts" name="amounts" defaultValue="25, 50, 100" required />
        <span className="hint">Separate them with commas. You can change them later on the product.</span>
      </div>
      <SubmitButton className="btn btn-primary self-start">Start selling gift cards</SubmitButton>
    </form>
  );
}

type Bonus = { every: string; bonus: string; from: string; to: string; usableFrom: string; usableUntil: string };

/** The gift card bonus offer. Submitted by hand so what was typed stays when it's refused. */
export function BonusForm({ value, on, currencySymbol }: { value: Bonus | null; on: boolean; currencySymbol: string }) {
  const [state, action] = useActionState(giftCardBonusAction, {} as FormState);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        data.set("step", ((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value ?? "save");
        startTransition(() => action(data));
      }}
    >
      <FormError message={state.error} />
      {state.saved && <p className="banner banner-success" role="status">Saved.</p>}
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="field">
          <label className="label" htmlFor="bonus-amount">Bonus card ({currencySymbol})</label>
          <input className="input num" id="bonus-amount" name="bonus" inputMode="decimal" placeholder="10" defaultValue={value?.bonus} required />
        </div>
        <div className="field">
          <label className="label" htmlFor="bonus-every">For every ({currencySymbol} in gift cards)</label>
          <input className="input num" id="bonus-every" name="every" inputMode="decimal" placeholder="50" defaultValue={value?.every} required />
        </div>
        <div className="field">
          <label className="label" htmlFor="bonus-from">Bought from</label>
          <input className="input" id="bonus-from" name="from" type="date" defaultValue={value?.from} required />
        </div>
        <div className="field">
          <label className="label" htmlFor="bonus-to">Bought until</label>
          <input className="input" id="bonus-to" name="to" type="date" defaultValue={value?.to} required />
        </div>
        <div className="field">
          <label className="label" htmlFor="bonus-usable-from">Bonus usable from (optional)</label>
          <input className="input" id="bonus-usable-from" name="usableFrom" type="date" defaultValue={value?.usableFrom} />
          <span className="hint">Like January 1, so it brings buyers back after the holidays.</span>
        </div>
        <div className="field">
          <label className="label" htmlFor="bonus-usable-until">Bonus expires after (optional)</label>
          <input className="input" id="bonus-usable-until" name="usableUntil" type="date" defaultValue={value?.usableUntil} />
          <span className="hint">Bought gift cards never expire; a bonus card can, since nobody paid for it.</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-3 items-center">
        <button className="btn btn-secondary" value="save">{on ? "Save the bonus" : "Start the bonus"}</button>
        {on && (
          <button className="hint hover:text-critical text-sm" value="off" formNoValidate>
            End the bonus
          </button>
        )}
      </div>
    </form>
  );
}

export function IssueForm() {
  const [state, action] = useActionState(issueGiftCardAction, {} as FormState);
  return (
    <form key={state.saved ? Date.now() : "issue"} action={action} className="flex flex-col gap-3">
      <FormError message={state.error} />
      {state.saved && <p className="banner banner-success" role="status">Gift card sent.</p>}
      <div className="grid sm:grid-cols-[1fr_10rem] gap-3">
        <div className="field">
          <label className="label" htmlFor="gc-email">Send to</label>
          <input className="input" id="gc-email" name="email" type="email" placeholder="buyer@example.com" required />
        </div>
        <div className="field">
          <label className="label" htmlFor="gc-amount">Amount</label>
          <input className="input num" id="gc-amount" name="amount" inputMode="decimal" placeholder="20.00" required />
        </div>
      </div>
      <div className="field">
        <label className="label" htmlFor="gc-note">Note in the email (optional)</label>
        <input className="input" id="gc-note" name="note" maxLength={500} placeholder="Sorry your lamp arrived broken. This one's on us." />
      </div>
      <SubmitButton className="btn btn-secondary self-start" pendingText="Sending…">Send gift card</SubmitButton>
    </form>
  );
}

/** Pasted rows of email, amount and name: checked first, then sent. Submitted by hand so the fields stay after each step. */
export function BulkForm({ days }: { days: { min: string; max: string } }) {
  const [state, action, pending] = useActionState(bulkGiftCardsAction, {} as BulkGiftCardState);
  const [changed, setChanged] = useState(false);
  const preview = !changed && !pending ? state.preview : undefined;
  return (
    <form
      className="flex flex-col gap-3"
      onChange={() => setChanged(true)}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        data.set("step", submitter?.value ?? "check");
        setChanged(false);
        startTransition(() => action(data));
      }}
    >
      <FormError message={state.error} />
      {state.done && !changed && !pending && (
        <p className="banner banner-success" role="status">
          {state.done.sendOn
            ? `${state.done.issued} gift cards (${state.done.total} in all) will be emailed on ${state.done.sendOn}.`
            : `${state.done.sent} of ${state.done.issued} gift cards (${state.done.total} in all) were emailed.${state.done.sent < state.done.issued ? " Use \"Send a new code\" on the others to try again." : ""}`}
        </p>
      )}
      <div className="field">
        <label className="label" htmlFor="bulk-rows">People and amounts</label>
        <textarea className="input font-mono text-sm" id="bulk-rows" name="rows" rows={6} required placeholder={"sam@example.com, 50, Sam\nalex@example.com, 25, Alex"} />
        <span className="hint">One person a row: email, amount and their name (optional). Paste straight from a spreadsheet, up to 500 rows.</span>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="field">
          <label className="label" htmlFor="bulk-from">From (optional)</label>
          <input className="input" id="bulk-from" name="from" maxLength={60} placeholder="Acme Inc" />
          <span className="hint">The email then reads as a gift from them, with each person&apos;s name.</span>
        </div>
        <div className="field">
          <label className="label" htmlFor="bulk-send-on">Send on (optional)</label>
          <input className="input" id="bulk-send-on" name="sendOn" type="date" min={days.min} max={days.max} />
          <span className="hint">Leave it empty to send now. On the day, each gets a fresh code in the morning.</span>
        </div>
      </div>
      <div className="field">
        <label className="label" htmlFor="bulk-message">Message (optional)</label>
        <input className="input" id="bulk-message" name="message" maxLength={300} placeholder="Happy holidays from all of us. Thanks for a great year!" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" value="check" className="btn btn-secondary" disabled={pending} aria-busy={pending}>{pending ? "Working…" : "Check"}</button>
        {preview && (
          <>
            <span className="text-sm" role="status">
              {preview.count} {preview.count === 1 ? "gift card" : "gift cards"}, {preview.total} in all{preview.sendOn ? `, emailed on ${preview.sendOn}` : ", emailed now"}.
            </span>
            <button type="submit" value="send" className="btn btn-primary" disabled={pending}>Send {preview.count} {preview.count === 1 ? "gift card" : "gift cards"}</button>
          </>
        )}
      </div>
    </form>
  );
}

export function CardActions({ id, disabled, usedUp }: { id: string; disabled: boolean; usedUp: boolean }) {
  const [resendState, resend] = useActionState(resendGiftCardAction.bind(null, id), {} as FormState);
  const [toggleState, toggle] = useActionState(setGiftCardDisabledAction.bind(null, id, !disabled), {} as FormState);
  return (
    <div className="flex flex-col items-end gap-1">
      <FormError message={resendState.error ?? toggleState.error} />
      {resendState.saved && <p className="text-sm text-success" role="status">New code sent.</p>}
      <div className="flex flex-wrap gap-2 justify-end">
        {!disabled && !usedUp && <form action={resend}><SubmitButton className="btn btn-secondary">Send a new code</SubmitButton></form>}
        <form action={toggle}><SubmitButton className={`btn btn-secondary ${disabled ? "" : "text-critical"}`}>{disabled ? "Turn on" : "Turn off"}</SubmitButton></form>
      </div>
    </div>
  );
}
