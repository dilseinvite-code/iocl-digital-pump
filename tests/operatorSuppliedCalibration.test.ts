import {describe,it,expect} from 'vitest';
import {isOperatorSuppliedReference,isOperatorSuppliedSourceMetadata} from '../src/shared/operatorSuppliedCalibration';
import {SCANNED_CALIBRATION_REFERENCES} from '../src/shared/scannedCalibrationReference';
function checkpointCurve(capacity:10000|20000){
 const ref=SCANNED_CALIBRATION_REFERENCES[capacity];
 const points=Array.from({length:ref.expectedPoints},(_,i)=>{
   const dipMm=i*10;
   const low=[...ref.printedCheckpoints].reverse().find(p=>p.dipMm<=dipMm)!;
   const high=ref.printedCheckpoints.find(p=>p.dipMm>=dipMm)!;
   const value=high.dipMm===low.dipMm?low.volumeLitres:
     low.volumeLitres+(high.volumeLitres-low.volumeLitres)*(dipMm-low.dipMm)/(high.dipMm-low.dipMm);
   return {dipMillimetresMilliunits:dipMm*1000,volumeMilliunits:Math.round(value*1000)};
 });
 return {source:{code:ref.code,nominalCapacityLitres:capacity,
   tankDiameterMm:ref.tankDiameterMm,tankLengthMm:ref.tankLengthMm,
   maxDipMm:ref.maxDipMm,pointsCount:ref.expectedPoints,maxVolumeLitres:ref.maxVolumeLitres},points};
}
describe('supplied calibration source checking',()=>{
 it.each([10000,20000] as const)('requires full numerical rows and printed checkpoints for %iL',capacity=>{
   const {source,points}=checkpointCurve(capacity);
   expect(isOperatorSuppliedSourceMetadata(source)).toBe(true);
   expect(isOperatorSuppliedReference(source,points)).toBe(true);
   expect(isOperatorSuppliedReference(source)).toBe(false);
 });
 it('does not substitute standard 20KL or an altered checkpoint',()=>{
   const {source,points}=checkpointCurve(20000);
   expect(isOperatorSuppliedReference({...source,code:'STANDARD_20KL'},points)).toBe(false);
   expect(isOperatorSuppliedReference(source,points.map((p,i)=>i===41?{...p,volumeMilliunits:p.volumeMilliunits+1000}:p))).toBe(false);
 });
 it('rejects missing and straight-line substitute charts even with matching endpoints',()=>{
   const {source,points}=checkpointCurve(10000);
   expect(isOperatorSuppliedReference(source,points.slice(0,-1))).toBe(false);
   const straight=points.map((p,i)=>({...p,volumeMilliunits:Math.round(i*source.maxVolumeLitres*1000/(points.length-1))}));
   expect(isOperatorSuppliedReference(source,straight)).toBe(false);
 });
});
