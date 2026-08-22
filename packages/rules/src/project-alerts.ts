import { projectAlertReason } from './reasons';

export type ProjectAlertInput = {
  projectId: string;
  merchantId: string;
  needsCoaching: boolean | null;
  coached: boolean | null;
  improved: boolean | null;
};

export type ProjectAlert = {
  code: 'NEEDS_COACHING' | 'NOT_IMPROVED' | 'COACHING_BLANK';
  projectId: string;
  merchantId: string;
  ruleVersion: 'v1';
  reason: string;
  evidence: Record<string, boolean | null>;
};

export function evaluateProjectAlerts(input: ProjectAlertInput): ProjectAlert[] {
  const matches: Array<{ code: ProjectAlert['code']; evidence: Record<string, boolean | null> }> = [];
  if (input.needsCoaching === true) {
    matches.push({ code: 'NEEDS_COACHING', evidence: { needsCoaching: input.needsCoaching } });
  }
  if (input.improved === false) {
    matches.push({ code: 'NOT_IMPROVED', evidence: { improved: input.improved } });
  }
  if (input.coached === null) {
    matches.push({ code: 'COACHING_BLANK', evidence: { coached: input.coached } });
  }
  return matches.map(({ code, evidence }) => ({
    code,
    projectId: input.projectId,
    merchantId: input.merchantId,
    ruleVersion: 'v1',
    reason: projectAlertReason(code),
    evidence,
  }));
}
