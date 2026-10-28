// The shopping dates coming up (Black Friday, Boxing Day, Valentine's Day...), for planning sales.
// Dates are days on the calendar, not times: the Sales page turns them into the merchant's own
// midnight, the way the sale form reads times. Only the dates buyers in the store's country keep.

export type SaleDate = {
  id: string;
  name: string;
  /** What the sale would be called. */
  saleTitle: string;
  /** First day of the sale and the day after its last, as YYYY-MM-DD. */
  start: string;
  end: string;
  /** The day itself, for "Valentine's Day is Saturday, February 14". */
  day: string;
};

const BOXING_DAY = ["GB", "IE", "CA", "AU", "NZ"];
const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const iso = (d: Date) => d.toISOString().slice(0, 10);
const plus = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
/** The nth weekday (0 Sunday) of a month. */
const nth = (y: number, m: number, weekday: number, n: number) => {
  const first = day(y, m, 1);
  return day(y, m, 1 + ((weekday - first.getUTCDay() + 7) % 7) + (n - 1) * 7);
};
/** Easter Sunday (the Western date). */
function easter(y: number) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  return day(y, month, ((h + l - 7 * m + 114) % 31) + 1);
}

/** The year's dates for a country: each with the sale's first day and how many days it runs. */
function datesIn(y: number, country: string) {
  const out: { id: string; name: string; saleTitle: string; date: Date; from: number; days: number }[] = [];
  const add = (id: string, name: string, saleTitle: string, date: Date, from: number, days: number) => out.push({ id, name, saleTitle, date, from, days });
  add("valentines", "Valentine's Day", "Valentine's sale", day(y, 2, 14), -7, 8);
  if (country === "GB" || country === "IE") add("mothers-day", "Mother's Day", "Mother's Day sale", plus(easter(y), -21), -7, 7);
  else if (["US", "CA", "AU", "NZ", "DE", "IT", "JP"].includes(country)) add("mothers-day", "Mother's Day", "Mother's Day sale", nth(y, 5, 0, 2), -7, 7);
  if (country === "AU" || country === "NZ") add("fathers-day", "Father's Day", "Father's Day sale", nth(y, 9, 0, 1), -7, 7);
  else if (["US", "GB", "IE", "CA", "FR", "NL", "JP"].includes(country)) add("fathers-day", "Father's Day", "Father's Day sale", nth(y, 6, 0, 3), -7, 7);
  add("halloween", "Halloween", "Halloween sale", day(y, 10, 31), -6, 7);
  add("singles-day", "Singles' Day", "11.11 sale", day(y, 11, 11), 0, 1);
  // The day after the fourth Thursday of November, through Cyber Monday.
  add("black-friday", "Black Friday", "Black Friday sale", plus(nth(y, 11, 4, 4), 1), 0, 4);
  if (BOXING_DAY.includes(country)) add("boxing-day", "Boxing Day", "Boxing Day sale", day(y, 12, 26), 0, 7);
  else add("after-christmas", "After Christmas", "After-Christmas sale", day(y, 12, 26), 0, 6);
  return out;
}

/** The next dates to plan for, soonest first: those whose sale hasn't ended, up to `limit`, within about four months. */
export function upcomingSaleDates(country: string, today: string, limit = 4): SaleDate[] {
  const y = Number(today.slice(0, 4));
  const horizon = iso(plus(day(y, Number(today.slice(5, 7)), Number(today.slice(8, 10))), 125));
  return [...datesIn(y, country), ...datesIn(y + 1, country)]
    .map((d) => ({ id: d.id, name: d.name, saleTitle: d.saleTitle, day: iso(d.date), start: iso(plus(d.date, d.from)), end: iso(plus(d.date, d.from + d.days)) }))
    .filter((d) => d.end > today && d.start <= horizon)
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, limit);
}
