import "server-only";

import { headers } from "next/headers";
import {
  createIdentityDatabaseAuthorizationContext,
  runInAuthorizedDatabaseTransaction,
} from "../database/transaction.ts";
import {
  getPrincipalResolutionByUserId,
  type PrincipalState,
} from "../authorization/principal-factories.ts";
import { getAuth } from "./auth.ts";
import { createCorrelationId } from "../http/correlation.ts";

export type CabinetPrincipalErrorCode =
  | "AUTHENTICATION_REQUIRED"
  | "CABINET_USER_INACTIVE";

export class CabinetPrincipalError extends Error {
  constructor(readonly code: CabinetPrincipalErrorCode) {
    super(code);
    this.name = "CabinetPrincipalError";
  }
}

async function getFreshPrincipalState(): Promise<{
  state: PrincipalState | null;
  disabled: boolean;
  organizationChoices: Array<{ id: string; name: string }>;
} | null> {
  const auth = getAuth();
  if (!auth) return null;
  const requestHeaders = await headers();
  const session = await auth.api.getSession({
    headers: requestHeaders,
    query: { disableCookieCache: true },
  });
  if (!session) return null;

  const correlationId = createCorrelationId();
  const persistedSession = await runInAuthorizedDatabaseTransaction(
    createIdentityDatabaseAuthorizationContext({ userId: session.user.id, correlationId }),
    (transaction) => transaction.session.findUnique({
      where: { id: session.session.id },
      select: {
        userId: true,
        expiresAt: true,
        activeOrganizationId: true,
        user: { select: { disabledAt: true } },
      },
    }),
  );
  if (
    !persistedSession ||
    persistedSession.userId !== session.user.id ||
    persistedSession.expiresAt <= new Date()
  ) {
    return null;
  }

  const resolution = await getPrincipalResolutionByUserId(session.user.id, {
    correlationId,
    selectedOrganizationId: persistedSession.activeOrganizationId,
  });
  if (
    resolution.autoSelectedOrganizationId
    && resolution.autoSelectedOrganizationId !== persistedSession.activeOrganizationId
  ) {
    await runInAuthorizedDatabaseTransaction(
      createIdentityDatabaseAuthorizationContext({ userId: session.user.id, correlationId }),
      (transaction) => transaction.session.updateMany({
        where: { id: session.session.id, userId: session.user.id },
        data: { activeOrganizationId: resolution.autoSelectedOrganizationId },
      }),
    );
  }
  return {
    state: resolution.state,
    disabled: persistedSession.user.disabledAt !== null,
    organizationChoices: resolution.organizationChoices,
  };
}

export async function getCurrentPrincipalState(): Promise<PrincipalState | null> {
  return (await getFreshPrincipalState())?.state ?? null;
}

export async function setCurrentActiveOrganization(organizationId: string): Promise<void> {
  const auth = getAuth();
  if (!auth) throw new CabinetPrincipalError("AUTHENTICATION_REQUIRED");
  const normalizedOrganizationId = organizationId.trim();
  if (!normalizedOrganizationId) throw new CabinetPrincipalError("CABINET_USER_INACTIVE");
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders, query: { disableCookieCache: true } });
  if (!session) throw new CabinetPrincipalError("AUTHENTICATION_REQUIRED");
  await runInAuthorizedDatabaseTransaction(
    createIdentityDatabaseAuthorizationContext({
      userId: session.user.id,
      correlationId: createCorrelationId(),
    }),
    async (transaction) => {
      const [persistedSession, membership] = await Promise.all([
        transaction.session.findUnique({ where: { id: session.session.id }, select: { userId: true, expiresAt: true } }),
        transaction.member.findUnique({ where: { organizationId_userId: { organizationId: normalizedOrganizationId, userId: session.user.id } }, select: { id: true } }),
      ]);
      if (!persistedSession || persistedSession.userId !== session.user.id || persistedSession.expiresAt <= new Date() || !membership) {
        throw new CabinetPrincipalError("CABINET_USER_INACTIVE");
      }
      await transaction.session.update({ where: { id: session.session.id }, data: { activeOrganizationId: normalizedOrganizationId } });
    },
  );
}

export async function getCurrentOrganizationSelection() {
  const result = await getFreshPrincipalState();
  if (!result) return null;
  return {
    disabled: result.disabled,
    hasPrincipal: result.state !== null,
    organizations: result.organizationChoices,
  };
}

export function requireCabinetPrincipalFromState(state: PrincipalState) {
  return state.principal;
}

export async function requireCurrentCabinetPrincipal() {
  const result = await getFreshPrincipalState();
  if (!result) throw new CabinetPrincipalError("AUTHENTICATION_REQUIRED");
  if (result.disabled || !result.state) throw new CabinetPrincipalError("CABINET_USER_INACTIVE");
  return requireCabinetPrincipalFromState(result.state);
}

export async function getCurrentCabinetRedirect(): Promise<string | null> {
  const result = await getFreshPrincipalState();
  if (!result || result.disabled) return "/?login=1";
  if (!result.state && result.organizationChoices.length > 1) return "/organization/";
  if (!result.state) return "/?login=1";
  return null;
}
