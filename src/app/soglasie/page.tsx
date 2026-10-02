import type { Metadata } from "next";
import { LegalDocument } from "../../components/marketing/LegalDocument.tsx";
import { ConsentContent } from "../../components/marketing/legal/LegalContents.tsx";

export const metadata: Metadata = {
  title: "Согласие на обработку данных",
  description: "Согласие пользователя на обработку персональных данных.",
  alternates: { canonical: "/soglasie/" },
};

export default function ConsentPage() {
  return (
    <LegalDocument
      eyebrow="Юридический документ"
      title="Согласие на обработку персональных данных"
      description="Условия, на которых пользователь добровольно предоставляет Оператору согласие на обработку персональных данных."
      version="Версия 1.0"
      effectiveDate="24.05.2026"
    >
      <ConsentContent />
    </LegalDocument>
  );
}
