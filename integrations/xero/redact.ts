/**
 * Redaction at the audit boundary.
 *
 * Every normalised record and every normalisation failure keeps the provider's original
 * payload in `raw`, for audit and traceability. For batch payments that payload includes the
 * member array Xero inlines on `GET /BatchPayments`, and a member can carry
 * `BankAccountNumber` — a supplier's actual bank account number.
 *
 * Retaining it buys nothing. No code path reads a bank account number back out of `raw`: the
 * only bank fields anything reads are `BankAccount.AccountID`/`Name`/`Code` on a bank
 * transaction, which `normaliseBankTransaction` lifts into named fields, and `Type === "BANK"`
 * on a ledger account. So the value is removed where the payload is CAPTURED, rather than
 * filtered wherever it might later be rendered or logged.
 *
 * That choice is the point of this module. A render-time filter has to be right in every
 * present and future consumer of `raw`; a capture-time redaction has to be right once. Before
 * this, two conventions were all that kept supplier account numbers off the page — nothing
 * rendered `raw`, and there are no client components — and neither is enforced by anything.
 */

/**
 * Marker left in place of a redacted value.
 *
 * The key is kept and its value replaced, rather than the key being deleted. Deleting it
 * would make "Xero sent no account number" and "we removed the account number" indis-
 * tinguishable in an audit payload, and the first of those is a real diagnostic signal when a
 * payment will not reconcile.
 */
export const REDACTED = "[redacted]" as const;

/**
 * Field names whose values are bank detail. Matched case-insensitively, since a payload we
 * have not surveyed may not use Xero's PascalCase.
 *
 * `BankAccountNumber` is the one observed live (nested batch members, `/Accounts`,
 * `/Payments`); `BankAccountDetails` is Xero's field on `/Contacts`. The rest are not known to
 * appear in any Xero payload and are here because the cost of carrying them is one set lookup
 * and the cost of omitting one is a supplier's bank details in an audit record.
 */
const SENSITIVE_KEYS: ReadonlySet<string> = new Set(
  [
    "BankAccountNumber",
    "BankAccountDetails",
    "AccountNumber",
    "RoutingCode",
    "SortCode",
    "IBAN",
    "SWIFT",
    "BIC",
  ].map((key) => key.toLowerCase()),
);

/** True when `key` names a value that must never be retained. Exported for tests. */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase());
}

/**
 * Deep copy of `value` with every bank-detail value replaced by {@link REDACTED}.
 *
 * Never mutates the input: the same payload object is still in flight for normalisation when
 * this is called, so redacting in place would blank fields the caller is about to read.
 */
export function redactForAudit<T>(value: T): T {
  return walk(value, new WeakMap<object, unknown>()) as T;
}

function walk(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (value === null || typeof value !== "object") return value;

  const asObject = value as object;
  // Xero payloads are JSON and acyclic, but `raw` is typed `unknown` and this must not be the
  // thing that throws while building a failure record.
  const already = seen.get(asObject);
  if (already !== undefined) return already;

  if (Array.isArray(value)) {
    const out: unknown[] = [];
    seen.set(asObject, out);
    for (const item of value) out.push(walk(item, seen));
    return out;
  }

  // Only plain objects are walked. A Date, Map or class instance is returned as-is: none
  // appears in a parsed Xero payload, and copying one field by field would corrupt it.
  const proto = Object.getPrototypeOf(asObject);
  if (proto !== Object.prototype && proto !== null) return value;

  const out: Record<string, unknown> = {};
  seen.set(asObject, out);
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (!isSensitiveKey(key)) {
      out[key] = walk(child, seen);
      continue;
    }
    // An absent value is left absent. Stamping REDACTED over a null would manufacture the
    // appearance of an account number Xero never sent.
    out[key] = child === null || child === undefined ? child : REDACTED;
  }
  return out;
}
