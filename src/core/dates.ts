/** Calendar validation, including leap years; lexical comparisons are safe only after this. */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Calendar months with end-of-month clamping (31 January + 1 month = 28/29 February). */
export function addMonths(value: string, months: number): string | undefined {
  if (!isIsoDate(value) || !Number.isSafeInteger(months) || months <= 0 || months > 120000) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const last = new Date(date.getTime());
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  date.setUTCDate(Math.min(day, last.getUTCDate()));
  if (date.getUTCFullYear() > 9999) return undefined;
  return date.toISOString().slice(0, 10);
}
