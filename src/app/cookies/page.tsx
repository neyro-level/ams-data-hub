import type { Metadata } from "next";
import { LegalDocument } from "../../components/marketing/LegalDocument.tsx";
import { CookiesContent } from "../../components/marketing/legal/LegalContents.tsx";

export const metadata: Metadata = {
  title: "Правила использования Cookie",
  description: "Правила использования файлов cookie и аналогичных технологий на сайте AMS IMPULSE.",
  alternates: { canonical: "/cookies/" },
};

export default function CookiesPage() {
  return (
    <LegalDocument
      eyebrow="Cookie и аналитика"
      title="Правила использования файлов cookie"
      description="Определяют порядок применения файлов cookie и аналогичных технологий на сайте."
      version="Версия 1.0"
      effectiveDate="24.05.2026"
    >
      <CookiesContent />
    </LegalDocument>
  );
}
