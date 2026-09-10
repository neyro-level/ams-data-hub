import { randomUUID } from "node:crypto";
import { z } from "zod";

export const correlationIdSchema = z.string().uuid();

export function createCorrelationId(): string {
  return randomUUID();
}
