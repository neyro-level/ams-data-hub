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
process.stdout.write("web_environment=valid\n");
