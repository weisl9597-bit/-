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

ALTER TABLE "ProjectSnapshot" ALTER COLUMN "businessSource" SET NOT NULL;
ALTER TABLE "ProjectSnapshot" ALTER COLUMN "assignedAt" SET NOT NULL;
ALTER TABLE "MetricSnapshot" ALTER COLUMN "businessSource" SET NOT NULL;
ALTER TABLE "MerchantClassificationSnapshot" ALTER COLUMN "businessSource" SET NOT NULL;
ALTER TABLE "RuleHit" ALTER COLUMN "businessSource" SET NOT NULL;

-- Rebuild uniqueness and lookup indexes with business source included.
DROP INDEX "MetricSnapshot_metricId_grain_periodStart_organizationId_di_key";
CREATE UNIQUE INDEX "MetricSnapshot_source_dimension_batch_key"
  ON "MetricSnapshot"(
    "metricId", "grain", "periodStart", "organizationId", "dimensionKey",
    "businessSource", "sourceBatchId"
  );

DROP INDEX "MerchantClassificationSnapshot_merchantId_dataDate_key";
CREATE UNIQUE INDEX "MerchantClassificationSnapshot_merchant_date_source_key"
  ON "MerchantClassificationSnapshot"("merchantId", "dataDate", "businessSource");

DROP INDEX "RuleHit_code_entityType_entityId_dataDate_version_key";
CREATE UNIQUE INDEX "RuleHit_entity_date_version_source_key"
  ON "RuleHit"(
    "code", "entityType", "entityId", "dataDate", "version", "businessSource"
  );

CREATE INDEX "ProjectSnapshot_businessSource_organizationId_dataDate_idx"
  ON "ProjectSnapshot"("businessSource", "organizationId", "dataDate");
CREATE INDEX "MetricSnapshot_businessSource_organizationId_periodStart_idx"
  ON "MetricSnapshot"("businessSource", "organizationId", "periodStart");
CREATE INDEX "MerchantClassificationSnapshot_businessSource_classification_dataDate_idx"
  ON "MerchantClassificationSnapshot"("businessSource", "classification", "dataDate");
CREATE INDEX "MerchantOverride_merchantId_businessSource_startDate_endDate_idx"
  ON "MerchantOverride"("merchantId", "businessSource", "startDate", "endDate");

