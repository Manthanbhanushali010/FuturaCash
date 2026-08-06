import Image from "next/image";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Sparkles } from "lucide-react";

const DEMO_MAILTO = "mailto:hello@futuracash.co.uk";

export function HeroSection() {
  return (
    <section className="relative overflow-hidden pt-32 pb-24 lg:pt-40 lg:pb-32">
      <div className="absolute inset-0 radial-glow" />
      <div className="absolute top-0 right-0 h-[600px] w-[600px] -translate-y-1/3 translate-x-1/3 rounded-full bg-accent-blue/10 blur-3xl" />

      <div className="relative mx-auto max-w-7xl px-6">
        <div className="grid items-center gap-16 lg:grid-cols-2 lg:gap-12">
          <div className="max-w-2xl">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-divider bg-surface/60 px-4 py-1.5">
              <Sparkles className="h-4 w-4 text-accent-blue" />
              <span className="text-sm font-medium text-text-secondary">Built for SMB finance teams</span>
            </div>

            <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight md:text-5xl lg:text-6xl">
              Your cash flow,{" "}
              <span className="text-accent-blue">forecast 13 weeks ahead</span>
            </h1>

            <p className="mt-6 text-lg leading-relaxed text-text-secondary md:text-xl">
              Connect your bank and Xero. See exactly when cash runs low — and
              make the right moves before it happens.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link
                href="/xero"
                className="inline-flex items-center gap-2 rounded-xl bg-accent-blue px-6 py-3.5 text-base font-medium text-white transition-all hover:bg-accent-blue/90 hover:shadow-lg hover:shadow-accent-blue/20"
              >
                Get started
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href={DEMO_MAILTO}
                className="inline-flex items-center gap-2 rounded-xl border border-divider bg-surface px-6 py-3.5 text-base font-medium text-text-primary transition-all hover:border-accent-blue/30 hover:bg-surface-elevated"
              >
                Book a demo
              </a>
            </div>

            <div className="mt-10 flex flex-wrap items-center gap-6 text-sm text-text-tertiary">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-accent-blue" />
                <span>Xero native</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-accent-blue" />
                <span>Bank-grade security</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-accent-blue" />
                <span>Setup in minutes</span>
              </div>
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-4 rounded-3xl bg-accent-blue/10 blur-2xl" />
            <div className="relative overflow-hidden rounded-2xl border border-divider bg-surface shadow-2xl glow-blue">
              <Image
                src="/hero-dashboard.png"
                alt="Futura dashboard showing a 13-week cash flow forecast with weekly inflows, outflows, and projected balance"
                width={1344}
                height={896}
                sizes="(min-width: 1024px) 50vw, 100vw"
                priority
                className="h-auto w-full"
              />
              <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-navy/60 to-transparent" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
