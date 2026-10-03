import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { productIdentity } from "../../platform/config/product-identity.ts";

export const metadata: Metadata = {
  title: "Страница не найдена",
  description: `Страница не найдена. Вернитесь на главную ${productIdentity.appName} или выберите доступный раздел.`,
  robots: { index: false, follow: false },
};

export default function CatchAllNotFoundPage() {
  notFound();
}
