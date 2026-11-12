"use client";
import { useActionState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { accountText } from "@/lib/account-text";
import { setBirthdayAction } from "./actions";

/** Month names in the store language. */
function months(locale: string) {
  const f = new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" });
  return Array.from({ length: 12 }, (_, i) => f.format(new Date(Date.UTC(2000, i, 1))));
}

/** Month and day of the buyer's birthday ("07-14"), or nothing yet. */
export function BirthdayForm({ handle, birthday, lang }: { handle: string; birthday: string | null; lang?: string | null }) {
  const a = accountText(lang);
  const t = a.forms;
  const [state, action] = useActionState(setBirthdayAction.bind(null, handle), {});
  const [month, day] = birthday?.split("-").map(Number) ?? [];
  return (
    <form action={action} className="flex flex-col gap-3">
      {state.error && <p className="banner banner-critical" role="alert">{state.error}</p>}
      {state.saved && <p className="banner banner-info" role="status">{t.saved}</p>}
      <div className="flex flex-wrap items-end gap-3">
        <div className="field">
          <label className="label" htmlFor="bday-month">{t.month}</label>
          <select className="input" id="bday-month" name="month" defaultValue={month ?? ""} key={`m-${birthday}`}>
            <option value="">{t.month}</option>
            {months(a.locale).map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="bday-day">{t.day}</label>
          <select className="input" id="bday-day" name="day" defaultValue={day ?? ""} key={`d-${birthday}`}>
            <option value="">{t.day}</option>
            {Array.from({ length: 31 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
          </select>
        </div>
        <SubmitButton className="btn btn-primary" pendingText={t.saving}>{t.saveBirthday}</SubmitButton>
        {birthday && <button className="btn btn-secondary" name="intent" value="clear">{t.remove}</button>}
      </div>
    </form>
  );
}
