import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { workflowTone } from '../src/frontend/components/common/OperationsUi';

describe('operations UI clarity',()=>{
  it('uses semantic colour as a supplement to the authoritative status text',()=>{
    for(const status of ['COMPLETED','COMPLETE','CLOSED','LOCKED','ALL CLOSED / LOCKED'])expect(workflowTone(status)).toBe('success');
    for(const status of ['PENDING','IN_PROGRESS','PARTIAL','CLOSING'])expect(workflowTone(status)).toBe('warning');
    for(const status of ['BLOCKED','REVIEW_REQUIRED'])expect(workflowTone(status)).toBe('danger');
    expect(workflowTone('OPEN')).toBe('info');
    for(const status of ['UNKNOWN','STATUS UNAVAILABLE','NOT_STARTED','NO ENTRY','30 NO-ENTRY DATES'])expect(workflowTone(status)).toBe('neutral');
  });
  it('keeps workflow and PDF generation intact, using the existing consolidated model only for presentation',()=>{
    const dsr=fs.readFileSync('src/frontend/pages/DsrReportsPage.tsx','utf8');
    expect(dsr).toContain('consolidateDsr(days)');
    expect(dsr).toContain('model.dateGroups.map');
    expect(dsr).toContain('getDsrWorkflowStatus(d)');
    expect(dsr).toContain('operationalShiftClosure(d)');
    expect(dsr).toContain('generateDsrPdf({outletName,roCode,days');
    expect(dsr).toContain('No incomplete retrieval will be exported.');
    expect(dsr).toContain('No data is written.');
    const daily=fs.readFileSync('src/frontend/pages/DailyOperationsPage.tsx','utf8');
    expect(daily).toContain("neutral: summary.completion.totalReceipts === 0");
    expect(daily).toContain('not a required step sequence');
    expect(daily).toContain('onClick={handleCloseOperations}');
    expect(daily).toContain('disabled={closingShiftBusy || hasUnsaved || !summary.shifts.find(s=>s.id===activeWorkspace.shift.id)?.reconciliationComplete}');
  });
});
