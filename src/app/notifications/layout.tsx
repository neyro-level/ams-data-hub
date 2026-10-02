import type { ReactNode } from "react";
import { PrivateApplicationLayout } from "../../components/shell/PrivateApplicationLayout.tsx";

export default function NotificationsLayout({ children }: { children: ReactNode }) { return <PrivateApplicationLayout>{children}</PrivateApplicationLayout>; }
