"use client";

import { LockKeyhole, LogIn, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { MarketingButton } from "../../../components/marketing/MarketingButton.tsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog.tsx";
import { Input } from "../../../components/ui/input.tsx";
import { authClient } from "../../../platform/auth/client.ts";

type LoginDialogProps = {
  initialOpen?: boolean;
};

export function LoginDialog({ initialOpen = false }: LoginDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(initialOpen);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const loginSucceededRef = useRef(false);
  const [pending, setPending] = useState(false);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && pending) return;
    setOpen(nextOpen);
    if (!nextOpen) {
      setErrorMessage(null);
      if (!loginSucceededRef.current && window.location.search.includes("login=")) {
        window.history.replaceState(null, "", "/");
      }
      loginSucceededRef.current = false;
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setErrorMessage(null);

    try {
      const result = await authClient.signIn.username({ username, password, rememberMe: true });
      if (result.error) {
        setErrorMessage("Не удалось войти. Проверьте логин и пароль.");
        return;
      }

      loginSucceededRef.current = true;
      setOpen(false);
      router.replace("/dashboard/");
    } catch {
      setErrorMessage("Не удалось войти. Повторите попытку позже.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <MarketingButton
        type="button"
        tone="outline"
        className="group gap-2 px-4"
        onClick={() => {
          setErrorMessage(null);
          setOpen(true);
        }}
      >
        <span className="hidden sm:inline">Вход в личный кабинет</span>
        <span className="sm:hidden">Войти</span>
        <LogIn className="transition-transform group-hover:translate-x-0.5" strokeWidth={1.7} aria-hidden />
      </MarketingButton>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="theme-public impulse-landing rounded-none border-[var(--ch-border-control)] bg-[var(--ch-bg-deeper)] p-7 text-[var(--ch-white)] shadow-[var(--ch-overlay-shadow)] sm:p-10"
          showCloseButton={!pending}
        >
          <DialogHeader>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--ch-accent)]">AMS IMPULSE</p>
            <DialogTitle className="mt-2 text-[32px] font-extrabold leading-tight tracking-[-0.04em] text-[var(--ch-white)] sm:text-[34px]">
              Вход в кабинет
            </DialogTitle>
          </DialogHeader>

          <form className="mt-9 border-t border-[var(--ch-border-subtle)] pt-8" onSubmit={handleSubmit}>
            <div className="space-y-6">
              <label className="block">
                <span className="mb-3 block text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--ch-label-ondark)]">Логин</span>
                <span className="group relative flex min-h-14 items-center">
                  <UserRound className="pointer-events-none absolute left-4 z-10 size-[18px] text-[var(--ch-icon-ondark)] group-focus-within:text-[var(--ch-accent)]" strokeWidth={1.6} aria-hidden />
                  <Input
                    type="text"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    className="min-h-14 rounded-none border-[var(--ch-border-control)] bg-[var(--ch-bg-dark)]/72 py-3 pl-12 pr-4 text-base font-medium text-[var(--ch-white)] placeholder:text-[var(--ch-placeholder-ondark)] focus-visible:border-[var(--ch-accent)] focus-visible:ring-[var(--ch-focus-soft)]"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    autoFocus
                    required
                  />
                </span>
              </label>

              <label className="block">
                <span className="mb-3 block text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--ch-label-ondark)]">Пароль</span>
                <span className="group relative flex min-h-14 items-center">
                  <LockKeyhole className="pointer-events-none absolute left-4 z-10 size-[18px] text-[var(--ch-icon-ondark)] group-focus-within:text-[var(--ch-accent)]" strokeWidth={1.6} aria-hidden />
                  <Input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="min-h-14 rounded-none border-[var(--ch-border-control)] bg-[var(--ch-bg-dark)]/72 py-3 pl-12 pr-4 text-base font-medium text-[var(--ch-white)] placeholder:text-[var(--ch-placeholder-ondark)] focus-visible:border-[var(--ch-accent)] focus-visible:ring-[var(--ch-focus-soft)]"
                    autoComplete="current-password"
                    required
                  />
                </span>
              </label>
            </div>

            {errorMessage ? (
              <p className="mt-6 border border-[var(--ch-error-border)] bg-[var(--ch-error-soft)] px-4 py-3 text-sm leading-5 text-[var(--ch-error)]" role="alert">
                {errorMessage}
              </p>
            ) : null}

            <MarketingButton
              type="submit"
              size="lg"
              disabled={pending}
              className="mt-7 min-h-14 w-full focus-visible:ring-[var(--ch-white)] focus-visible:ring-offset-[var(--ch-bg-deeper)]"
            >
              {pending ? "Входим…" : "Войти"}
              {!pending ? <LogIn strokeWidth={1.7} aria-hidden /> : null}
            </MarketingButton>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
