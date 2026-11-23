import {describe,expect,it} from 'vitest';
import {SCANNED_CALIBRATION_REFERENCES,reviewScannedCalibrationCandidate} from '../src/shared/scannedCalibrationReference';

describe('Scanned 10/20 KL checkpoint validation (not full row-by-row certification)',()=>{
  const sample=(capacity:10000|20000)=>{
    const r=SCANNED_CALIBRATION_REFERENCES[capacity];
    // SYNTHETIC TEST ONLY; never upload these interpolated intermediate points as a real chart.
    const points=Array.from({length:r.expectedPoints},(_,i)=>{
      const dipMm=i*10;
      const low=[...r.printedCheckpoints].reverse().find(p=>p.dipMm<=dipMm)!;
      const high=r.printedCheckpoints.find(p=>p.dipMm>=dipMm)!;
      const volume=high.dipMm===low.dipMm?low.volumeLitres:
        low.volumeLitres+(high.volumeLitres-low.volumeLitres)*(dipMm-low.dipMm)/(high.dipMm-low.dipMm);
      return {dipMm,volumeLitres:Math.round(volume*1000)/1000};
    });
    return {code:r.code,nominalCapacityLitres:capacity,tankDiameterMm:r.tankDiameterMm,
      tankLengthMm:r.tankLengthMm,maxDipMm:r.maxDipMm,points};
  };
  it.each([10000,20000] as const)('accepts full structured test curve with sample printed checkpoints for %iL',capacity=>{
    const c=sample(capacity);
    const v=reviewScannedCalibrationCandidate(c);
    expect(v.passed).toBe(true);
    expect(v.checkedSamplePoints).toBe(5);
    expect(c.points.at(-1)).toEqual({dipMm:c.maxDipMm,volumeLitres:SCANNED_CALIBRATION_REFERENCES[capacity].maxVolumeLitres});
  });
  it.each([10000,20000] as const)('rejects missing rows and altered scanned checkpoints for %iL',capacity=>{
    const c=sample(capacity);
    expect(reviewScannedCalibrationCandidate({...c,points:c.points.slice(0,-1)}).passed).toBe(false);
    const altered=c.points.map(p=>p.dipMm===410?{...p,volumeLitres:p.volumeLitres+0.5}:p);
    expect(reviewScannedCalibrationCandidate({...c,points:altered}).passed).toBe(false);
  });
});
