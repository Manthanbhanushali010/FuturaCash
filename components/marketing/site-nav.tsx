"use client";

// Marketing navigation. Client-only because of the mobile menu toggle — the rest
// of the landing page stays a server component.

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, TrendingUp } from "lucide-react";

const DEMO_MAILTO = "mailto:hello@futuracash.co.uk";

export function SiteNav() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-divider bg-navy/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-blue text-white">
            <TrendingUp className="h-5 w-5" />
          </div>
          <span className="text-lg font-semibold tracking-tight">Futura</span>
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          <a href="#features" className="text-sm text-text-secondary transition-colors hover:text-text-primary">
            Features
          </a>
          <a href="#how-it-works" className="text-sm text-text-secondary transition-colors hover:text-text-primary">
            How it works
          </a>
          <a href="#why-futura" className="text-sm text-text-secondary transition-colors hover:text-text-primary">
            Why Futura
          </a>
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <Link
            href="/xero"
            className="text-sm font-medium text-text-secondary transition-colors hover:text-text-primary"
          >
            Log in
          </Link>
          <a
            href={DEMO_MAILTO}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent-blue px-4 py-2 text-sm font-medium text-white transition-all hover:bg-accent-blue/90"
          >
            Book a demo
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>

        <button
          className="flex items-center justify-center md:hidden"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
          aria-expanded={mobileOpen}
        >
          <div className="space-y-1.5">
            <span className="block h-0.5 w-6 bg-text-primary" />
            <span className="block h-0.5 w-6 bg-text-primary" />
          </div>
        </button>
      </div>

      {mobileOpen && (
        <div className="border-t border-divider bg-surface px-6 py-4 md:hidden">
          <nav className="flex flex-col gap-4">
            <a href="#features" className="text-sm text-text-secondary" onClick={() => setMobileOpen(false)}>
              Features
            </a>
            <a href="#how-it-works" className="text-sm text-text-secondary" onClick={() => setMobileOpen(false)}>
              How it works
            </a>
            <a href="#why-futura" className="text-sm text-text-secondary" onClick={() => setMobileOpen(false)}>
              Why Futura
            </a>
            <Link href="/xero" className="text-sm text-text-secondary" onClick={() => setMobileOpen(false)}>
              Log in
            </Link>
            <a
              href={DEMO_MAILTO}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent-blue px-4 py-2 text-sm font-medium text-white"
            >
              Book a demo
            </a>
          </nav>
        </div>
      )}
    </header>
  );
}
