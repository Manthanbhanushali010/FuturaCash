import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: "Cash Flow Intelligence", description: "Source of truth for cash." };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
