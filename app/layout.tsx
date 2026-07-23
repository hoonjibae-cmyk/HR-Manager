import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "유쌤에듀 HR 관리",
  description: "㈜유쌤에듀 인사·급여·연차·문서 관리 프로그램",
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
