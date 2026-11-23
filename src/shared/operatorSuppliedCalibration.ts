import {scannedReferenceSpec,reviewScannedCalibrationCandidate} from './scannedCalibrationReference';
/** Operator supplied 10/20 KL numeric source. Completeness is checked without changing any readings.
 * This does not claim full scanned PDF equivalence or engineer certification. */
export type SuppliedPoint={dipMillimetresMilliunits:number;volumeMilliunits:number};
export type SuppliedTemplate={code:string;nominalCapacityLitres:number;
 tankDiameterMm?:number|null;tankLengthMm?:number|null;maxDipMm?:number|null;
 pointsCount?:number|null;maxVolumeLitres?:number|null};
export function isOperatorSuppliedSourceMetadata(source:SuppliedTemplate|null|undefined):boolean{
 if(!source)return false;
 const spec=scannedReferenceSpec(source.nominalCapacityLitres);
 if(!spec||source.code!==spec.code||
   source.tankDiameterMm!==spec.tankDiameterMm||
   source.tankLengthMm!==spec.tankLengthMm||
   source.maxDipMm!==spec.maxDipMm)return false;
 if(source.pointsCount!=null&&source.pointsCount!==spec.expectedPoints)return false;
 if(source.maxVolumeLitres!=null&&Math.abs(source.maxVolumeLitres-spec.maxVolumeLitres)>0.02)return false;
 return source.pointsCount===spec.expectedPoints&&source.maxVolumeLitres!=null;
}
/** Operational reuse requires every stored row and the printed PDF checkpoints to agree.
 * This still is not proof that all untranscribed PDF rows match. */
export function isOperatorSuppliedReference(source:SuppliedTemplate|null|undefined,points?:readonly SuppliedPoint[]):boolean{
 if(!isOperatorSuppliedSourceMetadata(source)||!source||!points)return false;
 const spec=scannedReferenceSpec(source.nominalCapacityLitres)!;
 if(points.length!==spec.expectedPoints)return false;
 const sorted=[...points].sort((a,b)=>a.dipMillimetresMilliunits-b.dipMillimetresMilliunits);
 for(let i=0;i<sorted.length;i++){
   const p=sorted[i];
   if(!Number.isFinite(p.dipMillimetresMilliunits)||!Number.isFinite(p.volumeMilliunits)||
     p.dipMillimetresMilliunits!==i*10000||p.volumeMilliunits<0||
     (i===0&&p.volumeMilliunits!==0)||
     (i>0&&p.volumeMilliunits<=sorted[i-1].volumeMilliunits))return false;
 }
 const last=sorted[sorted.length-1];
 if(last.dipMillimetresMilliunits!==spec.maxDipMm*1000||
    Math.abs(last.volumeMilliunits/1000-spec.maxVolumeLitres)>0.02||
    last.volumeMilliunits/1000>spec.nominalCapacityLitres*1.15+0.001)return false;
 return reviewScannedCalibrationCandidate({
    code:source.code,nominalCapacityLitres:source.nominalCapacityLitres,
    tankDiameterMm:source.tankDiameterMm,tankLengthMm:source.tankLengthMm,
    maxDipMm:source.maxDipMm,
    points:sorted.map(p=>({dipMm:p.dipMillimetresMilliunits/1000,volumeLitres:p.volumeMilliunits/1000})),
 }).passed;
}
