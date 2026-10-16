import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Verilo", template: "%s · Verilo" },
  description: "Accurate hours. Less busywork. More time for your business.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0f4c47" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
