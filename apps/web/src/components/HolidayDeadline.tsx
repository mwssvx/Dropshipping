import type { StoreText } from "@/lib/store-text";

/** "Order by Dec 15 to get it in time for Christmas", or a warning once that day has passed. */
export function HolidayDeadline({ id, holiday, t, day }: { id: string; holiday: { name: string; orderBy: Date | null; today: boolean }; t: StoreText; day: (d: Date) => string }) {
  return (
    <span id={id} className={holiday.orderBy ? "text-accent font-medium" : "hint"}>
      {!holiday.orderBy ? t.holidayTooLate(holiday.name) : holiday.today ? t.holidayOrderToday(holiday.name) : t.holidayOrderBy(day(holiday.orderBy), holiday.name)}
    </span>
  );
}
