import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "PriceVision",
  description: "Photo-based retail price monitoring platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
