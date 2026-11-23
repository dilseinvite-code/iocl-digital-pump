/**
 * Sample checkpoints transcribed from the two-page verified-person scan supplied
 * by the outlet operator on 2026-11-23. The original PDF is kept private.
 *
 * IMPORTANT: checkpoint agreement is a *partial source comparison*, not proof
 * that every scanned row matches. Existing operational charts must not be
 * activated or overwritten on this evidence alone.
 */
export interface ScanPoint { dipMm: number; volumeLitres: number }
export interface ScanReferenceCandidate {
  code: string;
  nominalCapacityLitres: number;
  tankDiameterMm?: number | null;
  tankLengthMm?: number | null;
  maxDipMm?: number | null;
  points: ReadonlyArray<ScanPoint>;
}
export interface ScanReferenceSpec {
  code: string;
  nominalCapacityLitres: number;
  tankDiameterMm: number;
  tankLengthMm: number;
  maxDipMm: number;
  maxVolumeLitres: number;
  expectedPoints: number;
  printedCheckpoints: ReadonlyArray<ScanPoint>;
}
export const SCANNED_CALIBRATION_REFERENCES: Readonly<Record<10000 | 20000, ScanReferenceSpec>> = {
  10000: {
    code: 'EXCEL_10KL_REFERENCE',
    nominalCapacityLitres: 10000,
    tankDiameterMm: 1940,
    tankLengthMm: 3750,
    maxDipMm: 1940,
    maxVolumeLitres: 11073.41,
    expectedPoints: 195, // zero plus 1–194 cm
    printedCheckpoints: [
      { dipMm: 0, volumeLitres: 0 },
      { dipMm: 10, volumeLitres: 6.90 },
      { dipMm: 410, volumeLitres: 1706.23 },
      { dipMm: 810, volumeLitres: 4378.94 },
      { dipMm: 1940, volumeLitres: 11073.41 },
    ],
  },
  20000: {
    code: 'EXCEL_20KL_REFERENCE',
    nominalCapacityLitres: 20000,
    tankDiameterMm: 2100,
    tankLengthMm: 6250,
    maxDipMm: 2100,
    maxVolumeLitres: 21628.93,
    expectedPoints: 211, // zero plus 1–210 cm
    printedCheckpoints: [
      { dipMm: 0, volumeLitres: 0 },
      { dipMm: 10, volumeLitres: 11.97 },
      { dipMm: 410, volumeLitres: 2974.02 },
      { dipMm: 810, volumeLitres: 7694.26 },
      // 202 cm confirmed from the original 20 KL chart by the operator on 2026-11-23.
      { dipMm: 2020, volumeLitres: 21359.52 },
      { dipMm: 2100, volumeLitres: 21628.93 },
    ],
  },
};
export function scannedReferenceSpec(capacityLitres: number): ScanReferenceSpec | null {
  return capacityLitres === 10000 || capacityLitres === 20000
    ? SCANNED_CALIBRATION_REFERENCES[capacityLitres]
    : null;
}
export function reviewScannedCalibrationCandidate(candidate: ScanReferenceCandidate): {
  passed: boolean;
  issues: string[];
  checkedSamplePoints: number;
} {
  const ref = scannedReferenceSpec(candidate.nominalCapacityLitres);
  if (!ref) return { passed: true, issues: [], checkedSamplePoints: 0 };
  const issues: string[] = [];
  if (candidate.code !== ref.code) issues.push('Select the scanned '+ref.nominalCapacityLitres/1000+' KL Excel Reference chart, not an unrelated standard template.');
  if (candidate.tankDiameterMm !== ref.tankDiameterMm || candidate.tankLengthMm !== ref.tankLengthMm || candidate.maxDipMm !== ref.maxDipMm) {
    issues.push('Tank diameter, length or maximum dip differs from the supplied scan.');
  }
  if (candidate.points.length !== ref.expectedPoints) {
    issues.push('Expected '+ref.expectedPoints+' readings, including 0 mm; found '+candidate.points.length+'.');
  }
  let previousVolume = -1;
  for (let i = 0; i < candidate.points.length; i++) {
    const p = candidate.points[i];
    if (!Number.isFinite(p.dipMm) || !Number.isFinite(p.volumeLitres) ||
      Math.abs(p.dipMm - i*10) > 0.0001 ||
      !Number.isFinite(previousVolume) || p.volumeLitres <= previousVolume) {
      issues.push('Dip sequence must be complete at 10 mm increments, starting at zero, with increasing volumes.');
      break;
    }
    previousVolume = p.volumeLitres;
  }
  if (candidate.points.length > 0 && Math.abs(candidate.points[0].volumeLitres) > 0.001) {
    issues.push('The zero dip must equal zero litres.');
  }
  const last = candidate.points[candidate.points.length-1];
  if (!last || Math.abs(last.dipMm - ref.maxDipMm) > 0.0001 ||
    Math.abs(last.volumeLitres - ref.maxVolumeLitres) > 0.02) {
    issues.push('Chart must reach the exact scanned maximum '+ref.maxDipMm+' mm / '+ref.maxVolumeLitres.toFixed(2)+' L.');
  }
  if (last && last.volumeLitres > ref.nominalCapacityLitres * 1.15 + 0.001) {
    issues.push('Source maximum exceeds the +15% reference-chart validation ceiling.');
  }
  for (const p of ref.printedCheckpoints) {
    const saved = candidate.points.find(x=>Math.abs(x.dipMm-p.dipMm)<0.0001);
    if (!saved || Math.abs(saved.volumeLitres-p.volumeLitres)>0.02) {
      issues.push('Printed scan checkpoint mismatch at '+p.dipMm+' mm: expected '+p.volumeLitres.toFixed(2)+' L; stored '+(saved ? saved.volumeLitres.toFixed(2)+' L' : 'missing')+'.');
    }
  }
  // Sampled checkpoints are insufficient to certify the whole transcription.
  return { passed: issues.length===0, issues, checkedSamplePoints: ref.printedCheckpoints.length };
}
