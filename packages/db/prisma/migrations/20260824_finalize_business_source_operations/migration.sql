-- Contract phase. This migration must deploy only after the expand release is
-- active on every web and worker container. The expand-release writers use the
-- new composite selectors while the rollout flag remains off, so they continue
-- working before and after these legacy indexes are removed.
DROP INDEX IF EXISTS "MetricSnapshot_metricId_grain_periodStart_organizationId_di_key";
DROP INDEX IF EXISTS "MerchantClassificationSnapshot_merchantId_dataDate_key";
DROP INDEX IF EXISTS "RuleHit_code_entityType_entityId_dataDate_version_key";
