import {
  parseWorkbook,
  type ParsedProjectRow,
} from '@designbao/importer/parse-workbook';
import {
  validateBatch,
  type CanonicalProjectRow,
  type ImportIssue,
} from '@designbao/importer/validate-batch';

export type ImportBatchStatus = 'QUEUED' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED';

export type ImportBatchRecord = {
  id: string;
  status: ImportBatchStatus;
  objectKey: string;
  dataDate: string;
  totalRows: number;
  acceptedRows: number;
  errorCount: number;
  warningCount: number;
};

export type PersistFailedBatchInput = {
  batchId: string;
  totalRows: number;
  rawRows: ParsedProjectRow[];
  errors: ImportIssue[];
  warnings: ImportIssue[];
};

export type PersistSuccessfulBatchInput = {
  batchId: string;
  dataDate: string;
  totalRows: number;
  rawRows: ParsedProjectRow[];
  records: CanonicalProjectRow[];
  warnings: ImportIssue[];
};

export type ImportBatchRepository = {
  getBatch(batchId: string): Promise<ImportBatchRecord | null>;
  markProcessing(batchId: string): Promise<void>;
  persistFailed(input: PersistFailedBatchInput): Promise<void>;
  persistSuccessful(input: PersistSuccessfulBatchInput): Promise<void>;
};

export type ImportObjectStore = {
  getObject(objectKey: string): Promise<Buffer | null>;
};

export type ImportBatchDependencies = {
  repository: ImportBatchRepository;
  storage: ImportObjectStore;
};

export type ImportBatchResult = {
  batchId: string;
  status: 'SUCCEEDED' | 'FAILED';
  acceptedRows: number;
  errorCount: number;
  warningCount: number;
};

export async function processImportBatch(
  batchId: string,
  dependencies: ImportBatchDependencies,
): Promise<ImportBatchResult> {
  const batch = await dependencies.repository.getBatch(batchId);
  if (!batch) throw new Error(`Import batch not found: ${batchId}`);
  await dependencies.repository.markProcessing(batchId);
  const buffer = await dependencies.storage.getObject(batch.objectKey);
  if (!buffer) throw new Error(`Import object not found: ${batch.objectKey}`);
  const parsed = await parseWorkbook(buffer);
  const validation = validateBatch(parsed);

  if (validation.errors.length > 0) {
    await dependencies.repository.persistFailed({
      batchId,
      totalRows: parsed.projects.length,
      rawRows: parsed.projects,
      errors: validation.errors,
      warnings: validation.warnings,
    });
    return {
      batchId,
      status: 'FAILED',
      acceptedRows: 0,
      errorCount: validation.errors.length,
      warningCount: validation.warnings.length,
    };
  }

  await dependencies.repository.persistSuccessful({
    batchId,
    dataDate: batch.dataDate,
    totalRows: parsed.projects.length,
    rawRows: parsed.projects,
    records: validation.records,
    warnings: validation.warnings,
  });
  return {
    batchId,
    status: 'SUCCEEDED',
    acceptedRows: validation.records.length,
    errorCount: 0,
    warningCount: validation.warnings.length,
  };
}
