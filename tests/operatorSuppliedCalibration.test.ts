import {describe,it,expect} from 'vitest';
import {isOperatorSuppliedReference} from '../src/shared/operatorSuppliedCalibration';
import {SCANNED_CALIBRATION_REFERENCES} from '../src/shared/scannedCalibrationReference';
function testSource(capacity:10000|20000){
 const ref=SCANNED_CALIBRATION_REFERENCES[capacity];
 const points=Array.from({length:ref.expectedPoints},(_,i)=>({
   dipMillimetresMilliunits:i*10000,
   volumeMilliunits:Math.round(ref.maxVolumeLitres*1000*i/(ref.expectedPoints-1)),
 }));
 points[0].volumeMilliunits=0;
 points[points.length-1].volumeMilliunits=Math.round(ref.maxVolumeLitres*1000);
 return {source:{code:ref.code,nominalCapacityLitres:capacity,tankDiameterMm:ref.tankDiameterMm,
   tankLengthMm:ref.tankLengthMm,maxDipMm:ref.maxDipMm,pointsCount:ref.expectedPoints,
   maxVolumeLitres:ref.maxVolumeLitres},points};
}
describe('operator supplied calibration without duplicate approvals',()=>{
 it.each([10000,20000] as const)('accepts complete %i L numerical reference',capacity=>{
   const {source,points}=testSource(capacity);
   expect(isOperatorSuppliedReference(source,points)).toBe(true);
   expect(isOperatorSuppliedReference(source)).toBe(true);
 });
 it('does not mistake Standard 20KL for the supplied PDF/Excel reference',()=>{
   const {source,points}=testSource(20000);
   expect(isOperatorSuppliedReference({...source,code:'STANDARD_20KL'},points)).toBe(false);
 });
 it('rejects missing or decreasing numerical values',()=>{
   const {source,points}=testSource(10000);
   expect(isOperatorSuppliedReference(source,points.slice(0,-1))).toBe(false);
   expect(isOperatorSuppliedReference(source,points.map((p,i)=>i===5?{...p,volumeMilliunits:0}:p))).toBe(false);
 });
});
