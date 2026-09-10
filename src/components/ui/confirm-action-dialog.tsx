"use client";

import { useState } from "react";
import { Button } from "./button.tsx";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "./dialog.tsx";

export function ConfirmActionDialog({ triggerLabel, title, description, confirmationName, onConfirm }: { triggerLabel: string; title: string; description: string; confirmationName: string; onConfirm: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  async function confirm() { setPending(true); try { await onConfirm(); setOpen(false); } finally { setPending(false); } }
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger render={<Button type="button" variant="destructive">{triggerLabel}</Button>} /><DialogContent><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description} Подтвердите действие для «{confirmationName}».</DialogDescription></DialogHeader><DialogFooter className="mt-6"><DialogClose render={<Button type="button" variant="outline" disabled={pending}>Назад</Button>} /><Button type="button" variant="destructive" disabled={pending} onClick={confirm}>{pending ? "Выполняем…" : triggerLabel}</Button></DialogFooter></DialogContent></Dialog>;
}
