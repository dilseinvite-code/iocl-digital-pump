import {describe,expect,it} from 'vitest';
import {limitTenKlCalibrationCurve,TEN_KL_OPERATIONAL_LIMIT_MILLIUNITS} from '../src/shared/tenKlCalibrationLimit';
import {TankCalibrationService} from '../src/worker/services/tankCalibrationService';
import {ExcelCalibrationImportService} from '../src/worker/services/excelCalibrationImportService';
import fs from 'node:fs';
import path from 'node:path';

describe('10 KL calibration: 11,000 L operating limit, original source retained',()=>{
  const scanTail=[
    {dipMillimetresMilliunits:0,volumeMilliunits:0},
    {dipMillimetresMilliunits:1890000,volumeMilliunits:10996440},
    {dipMillimetresMilliunits:1900000,volumeMilliunits:11018270},
    {dipMillimetresMilliunits:1940000,volumeMilliunits:11073410},
  ];
  it('adds exact 11,000 L endpoint near 1,891.63 mm without changing the signed tail',()=>{
    const before=JSON.stringify(scanTail);
    const r=limitTenKlCalibrationCurve(scanTail);
    expect(JSON.stringify(scanTail)).toBe(before);
    expect(r.sourceMaximumLitres).toBe(11073.41);
    expect(r.operationalMaximumLitres).toBe(11000);
    expect(r.operationalMaximumDipMm).toBeCloseTo(1891.63,2);
    expect(r.points.at(-1)?.volumeMilliunits).toBe(TEN_KL_OPERATIONAL_LIMIT_MILLIUNITS);
    expect(r.points.every(p=>p.volumeMilliunits<=TEN_KL_OPERATIONAL_LIMIT_MILLIUNITS)).toBe(true);
    expect(r.excludedSourcePoints).toBe(2);
    expect(r.boundaryInterpolated).toBe(true);
    expect(()=>TankCalibrationService.convertDipFromPoints(r.points,1900000)).toThrow(/out of range/);
    expect(TankCalibrationService.convertDipFromPoints(r.points,r.points.at(-1)!.dipMillimetresMilliunits).calculatedVolumeMilliunits).toBe(11000000);
  });
  it('preserves existing points under limit, including exactly 11,000 L',()=>{
    const s=[{dipMillimetresMilliunits:0,volumeMilliunits:0},{dipMillimetresMilliunits:10000,volumeMilliunits:11000000}];
    const r=limitTenKlCalibrationCurve(s);
    expect(r.points).toEqual(s);
    expect(r.boundaryInterpolated).toBe(false);
  });
  it('rejects a nonmonotone or unsafe curve instead of hiding bad source data',()=>{
    expect(()=>limitTenKlCalibrationCurve([{dipMillimetresMilliunits:0,volumeMilliunits:100},{dipMillimetresMilliunits:10000,volumeMilliunits:50}])).toThrow();
    expect(()=>limitTenKlCalibrationCurve([{dipMillimetresMilliunits:0,volumeMilliunits:0},{dipMillimetresMilliunits:0,volumeMilliunits:10}])).toThrow();
  });
  it('truncates the actual imported 195-point 10 KL fixture but does not mutate it',async()=>{
    const original=fs.readFileSync(path.resolve('tests/fixtures/20KL_15KL_10KL_calibration_Dip_chart.xlsx'));
    const parsed=await ExcelCalibrationImportService.extractWorkbook(original,'20KL_15KL_10KL_calibration_Dip_chart.xlsx');
    const source=parsed.charts.find(x=>x.templateCode==='EXCEL_10KL_REFERENCE')!;
    const before=JSON.stringify(source.points);
    const output=limitTenKlCalibrationCurve(source.points.map(p=>({
      dipMillimetresMilliunits:Math.round(p.dipMm*1000),
      volumeMilliunits:Math.round(p.volumeLitres*1000),
    })));
    expect(source.points.length).toBe(195);
    expect(JSON.stringify(source.points)).toBe(before);
    expect(output.points.length).toBeGreaterThan(180);
    expect(output.points.length).toBeLessThan(195);
    expect(output.sourceMaximumLitres).toBe(11073.41);
    expect(output.operationalMaximumLitres).toBe(11000);
    expect(output.operationalMaximumDipMm).toBeGreaterThan(1890);
    expect(output.operationalMaximumDipMm).toBeLessThan(1900);
  });
});
