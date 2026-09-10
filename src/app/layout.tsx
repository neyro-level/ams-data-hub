import type { Metadata, Viewport } from "next";
import { Toaster } from "../components/ui/sonner.tsx";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://impulse.ams24.ru"),
  title: {
    default: "Быстрое продвижение сайтов в SEO",
    template: "%s | AMS IMPULSE",
  },
  description:
    "Быстрое и безопасное продвижение сайтов в топ-1 выдачи Яндекс с помощью уникальных технологий.",
  applicationName: "AMS IMPULSE",
  keywords: ["продвижение сайтов", "SEO", "продвижение в Яндексе", "поведенческие факторы"],
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
    siteName: "AMS IMPULSE",
    title: "Быстрое продвижение сайтов в SEO",
    description:
      "Быстрое и безопасное продвижение сайтов в топ-1 выдачи Яндекс с помощью уникальных технологий.",
  },
  twitter: {
    card: "summary",
    title: "Быстрое продвижение сайтов в SEO",
    description:
      "Быстрое и безопасное продвижение сайтов в топ-1 выдачи Яндекс с помощью уникальных технологий.",
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
      <body className="min-h-full"><NuqsAdapter>{children}</NuqsAdapter><Toaster /></body>
    </html>
  );
}
