import { NextResponse } from "next/server";
import { z } from "zod";
import { correlationIdSchema } from "./correlation.ts";

export const publicErrorEnvelopeSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/),
    message: z.string().min(1).max(500),
    fieldErrors: z.record(z.string(), z.array(z.string())).default({}),
    correlationId: correlationIdSchema,
  }),
});

export type PublicErrorEnvelope = z.infer<typeof publicErrorEnvelopeSchema>;

export interface PublicErrorInput {
  code: string;
  message: string;
  correlationId: string;
  fieldErrors?: Record<string, string[]>;
}

export function createPublicErrorEnvelope(input: PublicErrorInput): PublicErrorEnvelope {
  return publicErrorEnvelopeSchema.parse({
    ok: false,
    error: {
      code: input.code,
      message: input.message,
      fieldErrors: input.fieldErrors ?? {},
      correlationId: input.correlationId,
    },
  });
}

export function createPublicErrorResponse(input: PublicErrorInput, status: number) {
  return NextResponse.json(createPublicErrorEnvelope(input), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Correlation-ID": input.correlationId,
    },
  });
}
