/**
 * Strict GUID validation for values that reach a Xero `where` clause or a URL path.
 *
 * This is a security boundary, not a convenience check. `/xero/batches/<id>` takes its id from
 * the URL, and that id is interpolated into
 * `where=BatchPaymentID==guid("<id>")`. A `"` in the id would close the literal early and the
 * remainder would be parsed by Xero as filter syntax — so the id is validated against an
 * exact shape BEFORE it is used, rather than escaped after.
 *
 * Validating is the right tool here because the set of legal values is tiny and exactly
 * describable: 32 hex digits in 8-4-4-4-12 groups. Escaping is for when the input space is
 * open; this one is closed, so anything that is not precisely a GUID is refused outright.
 */

/**
 * 8-4-4-4-12 hex, anchored at both ends, case-insensitive.
 *
 * Anchors matter more than the character class: without `^` and `$`, a value like
 * `aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa") or true--` would match on its prefix and be
 * accepted.
 */
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Xero's "no value" GUID. Shape-valid but it names nothing.
 *
 * Rejected explicitly: it can never identify a batch, and accepting it would spend a Xero
 * call to ask a question with no possible answer. Live batch ids were checked against this —
 * 85 of 85 populated `BatchPaymentID`s were real GUIDs, none the null GUID — so refusing it
 * costs nothing real.
 */
const NULL_GUID = "00000000-0000-0000-0000-000000000000";

/** True only for a value that is exactly a usable GUID. */
export function isXeroGuid(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!GUID.test(value)) return false;
  return value.toLowerCase() !== NULL_GUID;
}

/**
 * The GUID, or `null` when `value` is not one.
 *
 * Returns rather than throws: the caller is a page rendering a URL segment, and a bad id is a
 * 404-shaped answer to the user, not an exception to surface as a Xero failure.
 */
export function parseXeroGuid(value: unknown): string | null {
  return isXeroGuid(value) ? value : null;
}
