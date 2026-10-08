-- Forward compatibility: automatic Source GOOD publication has an exact
-- committed binding/root/run but no standalone BUILD stage receipt.
CREATE OR REPLACE FUNCTION public.snapshot_rollback_approved_source(org TEXT, project TEXT, sequence INTEGER)
RETURNS TABLE ("sourceDeliveryRunId" TEXT,"rootBuildInputId" TEXT,"inputHash" TEXT,
  "manifestCanonical" TEXT,"manifestSha256" TEXT,"keyId" TEXT,"publishedAt" TIMESTAMPTZ)
LANGUAGE SQL STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT r.id,i.id,i."inputHash"::text,b."manifestCanonical",b."manifestSha256"::text,b."keyId"::text,r."publishedAt"
  FROM public."DeliveryRun" r
  JOIN public."SnapshotPublicationBinding" b ON (b."organizationId",b."projectId",b."publishSequence")=(r."organizationId",r."projectId",r."publishSequence")
  LEFT JOIN public."SnapshotArtifactStageReceipt" s ON (s."organizationId",s."projectId",s."buildInputId")=(b."organizationId",b."projectId",b."buildInputId")
  JOIN public."SnapshotBuildInput" i ON (i."organizationId",i."projectId",i.id)=(b."organizationId",b."projectId",b."buildInputId")
  WHERE public.snapshot_publication_scope(org,project) AND r."organizationId"=org AND r."projectId"=project AND r."publishSequence"=sequence
    AND r."manifestSha256"=b."manifestSha256" AND r."manifestKey"='snapshots/' || project || '/' || b."manifestSha256"
    AND r."publishedAt"=i."capturedAt" AND i."publishSequence"=sequence AND b."inputHash"=i."inputHash"
    AND (s."buildInputId" IS NULL OR (s."publishSequence"=sequence AND s."manifestSha256"=b."manifestSha256"
      AND s."inputHash"=i."inputHash" AND s."idempotencyKeyHash"=i."idempotencyKeyHash" AND (s."requestHash" IS NULL OR s."requestHash"=i."requestHash")))
  UNION ALL
  SELECT r.id,v."rootBuildInputId",v."inputHash"::text,b."manifestCanonical",b."manifestSha256"::text,b."keyId"::text,r."publishedAt"
  FROM public."DeliveryRun" r
  JOIN public."SnapshotRollbackBinding" b ON (b."organizationId",b."projectId",b."publishSequence")=(r."organizationId",r."projectId",r."publishSequence")
  JOIN public."SnapshotRollbackReservation" v ON (v."organizationId",v."projectId",v."requestId")=(b."organizationId",b."projectId",b."requestId")
  JOIN public."SnapshotBuildInput" i ON (i."organizationId",i."projectId",i.id)=(v."organizationId",v."projectId",v."rootBuildInputId")
  WHERE public.snapshot_publication_scope(org,project) AND r."organizationId"=org AND r."projectId"=project AND r."publishSequence"=sequence
    AND b."stagedAt" IS NOT NULL AND v."publishSequence"=sequence AND v."inputHash"=i."inputHash"
    AND r."manifestSha256"=b."manifestSha256" AND r."manifestKey"='snapshots/' || project || '/' || b."manifestSha256"
    AND r."publishedAt"=v."createdAt"
$$;
