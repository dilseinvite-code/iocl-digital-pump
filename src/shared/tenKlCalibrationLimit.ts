/**
 * Full-range, read-only 10 KL reference curve.
 *
 * This function retains its legacy name for callers, but does NOT truncate
 * a verified calibration curve to 11,000 L. The signed scan reaches
 * 1,940 mm / 11,073.41 L, below the separate +15% chart validation ceiling.
 * Physical safe-fill and tank-specific activation rules remain independent.
 */
export const TEN_KL_TEMPLATE_CODE = 'EXCEL_10KL_REFERENCE';
export const TEN_KL_REFERENCE_MAX_VOLUME_LITRES = 11_073.41;
/** @deprecated This is the scanned chart endpoint, NOT a physical safe-fill limit. */
export const TEN_KL_OPERATIONAL_LIMIT_LITRES = TEN_KL_REFERENCE_MAX_VOLUME_LITRES;
/** @deprecated This is the scanned chart endpoint, NOT a physical safe-fill limit. */
export const TEN_KL_OPERATIONAL_LIMIT_MILLIUNITS = 11_073_410;
export interface Millipoint {
  dipMillimetresMilliunits: number;
  volumeMilliunits: number;
}
export interface TenKlLimitedCurve {
  points: Millipoint[];
  sourcePointsCount: number;
  excludedSourcePoints: number;
  sourceMaximumLitres: number;
  operationalMaximumLitres: number;
  operationalMaximumDipMm: number;
  boundaryInterpolated: boolean;
}
export function limitTenKlCalibrationCurve<T extends Millipoint>(
  source: readonly T[],
): TenKlLimitedCurve {
  if(source.length < 2) throw new Error('10 KL chart needs at least two recorded points');
  const sorted = [...source].sort((a,b)=>a.dipMillimetresMilliunits-b.dipMillimetresMilliunits);
  if(sorted[0].dipMillimetresMilliunits!==0 || sorted[0].volumeMilliunits!==0) {
    throw new Error('10 KL chart must start at 0 mm / 0 L');
  }
  for(let i=0;i<sorted.length;i++){
    const p=sorted[i];
    if(!Number.isSafeInteger(p.dipMillimetresMilliunits) ||
       !Number.isSafeInteger(p.volumeMilliunits) ||
       p.dipMillimetresMilliunits<0 || p.volumeMilliunits<0){
      throw new Error('10 KL source contains an invalid dip/volume point');
    }
    if(i>0 && (p.dipMillimetresMilliunits<=sorted[i-1].dipMillimetresMilliunits ||
      p.volumeMilliunits<=sorted[i-1].volumeMilliunits)){
      throw new Error('10 KL source dip and volume values must be strictly increasing');
    }
  }
  const last=sorted[sorted.length-1];
  if(last.volumeMilliunits>11_500_000) {
    throw new Error('10 KL source exceeds the +15% calibration validation ceiling');
  }
  const points=sorted.map(p=>({
    dipMillimetresMilliunits:p.dipMillimetresMilliunits,
    volumeMilliunits:p.volumeMilliunits,
  }));
  return {
    points,
    sourcePointsCount:source.length,
    excludedSourcePoints:0,
    sourceMaximumLitres:last.volumeMilliunits/1000,
    operationalMaximumLitres:last.volumeMilliunits/1000,
    operationalMaximumDipMm:last.dipMillimetresMilliunits/1000,
    boundaryInterpolated:false,
  };
}
