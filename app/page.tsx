import type { Metadata } from "next";

import { SiteNav } from "@/components/marketing/site-nav";
import { HeroSection } from "@/components/marketing/hero";
import {
  CTASection,
  FeaturesSection,
  HowItWorksSection,
  ProblemSection,
  WhyFuturaSection,
} from "@/components/marketing/sections";
import { SiteFooter } from "@/components/marketing/site-footer";

export const metadata: Metadata = {
  title: "Futura — 13-Week Cash Flow Forecasting for SMBs",
  description:
    "Futura connects to your bank accounts and Xero to give finance teams a live 13-week cash flow forecast. See when cash runs low before it happens.",
  openGraph: {
    title: "Futura — 13-Week Cash Flow Forecasting for SMBs",
    description:
      "Connect your bank and Xero. See exactly when cash runs low — before it happens.",
    type: "website",
  },
  twitter: { card: "summary_large_image" },
};

// The `futura-landing` class scopes the marketing palette (see app/globals.css
// and the palette decision in context/ui-context.md). The treasury UI at /xero
// keeps the app tokens and is unaffected by anything in this tree.
export default function Home() {
  return (
    <div className="futura-landing min-h-screen bg-navy text-text-primary">
      <SiteNav />
      <main>
        <HeroSection />
        <ProblemSection />
        <HowItWorksSection />
        <FeaturesSection />
        <WhyFuturaSection />
        <CTASection />
      </main>
      <SiteFooter />
    </div>
  );
}
