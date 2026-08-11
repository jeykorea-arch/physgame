import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "전기의 여정 — 1차시 알파",
  description: "발전소에서 변압기까지, 설치 없이 배우는 물리학 II AR 학습 게임",
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
