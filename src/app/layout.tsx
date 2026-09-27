import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "미미태그",
  description: "붙이는 순간, 물건의 디지털 프로필",
  robots: { index: false, follow: false }, // 출시 전 비공개
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#ffffff" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Nanum+Pen+Script&display=swap" rel="stylesheet" />
      </head>
      <body>
        <div className="shell">
          <header className="top">
            <Link href="/me" className="brand">미미태그</Link>
          </header>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
