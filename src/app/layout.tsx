import type { Metadata, Viewport } from "next";
import { Toaster } from "../components/ui/sonner.tsx";
import { productIdentity } from "../platform/config/product-identity.ts";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: productIdentity.metadataBase,
  title: {
    default: productIdentity.appName,
    template: `%s | ${productIdentity.appName}`,
  },
  description: "Рабочая платформа AMS для CRM, аналитических кабинетов и внутренних веб-приложений.",
  applicationName: productIdentity.appName,
  keywords: ["CRM", "аналитический кабинет", "внутреннее веб-приложение", "Data Hub"],
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: [{ url: productIdentity.faviconPath, type: "image/svg+xml" }],
    shortcut: productIdentity.faviconPath,
  },
  openGraph: {
    type: "website",
    locale: "ru_RU",
    url: "/",
    siteName: productIdentity.appName,
    title: productIdentity.appName,
    description: "Закрытая рабочая платформа AMS для данных и внутренних систем.",
  },
  twitter: {
    card: "summary",
    title: productIdentity.appName,
    description: "Закрытая рабочая платформа AMS для данных и внутренних систем.",
  },
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
    },
  },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#0c1117",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" className="h-full antialiased">
      <body className="min-h-full"><NuqsAdapter>{children}</NuqsAdapter><Toaster /></body>
    </html>
  );
}
