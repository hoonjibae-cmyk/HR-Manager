import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "유쌤에듀 HR 관리",
    template: "%s · 유쌤에듀 HR",
  },
  description: "주식회사 유쌤에듀 인사·급여·연차·보강 관리 프로그램",
  applicationName: "유쌤에듀 HR",
  // 아이콘은 app/icon.svg · app/apple-icon.png 를 Next 가 자동으로 붙인다
  appleWebApp: { capable: true, title: "유쌤에듀 HR", statusBarStyle: "default" },
  // 사내용 도구라 검색엔진에 노출될 이유가 없다
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#1733e1",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
