/**
 * Operational *display and conversion* limit for the supplied 10 KL chart.
 *
 * The signed original still contains 195 source points up to 11,073.41 L.
 * Preserve them unchanged in D1, documents and engineering audit. The
 * effective curve ends at 11,000 L with an INTERPOLATED fractional-mm point.
 * It is not a certificate of tank approval and must never silently approve a
 * draft chart or modify a physical tank stock record.
 */
export const TEN_KL_TEMPLATE_CODE = 'EXCEL_10KL_REFERENCE';
export const TEN_KL_OPERATIONAL_LIMIT_LITRES = 11_000;
export const TEN_KL_OPERATIONAL_LIMIT_MILLIUNITS = 11_000_000;

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
  if (source.length < 2) throw new Error('10 KL chart needs at least two recorded points');
  const sorted = [...source].sort((a,b)=>a.dipMillimetresMilliunits-b.dipMillimetresMilliunits);
  for (let i=0;i<sorted.length;i++) {
    const point=sorted[i];
    if (!Number.isSafeInteger(point.dipMillimetresMilliunits) ||
        !Number.isSafeInteger(point.volumeMilliunits) ||
        point.dipMillimetresMilliunits<0 || point.volumeMilliunits<0) {
      throw new Error('10 KL chart contains an invalid dip/volume point');
    }
    if (i>0 && (point.dipMillimetresMilliunits<=sorted[i-1].dipMillimetresMilliunits ||
                point.volumeMilliunits<sorted[i-1].volumeMilliunits)) {
      throw new Error('10 KL chart dip and volume values must be strictly ordered and non-decreasing');
    }
  }
  const limit=TEN_KL_OPERATIONAL_LIMIT_MILLIUNITS;
  const sourceMax=sorted[sorted.length-1].volumeMilliunits;
  const inside=sorted.filter(p=>p.volumeMilliunits<=limit).map(p=>({
    dipMillimetresMilliunits:p.dipMillimetresMilliunits,
    volumeMilliunits:p.volumeMilliunits,
  }));
  const firstAbove=sorted.find(p=>p.volumeMilliunits>limit);
  let boundaryInterpolated=false;
  if(firstAbove){
    const previous=inside[inside.length-1];
    if(!previous)throw new Error('10 KL source curve does not start below the 11,000 L limit');
    if(previous.volumeMilliunits<limit){
      const deltaDip=BigInt(firstAbove.dipMillimetresMilliunits-previous.dipMillimetresMilliunits);
      const deltaVolume=BigInt(firstAbove.volumeMilliunits-previous.volumeMilliunits);
      if(deltaDip<=0n||deltaVolume<=0n)throw new Error('10 KL boundary cannot be interpolated');
      // Floor at one micrometre of dip to never extend beyond the declared
      // physical volume threshold. 11,000 L is a derived profile endpoint.
      const fraction=(BigInt(limit-previous.volumeMilliunits)*deltaDip)/deltaVolume;
      const dip=Number(BigInt(previous.dipMillimetresMilliunits)+fraction);
      if(dip<=previous.dipMillimetresMilliunits||dip>=firstAbove.dipMillimetresMilliunits)
        throw new Error('10 KL boundary dip cannot be resolved at millimetre-milliunit precision');
      inside.push({dipMillimetresMilliunits:dip,volumeMilliunits:limit});
      boundaryInterpolated=true;
    }
  }
  if(inside.length<2)throw new Error('10 KL curve has insufficient readings below 11,000 L');
  return {
    points:inside,
    sourcePointsCount:source.length,
    excludedSourcePoints:source.length-sorted.filter(p=>p.volumeMilliunits<=limit).length,
    sourceMaximumLitres:sourceMax/1000,
    operationalMaximumLitres:inside[inside.length-1].volumeMilliunits/1000,
    operationalMaximumDipMm:inside[inside.length-1].dipMillimetresMilliunits/1000,
    boundaryInterpolated,
  };
}
