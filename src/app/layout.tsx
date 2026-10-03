import type { Metadata, Viewport } from "next";
import { Toaster } from "../components/ui/sonner.tsx";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://data-hab.ams24.ru"),
  title: {
    default: "AMS Data Hub",
    template: "%s | AMS Data Hub",
  },
  description: "Рабочая платформа AMS для CRM, аналитических кабинетов и внутренних веб-приложений.",
  applicationName: "AMS Data Hub",
  keywords: ["CRM", "аналитический кабинет", "внутреннее веб-приложение", "Data Hub"],
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: [{ url: "/ams-data-hub-favicon.svg", type: "image/svg+xml" }],
    shortcut: "/ams-data-hub-favicon.svg",
  },
  openGraph: {
    type: "website",
    locale: "ru_RU",
    url: "/",
    siteName: "AMS Data Hub",
    title: "AMS Data Hub",
    description: "Закрытая рабочая платформа AMS для данных и внутренних систем.",
  },
  twitter: {
    card: "summary",
    title: "AMS Data Hub",
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
