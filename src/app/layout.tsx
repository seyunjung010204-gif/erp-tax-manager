import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ERP Tax Evidence Manager",
  description: "홈택스 세금계산서 및 증빙자료 관리 ERP",
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
