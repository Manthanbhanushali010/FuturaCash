import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-12">
      <div>
        <h1 className="text-2xl font-semibold text-primary">Cash Flow Intelligence</h1>
        <p className="mt-2 text-sm text-muted">
          Spec 0 — live cash position. See <code>specs/spec-0.md</code>.
        </p>
      </div>

      <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
        <li className="px-5 py-4">
          <Link href="/xero" className="text-sm text-accent">
            Xero connection →
          </Link>
          <p className="mt-1 text-xs text-muted">
            Spec 1 — connect the Demo Company (UK), read invoices and the chart of accounts.
            Read-only scopes.
          </p>
        </li>
      </ul>
    </main>
  );
}
