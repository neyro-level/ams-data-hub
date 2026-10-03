import "server-only";

import { REDACTED_VALUE, rememberSensitiveValue } from "./sensitive-redaction.ts";

const ENVIRONMENT_NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/;

declare const secretValueBrand: unique symbol;

export type SecretValue = string & { readonly [secretValueBrand]: true };

export interface SecretRef {
  readonly kind: "environment";
  readonly name: string;
  toJSON(): "[SECRET_REF]";
  toString(): "[SECRET_REF]";
}

export interface SecretRefStatusDto {
  configured: boolean;
  displayValue: typeof REDACTED_VALUE;
}

type EnvironmentSource = Readonly<Record<string, string | undefined>>;

export function defineSecretRef(name: string): SecretRef {
  if (!ENVIRONMENT_NAME_PATTERN.test(name)) {
    throw new Error("SecretRef must use an uppercase environment variable name");
  }

  return Object.freeze({
    kind: "environment" as const,
    name,
    toJSON: () => "[SECRET_REF]" as const,
    toString: () => "[SECRET_REF]" as const,
  });
}

export function resolveSecretRef(
  reference: SecretRef,
  env: EnvironmentSource = process.env,
): SecretValue {
  const value = env[reference.name];
  if (value === undefined || value.length === 0) {
    throw new Error(`Required secret reference ${reference.name} is not configured`);
  }

  rememberSensitiveValue(value);
  return value as SecretValue;
}

export function createSecretRefStatus(
  reference: SecretRef,
  env: EnvironmentSource = process.env,
): SecretRefStatusDto {
  const value = env[reference.name];
  return {
    configured: value !== undefined && value.length > 0,
    displayValue: REDACTED_VALUE,
  };
}
