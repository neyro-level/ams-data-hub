import {
  projectEditorialPublicDtoSchema,
  type ProjectEditorialPublicDto,
} from "../contracts.ts";
import type {
  StoredEntityEditorial,
  StoredEntityMediaOrderPolicy,
} from "./ports/entity-editorial-repository.ts";

function isPermutation(candidate: string[], source: string[]): boolean {
  return candidate.length === source.length
    && candidate.every((value) => source.includes(value));
}

export function mapProjectEditorialPublic(
  editorial: Pick<StoredEntityEditorial, "entityType" | "entityUid" | "shortDescription" | "description"
    | "faq" | "mediaOrder" | "mediaOrderPolicyVersion">,
  policy: Pick<StoredEntityMediaOrderPolicy, "sourceMediaOrder" | "isImageOrderChangeAllowed" | "version"> | null,
): ProjectEditorialPublicDto {
  const sourceMediaOrder = policy?.sourceMediaOrder ?? [];
  const manualOrderIsValid = Boolean(
    policy?.isImageOrderChangeAllowed
    && editorial.mediaOrder.length > 0
    && editorial.mediaOrderPolicyVersion === policy.version
    && isPermutation(editorial.mediaOrder, sourceMediaOrder),
  );
  return projectEditorialPublicDtoSchema.parse({
    entityType: editorial.entityType,
    entityUid: editorial.entityUid,
    shortDescription: editorial.shortDescription,
    description: editorial.description,
    faq: editorial.faq,
    mediaOrder: manualOrderIsValid ? editorial.mediaOrder : sourceMediaOrder,
    isImageOrderChangeAllowed: policy?.isImageOrderChangeAllowed ?? false,
  });
}
