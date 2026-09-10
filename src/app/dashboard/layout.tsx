import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { PrivateApplicationLayout } from "../../components/shell/PrivateApplicationLayout.tsx";

export const metadata: Metadata = {
  title: "Личный кабинет",
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = { colorScheme: "light", themeColor: "#edf2f6" };

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <PrivateApplicationLayout>{children}</PrivateApplicationLayout>;
}
