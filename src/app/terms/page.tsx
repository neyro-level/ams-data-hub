import type { Metadata } from "next";
import { LegalDocument } from "../../components/marketing/LegalDocument.tsx";
import { TermsContent } from "../../components/marketing/legal/LegalContents.tsx";

export const metadata: Metadata = {
  title: "Общие условия сотрудничества",
  description: "Общие условия сотрудничества между АМС и заказчиком.",
  alternates: { canonical: "/terms/" },
};

export default function TermsPage() {
  return (
    <LegalDocument
      eyebrow="Юридический документ"
      title="Общие условия сотрудничества"
      description="Базовые правила работы, роли сторон, порядок заключения сделки и границы ответственности."
      version="Редакция 05.02.2026"
      effectiveDate="05.02.2026"
    >
      <TermsContent />
    </LegalDocument>
  );
}
