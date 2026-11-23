import {describe,expect,it} from 'vitest';
import {limitTenKlCalibrationCurve,TEN_KL_REFERENCE_MAX_VOLUME_LITRES} from '../src/shared/tenKlCalibrationLimit';
import {TankCalibrationService} from '../src/worker/services/tankCalibrationService';
import {ExcelCalibrationImportService} from '../src/worker/services/excelCalibrationImportService';
import fs from 'node:fs';
import path from 'node:path';

describe('10 KL complete scanned-reference volume range',()=>{
  const scanTail=[
    {dipMillimetresMilliunits:0,volumeMilliunits:0},
    {dipMillimetresMilliunits:1890000,volumeMilliunits:10996440},
    {dipMillimetresMilliunits:1900000,volumeMilliunits:11018270},
    {dipMillimetresMilliunits:1940000,volumeMilliunits:11073410},
  ];
  it('keeps every source point, including readings above 11,000 L',()=>{
    const before=JSON.stringify(scanTail);
    const c=limitTenKlCalibrationCurve(scanTail);
    expect(JSON.stringify(scanTail)).toBe(before);
    expect(c.sourceMaximumLitres).toBe(11073.41);
    expect(c.operationalMaximumLitres).toBe(TEN_KL_REFERENCE_MAX_VOLUME_LITRES);
    expect(c.operationalMaximumDipMm).toBe(1940);
    expect(c.excludedSourcePoints).toBe(0);
    expect(c.boundaryInterpolated).toBe(false);
    expect(c.points).toEqual(scanTail);
    expect(TankCalibrationService.convertDipFromPoints(c.points,1900000).calculatedVolumeMilliunits).toBe(11018270);
    expect(TankCalibrationService.convertDipFromPoints(c.points,1940000).calculatedVolumeMilliunits).toBe(11073410);
    expect(()=>TankCalibrationService.convertDipFromPoints(c.points,1940001)).toThrow(/out of range/i);
  });
  it('rejects invalid data and values beyond +15% ceiling',()=>{
    expect(()=>limitTenKlCalibrationCurve([{dipMillimetresMilliunits:0,volumeMilliunits:100},{dipMillimetresMilliunits:10000,volumeMilliunits:50}])).toThrow();
    expect(()=>limitTenKlCalibrationCurve([{dipMillimetresMilliunits:0,volumeMilliunits:0},{dipMillimetresMilliunits:0,volumeMilliunits:10}])).toThrow();
    expect(()=>limitTenKlCalibrationCurve([{dipMillimetresMilliunits:0,volumeMilliunits:0},{dipMillimetresMilliunits:1940000,volumeMilliunits:11500001}])).toThrow(/\+15%/);
  });
  it('preserves the existing workbook in full without claiming it matches the scan',async()=>{
    const workbook=fs.readFileSync(path.resolve('tests/fixtures/20KL_15KL_10KL_calibration_Dip_chart.xlsx'));
    const result=await ExcelCalibrationImportService.extractWorkbook(workbook,'20KL_15KL_10KL_calibration_Dip_chart.xlsx');
    const source=result.charts.find(x=>x.templateCode==='EXCEL_10KL_REFERENCE')!;
    const before=JSON.stringify(source.points);
    const full=limitTenKlCalibrationCurve(source.points.map(p=>({
      dipMillimetresMilliunits:Math.round(p.dipMm*1000),
      volumeMilliunits:Math.round(p.volumeLitres*1000),
    })));
    expect(source.points).toHaveLength(195);
    expect(JSON.stringify(source.points)).toBe(before);
    expect(full.points).toHaveLength(195);
    expect(full.operationalMaximumDipMm).toBe(1940);
    expect(full.sourceMaximumLitres).toBe(11073.41);
  });
});
