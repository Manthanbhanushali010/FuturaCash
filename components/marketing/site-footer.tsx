import Link from "next/link";
import { TrendingUp } from "lucide-react";

// Server component: the copyright year is resolved when the page is rendered
// (build time for this static route), so there is no hydration mismatch.
export function SiteFooter() {
  return (
    <footer className="border-t border-divider bg-surface/40 py-12">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-6 md:flex-row">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-blue text-white">
            <TrendingUp className="h-5 w-5" />
          </div>
          <span className="text-lg font-semibold tracking-tight">Futura</span>
        </Link>

        <p className="text-sm text-text-tertiary">
          © {new Date().getFullYear()} Futura Cash Ltd. All rights reserved.
        </p>

        <div className="flex items-center gap-6">
          <a href="mailto:hello@futuracash.co.uk" className="text-sm text-text-secondary hover:text-text-primary">
            Contact
          </a>
          <a href="#" className="text-sm text-text-secondary hover:text-text-primary">
            Privacy
          </a>
          <a href="#" className="text-sm text-text-secondary hover:text-text-primary">
            Terms
          </a>
        </div>
      </div>
    </footer>
  );
}
