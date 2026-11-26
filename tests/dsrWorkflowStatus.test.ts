import { describe, expect, it } from 'vitest';
import type { DailyFuelSummary } from '../src/shared/types';
import { dsrStatusLabel, financialDayStatus, financialShiftStatus, getDsrWorkflowStatus, operationalDsrStatus } from '../src/shared/dsrWorkflowStatus';

describe('Independent operational DSR and financial reconciliation', () => {
  it('maps operational completion independently of financial status', () => {
    expect(operationalDsrStatus('COMPLETE')).toBe('COMPLETED');
    expect(getDsrWorkflowStatus({ status: 'COMPLETE', shiftsCount: 1, financialReconciliationStatus: 'PENDING' } as DailyFuelSummary))
      .toEqual({ operational: 'COMPLETED', financial: 'PENDING' });
    expect(operationalDsrStatus('IN_PROGRESS')).toBe('IN_PROGRESS');
    expect(operationalDsrStatus('BLOCKED')).toBe('BLOCKED');
  });

  it('only marks finance complete with saved evidence and a finalized shift', () => {
    expect(financialShiftStatus('OPEN', false)).toBe('PENDING');
    expect(financialShiftStatus('CLOSED', true)).toBe('COMPLETED');
    expect(financialShiftStatus('LOCKED', true)).toBe('COMPLETED');
    expect(financialShiftStatus('CLOSED', false)).toBe('REVIEW_REQUIRED');
    expect(financialShiftStatus('OPEN', true)).toBe('REVIEW_REQUIRED');
    expect(financialShiftStatus('CLOSING', true)).toBe('REVIEW_REQUIRED');
    expect(financialShiftStatus('CLOSING', false)).toBe('REVIEW_REQUIRED');
    expect(financialShiftStatus('OPEN', null)).toBe('UNKNOWN');
  });

  it('does not mark a multi-shift day complete when any shift remains pending or uncertain', () => {
    expect(financialDayStatus([])).toBe('NOT_STARTED');
    expect(financialDayStatus(['COMPLETED', 'COMPLETED'])).toBe('COMPLETED');
    expect(financialDayStatus(['COMPLETED', 'PENDING'])).toBe('PENDING');
    expect(financialDayStatus(['COMPLETED', 'UNKNOWN'])).toBe('UNKNOWN');
    expect(financialDayStatus(['PENDING', 'UNKNOWN', 'REVIEW_REQUIRED'])).toBe('REVIEW_REQUIRED');
  });

  it('preserves old Worker compatibility without inferring finance evidence', () => {
    expect(getDsrWorkflowStatus({ status: 'COMPLETE', shiftsCount: 1 } as DailyFuelSummary))
      .toEqual({ operational: 'COMPLETED', financial: 'UNKNOWN' });
    expect(getDsrWorkflowStatus({ status: 'NOT_STARTED', shiftsCount: 0 } as DailyFuelSummary))
      .toEqual({ operational: 'NOT_STARTED', financial: 'NOT_STARTED' });
    expect(dsrStatusLabel('UNKNOWN')).toBe('STATUS UNAVAILABLE');
  });
});
