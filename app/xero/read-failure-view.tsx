import { XeroApiError } from "@/integrations/xero";
import { Notice } from "./parts";

/**
 * What the screen says when a Xero read fails — as a pure function, so it can be tested.
 *
 * This exists because of a real, measured incident. On 2026-10-28 production `/xero` showed
 * "Xero read failed" with a **Re-authorise** button for a `503 upstream connect error ...
 * reset reason: overflow` — a saturated gateway on Xero's side. The grant was valid the whole
 * time (nine scopes, 30-minute token, refreshing normally), so re-consenting could not have
 * helped; the button simply made the wrong remedy the only thing on offer. Three
 * re-authorisations were completed in twenty minutes and the fault cleared on its own.
 *
 * The rule: a button that asks the user to fix their authorisation may only appear when the
 * authorisation is actually what is wrong.
 */

/** A read failure, classified by what the user can usefully do about it. */
export type ReadFailure =
  | { kind: "BUSY"; detail: string; retryAfterSeconds: number | null }
  | { kind: "AUTH"; detail: string };

export function toReadFailure(error: XeroApiError): ReadFailure {
  return error.isBusy
    ? { kind: "BUSY", detail: error.message, retryAfterSeconds: error.retryAfterSeconds }
    : { kind: "AUTH", detail: error.message };
}

/**
 * How long to wait, in words.
 *
 * Xero sends `Retry-After` on some 429s and not at all on the Envoy 503s, so the wait is
 * stated only when it was actually measured. Inventing a plausible number would be a guess
 * presented as instruction.
 */
export function waitAdvice(retryAfterSeconds: number | null): string {
  if (retryAfterSeconds === null) return "Xero is busy. Try again shortly.";
  return `Xero is busy. Try again in ${retryAfterSeconds} seconds.`;
}

export function ReadFailureNotice({ failure }: { failure: ReadFailure }) {
  if (failure.kind === "BUSY") {
    return (
      <Notice tone="error" title="Xero is busy">
        <p>{waitAdvice(failure.retryAfterSeconds)}</p>
        <p className="mt-2 text-muted">
          Nothing is wrong with this connection, so there is nothing to re-authorise. This is
          Xero refusing the request — either its own gateway or our rate limit — and it clears
          on its own.
        </p>
        <p className="mt-2 text-muted">{failure.detail}</p>
      </Notice>
    );
  }

  return (
    <Notice tone="error" title="Xero read failed">
      <p>{failure.detail}</p>
      <div className="mt-4">
        <a
          href="/api/xero/connect"
          className="inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-base"
        >
          Re-authorise
        </a>
      </div>
    </Notice>
  );
}
