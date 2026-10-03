import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PrivateApplicationLayout } from "../../components/shell/PrivateApplicationLayout.tsx";

export const metadata: Metadata = {
  title: "Уведомления",
  robots: { index: false, follow: false, nocache: true },
};

export default function NotificationsLayout({ children }: { children: ReactNode }) { return <PrivateApplicationLayout>{children}</PrivateApplicationLayout>; }
