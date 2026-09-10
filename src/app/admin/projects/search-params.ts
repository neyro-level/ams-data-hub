import {
  createLoader,
  createSerializer,
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
} from "nuqs/server";
import { PROJECT_STATUSES } from "../../../modules/project-registry/contracts.ts";

export const projectSearchParams = {
  page: parseAsInteger.withDefault(1),
  search: parseAsString.withDefault(""),
  status: parseAsStringLiteral(PROJECT_STATUSES),
  sort: parseAsStringLiteral(["name", "status", "updatedAt"] as const).withDefault(
    "updatedAt",
  ),
  direction: parseAsStringLiteral(["asc", "desc"] as const).withDefault("desc"),
};

export const loadProjectSearchParams = createLoader(projectSearchParams);
export const serializeProjectSearchParams = createSerializer(projectSearchParams);
