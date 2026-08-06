import type { ReactNode } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Bell,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  Database,
  LineChart,
  Link2,
  PieChart,
  Shield,
  Zap,
} from "lucide-react";

const DEMO_MAILTO = "mailto:hello@futuracash.co.uk";

export function ProblemSection() {
  return (
    <section className="relative border-y border-divider bg-surface/40 py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid items-start gap-16 lg:grid-cols-2">
          <div>
            <span className="text-sm font-semibold uppercase tracking-wider text-accent-blue">
              The problem
            </span>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">
              Still forecasting cash in a spreadsheet?
            </h2>
            <p className="mt-6 text-lg text-text-secondary">
              Most SMB finance teams rely on fragile Excel models. One broken
              formula, one late invoice update, one missed row — and the forecast
              is wrong when you need it most.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <ProblemCard
              icon={<Database className="h-5 w-5" />}
              title="Manual data entry"
              description="Hours copying bank and Xero data into spreadsheets every week."
            />
            <ProblemCard
              icon={<Zap className="h-5 w-5" />}
              title="Static snapshots"
              description="Forecasts are out of date the moment a customer pays late."
            />
            <ProblemCard
              icon={<BarChart3 className="h-5 w-5" />}
              title="No visibility"
              description="Founders only see a cash crunch after it has already started."
            />
            <ProblemCard
              icon={<Shield className="h-5 w-5" />}
              title="Error prone"
              description="Broken formulas and version chaos make it hard to trust the numbers."
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function ProblemCard({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-divider bg-surface p-6 transition-colors hover:border-accent-blue/30">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-blue/10 text-accent-blue">
        {icon}
      </div>
      <h3 className="mt-4 text-base font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-text-secondary">{description}</p>
    </div>
  );
}

export function HowItWorksSection() {
  const steps = [
    {
      number: "01",
      icon: <Link2 className="h-5 w-5" />,
      title: "Connect",
      description:
        "Link your business bank accounts and Xero ledger in minutes. Futura ingests transactions automatically.",
    },
    {
      number: "02",
      icon: <LineChart className="h-5 w-5" />,
      title: "Forecast",
      description:
        "Get a live 13-week cash flow forecast built from actual balances, expected invoices, and recurring outgoings.",
    },
    {
      number: "03",
      icon: <Bell className="h-5 w-5" />,
      title: "Act",
      description:
        "Receive alerts before you run low, with clear recommendations on timing, collections, and spend.",
    },
  ];

  return (
    <section id="how-it-works" className="py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <span className="text-sm font-semibold uppercase tracking-wider text-accent-blue">How it works</span>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">
            From live data to forward visibility
          </h2>
          <p className="mt-6 text-lg text-text-secondary">
            Three steps to replace the spreadsheet with a forecast that updates itself.
          </p>
        </div>

        <div className="mt-16 grid gap-8 md:grid-cols-3">
          {steps.map((step) => (
            <div
              key={step.number}
              className="group relative rounded-2xl border border-divider bg-surface p-8 transition-all hover:border-accent-blue/30 hover:bg-surface-elevated"
            >
              <span className="absolute top-6 right-6 text-sm font-semibold text-text-tertiary">
                {step.number}
              </span>
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-blue/10 text-accent-blue transition-colors group-hover:bg-accent-blue group-hover:text-white">
                {step.icon}
              </div>
              <h3 className="mt-6 text-xl font-semibold">{step.title}</h3>
              <p className="mt-3 text-base leading-relaxed text-text-secondary">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function FeaturesSection() {
  const features = [
    {
      icon: <CreditCard className="h-5 w-5" />,
      title: "Real-time cash position",
      description: "See today's actual cash across all connected accounts, updated automatically.",
    },
    {
      icon: <Calendar className="h-5 w-5" />,
      title: "13-week forecast",
      description: "Weekly projected balances so you can plan payroll, VAT, supplier payments, and growth.",
    },
    {
      icon: <PieChart className="h-5 w-5" />,
      title: "Scenario modelling",
      description: "Model what happens if a major customer pays late, revenue dips, or costs spike.",
    },
    {
      icon: <Building2 className="h-5 w-5" />,
      title: "Sector-aware",
      description: "Built for the rhythms of retail, hospitality, and consumer goods businesses.",
    },
    {
      icon: <Link2 className="h-5 w-5" />,
      title: "Bank + Xero integration",
      description: "One source of truth that combines bank feeds with your accounting ledger.",
    },
    {
      icon: <Bell className="h-5 w-5" />,
      title: "Alerts before you run low",
      description: "Proactive warnings with enough time to chase debtors, delay spend, or draw down credit.",
    },
  ];

  return (
    <section id="features" className="border-y border-divider bg-surface/40 py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <span className="text-sm font-semibold uppercase tracking-wider text-accent-blue">Features</span>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">
            Everything finance teams need
          </h2>
          <p className="mt-6 text-lg text-text-secondary">
            A focused toolset designed around one job: knowing where cash is headed.
          </p>
        </div>

        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="rounded-xl border border-divider bg-surface p-6 transition-all hover:-translate-y-1 hover:border-accent-blue/30 hover:bg-surface-elevated"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-blue/10 text-accent-blue">
                {feature.icon}
              </div>
              <h3 className="mt-5 text-base font-semibold">{feature.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-text-secondary">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function WhyFuturaSection() {
  const reasons = [
    "Xero-native architecture, not a generic add-on.",
    "Built for SMB finance teams, not enterprise treasury.",
    "Sees the future, not just the past.",
    "Clear, calm interface that earns trust from day one.",
  ];

  return (
    <section id="why-futura" className="py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid items-center gap-16 lg:grid-cols-2">
          <div className="order-2 lg:order-1">
            <div className="relative">
              <div className="absolute -inset-4 rounded-3xl bg-accent-blue/10 blur-2xl" />
              <div className="relative rounded-2xl border border-divider bg-surface p-8 shadow-xl glow-blue-sm">
                <div className="mb-6 flex items-center justify-between">
                  <div className="text-sm font-medium text-text-secondary">Projected balance</div>
                  <div className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400">
                    Healthy
                  </div>
                </div>
                <div className="text-4xl font-semibold tracking-tight">£1,240,000</div>
                <div className="mt-1 text-sm text-text-secondary">13-week low: £312,000</div>
                <div className="mt-8 h-32 rounded-xl bg-surface-elevated/60 p-4">
                  <svg viewBox="0 0 300 80" className="h-full w-full" preserveAspectRatio="none">
                    <path
                      d="M0,60 C40,55 60,30 100,35 C140,40 160,65 200,50 C240,35 260,20 300,25"
                      fill="none"
                      stroke="#4C82F7"
                      strokeWidth="2.5"
                      vectorEffect="non-scaling-stroke"
                    />
                    <path
                      d="M0,60 C40,55 60,30 100,35 C140,40 160,65 200,50 C240,35 260,20 300,25 L300,80 L0,80 Z"
                      fill="url(#gradient)"
                      opacity="0.2"
                    />
                    <defs>
                      <linearGradient id="gradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#4C82F7" />
                        <stop offset="100%" stopColor="#4C82F7" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                  </svg>
                </div>
                <div className="mt-6 grid grid-cols-3 gap-4 text-center">
                  <div>
                    <div className="text-sm font-semibold">£4.2m</div>
                    <div className="text-xs text-text-tertiary">Inflow</div>
                  </div>
                  <div>
                    <div className="text-sm font-semibold">£3.8m</div>
                    <div className="text-xs text-text-tertiary">Outflow</div>
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-emerald-400">+£412k</div>
                    <div className="text-xs text-text-tertiary">Net</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="order-1 lg:order-2">
            <span className="text-sm font-semibold uppercase tracking-wider text-accent-blue">Why Futura</span>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">
              Built for businesses that outgrew Excel
            </h2>
            <p className="mt-6 text-lg text-text-secondary">
              Most tools report what happened. Futura tells you what is coming —
              so finance teams can act with confidence.
            </p>

            <ul className="mt-8 space-y-4">
              {reasons.map((reason) => (
                <li key={reason} className="flex items-start gap-3">
                  <div className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-blue/10">
                    <CheckCircle2 className="h-3.5 w-3.5 text-accent-blue" />
                  </div>
                  <span className="text-base text-text-secondary">{reason}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

export function CTASection() {
  return (
    <section className="py-24 lg:py-32">
      <div className="mx-auto max-w-7xl px-6">
        <div className="relative overflow-hidden rounded-3xl border border-divider bg-surface p-12 text-center lg:p-20">
          <div className="absolute inset-0 radial-glow" />
          <div className="absolute top-0 right-0 h-96 w-96 translate-x-1/3 -translate-y-1/3 rounded-full bg-accent-blue/20 blur-3xl" />
          <div className="absolute bottom-0 left-0 h-96 w-96 -translate-x-1/3 translate-y-1/3 rounded-full bg-accent-blue/10 blur-3xl" />

          <div className="relative">
            <h2 className="text-3xl font-semibold tracking-tight md:text-4xl lg:text-5xl">
              See your cash flow clearly
            </h2>
            <p className="mx-auto mt-6 max-w-2xl text-lg text-text-secondary">
              Join finance teams replacing fragile spreadsheets with a live 13-week forecast.
            </p>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
              <Link
                href="/xero"
                className="inline-flex items-center gap-2 rounded-xl bg-accent-blue px-7 py-4 text-base font-medium text-white transition-all hover:bg-accent-blue/90 hover:shadow-lg hover:shadow-accent-blue/25"
              >
                Get started
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href={DEMO_MAILTO}
                className="inline-flex items-center gap-2 rounded-xl border border-divider bg-navy px-7 py-4 text-base font-medium text-text-primary transition-all hover:border-accent-blue/30 hover:bg-surface-elevated"
              >
                Book a demo
                <ChevronRight className="h-4 w-4" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
