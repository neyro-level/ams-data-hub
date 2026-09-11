import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = {
  title: "Страница не найдена",
  description: "Страница не найдена. Вернитесь на главную АМС Старт или выберите доступный раздел.",
  robots: { index: false, follow: false },
};

export default function CatchAllNotFoundPage() {
  notFound();
}
