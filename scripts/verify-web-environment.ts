import { readPublicLeadsEnvironment } from "../src/shared/config/public-leads-environment.ts";
import {
  readAuthEnvironment,
  readDatabaseEnvironment,
} from "../src/platform/config/server-environment.ts";
import { inspectDatabaseTarget } from "../src/platform/config/database-target.ts";

readDatabaseEnvironment(process.env);
inspectDatabaseTarget(process.env);
const authEnvironment = readAuthEnvironment(process.env);
if (!authEnvironment) {
  throw new Error("Better Auth environment is required for web runtime");
}
readPublicLeadsEnvironment({
  NEXT_PUBLIC_LEADS_API_URL: process.env.NEXT_PUBLIC_LEADS_API_URL,
  NEXT_PUBLIC_LEADS_PROJECT_ID: process.env.NEXT_PUBLIC_LEADS_PROJECT_ID,
  NEXT_PUBLIC_LEADS_SITE_KEY: process.env.NEXT_PUBLIC_LEADS_SITE_KEY,
});

process.stdout.write("web_environment=valid\n");
