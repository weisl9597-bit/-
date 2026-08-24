-- CreateEnum
CREATE TYPE "BusinessSource" AS ENUM ('DESIGNBAO', 'XIAOHONGSHU', 'OTHER', 'ALL');

-- Add source-aware columns as nullable so existing production rows can be backfilled safely.
ALTER TABLE "ProjectSnapshot" ADD COLUMN "businessSource" "BusinessSource";
ALTER TABLE "ProjectSnapshot" ADD COLUMN "assignedAt" TIMESTAMP(3);
ALTER TABLE "MetricSnapshot" ADD COLUMN "businessSource" "BusinessSource";
ALTER TABLE "MerchantClassificationSnapshot" ADD COLUMN "businessSource" "BusinessSource";
ALTER TABLE "MerchantClassificationSnapshot" ADD COLUMN "dataAvailable" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "MerchantClassificationSnapshot" ALTER COLUMN "classification" DROP NOT NULL;
ALTER TABLE "MerchantClassificationSnapshot" ALTER COLUMN "suggested" DROP NOT NULL;
ALTER TABLE "RuleHit" ADD COLUMN "businessSource" "BusinessSource";
ALTER TABLE "MerchantOverride" ADD COLUMN "businessSource" "BusinessSource";

-- Backfill immutable project facts from the snapshot raw source and its current project assignment.
UPDATE "ProjectSnapshot" AS snapshot
SET
  "businessSource" = CASE trim(COALESCE(snapshot."raw"->>'F', ''))
    WHEN '设计宝' THEN 'DESIGNBAO'::"BusinessSource"
    WHEN '小红书' THEN 'XIAOHONGSHU'::"BusinessSource"
    ELSE 'OTHER'::"BusinessSource"
  END,
  "assignedAt" = project."assignedAt"
FROM "Project" AS project
WHERE project."id" = snapshot."projectId";

UPDATE "MetricSnapshot"
SET "businessSource" = CASE
  WHEN "dimensionKey" LIKE 'source:DESIGNBAO|%' THEN 'DESIGNBAO'::"BusinessSource"
  WHEN "dimensionKey" LIKE 'source:XIAOHONGSHU|%' THEN 'XIAOHONGSHU'::"BusinessSource"
  ELSE 'OTHER'::"BusinessSource"
END;

UPDATE "MerchantClassificationSnapshot"
SET "businessSource" = 'ALL'::"BusinessSource";

UPDATE "MerchantOverride"
SET "businessSource" = CASE
  WHEN "type" = 'PERMANENT_EXCLUDE' THEN NULL
  ELSE 'ALL'::"BusinessSource"
END;

UPDATE "RuleHit" AS hit
SET "businessSource" = COALESCE(
  (
    SELECT snapshot."businessSource"
    FROM "ProjectSnapshot" AS snapshot
    WHERE snapshot."projectId" = hit."projectId"
      AND snapshot."dataDate" = hit."dataDate"
    ORDER BY snapshot."createdAt" DESC
    LIMIT 1
  ),
  'OTHER'::"BusinessSource"
);

-- Abort instead of silently accepting an incomplete backfill.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "ProjectSnapshot"
    WHERE "businessSource" IS NULL OR "assignedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'ProjectSnapshot source backfill is incomplete';
  END IF;
  IF EXISTS (SELECT 1 FROM "MetricSnapshot" WHERE "businessSource" IS NULL) THEN
    RAISE EXCEPTION 'MetricSnapshot source backfill is incomplete';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "MerchantClassificationSnapshot" WHERE "businessSource" IS NULL
  ) THEN
    RAISE EXCEPTION 'MerchantClassificationSnapshot source backfill is incomplete';
  END IF;
  IF EXISTS (SELECT 1 FROM "RuleHit" WHERE "businessSource" IS NULL) THEN
    RAISE EXCEPTION 'RuleHit source backfill is incomplete';
  END IF;
END $$;

-- Railway deploys migrations before every old container has stopped. Keep the
-- pre-source-aware writers compatible during that rolling window: project
-- snapshots derive their immutable facts, while records without source context
-- receive the same neutral source used by the backfill above.
CREATE FUNCTION "fill_legacy_project_snapshot_source"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  project_assigned_at TIMESTAMP(3);
BEGIN
  IF NEW."businessSource" IS NULL THEN
    NEW."businessSource" := CASE trim(COALESCE(NEW."raw"->>'F', ''))
      WHEN '设计宝' THEN 'DESIGNBAO'::"BusinessSource"
      WHEN '小红书' THEN 'XIAOHONGSHU'::"BusinessSource"
      ELSE 'OTHER'::"BusinessSource"
    END;
  END IF;

  IF NEW."assignedAt" IS NULL THEN
    SELECT project."assignedAt"
    INTO project_assigned_at
    FROM "Project" AS project
    WHERE project."id" = NEW."projectId";
    NEW."assignedAt" := project_assigned_at;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "ProjectSnapshot_legacy_writer_defaults"
BEFORE INSERT ON "ProjectSnapshot"
FOR EACH ROW
EXECUTE FUNCTION "fill_legacy_project_snapshot_source"();

ALTER TABLE "MetricSnapshot"
  ALTER COLUMN "businessSource" SET DEFAULT 'OTHER';
ALTER TABLE "MerchantClassificationSnapshot"
  ALTER COLUMN "businessSource" SET DEFAULT 'ALL';
ALTER TABLE "RuleHit"
  ALTER COLUMN "businessSource" SET DEFAULT 'OTHER';

ALTER TABLE "ProjectSnapshot" ALTER COLUMN "businessSource" SET NOT NULL;
ALTER TABLE "ProjectSnapshot" ALTER COLUMN "assignedAt" SET NOT NULL;
ALTER TABLE "MetricSnapshot" ALTER COLUMN "businessSource" SET NOT NULL;
ALTER TABLE "MerchantClassificationSnapshot" ALTER COLUMN "businessSource" SET NOT NULL;
ALTER TABLE "RuleHit" ALTER COLUMN "businessSource" SET NOT NULL;

ALTER TABLE "ProjectSnapshot"
  ADD CONSTRAINT "ProjectSnapshot_actual_business_source_check"
  CHECK ("businessSource" <> 'ALL'::"BusinessSource");
ALTER TABLE "MetricSnapshot"
  ADD CONSTRAINT "MetricSnapshot_actual_business_source_check"
  CHECK ("businessSource" <> 'ALL'::"BusinessSource");
ALTER TABLE "RuleHit"
  ADD CONSTRAINT "RuleHit_actual_business_source_check"
  CHECK ("businessSource" <> 'ALL'::"BusinessSource");
ALTER TABLE "MerchantClassificationSnapshot"
  ADD CONSTRAINT "MerchantClassificationSnapshot_data_availability_check"
  CHECK (
    ("dataAvailable" = true AND "classification" IS NOT NULL AND "suggested" IS NOT NULL)
    OR ("dataAvailable" = false AND "classification" IS NULL AND "suggested" IS NULL)
  );

-- Expand phase: add the source-aware identities without removing the legacy
-- identities. The legacy indexes are removed only by the separately deployed
-- contract migration after all old Railway containers have drained.
CREATE UNIQUE INDEX "MetricSnapshot_source_dimension_batch_key"
  ON "MetricSnapshot"(
    "metricId", "grain", "periodStart", "organizationId", "dimensionKey",
    "businessSource", "sourceBatchId"
  );

CREATE UNIQUE INDEX "MerchantClassificationSnapshot_merchant_date_source_key"
  ON "MerchantClassificationSnapshot"("merchantId", "dataDate", "businessSource");

CREATE UNIQUE INDEX "RuleHit_entity_date_version_source_key"
  ON "RuleHit"(
    "code", "entityType", "entityId", "dataDate", "version", "businessSource",
    "sourceBatchId"
  );

CREATE INDEX "ProjectSnapshot_businessSource_organizationId_dataDate_idx"
  ON "ProjectSnapshot"("businessSource", "organizationId", "dataDate");
CREATE INDEX "MetricSnapshot_businessSource_organizationId_periodStart_idx"
  ON "MetricSnapshot"("businessSource", "organizationId", "periodStart");
CREATE INDEX "MerchantClassificationSnapshot_businessSource_classification_dataDate_idx"
  ON "MerchantClassificationSnapshot"("businessSource", "classification", "dataDate");
CREATE INDEX "MerchantOverride_merchantId_businessSource_startDate_endDate_idx"
  ON "MerchantOverride"("merchantId", "businessSource", "startDate", "endDate");
