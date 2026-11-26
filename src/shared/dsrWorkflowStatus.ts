import type { DailyFuelSummary, DailyOperationsStatus, FinancialReconciliationStatus, OperationalDsrStatus } from './types';

/** Map existing authoritative fuel/stock completeness, independent of finance. */
export function operationalDsrStatus(status: DailyOperationsStatus): OperationalDsrStatus {
  return status === 'COMPLETE' ? 'COMPLETED' : status;
}

/** Committed finance requires saved reconciliation evidence AND a finalized shift.
 *  Open/closing shifts with evidence must be reviewed, not treated as successful.
 *  A closed shift without evidence (including an exceptional empty close) is not a
 *  financial completion. UNKNOWN never implies a zero collection or no record.
 */
export function financialShiftStatus(shiftStatus: string, hasEvidence: boolean | null, deferred?: 'PENDING' | 'COMPLETED' | 'REVIEW_REQUIRED'): FinancialReconciliationStatus {
  if (hasEvidence === null) return 'UNKNOWN';
  if (deferred) {
    if (shiftStatus !== 'CLOSED' || deferred === 'REVIEW_REQUIRED') return 'REVIEW_REQUIRED';
    return deferred === 'PENDING' ? (hasEvidence ? 'REVIEW_REQUIRED' : 'PENDING') : (hasEvidence ? 'COMPLETED' : 'REVIEW_REQUIRED');
  }
  if (shiftStatus === 'CLOSED' || shiftStatus === 'LOCKED') {
    return hasEvidence ? 'COMPLETED' : 'REVIEW_REQUIRED';
  }
  if (shiftStatus === 'CLOSING' || hasEvidence) return 'REVIEW_REQUIRED';
  return shiftStatus === 'OPEN' ? 'PENDING' : 'UNKNOWN';
}

export function financialDayStatus(statuses: readonly FinancialReconciliationStatus[]): FinancialReconciliationStatus {
  if (!statuses.length) return 'NOT_STARTED';
  if (statuses.includes('REVIEW_REQUIRED')) return 'REVIEW_REQUIRED';
  if (statuses.includes('UNKNOWN')) return 'UNKNOWN';
  return statuses.every(status => status === 'COMPLETED') ? 'COMPLETED' : 'PENDING';
}

/** Old Worker responses can still display operational data; never guess finance. */
export function getDsrWorkflowStatus(summary: DailyFuelSummary) {
  return {
    operational: summary.operationalDsrStatus ?? operationalDsrStatus(summary.status),
    financial: summary.financialReconciliationStatus ?? (summary.shiftsCount === 0 ? 'NOT_STARTED' : 'UNKNOWN'),
  };
}

export function dsrStatusLabel(status: OperationalDsrStatus | FinancialReconciliationStatus): string {
  return status === 'UNKNOWN' ? 'STATUS UNAVAILABLE' : status.replaceAll('_', ' ');
}
