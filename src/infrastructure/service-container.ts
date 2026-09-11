import "server-only";

import { ReliabilityService } from "../modules/platform-operations/index.ts";
import { PrismaReliabilityRepository } from "../modules/platform-operations/server.ts";

const reliabilityRepository = new PrismaReliabilityRepository();

const reliabilityService = new ReliabilityService(reliabilityRepository);

export function getReliabilityService() {
  return reliabilityService;
}
