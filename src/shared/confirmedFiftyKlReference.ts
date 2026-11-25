// Administrator-attested use of the existing standard reference is not statutory certification.
export const CONFIRMED_50KL_SOURCE_ID = 'gtct-std-50kl';
export const CONFIRMED_50KL_SOURCE_MARKER = 'ADMIN_CONFIRMED_STANDARD_50KL_REFERENCE';
export const CONFIRMED_50KL_OUTLET = '394535';
export type ReferenceRow = {dipMillimetresMilliunits:number;volumeMilliunits:number};
export function isConfirmedFiftyKlTarget(roCode:string,tank:{tankNumber:number;capacityLitres:number;productCode?:string;status:string}):boolean {
  return roCode === CONFIRMED_50KL_OUTLET && tank.capacityLitres === 50000 &&
    ['ACTIVE','INACTIVE'].includes(tank.status) &&
    ((tank.tankNumber === 2 && tank.productCode === 'HSD') || (tank.tankNumber === 3 && tank.productCode === 'MS'));
}
export function validConfirmedFiftyKlSource(source:{id:string;code:string;nominalCapacityLitres:number;status:string;tankDiameterMmMilliunits:number|null;tankLengthMmMilliunits:number|null;maxDipMmMilliunits:number|null;requiresEngineeringReview?:boolean;requiresDimensionVerification?:boolean;isOverCapacityCeiling?:boolean},rows:readonly ReferenceRow[]):boolean {
  return source.id === CONFIRMED_50KL_SOURCE_ID && source.code === 'STANDARD_50KL' &&
    source.nominalCapacityLitres === 50000 && ['APPROVED','ACTIVE'].includes(source.status) &&
    !source.requiresEngineeringReview && !source.requiresDimensionVerification && !source.isOverCapacityCeiling &&
    source.tankDiameterMmMilliunits === 3000000 && source.tankLengthMmMilliunits === 7500000 &&
    source.maxDipMmMilliunits === 3000000 && rows.length === 301 &&
    rows[0].volumeMilliunits === 0 && rows[300].volumeMilliunits === 53015000 &&
    rows.every((r,i)=>Number.isSafeInteger(r.volumeMilliunits) && r.volumeMilliunits >= 0 &&
      r.dipMillimetresMilliunits === i*10000 && (i===0 || r.volumeMilliunits>rows[i-1].volumeMilliunits));
}
export function validConfirmedFiftyKlLimits(tank:{safeFillCapacityLitres:number;minimumOperatingLevelLitres:number;capacityLitres:number}):boolean{
  return Number.isFinite(tank.safeFillCapacityLitres) && Number.isFinite(tank.minimumOperatingLevelLitres) &&
    tank.safeFillCapacityLitres>0 && tank.safeFillCapacityLitres<=tank.capacityLitres &&
    tank.minimumOperatingLevelLitres>=0 && tank.minimumOperatingLevelLitres<tank.safeFillCapacityLitres;
}
