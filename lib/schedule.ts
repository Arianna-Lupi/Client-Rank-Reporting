/**
 * Pure, DST-safe scheduling helpers (SCH-01).
 *
 * Vercel Cron runs only in UTC with no per-job timezone, so the daily report is
 * scheduled hourly and these helpers gate the actual work to the configured
 * local hour. The local hour/date are derived from `Intl.DateTimeFormat` with a
 * `timeZone`, which handles DST transitions correctly without any extra deps or
 * hand-computed offsets.
 *
 * Both functions take `now` as a parameter (never read the wall clock), so they
 * are fully deterministic and unit-tested offline.
 */

/**
 * True only when the local hour in `tz` equals `hour`. Uses Intl to extract the
 * local hour from `now`, so a fixed UTC instant maps to the correct local hour
 * on either side of a DST boundary.
 */
export function isReportHour(now: Date, tz: string, hour: number): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const hourPart = parts.find((p) => p.type === 'hour')?.value;
  if (hourPart === undefined) {
    return false;
  }

  // hour12:false can render midnight as '24' in some engines — normalize to 0.
  const localHour = hourPart === '24' ? 0 : Number(hourPart);
  return localHour === hour;
}

/** Short weekday name -> index (0=Sunday … 6=Saturday), the Intl 'short' form. */
const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * True only when the local weekday in `tz` equals `dow` (0=Sunday … 6=Saturday).
 * Uses Intl to derive the local weekday from `now`, so a fixed UTC instant maps
 * to the correct local day on either side of a midnight/DST boundary. Powers the
 * weekly cadence gate alongside isReportHour (SCH-04).
 */
export function isReportDow(now: Date, tz: string, dow: number): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
  }).formatToParts(now);

  const weekday = parts.find((p) => p.type === 'weekday')?.value;
  if (weekday === undefined) {
    return false;
  }

  const localDow = WEEKDAY_INDEX[weekday];
  if (localDow === undefined) {
    return false;
  }
  return localDow === dow;
}

/**
 * The local calendar day in `tz` as 'YYYY-MM-DD'. `en-CA` already formats dates
 * in ISO order, so `format(now)` is the key directly — used as the per-day
 * idempotency key, which can differ from the UTC day near midnight.
 */
export function reportDateKey(now: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
