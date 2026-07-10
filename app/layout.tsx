import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Market & Run Agents",
  description:
    "SOXL day/night action briefs with impact playbooks, next-session calls, call log, and Gemini API fallback — plus Toronto run-club coaching",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
