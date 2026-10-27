import { Suspense } from "react";
import type { Money } from "@/core/money";
import { outstandingByDirection } from "@/core/position";
import {
  XeroNotConnectedError,
  getConnectionState,
  connectionPrompt,
  isXeroConfigured,
  readXeroSnapshot,
  type XeroSnapshot,
} from "@/integrations/xero";
import { XeroApiError } from "@/integrations/xero/client";
import { BatchPaymentsCard, BatchPaymentsCardSkeleton } from "./batch-payments";
import { Card, Cell, Empty, Figure, Notice, Pill, Row, Table, formatDay } from "./parts";

/**
 * Spec 1 — read-only view of the connected Xero organisation.
 *
 * Proves the whole path: consent → tokens → tenant → authorised read → normalised model.
 * Nothing here writes to the ledger; that is Spec 2.
 */

export const dynamic = "force-dynamic";

/**
 * Explicit, rather than inherited from whatever the platform's default happens to be.
 *
 * The default is 10s on Hobby and 15s on Pro — below what this page already needs: the
 * snapshot alone makes four Xero calls, and the batch-payment card adds a fifth. A page that
 * is killed mid-read shows the user a platform error page, not a bounded answer, which is the
 * worst of the available outcomes. 60s is the Hobby ceiling and well inside Pro's 300s, so
 * this value is valid on either plan — deliberately, since the plan is not confirmed.
 *
 * It is a ceiling, not a budget: the batch card is behind Suspense, so the rest of the page
 * is already on screen while that read runs.
 */
export const maxDuration = 60;

/**
 * Rows rendered per table.
 *
 * Not a fetch limit — `maxPages` in integrations/xero/client.ts bounds that, and currently
 * allows 200 of each. This caps what reaches the DOM, so raising it costs no extra Xero API
 * calls. Used by both the slice and the "showing the first N" message: two literals would
 * eventually disagree and the page would quietly lie about how much it is displaying.
 */
const MAX_ROWS = 200;

export default async function XeroPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : null;

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10">
      <header>
        <p className="text-xs uppercase tracking-widest text-muted">Spec 1 — de-risk spike</p>
        <h1 className="mt-1 text-2xl font-semibold text-primary">Xero connection</h1>
      </header>

      {error ? <Notice tone="error" title="Connection failed">{error}</Notice> : null}

      <Body />
    </main>
  );
}

async function Body() {
  if (!isXeroConfigured()) {
    return (
      <Notice tone="info" title="Xero is not configured">
        <p>
          Add <code>XERO_CLIENT_ID</code>, <code>XERO_CLIENT_SECRET</code> and{" "}
          <code>XERO_REDIRECT_URI</code> to <code>.env.local</code> (see{" "}
          <code>.env.example</code>), then restart the dev server.
        </p>
      </Notice>
    );
  }

  const state = await getConnectionState();
  if (!state) {
    return (
      <Notice tone="info" title="Not connected">
        <p className="mb-4">
          Authorise the Xero Demo Company (UK) to pull its invoices and chart of accounts.
          Read-only scopes only — this app never writes to Xero.
        </p>
        <ConnectLink />
      </Notice>
    );
  }

  if (connectionPrompt(state) === "disconnected-in-xero") {
    // Xero reported zero authorised organisations on the last refresh. Rendering the chooser
    // here would show an empty list with no explanation.
    return (
      <Notice tone="info" title="No organisation is connected any more">
        <p className="mb-4">
          Xero reports no authorised organisation for this connection. That happens when the
          app is disconnected from inside Xero (Settings → Connected Apps), or when a Demo
          Company reaches its 28-day reset. Nothing is wrong with your data here — the
          authorisation on Xero&apos;s side has ended.
        </p>
        <ConnectLink label="Re-authorise" />
      </Notice>
    );
  }

  if (!state.activeTenantId) {
    return (
      <Card title="Choose an organisation" subtitle="Consent covered more than one org.">
        <ul className="divide-y divide-border">
          {state.connections.map((connection) => (
            <li key={connection.tenantId} className="flex items-center justify-between px-5 py-4">
              <div>
                <p className="text-sm text-primary">{connection.tenantName}</p>
                <p className="text-xs text-muted">{connection.tenantType}</p>
              </div>
              <form action="/api/xero/select-tenant" method="post">
                <input type="hidden" name="tenantId" value={connection.tenantId} />
                <button
                  type="submit"
                  className="rounded-md border border-accent px-3 py-1.5 text-sm text-accent"
                >
                  Use this org
                </button>
              </form>
            </li>
          ))}
        </ul>
      </Card>
    );
  }

  let snapshot: XeroSnapshot;
  try {
    snapshot = await readXeroSnapshot();
  } catch (caught) {
    if (caught instanceof XeroNotConnectedError) {
      return (
        <Notice tone="info" title="Not connected">
          <ConnectLink />
        </Notice>
      );
    }
    if (caught instanceof XeroApiError) {
      // Includes 429: surface it plainly rather than retrying into the rate limit.
      return (
        <Notice tone="error" title="Xero read failed">
          <p>{caught.message}</p>
          <div className="mt-4">
            <ConnectLink label="Re-authorise" />
          </div>
        </Notice>
      );
    }
    throw caught;
  }

  return <Snapshot snapshot={snapshot} />;
}

function ConnectLink({ label = "Connect to Xero" }: { label?: string }) {
  return (
    <a
      href="/api/xero/connect"
      className="inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-base"
    >
      {label}
    </a>
  );
}

function Snapshot({ snapshot }: { snapshot: XeroSnapshot }) {
  const { organisation, accounts, commitments, bankTransactions } = snapshot;
  const outstanding = outstandingByDirection(commitments.items);
  const failures = [...accounts.failures, ...commitments.failures, ...bankTransactions.failures];
  // ANY missing scope prompts, not just the bank one.
  //
  // The guard used to check `accounting.banktransactions.read` alone. When
  // `accounting.payments.read` was added on 22 Oct, `missingScopes` correctly reported it and
  // the screen said nothing at all — so the operator had no way to know a re-authorisation was
  // needed, and had to be told out of band. A guard that only notices the scope it was written
  // for is a guard that silently stops working the next time one is added.
  const needsReconsent = snapshot.missingScopes.length > 0;
  const needsBankScope = snapshot.missingScopes.includes("accounting.banktransactions.read");

  return (
    <>
      <Card
        title={snapshot.tenantName}
        subtitle={
          organisation
            ? `${organisation.countryCode ?? "—"} · base ${organisation.baseCurrency} · ${
                organisation.status ?? "status unknown"
              }`
            : "Organisation details unavailable"
        }
        action={
          <form action="/api/xero/disconnect" method="post">
            <button type="submit" className="text-xs text-muted underline underline-offset-4">
              Disconnect
            </button>
          </form>
        }
      >
        <dl className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
          <Stat label="Invoices read" value={String(commitments.items.length)} />
          <Stat
            label="Bank transactions"
            value={needsBankScope ? "—" : String(bankTransactions.items.length)}
          />
          <Stat label="Accounts read" value={String(accounts.items.length)} />
          <Stat
            label="Receivable outstanding"
            value={<MoneyList amounts={outstanding.INFLOW} />}
          />
          <Stat label="Payable outstanding" value={<MoneyList amounts={outstanding.OUTFLOW} />} />
        </dl>
        <p className="px-5 py-3 text-xs text-muted">
          Chart of accounts {snapshot.accountsFromCache ? "served from cache" : "fetched live"} ·
          outstanding totals sum <code>AmountDue</code> on AUTHORISED and SUBMITTED documents
          only, grouped by currency — never across currencies.
        </p>
        {snapshot.invoicesTruncated ? (
          <div className="px-5 pb-4">
            <Notice tone="error" title="These totals are a floor, not the full figure">
              <p>
                Xero holds more outstanding invoices than this read returned, so the amounts
                above are the total of what was fetched — the real position is higher. Treat
                them as a lower bound until the read covers everything.
              </p>
            </Notice>
          </div>
        ) : null}
      </Card>

      {failures.length > 0 ? (
        <Notice tone="error" title={`${failures.length} record(s) could not be normalised`}>
          <ul className="list-disc space-y-1 pl-5">
            {failures.slice(0, 10).map((failure, index) => (
              <li key={`${failure.externalId ?? "unknown"}-${index}`}>
                <span className="figure">{failure.externalId ?? "(no id)"}</span> — {failure.reason}
              </li>
            ))}
          </ul>
          <p className="mt-2">
            These are excluded from the totals above. They are reported rather than dropped so
            the position never hides a gap.
          </p>
        </Notice>
      ) : null}

      <Card
        title="Outstanding invoices and bills"
        subtitle="ACCREC = money in · ACCPAY = money out. Paid invoices are excluded — this is what is still owed, not a history."
      >
        {commitments.items.length === 0 ? (
          <Empty>No invoices returned for the selected statuses.</Empty>
        ) : (
          <Table head={["Document", "Counterparty", "Direction", "Status", "Due", "Total", "Outstanding"]}>
            {commitments.items.slice(0, MAX_ROWS).map((commitment) => (
              <Row key={commitment.externalId}>
                <Cell>
                  <span className="figure">{commitment.documentNumber ?? "—"}</span>
                </Cell>
                <Cell>{commitment.counterpartyName ?? "—"}</Cell>
                <Cell muted>{commitment.direction === "INFLOW" ? "In" : "Out"}</Cell>
                <Cell>
                  <Pill
                    label={commitment.providerStatus}
                    tone={commitment.status === "UNKNOWN" ? "warn" : "neutral"}
                  />
                </Cell>
                <Cell muted>
                  <span className="figure">{formatDay(commitment.dueAt)}</span>
                </Cell>
                <Cell align="right">
                  <Figure value={commitment.total} muted />
                </Cell>
                <Cell align="right">
                  <Figure value={commitment.amountDue} />
                </Cell>
              </Row>
            ))}
          </Table>
        )}
        {commitments.items.length > MAX_ROWS ? (
          <p className="px-5 py-3 text-xs text-muted">
            Showing the first {MAX_ROWS} of {commitments.items.length}.
          </p>
        ) : null}
      </Card>

      {needsReconsent ? (
        <Notice tone="info" title="Re-authorise to include everything we can now read">
          <p>
            This connection was authorised before some of the permissions we now request. Xero
            never adds a scope to an existing consent, so the data behind these stays
            unavailable until you re-authorise:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {snapshot.missingScopes.map((scope) => (
              <li key={scope}>
                <code>{scope}</code>
                {scope === "accounting.payments.read" ? (
                  <> — payments, batch payments, prepayments and overpayments</>
                ) : null}
                {scope === "accounting.banktransactions.read" ? (
                  <> — bank transactions</>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="mt-4">
            <ConnectLink label="Re-authorise" />
          </div>
        </Notice>
      ) : null}

      {needsBankScope ? null : (
        <Card
          title="Bank transactions"
          subtitle="Xero's ledger record of money through the bank — not a live bank feed. RECEIVE = in · SPEND = out."
        >
          {bankTransactions.items.length === 0 ? (
            <Empty>No bank transactions returned for the selected statuses.</Empty>
          ) : (
            <Table head={["Date", "Description", "Counterparty", "Direction", "Account", "Tax", "Total"]}>
              {bankTransactions.items.slice(0, MAX_ROWS).map((entry) => (
                <Row key={entry.externalId}>
                  <Cell muted>
                    <span className="figure">{formatDay(entry.bookedAt)}</span>
                  </Cell>
                  <Cell>
                    {/* Reference first when present, description otherwise: Xero populates
                        them independently and description is the more reliable of the two. */}
                    {entry.reference ?? entry.description ?? "—"}
                    {entry.isReconciled ? (
                      <span className="ml-2">
                        <Pill label="reconciled" />
                      </span>
                    ) : null}
                  </Cell>
                  <Cell>{entry.counterpartyName ?? "—"}</Cell>
                  <Cell muted>{entry.direction === "INFLOW" ? "In" : "Out"}</Cell>
                  <Cell muted>{entry.bankAccountName ?? "—"}</Cell>
                  <Cell align="right">
                    <Figure value={entry.totalTax} muted />
                  </Cell>
                  <Cell align="right">
                    <Figure value={entry.total} />
                  </Cell>
                </Row>
              ))}
            </Table>
          )}
          {snapshot.bankTransactionsTruncated ? (
            <div className="px-5 pt-4">
              <Notice tone="error" title="This is a recent slice, not the full history">
                <p>
                  Xero holds more bank transactions than this read returned, so what is listed
                  below is the most recent portion rather than everything. Nothing here is
                  summed into a total, so no figure is wrong — but do not read the absence of an
                  older transaction as evidence it does not exist.
                </p>
              </Notice>
            </div>
          ) : null}
          {bankTransactions.items.length > MAX_ROWS ? (
            <p className="px-5 py-3 text-xs text-muted">
              Showing the first {MAX_ROWS} of {bankTransactions.items.length}.
            </p>
          ) : null}
        </Card>
      )}

      {/* Behind Suspense so the snapshot above is not held back by a fifth Xero call. The
          card reads /BatchPayments itself and renders its own failure states — it must never
          be able to blank or slow the cards that were already working. */}
      <Suspense fallback={<BatchPaymentsCardSkeleton />}>
        <BatchPaymentsCard
          tenantId={snapshot.tenantId}
          baseCurrency={organisation?.baseCurrency ?? null}
          scopeMissing={snapshot.missingScopes.includes("accounting.payments.read")}
        />
      </Suspense>

      <Card title="Chart of accounts" subtitle="Cached for 15 minutes — Xero allows 5,000 calls/day per org.">
        {accounts.items.length === 0 ? (
          <Empty>No accounts returned.</Empty>
        ) : (
          <Table head={["Code", "Name", "Type", "Class", "Tax", "Status"]}>
            {accounts.items.map((account) => (
              <Row key={account.externalId}>
                <Cell>
                  <span className="figure">{account.code ?? "—"}</span>
                </Cell>
                <Cell>
                  {account.name}
                  {account.isBankAccount ? <span className="ml-2"><Pill label="bank" /></span> : null}
                </Cell>
                <Cell muted>{account.type}</Cell>
                <Cell muted>{account.classification ?? "—"}</Cell>
                <Cell muted>{account.taxType ?? "—"}</Cell>
                <Cell muted>{account.status ?? "—"}</Cell>
              </Row>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-surface px-5 py-4">
      <dt className="text-xs uppercase tracking-wider text-muted">{label}</dt>
      <dd className="mt-1 text-sm text-primary">{value}</dd>
    </div>
  );
}

function MoneyList({ amounts }: { amounts: readonly Money[] }) {
  if (amounts.length === 0) return <span className="figure text-muted">—</span>;
  return (
    <span className="flex flex-col gap-0.5">
      {amounts.map((amount) => (
        <Figure key={amount.currency} value={amount} />
      ))}
    </span>
  );
}

