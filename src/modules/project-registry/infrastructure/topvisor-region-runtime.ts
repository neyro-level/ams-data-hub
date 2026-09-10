import "server-only";
import { z } from "zod";
import { createTopvisorClient, readTopvisorEnvironment } from "../../../../collector/sources/topvisor/client.ts";
import type { PrincipalContext } from "../../../platform/authorization/principal.ts";
import { ProjectRegistryAdminError } from "../domain/platform-admin.ts";
import type { TopvisorRegionOption } from "../contracts.ts";

const inputSchema = z.object({ search: z.string().trim().min(2).max(80) });

export async function searchTopvisorRegions(principal: PrincipalContext, rawInput: { search: string }): Promise<TopvisorRegionOption[]> {
  if (principal.kind !== "platform-admin") throw new ProjectRegistryAdminError("PROJECT_REGISTRY_ADMIN_ACCESS_DENIED");
  const input = inputSchema.parse(rawInput);
  const client = createTopvisorClient(readTopvisorEnvironment());
  const [yandex, google] = await Promise.all([
    client.searchRegions(input.search, "YANDEX"),
    client.searchRegions(input.search, "GOOGLE"),
  ]);
  const googleByName = new Map(google.map((item) => [`${item.countryCode}:${item.name.toLocaleLowerCase("ru-RU")}`, item]));
  return yandex.flatMap((item) => {
    const counterpart = googleByName.get(`${item.countryCode}:${item.name.toLocaleLowerCase("ru-RU")}`);
    return counterpart ? [{ name: item.name, countryCode: item.countryCode, parentName: item.parentName, yandexKey: item.key, googleKey: counterpart.key }] : [];
  }).slice(0, 20);
}
