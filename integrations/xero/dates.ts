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
