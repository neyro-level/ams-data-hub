"use client";

import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { getNotificationSummaryAction, setNotificationReadAction } from "../../modules/notifications/actions.ts";
import type { NotificationListResult } from "../../modules/notifications/index.ts";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { ButtonLink } from "../ui/button-link.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.tsx";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "../ui/sheet.tsx";

function readableMessage(message: string) {
  return message.replace(/\s*Код:\s*[A-Z0-9_]+\.?/giu, "").replace(/\s{2,}/gu, " ").trim();
}

function NotificationsList({ summary, open }: { summary: NotificationListResult; open: (id: string, route: string | null) => void }) {
  return <div className="flex flex-col gap-2">{summary.items.length ? summary.items.map((item) => <button className="flex min-h-11 w-full flex-col gap-1 rounded-[var(--radius)] px-3 py-2 text-left hover:bg-[var(--muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]" key={item.id} type="button" onClick={() => open(item.id, item.route)}><span className="flex w-full items-center justify-between gap-2"><span className="truncate text-sm font-semibold">{item.title}</span>{item.read ? null : <span className="size-2 shrink-0 rounded-full bg-[var(--info)]" aria-label="Непрочитанное" />}</span><span className="line-clamp-2 text-xs leading-5 text-app-muted-foreground">{readableMessage(item.message)}</span></button>) : <p className="px-3 py-6 text-center text-sm text-app-muted-foreground">Уведомлений пока нет</p>}<ButtonLink className="w-full" href="/notifications/" variant="outline">Все уведомления</ButtonLink></div>;
}

function BellButton({ count, surface }: { count: number; surface: "default" | "sidebar" }) {
  return <Button className={`relative size-11 ${surface === "sidebar" ? "sidebar-action size-8 min-h-8" : ""}`} type="button" variant="ghost" size="icon" aria-label={count ? `Уведомления: ${count} непрочитанных` : "Уведомления"}><Bell aria-hidden />{count ? <Badge className="absolute -right-1 -top-1 min-w-5 justify-center px-1 text-[10px]" variant="destructive">{count > 99 ? "99+" : count}</Badge> : null}</Button>;
}

export function NotificationCenter({ initialSummary, surface = "default" }: { initialSummary: NotificationListResult; surface?: "default" | "sidebar" }) {
  const router = useRouter(); const [summary, setSummary] = useState(initialSummary);
  const refresh = useCallback(async () => { const result = await getNotificationSummaryAction({}); if (result.ok) setSummary(result.data); }, []);
  useEffect(() => { const timer = window.setInterval(() => void refresh(), 60_000); const onVisibility = () => { if (document.visibilityState === "visible") void refresh(); }; document.addEventListener("visibilitychange", onVisibility); return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisibility); }; }, [refresh]);
  async function open(id: string, route: string | null) { await setNotificationReadAction({ notificationId: id, read: true }); await refresh(); if (route) router.push(route); else router.push("/notifications/"); }
  return <><div className="hidden lg:block"><Popover><PopoverTrigger render={<BellButton count={summary.unreadCount} surface={surface} />} /><PopoverContent aria-label="Последние уведомления"><NotificationsList summary={summary} open={open} /></PopoverContent></Popover></div><div className="lg:hidden"><Sheet><SheetTrigger render={<BellButton count={summary.unreadCount} surface={surface} />} /><SheetContent side="right"><SheetHeader><SheetTitle>Уведомления</SheetTitle></SheetHeader><div className="mt-5"><NotificationsList summary={summary} open={open} /></div></SheetContent></Sheet></div></>;
}
