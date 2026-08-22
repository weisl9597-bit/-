import {
  classifyMerchant,
  type ClassificationDecision,
  type MerchantClassificationInput,
} from './merchant-classification';
import {
  evaluateProjectAlerts,
  type ProjectAlert,
  type ProjectAlertInput,
} from './project-alerts';

export type RuleEvaluationRepository = {
  loadProjectFacts(input: { dataDate: string; batchId: string }): Promise<ProjectAlertInput[]>;
  loadMerchantInputs(input: { dataDate: string; batchId: string }): Promise<MerchantClassificationInput[]>;
  persist(input: {
    dataDate: string;
    batchId: string;
    hits: ProjectAlert[];
    decisions: ClassificationDecision[];
  }): Promise<void>;
};

export async function evaluateRules(
  dataDate: string,
  batchId: string,
  repository: RuleEvaluationRepository,
): Promise<{ projectAlertCount: number; merchantDecisionCount: number }> {
  const [projects, merchants] = await Promise.all([
    repository.loadProjectFacts({ dataDate, batchId }),
    repository.loadMerchantInputs({ dataDate, batchId }),
  ]);
  const hits = projects.flatMap(evaluateProjectAlerts);
  const decisions = merchants.map(classifyMerchant);
  await repository.persist({ dataDate, batchId, hits, decisions });
  return { projectAlertCount: hits.length, merchantDecisionCount: decisions.length };
}
