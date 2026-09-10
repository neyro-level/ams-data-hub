import { SyncService } from "../modules/data-ingestion/index.ts";
import {
  PinoSyncLogger,
  PrismaSyncRepository,
} from "../modules/data-ingestion/server.ts";
import { ReliabilityService } from "../modules/platform-operations/index.ts";
import { PrismaReliabilityRepository } from "../modules/platform-operations/server.ts";
import {
  MonitoringService,
  ProjectService,
} from "../modules/project-registry/index.ts";
import {
  PrismaMonitoringRepository,
  PrismaProjectRepository,
} from "../modules/project-registry/worker.ts";
import { ReportService } from "../modules/reporting/index.ts";
import { PrismaReportRepository } from "../modules/reporting/server.ts";

const projectRepository = new PrismaProjectRepository();
const monitoringRepository = new PrismaMonitoringRepository();
const reportRepository = new PrismaReportRepository();
const syncRepository = new PrismaSyncRepository();
const reliabilityRepository = new PrismaReliabilityRepository();

const projectService = new ProjectService(projectRepository);
const monitoringService = new MonitoringService(monitoringRepository);
const reportService = new ReportService(projectService, reportRepository);
const reliabilityService = new ReliabilityService(reliabilityRepository);
const syncService = new SyncService({
  monitoringService,
  projectService,
  reportService,
  syncRepository,
  logger: new PinoSyncLogger(),
});

export function getWorkerSyncService() {
  return syncService;
}

export function getWorkerMonitoringService() {
  return monitoringService;
}

export function getWorkerReliabilityService() {
  return reliabilityService;
}
