import {beforeEach,afterEach,describe,it,expect} from 'vitest';
import fs from 'node:fs';
import app from '../src/worker/app';
import {createLocalD1Database} from '../src/db/localD1';
import {getDb} from '../src/db';
import * as schema from '../src/db/schema';
import {seedDatabase} from '../src/db/seed';
import {ExcelCalibrationImportService} from '../src/worker/services/excelCalibrationImportService';
import {eq} from 'drizzle-orm';

describe('Admin fresh start: archive all old calibration, preserve historic stock',()=>{
 let localD1:any,env:any,dbPath:string,cookie:string;
 beforeEach(async()=>{
   dbPath='./.sqlite/test_clear_all_cal_'+Math.random().toString(36).slice(2)+'.db';
   localD1=createLocalD1Database(dbPath);
   const db=getDb(localD1);
   await seedDatabase(db);
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
 const request=(method:string,path:string,payload?:any)=>app.fetch(
   new Request('http://localhost/api/v1'+path,{
     method,headers:{'Content-Type':'application/json',Cookie:cookie,Origin:'http://localhost:3000'},
     ...(payload===undefined?{}:{body:JSON.stringify(payload)})
   }),env);
 async function addTemplateAndDefault(){
   const db=getDb(localD1),now=new Date().toISOString();
   await db.insert(schema.globalTankCalibrationTemplates).values({
     id:'gtct-erase-test',code:'FRESH_RESET_TEST_10KL',name:'Previous 10 KL readings',
     nominalCapacityLitres:10000,revisionNumber:1,status:'APPROVED',
     tankDiameterMmMilliunits:1940000,tankLengthMmMilliunits:3750000,
     maxDipMmMilliunits:1940000,sourceFileName:'old-calibration.xlsx',
     createdAt:now,updatedAt:now,createdBy:'user-admin'
   });
   await db.insert(schema.globalTankCalibrationTemplatePoints).values([
     {id:'old-dip-0',templateId:'gtct-erase-test',dipMillimetresMilliunits:0,volumeMilliunits:0,createdAt:now,createdBy:'user-admin'},
     {id:'old-dip-1940',templateId:'gtct-erase-test',dipMillimetresMilliunits:1940000,volumeMilliunits:11073410,createdAt:now,createdBy:'user-admin'}
   ]);
   await db.insert(schema.globalTankCapacityDefaults).values({
     capacityLitres:10000,templateId:'gtct-erase-test',updatedBy:'user-admin',updatedAt:now
   }).onConflictDoNothing();
 }
 it('archives all global and tank charts, clears default selection and inactivates tanks without deleting historic values',async()=>{
   const db=getDb(localD1);
   await addTemplateAndDefault();
   const beforePoints=await db.select().from(schema.tankCalibrationPoints);
   const beforeTemplates=await db.select().from(schema.globalTankCalibrationTemplatePoints);
   const stockBefore=await db.select().from(schema.tankStockReadings);
   const snapshotsBefore=await db.select().from(schema.operationalShiftTanks);
   const baseline=await db.select().from(schema.tankCalibrationCharts);
   expect(baseline.some(c=>c.status==='ACTIVE')).toBe(true);
   const preview=await request('GET','/calibration-templates/reset-all-preview');
   expect(preview.status).toBe(200);
   const plan=(await preview.json() as any).data;
   expect(plan.openOrClosingShifts).toBe(0);
   expect(plan.globalSourcesToArchive).toBeGreaterThan(0);
   expect(plan.tankChartsToArchive).toBeGreaterThan(0);
   expect(plan.defaultChartMappingsToClear).toBeGreaterThan(0);
   expect((await request('POST','/calibration-templates/reset-all',{confirm:'CLEAR'})).status).toBe(400);
   const result=await request('POST','/calibration-templates/reset-all',{confirm:'CLEAR ALL CALIBRATION'});
   expect(result.status).toBe(200);
   expect((await result.json() as any).data.completed).toBe(true);
   const templates=await db.select().from(schema.globalTankCalibrationTemplates);
   expect(templates.every(t=>t.status==='ARCHIVED'||t.status==='SUPERSEDED')).toBe(true);
   const charts=await db.select().from(schema.tankCalibrationCharts);
   expect(charts.every(c=>c.status==='ARCHIVED'||c.status==='SUPERSEDED')).toBe(true);
   expect(await db.select().from(schema.globalTankCapacityDefaults)).toHaveLength(0);
   const tanks=await db.select().from(schema.tanks);
   expect(tanks.every(t=>t.status!=='ACTIVE')).toBe(true);
   expect(await db.select().from(schema.tankCalibrationPoints)).toEqual(beforePoints);
   expect(await db.select().from(schema.globalTankCalibrationTemplatePoints)).toEqual(beforeTemplates);
   expect(await db.select().from(schema.tankStockReadings)).toEqual(stockBefore);
   expect(await db.select().from(schema.operationalShiftTanks)).toEqual(snapshotsBefore);
   const audit=await db.select().from(schema.auditLogs)
     .where(eq(schema.auditLogs.action,'ALL_CALIBRATION_ARCHIVED_FOR_FRESH_START'));
   expect(audit).toHaveLength(1);
   const next=await request('POST','/outlets/ro-1001/tanks/quick-register',{
     name:'Fresh 10 KL tank after reset',capacityLitres:10000
   });
   expect(next.status).toBe(409);
   const error=(await next.json() as any).error.code;
   expect(['CALIBRATION_NOT_FOUND','DEFAULT_CHART_REQUIRED']).toContain(error);
 });
 it('blocks the organization-wide reset while any shift is OPEN or CLOSING',async()=>{
   const db=getDb(localD1),now=new Date().toISOString();
   const [shiftTemplate]=await db.select().from(schema.globalShiftTemplates);
   await db.insert(schema.operationalShifts).values({
     id:'reset-open-shift',outletId:'ro-1001',shiftTemplateId:shiftTemplate.id,
     businessDate:'2026-11-24',startedAt:now,status:'OPEN',
     openedByUserId:'user-admin',createdAt:now,updatedAt:now
   });
   const preview=await request('GET','/calibration-templates/reset-all-preview');
   expect((await preview.json() as any).data.openOrClosingShifts).toBe(1);
   const failed=await request('POST','/calibration-templates/reset-all',{
     confirm:'CLEAR ALL CALIBRATION'
   });
   expect(failed.status).toBe(409);
   expect((await failed.json() as any).error.code).toBe('OPEN_SHIFTS_BLOCK_CALIBRATION_RESET');
   const [old]=await db.select().from(schema.tankCalibrationCharts)
     .where(eq(schema.tankCalibrationCharts.id,'tcc-legacy-tank-ro1-1-r1'));
   expect(old.status).toBe('ACTIVE');
 });
 it('rolls back all calibration and tank status updates if the mandatory audit fails',async()=>{
   const db=getDb(localD1);
   await addTemplateAndDefault();
   await localD1.exec("CREATE TRIGGER deny_global_calibration_reset BEFORE INSERT ON audit_logs WHEN NEW.action='ALL_CALIBRATION_ARCHIVED_FOR_FRESH_START' BEGIN SELECT RAISE(ABORT,'AUDIT_RESET_REJECTED'); END;");
   const response=await request('POST','/calibration-templates/reset-all',{
     confirm:'CLEAR ALL CALIBRATION'
   });
   expect(response.status).toBe(500);
   const [chart]=await db.select().from(schema.tankCalibrationCharts)
     .where(eq(schema.tankCalibrationCharts.id,'tcc-legacy-tank-ro1-1-r1'));
   expect(chart.status).toBe('ACTIVE');
   const [template]=await db.select().from(schema.globalTankCalibrationTemplates)
     .where(eq(schema.globalTankCalibrationTemplates.id,'gtct-erase-test'));
   expect(template.status).toBe('APPROVED');
   expect(await db.select().from(schema.globalTankCapacityDefaults)).toHaveLength(1);
   const [tank]=await db.select().from(schema.tanks)
     .where(eq(schema.tanks.id,'tank-ro1-1'));
   expect(tank.status).toBe('ACTIVE');
 });
 it('imports a fresh Excel revision without reopening the archived source code',async()=>{
   const db=getDb(localD1),now=new Date().toISOString();
   await db.insert(schema.globalTankCalibrationTemplates).values({
     id:'archive-original-excel-10',code:'EXCEL_10KL_REFERENCE',name:'Old Excel 10 KL',
     nominalCapacityLitres:10000,status:'ARCHIVED',revisionNumber:1,
     createdAt:now,updatedAt:now,createdBy:'user-admin'
   });
   const workbook=fs.readFileSync('tests/fixtures/20KL_15KL_10KL_calibration_Dip_chart.xlsx');
   const extracted=await ExcelCalibrationImportService.extractWorkbook(workbook,'fresh.xlsx');
   const result=await ExcelCalibrationImportService.importEligibleCharts(
     db,extracted,{userId:'user-admin'},
     {confirmImport:true,targetCodes:['EXCEL_10KL_REFERENCE']}
   );
   expect(result.importedTemplates).toHaveLength(1);
   const fresh=result.importedTemplates[0];
   expect(fresh.code).toMatch(/^EXCEL_10KL_REFERENCE_FRESH_[A-F0-9]{8}$/);
   expect(fresh.status).toBe('DRAFT');
   const [archived]=await db.select().from(schema.globalTankCalibrationTemplates)
     .where(eq(schema.globalTankCalibrationTemplates.id,'archive-original-excel-10'));
   expect(archived.status).toBe('ARCHIVED');
   const saved=await db.select().from(schema.globalTankCalibrationTemplates)
     .where(eq(schema.globalTankCalibrationTemplates.code,fresh.code));
   expect(saved).toHaveLength(1);
   const points=await db.select().from(schema.globalTankCalibrationTemplatePoints)
     .where(eq(schema.globalTankCalibrationTemplatePoints.templateId,saved[0].id));
   expect(points).toHaveLength(195);
 });

 it('does not resurrect orphan legacy calibration points after the all-chart reset',async()=>{
   const db=getDb(localD1),now=new Date().toISOString(),id='legacy-only-reset-tank';
   await db.insert(schema.tanks).values({
     id,outletId:'ro-1001',tankNumber:99,name:'Old unversioned 10KL tank',
     productId:'prod-ms',capacityLitres:10000,safeFillCapacityLitres:9000,
     minimumOperatingLevelLitres:0,status:'ACTIVE',createdAt:now,updatedAt:now,
     createdBy:'user-admin'
   });
   await db.insert(schema.tankCalibrationPoints).values([
     {id:'legacy-unlinked-zero',chartId:null,tankId:id,dipMillimetresMilliunits:0,
       volumeMilliunits:0,createdAt:now,createdBy:'user-admin'},
     {id:'legacy-unlinked-ten',chartId:null,tankId:id,dipMillimetresMilliunits:10000,
       volumeMilliunits:6900,createdAt:now,createdBy:'user-admin'},
   ]);
   const reset=await request('POST','/calibration-templates/reset-all',{
     confirm:'CLEAR ALL CALIBRATION'
   });
   expect(reset.status).toBe(200);
   const view=await request('GET','/tanks/'+id+'/calibration');
   expect(view.status).toBe(200);
   const body=(await view.json() as any);
   expect(body.data).toHaveLength(0);
   expect(body.activeChart).toBeNull();
   const charts=await db.select().from(schema.tankCalibrationCharts)
     .where(eq(schema.tankCalibrationCharts.tankId,id));
   expect(charts).toHaveLength(0);
   const oldPoints=await db.select().from(schema.tankCalibrationPoints)
     .where(eq(schema.tankCalibrationPoints.tankId,id));
   expect(oldPoints).toHaveLength(2);
   expect(oldPoints.every(p=>p.chartId===null)).toBe(true);
 });

});
