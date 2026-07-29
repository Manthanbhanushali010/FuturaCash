/**
 * Exact decimal → integer minor units.
 *
 * WHY THIS EXISTS (invariant #4). Xero, Plaid and every other provider serialise money as
 * JSON numbers: `"Total": 1234.55`. By the time `JSON.parse` hands it to us the decimal
 * text is gone and we hold an IEEE-754 double that is merely the *nearest* double to that
 * decimal. Both obvious conversions are wrong, and — the nasty part — they are wrong on
 * DIFFERENT values, so neither can be used to check the other:
 *
 *   Math.round(1.005 * 100)  === 100     // WRONG, want 101 (1.005*100 is 100.49999999999999)
 *   Math.round(0.145 * 100)  === 14      // WRONG, want 15
 *   (1.045).toFixed(2)       === "1.04"  // WRONG, want 1.05 — yet Math.round gets this one right
 *   (2.675).toFixed(2)       === "2.67"  // WRONG, want 2.68 — likewise
 *
 * Multiplying by 100 amplifies the representation error across the rounding boundary, and
 * toFixed rounds the stored double rather than the decimal it came from. A penny lost per
 * invoice is a reconciliation that never closes.
 *
 * The fix: never do arithmetic on the double. ECMA-262 Number::toString produces the
 * SHORTEST decimal string that round-trips to the same double — which, for any decimal a
 * provider actually sent, is that original decimal exactly. So `String(1.005)` is
 * `"1.005"`, and we parse those digits as text and shift the point with BigInt.
 *
 * Prefer feeding this the raw string when a provider gives you one; the number path is
 * for JSON payloads where the string is already lost.
 */

export type Rounding =
  /** Refuse to lose precision. The default — a total with unexpected precision is a bug, not a rounding. */
  | "forbid"
  /** Round half away from zero: 2.345 → 2.35, -2.345 → -2.35. Use only where documented. */
  | "half-up";

const DECIMAL_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

/**
 * Convert a decimal value to an integer number of minor units at the given scale.
 *
 * @param value  Decimal as a string (preferred, exact) or a JSON-parsed number.
 * @param digits Minor-unit exponent — 2 for GBP/USD/EUR, 0 for JPY. See core/money.ts.
 * @param rounding What to do when `value` has more precision than `digits` allows.
 */
export function decimalToMinorUnits(
  value: string | number,
  digits: number,
  rounding: Rounding = "forbid",
): number {
  if (!Number.isInteger(digits) || digits < 0 || digits > 8) {
    throw new Error(`Minor-unit digits must be an integer in 0..8, got ${digits}`);
  }

  const text = toDecimalString(value);
  const negative = text.startsWith("-");
  const unsigned = text.replace(/^[+-]/, "");
  const pointIndex = unsigned.indexOf(".");
  const integerPart = pointIndex === -1 ? unsigned : unsigned.slice(0, pointIndex);
  const fractionPart = pointIndex === -1 ? "" : unsigned.slice(pointIndex + 1);

  let magnitude: bigint;
  if (fractionPart.length <= digits) {
    // Pad to scale: "12.5" at 2 digits → "12" + "50" → 1250n
    magnitude = BigInt((integerPart || "0") + fractionPart.padEnd(digits, "0"));
  } else {
    const kept = fractionPart.slice(0, digits);
    const dropped = fractionPart.slice(digits);
    if (rounding === "forbid") {
      throw new Error(
        `Value ${text} has more precision than ${digits} minor-unit digit(s) and would lose "${dropped}". ` +
          `Pass rounding: "half-up" at this boundary only if dropping it is intended.`,
      );
    }
    magnitude = BigInt((integerPart || "0") + kept);
    // Half away from zero. Checking only the first dropped digit is sufficient and exact:
    // >=5 means the remainder is at least half, <5 means it is strictly below half.
    if (dropped.charCodeAt(0) >= 53 /* "5" */) {
      magnitude += 1n;
    }
  }

  const signed = negative ? -magnitude : magnitude;
  if (signed > BigInt(Number.MAX_SAFE_INTEGER) || signed < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error(`Value ${text} exceeds the safe integer range in minor units`);
  }
  return Number(signed);
}

/** Inverse, for display and debugging. Integer/string arithmetic only — never a float. */
export function minorUnitsToDecimalString(minor: number, digits: number): string {
  if (!Number.isSafeInteger(minor)) {
    throw new Error(`Expected a safe integer in minor units, got ${minor}`);
  }
  if (digits === 0) return String(minor);
  const negative = minor < 0;
  const text = String(Math.abs(minor)).padStart(digits + 1, "0");
  const cut = text.length - digits;
  return `${negative ? "-" : ""}${text.slice(0, cut)}.${text.slice(cut)}`;
}

/** Canonical decimal text for a value, or throw if it is not one we can convert exactly. */
function toDecimalString(value: string | number): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!DECIMAL_PATTERN.test(trimmed)) {
      throw new Error(`Not a plain decimal string: ${JSON.stringify(value)}`);
    }
    return trimmed;
  }

  if (!Number.isFinite(value)) {
    throw new Error(`Cannot convert non-finite number to minor units: ${value}`);
  }
  const text = String(value);
  if (!DECIMAL_PATTERN.test(text)) {
    // Exponent form (1e-7, 1e21). Real money never arrives this way; if it does, the value
    // is outside what we model and guessing at it would be worse than stopping.
    throw new Error(
      `Number ${text} is outside the plain-decimal range this converter handles. ` +
        `Pass the provider's raw decimal string instead.`,
    );
  }
  return text;
}
