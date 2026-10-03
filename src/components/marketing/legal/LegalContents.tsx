import { privacyHtml } from "./legal-html.ts";
import styles from "../LegalDocument.module.css";

type StaticLegalContentProps = {
  html: string;
};

function StaticLegalContent({ html }: StaticLegalContentProps) {
  return <div className={styles.source} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function PrivacyContent() {
  return <StaticLegalContent html={privacyHtml} />;
}
