export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { SiteReportView } from "../../modules/reporting/presentation.ts";
import { getDemoSnapshot } from "../../modules/reporting/presentation.ts";
import {
  getCurrentCabinetRedirect,
  getCurrentPrincipalState,
} from "../../modules/identity-access/server.ts";
import { siteRegistrySchema } from "../../shared/schemas/registry.ts";

const demoSite = siteRegistrySchema.parse({
  siteSlug: "overview",
  name: "Synthetic overview",
  siteUrl: "https://demo.ams-cloud.ru",
  timezone: "+03:00",
  enabled: true,
  webmaster: {
    enabled: true,
    expectedHostUrl: "https://demo.ams-cloud.ru",
  },
  metrica: {
    enabled: true,
    counterId: "100001",
    goalProfile: "default",
  },
});

export default async function DemoPage() {
  const cabinetRedirect = await getCurrentCabinetRedirect();
  if (cabinetRedirect) redirect(cabinetRedirect);
  const state = await getCurrentPrincipalState();
  if (!state) redirect("/?login=1");

  return (
    <>
      <SiteReportView
        site={demoSite}
        snapshot={getDemoSnapshot()}
        mode="fixture"
      />
    </>
  );
}
