/**
 * Xero date parsing.
 *
 * The Accounting API's JSON serialises dates in the legacy .NET form
 * `/Date(1552262400000+0000)/`, usually alongside a plain twin field (`DateString`,
 * `DueDateString`) like `2019-03-11T00:00:00`. Both are handled; anything else is
 * rejected rather than coerced, because a silently-wrong due date moves cash into the
 * wrong forecast week.
 */

const DOTNET_DATE = /^\/Date\((-?\d+)([+-]\d{4})?\)\/$/;
const PLAIN_DATE_TIME = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;

/**
 * Parse a Xero date into an ISO 8601 UTC string.
 *
 * @param value       The `/Date(...)/ ` field.
 * @param plainValue  The sibling `*String` field, preferred when present.
 */
export function parseXeroDate(
  value: string | undefined,
  plainValue?: string | undefined,
): string | null {
  const plain = plainValue?.trim();
  if (plain) {
    if (!PLAIN_DATE_TIME.test(plain)) {
      throw new Error(`Unrecognised Xero date string: ${JSON.stringify(plainValue)}`);
    }
    // Xero's *String fields are the org's local date with no zone marker. Treat a bare
    // datetime as UTC — Xero emits these at midnight, so the calendar day is what matters.
    const normalised = /(?:Z|[+-]\d{2}:?\d{2})$/.test(plain) ? plain : `${plain.replace(" ", "T")}Z`;
    const parsed = new Date(normalised);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`Unparseable Xero date string: ${JSON.stringify(plainValue)}`);
    }
    return parsed.toISOString();
  }

  const raw = value?.trim();
  if (!raw) return null;

  const match = DOTNET_DATE.exec(raw);
  if (match) {
    // The trailing offset is Xero's rendering hint; the epoch milliseconds are already UTC.
    const epochMs = Number(match[1]);
    if (!Number.isFinite(epochMs)) {
      throw new Error(`Unparseable Xero date: ${JSON.stringify(value)}`);
    }
    return new Date(epochMs).toISOString();
  }

  if (PLAIN_DATE_TIME.test(raw)) {
    return parseXeroDate(undefined, raw);
  }

  throw new Error(`Unrecognised Xero date format: ${JSON.stringify(value)}`);
}

/** Calendar day (YYYY-MM-DD) — what the 13-week forecast grid actually buckets on. */
export function toCalendarDay(isoString: string): string {
  return isoString.slice(0, 10);
}

/**
 * A date as Xero's `where` clause wants it: `DateTime(2026,7,26)`.
 *
 * UTC components deliberately. Using the local getters would shift the boundary by a day for
 * anyone west of UTC, which on a 90-day window is a silent off-by-one at both ends — the kind
 * of error that makes two reads of "the same" window disagree by a day's trading.
 *
 * No leading zeros: `DateTime(2026,7,26)` is what Xero accepts, verified live 2026-10-24.
 */
export function toXeroDateTime(value: Date): string {
  return `DateTime(${value.getUTCFullYear()},${value.getUTCMonth() + 1},${value.getUTCDate()})`;
}

/**
 * Today's calendar date in a given IANA timezone, as `YYYY-MM-DD`.
 *
 * This exists because "is this record dated in the future?" has no answer in UTC. JENKI runs
 * on Europe/London, which is UTC+1 for seven months of the year, so between midnight and
 * 01:00 BST the UK calendar day and the UTC calendar day differ. Asked in UTC at 00:30 BST on
 * 15 July, "today" is still 14 July — and every record Xero stamped with 15 July, which is
 * genuinely today's trading, would be classified as scheduled for the future.
 *
 * `Intl` rather than arithmetic on purpose: the offset is a function of the date (BST starts
 * and ends on Sundays that move each year), so a fixed +1 would be wrong for five months and
 * a DST table would be a second source of truth to maintain. `en-CA` is not relied on for
 * the format — the parts are read by name, so a locale default cannot silently reorder it.
 *
 * @param timeZone An IANA zone, e.g. "Europe/London". Invalid zones throw rather than
 *                 falling back to UTC, because a silent fallback is the defect above.
 */
export function calendarDateIn(timeZone: string, now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const get = (type: "year" | "month" | "day"): string => {
    const found = parts.find((part) => part.type === type)?.value;
    if (!found) throw new Error(`Could not read the ${type} for timezone ${timeZone}`);
    return found;
  };

  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** `YYYY-MM-DD`. Narrow enough that a timestamp cannot be passed where a date belongs. */
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Assert a value is a bare calendar date.
 *
 * The reconciliation compares record dates as strings, so a full timestamp slipped in here
 * would compare as GREATER than every `YYYY-MM-DD` and silently mark the entire window as
 * dated in the future. This is the same class of defect as the period bounds that arrived as
 * 16:57 timestamps and moved £62k into the wrong slice — caught then only because an
 * `unattributed` bucket existed to notice it.
 */
export function assertCalendarDate(value: string, label: string): string {
  if (!CALENDAR_DATE.test(value)) {
    throw new Error(`${label} must be a calendar date (YYYY-MM-DD), got ${JSON.stringify(value)}`);
  }
  return value;
}
