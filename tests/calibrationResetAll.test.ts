import {beforeEach,afterEach,describe,it,expect} from 'vitest';
import fs from 'node:fs';
import app from '../src/worker/app';
import {createLocalD1Database} from '../src/db/localD1';
import {getDb} from '../src/db';
import * as schema from '../src/db/schema';
import {seedDatabase} from '../src/db/seed';
import {operatorPdfSource} from '../src/shared/operatorPdfSourceData';
import {eq} from 'drizzle-orm';

describe('Replace ONLY 10KL and 20KL calibration with uploaded PDF values',()=>{
 let localD1:any,env:any,dbPath:string,cookie:string;
 beforeEach(async()=>{
  dbPath='./.sqlite/test_replace_10_20_'+Math.random().toString(36).slice(2)+'.db';
  localD1=createLocalD1Database(dbPath);
  const db=getDb(localD1);await seedDatabase(db);
  env={DB:localD1,DOCUMENTS_BUCKET:null};
  const login=await app.fetch(new Request('http://localhost/api/v1/auth/login',{
   method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost:3000'},
   body:JSON.stringify({email:'admin@iocl.in',password:'Password@123'})
  }),env);
  expect(login.status).toBe(200);
  cookie=login.headers.get('set-cookie')?.split(';')[0]||'';
 });
 afterEach(()=>{
  try{localD1.close()}catch{}
  for(const ext of ['', '-wal','-shm'])try{fs.unlinkSync(dbPath+ext)}catch{}
 });
 const request=(method:string,path:string,payload?:any)=>app.fetch(new Request(
  'http://localhost/api/v1'+path,{
   method,headers:{'Content-Type':'application/json',Cookie:cookie,Origin:'http://localhost:3000'},
   ...(payload===undefined?{}:{body:JSON.stringify(payload)})
  }),env);
 async function prepareOldSource(capacity:number,code:string){
  const db=getDb(localD1),now=new Date().toISOString();
  const id='old-source-'+capacity;
  await db.insert(schema.globalTankCalibrationTemplates).values({
   id,code,name:'Old '+capacity+' Excel',nominalCapacityLitres:capacity,
   revisionNumber:1,status:'APPROVED',createdAt:now,updatedAt:now,createdBy:'user-admin'
  });
  await db.insert(schema.globalTankCalibrationTemplatePoints).values([
   {id:'old-zero-'+capacity,templateId:id,dipMillimetresMilliunits:0,volumeMilliunits:0,createdAt:now,createdBy:'user-admin'},
   {id:'old-ten-'+capacity,templateId:id,dipMillimetresMilliunits:10000,volumeMilliunits:10000,createdAt:now,createdBy:'user-admin'},
  ]);
  return id;
 }
 it('purges old 10/20 global rows, installs PDF values and leaves 50/25 KL unchanged',async()=>{
  const db=getDb(localD1);
  const old10=await prepareOldSource(10000,'EXCEL_10KL_REFERENCE');
  const old20=await prepareOldSource(20000,'EXCEL_20KL_REFERENCE');
  const allBefore=await db.select().from(schema.tanks);
  const twentyFive=allBefore.find(t=>t.id==='tank-ro1-2');
  const fiftyTemplate=await db.select().from(schema.globalTankCalibrationTemplates)
   .where(eq(schema.globalTankCalibrationTemplates.code,'STANDARD_50KL'));
  const fiftyPoints=await db.select().from(schema.globalTankCalibrationTemplatePoints)
   .where(eq(schema.globalTankCalibrationTemplatePoints.templateId,fiftyTemplate[0].id));
  const stockBefore=await db.select().from(schema.tankStockReadings);
  const preview=await request('GET','/calibration-templates/replace-10-20-preview');
  expect(preview.status).toBe(200);
  expect((await preview.json() as any).data.oldGlobalSources).toBeGreaterThan(0);
  expect((await request('POST','/calibration-templates/replace-10-20',{confirm:'CLEAR ALL CALIBRATION'})).status).toBe(400);
  const response=await request('POST','/calibration-templates/replace-10-20',{confirm:'REPLACE 10KL 20KL'});
  expect(response.status).toBe(200);
  expect((await response.json() as any).data.completed).toBe(true);
  const after=await db.select().from(schema.globalTankCalibrationTemplates);
  for(const id of [old10,old20]){
   expect(after.find(t=>t.id===id)?.status).toBe('ARCHIVED');
   expect(await db.select().from(schema.globalTankCalibrationTemplatePoints)
    .where(eq(schema.globalTankCalibrationTemplatePoints.templateId,id))).toHaveLength(0);
  }
  for(const capacity of [10000,20000]){
   const source=operatorPdfSource(capacity)!;
   const saved=after.find(t=>t.code===source.code);
   expect(saved?.status).toBe('APPROVED');
   const rows=await db.select().from(schema.globalTankCalibrationTemplatePoints)
    .where(eq(schema.globalTankCalibrationTemplatePoints.templateId,saved!.id));
   expect(rows).toHaveLength(source.points.length);
   const record=rows.find(row=>row.dipMillimetresMilliunits===2020000);
   if(capacity===20000)expect(record?.volumeMilliunits).toBe(21359520);
   const defaults=await db.select().from(schema.globalTankCapacityDefaults)
    .where(eq(schema.globalTankCapacityDefaults.capacityLitres,capacity));
   expect(defaults[0]?.templateId).toBe(saved!.id);
  }
  const afterTanks=await db.select().from(schema.tanks);
  expect(afterTanks.find(t=>t.id==='tank-ro1-1')?.status).toBe('INACTIVE');
  expect(afterTanks.find(t=>t.id==='tank-ro1-2')?.status).toBe(twentyFive?.status);
  expect(await db.select().from(schema.globalTankCalibrationTemplatePoints)
   .where(eq(schema.globalTankCalibrationTemplatePoints.templateId,fiftyTemplate[0].id))).toEqual(fiftyPoints);
  expect(await db.select().from(schema.tankStockReadings)).toEqual(stockBefore);
  const audit=await db.select().from(schema.auditLogs)
   .where(eq(schema.auditLogs.action,'REPLACE_10KL_20KL_WITH_PDF'));
  expect(audit).toHaveLength(1);
 });
 it('preserves existing historically referenced 20KL tank chart rows',async()=>{
  const db=getDb(localD1),now=new Date().toISOString(),oldId='tcc-legacy-tank-ro1-1-r1';
  const oldPoints=await db.select().from(schema.tankCalibrationPoints)
   .where(eq(schema.tankCalibrationPoints.chartId,oldId));
  const [template]=await db.select().from(schema.globalShiftTemplates);
  const id='old-20kl-history-'+Math.random().toString(36).slice(2);
  await db.insert(schema.operationalShifts).values({
   id,outletId:'ro-1001',shiftTemplateId:template.id,businessDate:'2024-01-01',
   startedAt:'2024-01-01T06:00:00Z',closedAt:'2024-01-01T14:00:00Z',
   status:'CLOSED',openedByUserId:'user-admin',closedByUserId:'user-admin',
   createdAt:now,updatedAt:now
  });
  await db.insert(schema.tankStockReadings).values({
   id:'old-stock-'+id,operationalShiftId:id,outletId:'ro-1001',
   tankId:'tank-ro1-1',productId:'prod-ms',readingType:'OPENING',source:'MANUAL',
   productDipMmMilliunits:1000000,waterDipMmMilliunits:0,
   grossObservedVolumeMilliunits:8000000,waterVolumeMilliunits:0,
   netProductVolumeMilliunits:8000000,calibrationChartId:oldId,
   calibrationRevision:1,recordedAt:now,recordedByUserId:'user-admin',createdAt:now,updatedAt:now
  });
  const action=await request('POST','/calibration-templates/replace-10-20',{confirm:'REPLACE 10KL 20KL'});
  expect(action.status).toBe(200);
  const [chart]=await db.select().from(schema.tankCalibrationCharts)
   .where(eq(schema.tankCalibrationCharts.id,oldId));
  expect(chart.status).toBe('ARCHIVED');
  const points=await db.select().from(schema.tankCalibrationPoints)
   .where(eq(schema.tankCalibrationPoints.chartId,oldId));
  expect(points).toEqual(oldPoints);
  const [reading]=await db.select().from(schema.tankStockReadings)
   .where(eq(schema.tankStockReadings.operationalShiftId,id));
  expect(reading.netProductVolumeMilliunits).toBe(8000000);
  expect(reading.calibrationChartId).toBe(oldId);
 });
 it('blocks requested deletion while an operational shift is open',async()=>{
  const db=getDb(localD1),now=new Date().toISOString();
  const [shiftTemplate]=await db.select().from(schema.globalShiftTemplates);
  await db.insert(schema.operationalShifts).values({
   id:'open-shift-blocks-10kl-20kl',outletId:'ro-1001',
   shiftTemplateId:shiftTemplate.id,businessDate:'2026-11-24',
   startedAt:now,status:'OPEN',openedByUserId:'user-admin',createdAt:now,updatedAt:now
  });
  const res=await request('POST','/calibration-templates/replace-10-20',{confirm:'REPLACE 10KL 20KL'});
  expect(res.status).toBe(409);
  const j=await res.json() as any;
  expect(j.error.code).toBe('SHIFT_OPEN');
  const preview=await request('GET','/calibration-templates/replace-10-20-preview');
  expect(preview.status).toBe(200);
  const details=(await preview.json() as any).data;
  expect(details.openOrClosingShifts).toBe(1);
  expect(details.blockingShifts).toHaveLength(1);
  expect(details.blockingShifts[0]).toMatchObject({
   id:'open-shift-blocks-10kl-20kl',
   outletId:'ro-1001',
   businessDate:'2026-11-24',
   status:'OPEN',
  });
  expect(details.blockingShifts[0].outletCode).toBeTruthy();
  expect(details.blockingShifts[0].shiftName).toBeTruthy();
  const [tank]=await db.select().from(schema.tanks)
   .where(eq(schema.tanks.id,'tank-ro1-1'));
  expect(tank.status).toBe('ACTIVE');
 });
 it('rolls back old-data purge if audit insert fails',async()=>{
  const db=getDb(localD1);
  const old=await prepareOldSource(10000,'EXCEL_10KL_REFERENCE');
  await localD1.exec("CREATE TRIGGER prevent_pdf_replacement_audit BEFORE INSERT ON audit_logs WHEN NEW.action='REPLACE_10KL_20KL_WITH_PDF' BEGIN SELECT RAISE(ABORT,'AUDIT_FAILURE'); END;");
  const result=await request('POST','/calibration-templates/replace-10-20',{confirm:'REPLACE 10KL 20KL'});
  expect(result.status).toBe(500);
  const [oldSource]=await db.select().from(schema.globalTankCalibrationTemplates)
   .where(eq(schema.globalTankCalibrationTemplates.id,old));
  expect(oldSource.status).toBe('APPROVED');
  expect(await db.select().from(schema.globalTankCalibrationTemplatePoints)
   .where(eq(schema.globalTankCalibrationTemplatePoints.templateId,old))).toHaveLength(2);
  const [oldTank]=await db.select().from(schema.tanks)
   .where(eq(schema.tanks.id,'tank-ro1-1'));
  expect(oldTank.status).toBe('ACTIVE');
 });
});
