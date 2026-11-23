import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {parseSimpleCalibrationCsv} from '../src/frontend/components/pump/simpleCalibrationCsv';

describe('Simple calibration upload – no engineering forms in main flow',()=>{
 it('loads increasing dip-volume CSV and normalizes it without modifying the readings',()=>{
   const raw='dip_mm,volume_litres\n0,0\n10,6.9\n20,20.1\n30,41.03';
   const p=parseSimpleCalibrationCsv(raw);
   expect(p.valid).toBe(true);
   expect(p.points).toHaveLength(4);
   expect(p.maxVolumeLitres).toBe(41.03);
   expect(p.normalizedCsv).toBe(raw);
 });
 it('accepts semicolon CSV and warns on nonzero starting point',()=>{
   const p=parseSimpleCalibrationCsv('dip_mm;volume_litres\n10;5.2\n20;10.4');
   expect(p.valid).toBe(true);
   expect(p.warnings).toContain('First reading does not start at 0 mm. Check for missing rows.');
 });
 it('rejects duplicate, reversed, negative and malformed readings',()=>{
   const invalid=[
     'dip_mm,volume_litres\n0,0\n0,20',
     'dip_mm,volume_litres\n0,0\n10,-1',
     'dip_mm,volume_litres\n0,0\n10,9\n20,8',
     'dip_mm,volume_litres\n0,0\nX,10',
     'height,amount\n0,0\n10,20',
   ];
   for(const t of invalid){
     const parsed=parseSimpleCalibrationCsv(t);
     expect(parsed.valid).toBe(false);
     expect(parsed.errors.length).toBeGreaterThan(0);
   }
 });
 it('keeps imported maximum (including overcapacity) unchanged in a draft',()=>{
   const p=parseSimpleCalibrationCsv('dip_mm,volume_litres\n0,0\n1890,10996.44\n1900,11018.27\n1940,11073.41');
   expect(p.valid).toBe(true);
   expect(p.maxVolumeLitres).toBe(11073.41);
   expect(p.points.at(-1)?.volumeLitres).toBe(11073.41);
 });
 it('mounted workspace hides engineering UI and preserves protected source imports',()=>{
   const page=fs.readFileSync(path.resolve('src/frontend/pages/PumpInfrastructurePage.tsx'),'utf8');
   const simple=fs.readFileSync(path.resolve('src/frontend/components/pump/SimpleGlobalCalibrationManager.tsx'),'utf8');
   const route=fs.readFileSync(path.resolve('src/worker/routes/tankCalibration.ts'),'utf8');
   expect(page).toContain('<SimpleGlobalCalibrationManager');
   expect(page).not.toContain('<GlobalCalibrationMasterSection');
   expect(simple).not.toContain('engineering-verification-panel');
   expect(simple).not.toContain('Record Engineering Verification');
   expect(simple).toContain('simple-calibration-file-input');
   expect(simple).toContain('simple-save-calibration');
   expect(route).toContain('TEMPLATE_PROTECTED');
   expect(route).toContain("allowEngineeringReviewReference: body.simpleUpload === true");
 });
});
