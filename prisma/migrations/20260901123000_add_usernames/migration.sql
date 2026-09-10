-- Add optional Better Auth username field.
ALTER TABLE "User" ADD COLUMN "username" TEXT;

-- Existing users receive deterministic, normalized usernames derived from the
-- local part of their current email. Hash suffixes avoid collisions without
-- exposing the full email address.
WITH normalized AS (
  SELECT
    "id",
    CASE
      WHEN length(trim(BOTH '_' FROM regexp_replace(lower(split_part("email", '@', 1)), '[^a-z0-9_]+', '_', 'g'))) >= 3
        THEN left(trim(BOTH '_' FROM regexp_replace(lower(split_part("email", '@', 1)), '[^a-z0-9_]+', '_', 'g')), 30)
      ELSE 'user_' || substr(md5("id"), 1, 12)
    END AS base_username
  FROM "User"
), ranked AS (
  SELECT
    "id",
    base_username,
    count(*) OVER (PARTITION BY base_username) AS duplicate_count
  FROM normalized
)
UPDATE "User" AS target
SET "username" = CASE
  WHEN ranked.duplicate_count = 1 THEN ranked.base_username
  ELSE left(ranked.base_username, 24) || '_' || substr(md5(ranked."id"), 1, 5)
END
FROM ranked
WHERE target."id" = ranked."id";

CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
