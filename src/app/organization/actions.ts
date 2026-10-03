"use server";

import { redirect } from "next/navigation";
import { setCurrentActiveOrganization } from "../../modules/identity-access/server.ts";

export async function selectOrganizationAction(formData: FormData) {
  const organizationId = formData.get("organizationId");
  if (typeof organizationId !== "string") return;
  await setCurrentActiveOrganization(organizationId);
  redirect("/dashboard/");
}
