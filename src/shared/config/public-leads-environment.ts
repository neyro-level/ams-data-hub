import { z } from "zod";

const publicLeadsEnvironmentSchema = z.object({
  NEXT_PUBLIC_LEADS_API_URL: z.literal("https://ams24.ru/api/leads"),
  NEXT_PUBLIC_LEADS_PROJECT_ID: z.string().trim().regex(/^[a-z0-9-]{3,64}$/),
  NEXT_PUBLIC_LEADS_SITE_KEY: z.string().trim().min(16).max(128),
});

export interface PublicLeadsEnvironment {
  apiUrl: "https://ams24.ru/api/leads";
  projectId: string;
  siteKey: string;
}

export function readPublicLeadsEnvironment(
  env: Record<string, string | undefined>,
): PublicLeadsEnvironment {
  const parsed = publicLeadsEnvironmentSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error("Отправка заявок временно не настроена.");
  }

  return {
    apiUrl: parsed.data.NEXT_PUBLIC_LEADS_API_URL,
    projectId: parsed.data.NEXT_PUBLIC_LEADS_PROJECT_ID,
    siteKey: parsed.data.NEXT_PUBLIC_LEADS_SITE_KEY,
  };
}
