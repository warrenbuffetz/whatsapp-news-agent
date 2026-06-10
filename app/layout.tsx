import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "WhatsApp News & Weather Agent",
  description: "Serverless inbound-trigger backend for morning briefs via WhatsApp",
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
