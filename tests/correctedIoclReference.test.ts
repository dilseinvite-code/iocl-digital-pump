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

import fs from 'node:fs';
import app from '../src/worker/app';
import {createLocalD1Database} from '../src/db/localD1';
import {getDb} from '../src/db';
import {seedDatabase} from '../src/db/seed';
import * as schema from '../src/db/schema';
import {eq} from 'drizzle-orm';

describe('Corrected IOCL chart upgrade against isolated local D1',()=>{
 it('copies corrected readings to a new ACTIVE revision, archives prior source, preserves historical reading, and is idempotent',async()=>{
  const file='./.sqlite/test_iocl_upgrade_'+crypto.randomUUID()+'.db';
  fs.mkdirSync('./.sqlite',{recursive:true});
  const local=createLocalD1Database(file);
  try{
   const db=getDb(local);await seedDatabase(db);
   const env={DB:local,DOCUMENTS_BUCKET:null};
   const login=await app.fetch(new Request('http://localhost/api/v1/auth/login',{
    method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost:3000'},
    body:JSON.stringify({email:'admin@iocl.in',password:'Password@123'})
   }),env);
   expect(login.status).toBe(200);
   const cookie=login.headers.get('set-cookie')?.split(';')[0]||'';
   const request=(payload:any)=>app.fetch(new Request('http://localhost/api/v1/calibration-templates/upgrade-iocl-10-20',{
    method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,Origin:'http://localhost:3000'},body:JSON.stringify(payload)
   }),env);
   const now=new Date().toISOString();
   const tankId='tank-test-iocl-upgrade';
   const sourceId='gtct-test-previous-20';
   const chartId='tcc-test-previous-20';
   const oldRows=([0,11.97,33.89,62.22,95.74,133.61,175.43,220.8,269.41,321.05,375.61,432.63,492.26,554.27,618.56,685.03,753.57,824.11,896.57,970.88,1046.97,1124.79,1204.28,1285.38,1368.04,1452.22,1537.87,1624.95,1713.41,1803.22,1894.36,1986.75,2080.39,2175.24,2271.27,2368.44,2466.74,2566.12,2666.57,2768.05,2870.54,2974.02,3078.46,3183.83,3290.12,3397.31,3505.36,3614.26,3723.99,3834.63,3945.86,4057.96,4170.8,4284.38,4398.67,4513.65,4629.31,4745.63,4862.59,4980.18,5098.38,5217.17,5336.53,5456.46,5576.94,5697.94,5819.46,5941.48,6063.98,6186.96,6310.39,6434.26,6558.56,6683.28,6808.39,6933.89,7059.77,7186,7312.58,7439.49,7566.72,7694.26,7822.09,7950.2,8078.58,8207.21,8336.09,8465.2,8594.52,8724.05,8853.77,8983.68,9113.75,9243.97,9374.34,9504.86,9635.47,9766.2,9897.02,10027.93,10158.91,10289.95,10421.04,10552.16,10683.31,10814.47,10945.62,11076.77,11207.89,11338.98,11470.02,11601,11731.91,11862.73,11993.46,12124.08,12254.59,12384.96,12515.18,12645.26,12775.16,12904.88,13034.41,13163.73,13292.84,13421.72,13550.35,13678.73,13806.84,13934.67,14062.21,14189.44,14316.35,14442.93,14569.16,14695.04,14820.54,14945.65,15070.37,15194.67,15318.54,15441.97,15564.96,15687.45,15809.47,15930.99,16051.99,16172.47,16292.4,16411.76,16530.55,16648.75,16766.34,16883.3,16999.62,17115.28,17230.28,17344.55,17458.13,17570.97,17683.07,17794.4,17904.94,18014.67,18123.57,18231.62,18338.81,18445.1,18550.47,18654.91,18758.39,18860.88,18962.36,19062.81,19162.19,19260.49,19357.66,19453.69,19548.54,19642.18,19734.58,19825.71,19915.52,20003.98,20091.06,20176.71,20260.89,20343.55,20424.65,20504.14,20581.96,20658.05,20732.36,20804.82,20875.36,20943.91,21010.37,21074.65,21136.87,21196.3,21253.42,21307.88,21359.52,21408.13,21453.5,21495.32,21533.22,21566.71,21595.04,21616.96,21628.93]).map((v,i)=>({dipMillimetresMilliunits:i*10000,volumeMilliunits:Math.round(v*1000)}));
   await db.insert(schema.globalTankCalibrationTemplates).values({
    id:sourceId,code:previousOperatorPdfCode(20000)!,name:'Previous supplied 20 KL',nominalCapacityLitres:20000,
    tankDiameterMmMilliunits:2100000,tankLengthMmMilliunits:6250000,maxDipMmMilliunits:2100000,
    revisionNumber:1,status:'APPROVED',createdBy:'user-admin',createdAt:now,updatedAt:now
   });
   await db.insert(schema.tanks).values({id:tankId,outletId:'ro-1001',tankNumber:99,name:'20 KL upgrade test',productId:'prod-ms',
    capacityLitres:20000,safeFillCapacityLitres:19000,minimumOperatingLevelLitres:1000,status:'ACTIVE',createdBy:'user-admin',createdAt:now,updatedAt:now});
   await db.insert(schema.tankCalibrationCharts).values({
    id:chartId,tankId,sourceTemplateId:sourceId,revisionNumber:1,status:'ACTIVE',chartUnitDip:'MM',chartUnitVolume:'LITRES',
    tankDiameterMmMilliunits:2100000,tankLengthMmMilliunits:6250000,maxDipMmMilliunits:2100000,chartCapacityMilliunits:21628930,
    effectiveFrom:'2026-11-24',createdBy:'user-admin',createdAt:now,updatedAt:now
   });
   for(let i=0;i<oldRows.length;i+=5){
    await db.insert(schema.globalTankCalibrationTemplatePoints).values(oldRows.slice(i,i+5).map((p,k)=>({...p,id:'gtcp-old-test-'+(i+k),templateId:sourceId,createdAt:now,createdBy:'user-admin'})));
    await db.insert(schema.tankCalibrationPoints).values(oldRows.slice(i,i+5).map((p,k)=>({...p,id:'tcp-old-test-'+(i+k),tankId,chartId,createdAt:now,createdBy:'user-admin'})));
   }
   const [shift]=await db.select().from(schema.globalShiftTemplates);
   await db.insert(schema.operationalShifts).values({id:'ops-upgrade-test',outletId:'ro-1001',shiftTemplateId:shift.id,
     businessDate:'2026-11-24',startedAt:now,status:'OPEN',openedByUserId:'user-admin',createdAt:now,updatedAt:now});
   const confirm={confirm:'USE IOCL 26 NOV 2026'};
   expect((await request(confirm)).status).toBe(409);
   await db.update(schema.operationalShifts).set({status:'CLOSED',closedAt:now,closedByUserId:'user-admin'}).where(eq(schema.operationalShifts.id,'ops-upgrade-test'));
   await db.insert(schema.tankStockReadings).values({
    id:'stock-upgrade-test',operationalShiftId:'ops-upgrade-test',outletId:'ro-1001',tankId,productId:'prod-ms',readingType:'OPENING',source:'MANUAL',
    productDipMmMilliunits:490000,waterDipMmMilliunits:0,grossObservedVolumeMilliunits:3834630,waterVolumeMilliunits:0,netProductVolumeMilliunits:3834630,
    calibrationChartId:chartId,calibrationRevision:1,recordedAt:now,recordedByUserId:'user-admin',createdAt:now,updatedAt:now
   });
   const res=await request(confirm);
   const json=await res.json() as any;
   expect(json.error).toBeNull();
   expect(res.status).toBe(200);
   expect(json.data.upgraded).toBe(1);
   const charts=await db.select().from(schema.tankCalibrationCharts).where(eq(schema.tankCalibrationCharts.tankId,tankId));
   expect(charts).toHaveLength(2);
   expect(charts.find(x=>x.id===chartId)?.status).toBe('SUPERSEDED');
   const active=charts.find(x=>x.status==='ACTIVE')!;
   expect(active.revisionNumber).toBe(2);
   const rows=await db.select().from(schema.tankCalibrationPoints).where(eq(schema.tankCalibrationPoints.chartId,active.id)).orderBy(schema.tankCalibrationPoints.dipMillimetresMilliunits);
   expect(matchesExactOperatorPdfRows(20000,rows)).toBe(true);
   const old=await db.select().from(schema.tankCalibrationPoints).where(eq(schema.tankCalibrationPoints.chartId,chartId)).orderBy(schema.tankCalibrationPoints.dipMillimetresMilliunits);
   expect(matchesPreviousOperatorPdfRows(20000,old)).toBe(true);
   const [historical]=await db.select().from(schema.tankStockReadings).where(eq(schema.tankStockReadings.id,'stock-upgrade-test'));
   expect(historical.calibrationChartId).toBe(chartId);
   expect(historical.netProductVolumeMilliunits).toBe(3834630);
   const [tank]=await db.select().from(schema.tanks).where(eq(schema.tanks.id,tankId));
   expect(tank.status).toBe('ACTIVE');expect(tank.safeFillCapacityLitres).toBe(19000);
   const [previous]=await db.select().from(schema.globalTankCalibrationTemplates).where(eq(schema.globalTankCalibrationTemplates.id,sourceId));
   expect(previous.status).toBe('ARCHIVED');
   const again=await request(confirm);expect(again.status).toBe(200);
   expect((await again.json() as any).data.upgraded).toBe(0);
   expect(await db.select().from(schema.tankCalibrationCharts).where(eq(schema.tankCalibrationCharts.tankId,tankId))).toHaveLength(2);
  }finally{local.close();for(const ext of ['','-wal','-shm'])try{fs.unlinkSync(file+ext)}catch{}}
 });
});
