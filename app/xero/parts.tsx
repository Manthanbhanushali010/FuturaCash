import type { ReactNode } from "react";
import { format, type Money } from "@/core/money";

/**
 * Presentation primitives for the Xero screen: long-thin, table-first cards per
 * context/ui-context.md. Server components — no interactivity beyond plain forms.
 */

export function Card({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface">
      <header className="flex items-baseline justify-between gap-4 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold tracking-wide text-primary">{title}</h2>
          {subtitle ? <p className="mt-1 text-xs text-muted">{subtitle}</p> : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

/** A monetary figure. Mono + tabular so columns align; negative always reads red. */
export function Figure({ value, muted = false }: { value: Money; muted?: boolean }) {
  const negative = value.minor < 0;
  return (
    <span
      className={`figure ${negative ? "text-error" : muted ? "text-muted" : "text-primary"}`}
    >
      {format(value)}
    </span>
  );
}

export function Table({ head, children }: { head: readonly string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            {head.map((label, index) => (
              <th
                key={label}
                className={`px-5 py-3 text-xs font-medium uppercase tracking-wider text-muted ${
                  index >= head.length - 2 ? "text-right" : ""
                }`}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <tr className="border-b border-border/50 last:border-0">{children}</tr>;
}

export function Cell({
  children,
  align = "left",
  muted = false,
}: {
  children: ReactNode;
  align?: "left" | "right";
  muted?: boolean;
}) {
  return (
    <td
      className={`px-5 py-3 ${align === "right" ? "text-right" : ""} ${
        muted ? "text-muted" : "text-primary"
      }`}
    >
      {children}
    </td>
  );
}

export function Pill({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "warn" }) {
  return (
    <span
      className={`rounded-md border px-2 py-0.5 text-xs ${
        tone === "warn"
          ? "border-error/40 text-error"
          : "border-border bg-surface-2 text-muted"
      }`}
    >
      {label}
    </span>
  );
}

export function Notice({
  tone,
  title,
  children,
}: {
  tone: "error" | "info";
  title: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={`rounded-xl border px-5 py-4 ${
        tone === "error" ? "border-error/40 bg-error/5" : "border-border bg-surface"
      }`}
    >
      <p className={`text-sm font-medium ${tone === "error" ? "text-error" : "text-primary"}`}>
        {title}
      </p>
      {children ? <div className="mt-2 text-sm text-muted">{children}</div> : null}
    </div>
  );
}

/** Empty state — ui-context.md: never render a blank or a half-loaded view. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-5 py-6 text-sm text-muted">{children}</p>;
}

export function formatDay(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "—";
}
