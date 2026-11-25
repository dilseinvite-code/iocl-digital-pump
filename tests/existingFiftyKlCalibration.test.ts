import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { isFiftyKlSourceReady } from '../src/frontend/components/pump/ExistingFiftyKlCalibration';
import type { GlobalTankCalibrationTemplate } from '../src/shared/types';
const source = {id:'gtct-std-50kl',nominalCapacityLitres:50000,status:'APPROVED',pointsCount:2,points:[{},{}]} as unknown as GlobalTankCalibrationTemplate;
describe('Existing 50 KL global linking',()=>{
  it('only accepts a saved approved exact-capacity source with readings',()=>{
    expect(isFiftyKlSourceReady(source)).toBe(true);
    expect(isFiftyKlSourceReady(null)).toBe(false);
    expect(isFiftyKlSourceReady({...source,nominalCapacityLitres:20000})).toBe(false);
    expect(isFiftyKlSourceReady({...source,status:'DRAFT'})).toBe(false);
    expect(isFiftyKlSourceReady({...source,requiresEngineeringReview:true})).toBe(false);
    expect(isFiftyKlSourceReady({...source,requiresDimensionVerification:true})).toBe(false);
    expect(isFiftyKlSourceReady({...source,pointsCount:301})).toBe(false);
  });
  it('uses the governed assignment API without bypass and requires separate confirmation',()=>{
    const ui=readFileSync('src/frontend/components/pump/ExistingFiftyKlCalibration.tsx','utf8');
    expect(ui).toContain("base+'/assign-preview'");
    expect(ui).toContain("base+'/assign'");
    expect(ui).not.toContain('draftOnlyFromAddTank');
    expect(ui).toContain('disabled={busy||!confirmed}');
    expect(ui).toContain("tankBase+'/engineering-verify'");
    const route=readFileSync('src/worker/routes/tankCalibration.ts','utf8');
    expect(route).toContain("existingChart.sourceTemplateId === 'gtct-std-50kl'");
    expect(route).toContain('GLOBAL_CHART_ROWS_MISMATCH');
    expect(route).toContain('Close the current shift before activating the 50 KL chart.');
  });
});
