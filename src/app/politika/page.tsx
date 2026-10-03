import type { Metadata } from "next";
import { LegalDocument } from "../../components/marketing/LegalDocument.tsx";
import { PrivacyContent } from "../../components/marketing/legal/LegalContents.tsx";
import { productIdentity } from "../../platform/config/product-identity.ts";

export const metadata: Metadata = {
  title: "Политика обработки персональных данных и конфиденциальности",
  description: `Проект политики обработки персональных данных и конфиденциальности ${productIdentity.appName}. Требует юридической проверки владельцем.`,
  alternates: { canonical: "/politika/" },
  robots: { index: false, follow: false, nocache: true },
};

export default function PrivacyPage() {
  return (
    <LegalDocument
      eyebrow="Юридический документ · проект"
      title="Политика обработки персональных данных и конфиденциальности"
      description="Текст требует юридической проверки и утверждения владельцем до применения в production."
      version="Проект версии 1.0"
      effectiveDate="не установлена"
    >
      <PrivacyContent />
    </LegalDocument>
  );
}
