import { z } from "zod";

const publicLeadsEnvironmentSchema = z.object({
  NEXT_PUBLIC_CONTACT_API_URL: z.string().trim().url().optional(),
  NEXT_PUBLIC_CONTACT_PROJECT_ID: z.string().trim().regex(/^[a-z0-9-]{3,64}$/).optional(),
  NEXT_PUBLIC_CONTACT_SITE_KEY: z.string().trim().min(16).max(128).optional(),
});

export interface PublicLeadsEnvironment {
  apiUrl: string;
  projectId: string;
  siteKey: string;
}

export function readPublicLeadsEnvironment(
  env: Record<string, string | undefined>,
): PublicLeadsEnvironment | null {
  const parsed = publicLeadsEnvironmentSchema.safeParse(env);
  if (!parsed.success) {
    return null;
  }
  const { NEXT_PUBLIC_CONTACT_API_URL, NEXT_PUBLIC_CONTACT_PROJECT_ID, NEXT_PUBLIC_CONTACT_SITE_KEY } = parsed.data;
  if (!NEXT_PUBLIC_CONTACT_API_URL || !NEXT_PUBLIC_CONTACT_PROJECT_ID || !NEXT_PUBLIC_CONTACT_SITE_KEY) {
    return null;
  }

  return {
    apiUrl: NEXT_PUBLIC_CONTACT_API_URL,
    projectId: NEXT_PUBLIC_CONTACT_PROJECT_ID,
    siteKey: NEXT_PUBLIC_CONTACT_SITE_KEY,
  };
}
