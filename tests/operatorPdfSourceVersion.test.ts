import {describe,it,expect} from 'vitest';
import {operatorPdfSource,operatorPdfCodeForCapacity,matchesExactOperatorPdfRows} from '../src/shared/operatorPdfSourceData';
import {isOperatorSuppliedReference,isOperatorSuppliedSourceMetadata} from '../src/shared/operatorSuppliedCalibration';
import {reviewScannedCalibrationCandidate} from '../src/shared/scannedCalibrationReference';
describe('Operator supplied PDF chart versions preserve numeric rows',()=>{
  it.each([10000,20000] as const)('%i L PDF version has full readings and is ready without second approval',capacity=>{
    const s=operatorPdfSource(capacity)!;
    const points=s.points.map(p=>({dipMillimetresMilliunits:p.dipMm*1000,volumeMilliunits:Math.round(p.volumeLitres*1000)}));
    const metadata={...s,pointsCount:s.points.length};
    expect(isOperatorSuppliedSourceMetadata(metadata)).toBe(true);
    expect(isOperatorSuppliedReference(metadata,points)).toBe(true);
    expect(matchesExactOperatorPdfRows(capacity,points)).toBe(true);
    expect(reviewScannedCalibrationCandidate(s).passed).toBe(true);
    expect(s.points.at(-1)!.volumeLitres).toBeLessThanOrEqual(capacity*1.15);
  });
  it('2020mm 20 KL figure remains operator-confirmed, not synthesized',()=>{
    expect(operatorPdfSource(20000)!.points[202]).toEqual({dipMm:2020,volumeLitres:21359.52});
  });
  it('cannot substitute a Standard or altered PDF row and never modifies 15KL/50KL',()=>{
    expect(operatorPdfCodeForCapacity(15000)).toBeNull();
    expect(operatorPdfCodeForCapacity(50000)).toBeNull();
    const s=operatorPdfSource(20000)!;
    const points=s.points.map(p=>({dipMillimetresMilliunits:p.dipMm*1000,volumeMilliunits:Math.round(p.volumeLitres*1000)}));
    const metadata={...s,pointsCount:s.points.length};
    expect(isOperatorSuppliedReference({...metadata,code:'STANDARD_20KL'},points)).toBe(false);
    points[202]={...points[202],volumeMilliunits:21369520};
    expect(isOperatorSuppliedReference(metadata,points)).toBe(false);
  });
});
