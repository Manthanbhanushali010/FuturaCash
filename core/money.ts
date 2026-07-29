// Money is ALWAYS integer minor units (e.g. pennies) + an explicit currency code.
// Never floating-point. See context/architecture.md invariant #4 and CLAUDE.md rule #4.

/**
 * Currencies we are willing to hold. Deliberately a closed set: an amount in a currency
 * we do not model is a refusal, not a guess. Extend this list consciously — each entry
 * needs its minor-unit exponent below.
 */
export const SUPPORTED_CURRENCIES = [
  "GBP",
  "EUR",
  "USD",
  "AUD",
  "NZD",
  "CAD",
  "CHF",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "ZAR",
  "SGD",
  "HKD",
  "INR",
  "AED",
  "JPY",
] as const;

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];

/**
 * ISO 4217 minor-unit exponent: how many decimal places the currency has.
 * Not every currency is 2 — JPY has none, so 1 minor unit IS 1 yen. Code that assumes
 * "divide by 100" is wrong for those, which is why nothing below hardcodes 100.
 */
const MINOR_UNIT_DIGITS: Record<CurrencyCode, number> = {
  GBP: 2,
  EUR: 2,
  USD: 2,
  AUD: 2,
  NZD: 2,
  CAD: 2,
  CHF: 2,
  SEK: 2,
  NOK: 2,
  DKK: 2,
  PLN: 2,
  ZAR: 2,
  SGD: 2,
  HKD: 2,
  INR: 2,
  AED: 2,
  JPY: 0,
};

export interface Money {
  /** Integer amount in minor units (pennies for GBP). Negative = outflow. Never a float. */
  readonly minor: number;
  readonly currency: CurrencyCode;
}

export function isCurrencyCode(value: string): value is CurrencyCode {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

/** Narrow an untrusted currency string, or throw. Use at every provider boundary. */
export function parseCurrency(value: string): CurrencyCode {
  const upper = value.trim().toUpperCase();
  if (!isCurrencyCode(upper)) {
    throw new Error(
      `Unsupported currency "${value}". Add it to SUPPORTED_CURRENCIES and MINOR_UNIT_DIGITS in core/money.ts before handling amounts in it.`,
    );
  }
  return upper;
}

/** Decimal places for a currency — the scale its minor units are expressed in. */
export function minorUnitDigits(currency: CurrencyCode): number {
  return MINOR_UNIT_DIGITS[currency];
}

export function money(minor: number, currency: CurrencyCode): Money {
  if (!Number.isInteger(minor)) {
    throw new Error(`Money.minor must be an integer (minor units), got ${minor}`);
  }
  if (!Number.isSafeInteger(minor)) {
    throw new Error(`Money.minor exceeds safe integer range: ${minor}`);
  }
  return { minor, currency };
}

export function add(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new Error(`Cannot add ${a.currency} to ${b.currency} without explicit conversion`);
  }
  return money(a.minor + b.minor, a.currency);
}

export function negate(m: Money): Money {
  return money(-m.minor, m.currency);
}

export function sum(items: Money[], currency: CurrencyCode): Money {
  return items.reduce((acc, m) => add(acc, m), money(0, currency));
}

export function isZero(m: Money): boolean {
  return m.minor === 0;
}

/** e.g. "-1,234.56 GBP". Integer arithmetic only — no division into floats. */
export function format(m: Money): string {
  const digits = minorUnitDigits(m.currency);
  const scale = 10 ** digits;
  const sign = m.minor < 0 ? "-" : "";
  const abs = Math.abs(m.minor);
  const major = Math.floor(abs / scale).toLocaleString("en-GB");
  if (digits === 0) return `${sign}${major} ${m.currency}`;
  const fraction = String(abs % scale).padStart(digits, "0");
  return `${sign}${major}.${fraction} ${m.currency}`;
}
