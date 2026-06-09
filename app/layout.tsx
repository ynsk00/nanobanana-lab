import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nano Banana Lab",
  description: "Google Gemini Nano Banana 画像生成 実験サイト",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
