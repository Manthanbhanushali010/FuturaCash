import { isGateConfigured, safeReturnPath } from "@/lib/page-gate";

/**
 * The interim access gate. Styled with the app tokens from context/ui-context.md — a viewer
 * arrives here from the marketing page, so a browser credential dialog would be jarring.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Futura — access" };

export default async function UnlockPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = safeReturnPath(typeof params.next === "string" ? params.next : null);
  const failed = params.error === "1";
  const configured = isGateConfigured();

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-12">
      <div>
        <p className="text-xs uppercase tracking-widest text-muted">Futura</p>
        <h1 className="mt-1 text-2xl font-semibold text-primary">Restricted area</h1>
        <p className="mt-2 text-sm text-muted">
          This screen connects to live accounting data. Enter the access password to continue.
        </p>
      </div>

      {!configured ? (
        <div className="rounded-xl border border-error/40 px-5 py-4">
          <p className="text-sm font-medium text-error">Access gate is not configured</p>
          <p className="mt-2 text-sm text-muted">
            <code>XERO_PAGE_PASSWORD</code> is not set in this environment. The gate fails
            closed, so nothing behind it is reachable until the variable is added.
          </p>
        </div>
      ) : (
        <form
          action="/api/unlock"
          method="post"
          className="flex flex-col gap-3 rounded-xl border border-border bg-surface px-5 py-5"
        >
          <input type="hidden" name="next" value={next} />
          <label htmlFor="password" className="text-xs uppercase tracking-wider text-muted">
            Access password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            autoFocus
            required
            className="rounded-md border border-border bg-base px-3 py-2 text-sm text-primary outline-none focus:border-accent"
          />
          {failed ? (
            <p className="text-sm text-error">Incorrect password.</p>
          ) : null}
          <button
            type="submit"
            className="mt-1 rounded-md bg-accent px-4 py-2 text-sm font-medium text-base"
          >
            Continue
          </button>
        </form>
      )}

      <p className="text-xs text-muted">
        Temporary measure while proper sign-in is built. It protects the connection to a real
        accounting system — treat the password accordingly.
      </p>
    </main>
  );
}
