import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {ExcelCalibrationImportService} from '../src/worker/services/excelCalibrationImportService';
import {parseSimpleCalibrationCsv} from '../src/frontend/components/pump/simpleCalibrationCsv';
import {SCANNED_CALIBRATION_REFERENCES} from '../src/shared/scannedCalibrationReference';

const sourceDir=path.join(process.cwd(),'docs/calibration/pdf-source-candidates');
const candidate=(kl:number)=>{
 const file=path.join(sourceDir,'scanned-'+kl+'kl-10mm.csv');
 const parsed=parseSimpleCalibrationCsv(fs.readFileSync(file,'utf8'));
 expect(parsed.errors).toEqual([]);
 expect(parsed.valid).toBe(true);
 return parsed.points;
};

describe('Scanned PDF candidate transcriptions compared with legacy Excel',()=>{
 it.each([10,20] as const)('%iKL source is a complete monotonically increasing 10 mm table',kl=>{
   const spec=SCANNED_CALIBRATION_REFERENCES[kl===10?10000:20000];
   const points=candidate(kl);
   expect(points).toHaveLength(spec.expectedPoints);
   expect(points[0]).toEqual({dipMm:0,volumeLitres:0});
   expect(points.at(-1)).toEqual({dipMm:spec.maxDipMm,volumeLitres:spec.maxVolumeLitres});
   for(let i=1;i<points.length;i++){
     expect(points[i].dipMm).toBe(i*10);
     expect(points[i].volumeLitres).toBeGreaterThan(points[i-1].volumeLitres);
   }
   for(const cp of spec.printedCheckpoints){
     expect(points.find(p=>p.dipMm===cp.dipMm)?.volumeLitres).toBe(cp.volumeLitres);
   }
   expect(points.at(-1)!.volumeLitres).toBeLessThanOrEqual(kl*1000*1.15);
 });
 it('reports ALL full-table PDF-to-legacy Excel discrepancies without updating stored data',async()=>{
   const bytes=fs.readFileSync(path.join(process.cwd(),'tests/fixtures/20KL_15KL_10KL_calibration_Dip_chart.xlsx'));
   const extracted=await ExcelCalibrationImportService.extractWorkbook(bytes,'20KL_15KL_10KL_calibration_Dip_chart.xlsx');
   for(const kl of [10,20] as const){
     const rows=candidate(kl);
     const old=extracted.charts.find(c=>c.nominalCapacityLitres===kl*1000);
     expect(old).toBeDefined();
     expect(old?.points).toHaveLength(rows.length);
     const oldByDip=new Map(old!.points.map(p=>[p.dipMm,p.volumeLitres]));
     const mismatches=rows.map(p=>({
       dipMm:p.dipMm,pdf:p.volumeLitres,excel:oldByDip.get(p.dipMm),
       deltaLitres:Math.round((p.volumeLitres-(oldByDip.get(p.dipMm)??NaN))*100)/100,
     })).filter(p=>!Number.isFinite(p.deltaLitres)||Math.abs(p.deltaLitres)>0.01);
     console.info('[PDF_VS_LEGACY_EXCEL]',JSON.stringify({
       capacityKL:kl,totalPoints:rows.length,differences:mismatches.length,
       maximumAbsoluteDifferenceLitres:Math.max(0,...mismatches.map(p=>Math.abs(p.deltaLitres))),
       first25:mismatches.slice(0,25),
       caveat:'Manual scan transcription pending second pass; comparison-only; no database writes.'
     }));
   }
 });
 it('retains the flagged 20KL printed anomaly instead of inventing a smooth replacement',()=>{
   const rows=candidate(20);
   const get=(dip:number)=>rows.find(p=>p.dipMm===dip)!.volumeLitres;
   expect(get(2010)).toBe(21307.88);
   expect(get(2020)).toBe(21369.52);
   expect(get(2030)).toBe(21408.13);
   expect(Math.abs((get(2020)-get(2010))-(get(2030)-get(2020)))).toBeGreaterThan(20);
 });
});
