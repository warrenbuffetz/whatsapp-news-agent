import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SOXL Brief Agent",
  description:
    "SOXL day/night action briefs with impact table, next-session prediction, call log, and Gemini API fallback",
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
