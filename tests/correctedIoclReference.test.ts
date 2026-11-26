import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {operatorPdfSource,matchesExactOperatorPdfRows,matchesPreviousOperatorPdfRows,previousOperatorPdfCode} from '../src/shared/operatorPdfSourceData';
describe('26 November IOCL photo corrections',()=>{
 it.each([10000,20000])('preserves complete corrected %i L reference',capacity=>{
  const source=operatorPdfSource(capacity)!;
  expect(source.code).not.toBe(previousOperatorPdfCode(capacity));
  const rows=source.points.map(p=>({dipMillimetresMilliunits:p.dipMm*1000,volumeMilliunits:Math.round(p.volumeLitres*1000)}));
  expect(rows.length).toBe(capacity===10000?195:211);
  expect(matchesExactOperatorPdfRows(capacity,rows)).toBe(true);
  expect(matchesPreviousOperatorPdfRows(capacity,rows)).toBe(false);
  expect(rows.every((p,i)=>i===0||p.volumeMilliunits>rows[i-1].volumeMilliunits)).toBe(true);
 });
 it('uses all 21 corrected literal volume values',()=>{
  const corrections={"10":{"30":1087.95,"38":1529.65,"41":1705.23,"151":9248.45,"152":9308.57,"162":9878.95,"168":10189.69,"173":10426.63,"176":10557.66,"184":10857.19,"185":10888.53,"188":10972.35},"20":{"4":95.71,"10":375.51,"30":1894.35,"49":3834.53,"95":9504.85,"142":15564.95,"156":17230.26,"197":21074.66,"198":21136.67}};
  for(const [k,values] of Object.entries(corrections)){
   const points=operatorPdfSource(Number(k)*1000)!.points;
   for(const [cm,volume] of Object.entries(values))expect(points[Number(cm)].volumeLitres).toBe(volume);
  }
 });
 it('keeps replacement atomic and preserves tank status and prior readings',()=>{
  const route=readFileSync('src/worker/routes/tankCalibration.ts','utf8');
  const upgrade=route.slice(route.indexOf("tankCalibration.post('/calibration-templates/upgrade-iocl-10-20'"),route.indexOf("tankCalibration.get('/calibration-templates/replace-10-20-preview'"));
  expect(upgrade).toContain('plan.openShifts');
  expect(upgrade).toContain('matchesPreviousOperatorPdfRows(capacity,copied)');
  expect(upgrade).toContain("ch.status==='ACTIVE'?'SUPERSEDED':'ARCHIVED'");
  expect(upgrade).toContain('batch(batch)');
  expect(upgrade).not.toContain('db.delete(');
  expect(upgrade).not.toContain('db.update(schema.tanks)');
 });
});
