// Money is ALWAYS integer minor units (e.g. pennies) + an explicit currency code.
// Never floating-point. See context/architecture.md invariant #4 and CLAUDE.md rule #4.

export type CurrencyCode = "GBP" | "EUR" | "USD";

export interface Money {
  /** Integer amount in minor units (pennies for GBP). Negative = outflow. Never a float. */
  readonly minor: number;
  readonly currency: CurrencyCode;
}

export function money(minor: number, currency: CurrencyCode): Money {
  if (!Number.isInteger(minor)) {
    throw new Error(`Money.minor must be an integer (minor units), got ${minor}`);
  }
  return { minor, currency };
}

export function add(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new Error(`Cannot add ${a.currency} to ${b.currency} without explicit conversion`);
  }
  return { minor: a.minor + b.minor, currency: a.currency };
}

export function sum(items: Money[], currency: CurrencyCode): Money {
  return items.reduce((acc, m) => add(acc, m), money(0, currency));
}

export function format(m: Money): string {
  const sign = m.minor < 0 ? "-" : "";
  const abs = Math.abs(m.minor);
  const major = Math.floor(abs / 100).toLocaleString();
  const minor = String(abs % 100).padStart(2, "0");
  return `${sign}${major}.${minor} ${m.currency}`;
}
