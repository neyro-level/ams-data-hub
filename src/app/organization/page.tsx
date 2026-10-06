export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentOrganizationSelection } from "../../modules/identity-access/server.ts";
import { Button } from "../../components/ui/button.tsx";
import { productIdentity } from "../../platform/config/product-identity.ts";
import { selectOrganizationAction } from "./actions.ts";

export const metadata: Metadata = {
  title: "Выбор организации",
  robots: { index: false, follow: false },
};

export default async function OrganizationSelectionPage() {
  const selection = await getCurrentOrganizationSelection();
  if (!selection || selection.disabled) redirect("/?login=1");
  if (selection.hasPrincipal) redirect("/dashboard/");

  return (
    <main className="theme-app grid min-h-screen place-items-center bg-[var(--background)] px-4 py-10 text-app-foreground">
      <section className="w-full max-w-xl rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--card)] p-6 shadow-sm sm:p-8">
        <p className="text-sm font-semibold text-app-primary">{productIdentity.appName}</p>
        <h1 className="mt-2 text-2xl font-semibold">Выберите организацию</h1>
        <p className="mt-2 text-sm text-app-secondary">
          У вашей учётной записи несколько рабочих областей. Выбор сохранится для текущей сессии.
        </p>

        {selection.organizations.length > 0 ? (
          <div className="mt-6 grid gap-3">
            {selection.organizations.map((organization) => (
              <form key={organization.id} action={selectOrganizationAction}>
                <input type="hidden" name="organizationId" value={organization.id} />
                <Button type="submit" variant="outline" className="h-auto min-h-12 w-full justify-start px-4 py-3 text-left">
                  {organization.name}
                </Button>
              </form>
            ))}
          </div>
        ) : (
          <p className="mt-6 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--muted)] p-4 text-sm text-app-secondary">
            Для учётной записи пока не назначена организация. Обратитесь к администратору платформы.
          </p>
        )}
      </section>
    </main>
  );
}
