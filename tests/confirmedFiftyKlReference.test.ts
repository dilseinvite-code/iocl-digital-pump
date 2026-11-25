import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {isConfirmedFiftyKlTarget,validConfirmedFiftyKlSource,validConfirmedFiftyKlLimits} from '../src/shared/confirmedFiftyKlReference';
const tank={tankNumber:2,capacityLitres:50000,productCode:'HSD',status:'ACTIVE'};
const source={id:'gtct-std-50kl',code:'STANDARD_50KL',nominalCapacityLitres:50000,status:'APPROVED',tankDiameterMmMilliunits:3000000,tankLengthMmMilliunits:7500000,maxDipMmMilliunits:3000000};
// Synthetic monotone test fixture only; production copies the actual saved source rows.
const rows=Array.from({length:301},(_,i)=>({dipMillimetresMilliunits:i*10000,volumeMilliunits:Math.round(i*53015000/300)}));
describe('Scoped confirmed 50 KL reference',()=>{
  it('allows only the two specified COCO 33 tanks',()=>{
    expect(isConfirmedFiftyKlTarget('394535',tank)).toBe(true);
    expect(isConfirmedFiftyKlTarget('394535',{...tank,tankNumber:3,productCode:'MS'})).toBe(true);
    expect(isConfirmedFiftyKlTarget('395633',tank)).toBe(false);
    expect(isConfirmedFiftyKlTarget('394535',{...tank,tankNumber:1})).toBe(false);
    expect(isConfirmedFiftyKlTarget('394535',{...tank,capacityLitres:20000})).toBe(false);
  });
  it('requires complete valid approved chart with matching dimensions and endpoints',()=>{
    expect(validConfirmedFiftyKlSource(source,rows)).toBe(true);
    expect(validConfirmedFiftyKlSource({...source,status:'DRAFT'},rows)).toBe(false);
    expect(validConfirmedFiftyKlSource({...source,tankLengthMmMilliunits:6500000},rows)).toBe(false);
    expect(validConfirmedFiftyKlSource({...source,requiresEngineeringReview:true},rows)).toBe(false);
    expect(validConfirmedFiftyKlSource(source,rows.slice(0,-1))).toBe(false);
    expect(validConfirmedFiftyKlSource(source,rows.map((r,i)=>i===100?{...r,volumeMilliunits:0}:r))).toBe(false);
  });
  it('preserves operational limits and rejects invalid ones',()=>{
    const limits={capacityLitres:50000,safeFillCapacityLitres:50000,minimumOperatingLevelLitres:5000};
    expect(validConfirmedFiftyKlLimits(limits)).toBe(true);
    expect(validConfirmedFiftyKlLimits({...limits,safeFillCapacityLitres:53015})).toBe(false);
    expect(validConfirmedFiftyKlLimits({...limits,minimumOperatingLevelLitres:50000})).toBe(false);
  });
  it('retains authority, explicit attestation, open-shift protection and atomic audit without claiming a certificate',()=>{
    const repo=readFileSync('src/worker/repositories/pumpRepository.ts','utf8');
    const method=repo.slice(repo.indexOf('async activateConfirmedFiftyKlReference'),repo.indexOf('async updateCalibrationChartStatus'));
    expect(method).toContain('findActiveOperationalShift');
    expect(method).toContain('EXISTING_CHART_PROTECTED');
    expect(method).toContain('confirmCompatibility!==true');
    expect(method).toContain('certificateProvided:false');
    expect(method).toContain('referenceDocument:null');
    expect(method).toContain('batch(batch)');
    expect(repo).toContain('if (chart.sourceFileName === CONFIRMED_50KL_SOURCE_MARKER) continue');
    const route=readFileSync('src/worker/routes/tankCalibration.ts','utf8');
    const section=route.slice(route.indexOf("tankCalibration.post('/tanks/:tankId/calibration/confirmed-50kl-reference'"));
    expect(section).toContain('canAuthorizeCalibrationActivation(c)');
    expect(section).toContain('verifyOutletAuthority');
    expect(section).toContain('activateConfirmedFiftyKlReference');
  });
});
