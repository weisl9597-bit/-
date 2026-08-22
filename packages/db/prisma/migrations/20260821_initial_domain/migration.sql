-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OrganizationLevel" AS ENUM ('NATIONAL', 'REGION', 'CITY');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'REGION_MANAGER', 'CITY_MANAGER');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('QUEUED', 'PROCESSING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "IssueSeverity" AS ENUM ('ERROR', 'WARNING');

-- CreateEnum
CREATE TYPE "PeriodGrain" AS ENUM ('DAY', 'WEEK', 'MONTH', 'CUSTOM');

-- CreateEnum
CREATE TYPE "MetricUnit" AS ENUM ('COUNT', 'RATE');

-- CreateEnum
CREATE TYPE "MetricDirection" AS ENUM ('POSITIVE', 'NEGATIVE', 'NEUTRAL');

-- CreateEnum
CREATE TYPE "MetricSource" AS ENUM ('CALCULATED', 'IMPORTED');

-- CreateEnum
CREATE TYPE "MerchantClassification" AS ENUM ('A', 'A_RISK', 'B', 'C_CANDIDATE', 'C', 'ELIMINATED');

-- CreateEnum
CREATE TYPE "RuleEntityType" AS ENUM ('PROJECT', 'MERCHANT');

-- CreateEnum
CREATE TYPE "RuleHitStatus" AS ENUM ('ACTIVE', 'RESOLVED', 'CONFIRMED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "MerchantOverrideType" AS ENUM ('CONFIRM_C', 'TEMP_EXEMPT', 'PERMANENT_EXCLUDE', 'MANUAL_CLASSIFICATION');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('IMPORT', 'METRICS', 'RULES');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "AuditEntityType" AS ENUM ('USER', 'UPLOAD_BATCH', 'MERCHANT', 'PROJECT', 'RULE_HIT');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "level" "OrganizationLevel" NOT NULL,
    "path" TEXT NOT NULL,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserScope" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserScope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Merchant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "facts" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Merchant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "sourceProjectId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'UNKNOWN',
    "followWithin30m" BOOLEAN,
    "needsAnalyzed" BOOLEAN,
    "hardInvite" BOOLEAN,
    "needsCoaching" BOOLEAN,
    "coached" BOOLEAN,
    "improved" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadBatch" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "objectKey" TEXT,
    "dataDate" DATE NOT NULL,
    "status" "UploadStatus" NOT NULL DEFAULT 'QUEUED',
    "uploadedById" TEXT,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "acceptedRows" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "failureStage" TEXT,
    "failureMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UploadBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadRow" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "sourceSheet" TEXT NOT NULL,
    "sourceRow" INTEGER NOT NULL,
    "raw" JSONB NOT NULL,
    "canonical" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UploadRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadError" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "sourceSheet" TEXT NOT NULL,
    "sourceRow" INTEGER,
    "field" TEXT,
    "code" TEXT NOT NULL,
    "severity" "IssueSeverity" NOT NULL,
    "message" TEXT NOT NULL,
    "rawValue" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UploadError_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectSnapshot" (
    "id" TEXT NOT NULL,
    "dataDate" DATE NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourceProjectId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "uploadBatchId" TEXT NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'UNKNOWN',
    "followWithin30m" BOOLEAN,
    "needsAnalyzed" BOOLEAN,
    "hardInvite" BOOLEAN,
    "sopCompliant" BOOLEAN NOT NULL DEFAULT false,
    "needsCoaching" BOOLEAN,
    "coached" BOOLEAN,
    "improved" BOOLEAN,
    "raw" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricDefinition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "groupName" TEXT NOT NULL,
    "unit" "MetricUnit" NOT NULL,
    "direction" "MetricDirection" NOT NULL,
    "source" "MetricSource" NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "formulaVersion" TEXT NOT NULL DEFAULT 'v1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetricDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricSnapshot" (
    "id" TEXT NOT NULL,
    "metricId" TEXT NOT NULL,
    "grain" "PeriodGrain" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "merchantId" TEXT,
    "dimensionKey" TEXT NOT NULL,
    "value" DECIMAL(18,4),
    "numerator" DECIMAL(18,4),
    "denominator" DECIMAL(18,4),
    "source" "MetricSource" NOT NULL,
    "sourceBatchId" TEXT NOT NULL,
    "formulaVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantClassificationSnapshot" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "dataDate" DATE NOT NULL,
    "classification" "MerchantClassification" NOT NULL,
    "suggested" "MerchantClassification" NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "ruleVersion" TEXT NOT NULL,
    "requiresConfirmation" BOOLEAN NOT NULL DEFAULT false,
    "confirmedById" TEXT,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MerchantClassificationSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleHit" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "entityType" "RuleEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "merchantId" TEXT,
    "projectId" TEXT,
    "dataDate" DATE NOT NULL,
    "status" "RuleHitStatus" NOT NULL DEFAULT 'ACTIVE',
    "evidence" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "sourceBatchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "RuleHit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantOverride" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "type" "MerchantOverrideType" NOT NULL,
    "classification" "MerchantClassification",
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MerchantOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" "AuditEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "reason" TEXT,
    "beforeValue" JSONB,
    "afterValue" JSONB,
    "metadata" JSONB DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "sourceBatchId" TEXT,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "lockedBy" TEXT,
    "lockedAt" TIMESTAMP(3),
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_code_key" ON "Organization"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_path_key" ON "Organization"("path");

-- CreateIndex
CREATE INDEX "Organization_parentId_idx" ON "Organization"("parentId");

-- CreateIndex
CREATE INDEX "Organization_level_idx" ON "Organization"("level");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "UserScope_organizationId_idx" ON "UserScope"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "UserScope_userId_organizationId_key" ON "UserScope"("userId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Merchant_organizationId_idx" ON "Merchant"("organizationId");

-- CreateIndex
CREATE INDEX "Merchant_name_idx" ON "Merchant"("name");

-- CreateIndex
CREATE INDEX "Project_merchantId_idx" ON "Project"("merchantId");

-- CreateIndex
CREATE INDEX "Project_sourceProjectId_idx" ON "Project"("sourceProjectId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_sourceProjectId_merchantId_key" ON "Project"("sourceProjectId", "merchantId");

-- CreateIndex
CREATE INDEX "Project_organizationId_idx" ON "Project"("organizationId");

-- CreateIndex
CREATE INDEX "Project_assignedAt_idx" ON "Project"("assignedAt");

-- CreateIndex
CREATE INDEX "UploadBatch_dataDate_status_idx" ON "UploadBatch"("dataDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "UploadBatch_fileHash_dataDate_key" ON "UploadBatch"("fileHash", "dataDate");

-- CreateIndex
CREATE UNIQUE INDEX "UploadRow_batchId_sourceSheet_sourceRow_key" ON "UploadRow"("batchId", "sourceSheet", "sourceRow");

-- CreateIndex
CREATE INDEX "UploadError_batchId_severity_idx" ON "UploadError"("batchId", "severity");

-- CreateIndex
CREATE INDEX "ProjectSnapshot_merchantId_dataDate_idx" ON "ProjectSnapshot"("merchantId", "dataDate");

-- CreateIndex
CREATE INDEX "ProjectSnapshot_sourceProjectId_dataDate_idx" ON "ProjectSnapshot"("sourceProjectId", "dataDate");

-- CreateIndex
CREATE INDEX "ProjectSnapshot_organizationId_dataDate_idx" ON "ProjectSnapshot"("organizationId", "dataDate");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectSnapshot_dataDate_projectId_key" ON "ProjectSnapshot"("dataDate", "projectId");

-- CreateIndex
CREATE INDEX "MetricDefinition_groupId_sortOrder_idx" ON "MetricDefinition"("groupId", "sortOrder");

-- CreateIndex
CREATE INDEX "MetricSnapshot_organizationId_periodStart_idx" ON "MetricSnapshot"("organizationId", "periodStart");

-- CreateIndex
CREATE INDEX "MetricSnapshot_merchantId_periodStart_idx" ON "MetricSnapshot"("merchantId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "MetricSnapshot_metricId_grain_periodStart_organizationId_di_key" ON "MetricSnapshot"("metricId", "grain", "periodStart", "organizationId", "dimensionKey", "sourceBatchId");

-- CreateIndex
CREATE INDEX "MerchantClassificationSnapshot_classification_dataDate_idx" ON "MerchantClassificationSnapshot"("classification", "dataDate");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantClassificationSnapshot_merchantId_dataDate_key" ON "MerchantClassificationSnapshot"("merchantId", "dataDate");

-- CreateIndex
CREATE INDEX "RuleHit_merchantId_dataDate_idx" ON "RuleHit"("merchantId", "dataDate");

-- CreateIndex
CREATE INDEX "RuleHit_projectId_dataDate_idx" ON "RuleHit"("projectId", "dataDate");

-- CreateIndex
CREATE UNIQUE INDEX "RuleHit_code_entityType_entityId_dataDate_version_key" ON "RuleHit"("code", "entityType", "entityId", "dataDate", "version");

-- CreateIndex
CREATE INDEX "MerchantOverride_merchantId_startDate_endDate_idx" ON "MerchantOverride"("merchantId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "Job_status_availableAt_idx" ON "Job"("status", "availableAt");

-- CreateIndex
CREATE UNIQUE INDEX "Job_type_sourceBatchId_key" ON "Job"("type", "sourceBatchId");

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserScope" ADD CONSTRAINT "UserScope_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserScope" ADD CONSTRAINT "UserScope_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Merchant" ADD CONSTRAINT "Merchant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadBatch" ADD CONSTRAINT "UploadBatch_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadRow" ADD CONSTRAINT "UploadRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "UploadBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadError" ADD CONSTRAINT "UploadError_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "UploadBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSnapshot" ADD CONSTRAINT "ProjectSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSnapshot" ADD CONSTRAINT "ProjectSnapshot_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSnapshot" ADD CONSTRAINT "ProjectSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSnapshot" ADD CONSTRAINT "ProjectSnapshot_uploadBatchId_fkey" FOREIGN KEY ("uploadBatchId") REFERENCES "UploadBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricSnapshot" ADD CONSTRAINT "MetricSnapshot_metricId_fkey" FOREIGN KEY ("metricId") REFERENCES "MetricDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricSnapshot" ADD CONSTRAINT "MetricSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricSnapshot" ADD CONSTRAINT "MetricSnapshot_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricSnapshot" ADD CONSTRAINT "MetricSnapshot_sourceBatchId_fkey" FOREIGN KEY ("sourceBatchId") REFERENCES "UploadBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantClassificationSnapshot" ADD CONSTRAINT "MerchantClassificationSnapshot_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantClassificationSnapshot" ADD CONSTRAINT "MerchantClassificationSnapshot_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleHit" ADD CONSTRAINT "RuleHit_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleHit" ADD CONSTRAINT "RuleHit_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleHit" ADD CONSTRAINT "RuleHit_sourceBatchId_fkey" FOREIGN KEY ("sourceBatchId") REFERENCES "UploadBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantOverride" ADD CONSTRAINT "MerchantOverride_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantOverride" ADD CONSTRAINT "MerchantOverride_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_sourceBatchId_fkey" FOREIGN KEY ("sourceBatchId") REFERENCES "UploadBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
