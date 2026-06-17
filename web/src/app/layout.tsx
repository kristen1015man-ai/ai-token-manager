import type { Metadata } from "next";
import { BRAND_SLOGAN, BRAND_TITLE } from "@/lib/brand";
import "./globals.css";

export const metadata: Metadata = {
  title: BRAND_TITLE,
  description: BRAND_SLOGAN,
  icons: {
    icon: "/logo.png",
    shortcut: "/logo.png",
    apple: "/logo.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:opsz,wght@6..96,600;700;800&family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500;1,600&family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Playfair+Display:ital,wght@0,400;0,600;0,700;0,800;0,900;1,600;1,700&display=swap"
          rel="stylesheet"
        />
        {/* FOUC prevention: apply dark theme before first paint */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){var t=localStorage.getItem('theme');if(t==='dark')document.documentElement.setAttribute('data-theme','dark')})();` }} />
      </head>
      <body className="antialiased text-gray-900">
        {children}
      </body>
    </html>
  );
}
