import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Token 管家",
  description: "公司级 AI API 用量管理平台",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="antialiased bg-gray-50 text-gray-900">
        {children}
      </body>
    </html>
  );
}
