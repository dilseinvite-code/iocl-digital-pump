import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

describe('Phase 2 Modern Enterprise Light: Daily Operations & DSR', () => {
  const source = fs.readFileSync('src/frontend/pages/DailyOperationsPage.tsx', 'utf8');
  const styling = fs.readFileSync('src/frontend/pages/dailyOperationsModern.css', 'utf8');

  it('adds the scoped enterprise-light workspace styling and accessible tables', () => {
    expect(source).toContain("import './dailyOperationsModern.css'");
    expect(source).toContain('className="daily-ops-modern daily-command pb-12"');
    expect((source.match(/daily-ops-data-table w-full text-left border-collapse/g) || []).length).toBe(5);
    expect((source.match(/aria-label="Scrollable operations table"/g) || []).length).toBe(5);
    expect(styling).toContain('.daily-ops-modern .daily-ops-data-table');
    expect(styling).toContain('position: sticky;');
    expect(styling).toContain('min-height: 42px;');
  });

  it('provides descriptive completion indicators without creating workflow gates', () => {
    expect(source).toContain('aria-label="Daily operations progress"');
    expect(source).toContain('summary.completion.openingTankReadings');
    expect(source).toContain('summary.completion.nozzleMeterReadings + summary.completion.unavailableNozzles');
    expect(source).toContain('summary.completion.pendingReceipts === 0');
    expect(source).toContain('summary.completion.reconciliationComplete');
    expect(source).toContain('not a required step sequence');
  });

  it('extends the approved command centre without changing data entry or scope authority', () => {
    expect(source).toContain('outletHierarchy(selectedOutlet)');
    expect(source).toContain('selectedOutlet?.id===selectedOutletId');
    expect(source).toContain('Daily figures apply only to the selected retail outlet.');
    expect(source).toContain('hasPermission(PERMISSIONS.SHIFTS_OPEN)');
    expect(source).toContain('canOpenShift && bootstrap && bootstrap.shiftTemplates.length > 0');
    expect(source).toContain('className="dc-shift-notes"');
    expect(source).toContain('value={newShiftNotes}');
    expect(source).toContain('{isGlobalAdmin && <details className="dc-admin-tools">');
    expect(source).toContain('aria-label="Independent DSR and financial reconciliation"');
    expect(source).toContain('aria-label="Attention centre"');
    expect(source).toContain('summary.completion.expectedTanks ?');
    for(const cls of ['dc-status-card','dc-progress-tile','dc-task-tile','dc-context-controls'])expect(styling).toContain(cls);
  });

  it('keeps all missing-data warning details available and collapsible', () => {
    expect(source).toContain('<details open className="group rounded-xl');
    expect(source).toContain('summary.missingFields.map((mf, i)');
    expect(source).toContain('TANK CALIBRATION REQUIRED');
  });

  it('preserves shift actions, DSR rendering, and existing service integration', () => {
    for (const required of [
      'handleOpenShift', 'handleCloseShift', 'handleAdminEmptyClose',
      'handleSaveAllTanks', 'handleSaveAllNozzles', 'handleRecordUnavailability',
      'handleComputeReconciliation', 'fetchDailyOperationsBootstrap',
      'fetchDailyFuelSummary', 'saveMeterReadingsBatch', 'saveTankReadingsBatch',
      'DailyOperationsTestDataResetPanel', 'data-testid="dsr-summary-view"',
      'data-testid="admin-close-empty-shift-btn"',
    ]) {
      expect(source).toContain(required);
    }
    expect(source).toContain("viewMode === 'WORKSPACE'");
    expect(source).toContain("viewMode === 'DSR'");
  });
});
