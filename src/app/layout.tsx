import type { Metadata, Viewport } from "next";
import { ServiceWorkerRegistration } from "../components/pwa/ServiceWorkerRegistration.tsx";
import { Toaster } from "../components/ui/sonner.tsx";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://ams-start.example"),
  title: {
    default: "АМС Старт",
    template: "%s | АМС Старт",
  },
  description: "Нейтральный стартовый шаблон для CRM, аналитических кабинетов и внутренних веб-приложений.",
  applicationName: "АМС Старт",
  manifest: "/manifest.webmanifest",
  keywords: ["CRM", "аналитический кабинет", "внутреннее веб-приложение", "SaaS starter"],
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: [{ url: "/ams-favicon.svg", type: "image/svg+xml" }],
    shortcut: "/ams-favicon.svg",
  },
  openGraph: {
    type: "website",
    locale: "ru_RU",
    url: "/",
    siteName: "АМС Старт",
    title: "АМС Старт",
    description: "Нейтральный foundation для кабинетов, CRM, аналитики и внутренних систем.",
  },
  twitter: {
    card: "summary",
    title: "АМС Старт",
    description: "Нейтральный foundation для кабинетов, CRM, аналитики и внутренних систем.",
  },
  appleWebApp: {
    capable: true,
    title: "АМС Старт",
    statusBarStyle: "black-translucent",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
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
      <body className="min-h-full"><NuqsAdapter>{children}</NuqsAdapter><ServiceWorkerRegistration /><Toaster /></body>
    </html>
  );
}
