import { createHash } from "node:crypto";
import type { PublicCoordinates, PublicCoordinatesInput } from "../contracts.ts";
import { SnapshotCompositionError } from "./snapshot-error.ts";

function validateCoordinates(latitude: number, longitude: number): void {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new SnapshotCompositionError("SNAPSHOT_COORDINATES_INVALID");
  }
}

function projectIntoCell(value: number, cellSize: number, selector: number, minimum: number, maximum: number): number {
  const bounded = value === maximum ? value - cellSize : value;
  const cellStart = Math.floor(bounded / cellSize) * cellSize;
  const position = 0.25 + (selector / 255) * 0.5;
  return Number(Math.min(maximum, Math.max(minimum, cellStart + cellSize * position)).toFixed(6));
}

export function projectPublicCoordinates(input: PublicCoordinatesInput): PublicCoordinates {
  validateCoordinates(input.latitude, input.longitude);
  if (!input.entityUid.trim() || !input.policyVersion.trim()) {
    throw new SnapshotCompositionError("SNAPSHOT_COORDINATES_INVALID");
  }
  if (input.precision === "EXACT") {
    return {
      latitude: input.latitude,
      longitude: input.longitude,
    };
  }

  const cellSize = input.precision === "STREET" ? 0.002 : 0.02;
  const digest = createHash("sha256")
    .update(`${input.entityUid}\0${input.policyVersion}\0${input.precision}`)
    .digest();
  return {
    latitude: projectIntoCell(input.latitude, cellSize, digest[0] ?? 0, -90, 90),
    longitude: projectIntoCell(input.longitude, cellSize, digest[1] ?? 0, -180, 180),
  };
}
