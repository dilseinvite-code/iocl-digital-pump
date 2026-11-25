import { createLocalD1Database } from '../src/db/localD1';
import { getDb } from '../src/db';
import { seedDatabase } from '../src/db/seed';
import { PumpRepository } from '../src/worker/repositories/pumpRepository';
import * as schema from '../src/db/schema';
import {eq} from 'drizzle-orm';
import fs from 'node:fs';
import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {isConfirmedFiftyKlTarget,validConfirmedFiftyKlSource,validConfirmedFiftyKlLimits} from '../src/shared/confirmedFiftyKlReference';
const tank={tankNumber:2,capacityLitres:50000,productCode:'HSD',status:'ACTIVE'};
const source={id:'gtct-std-50kl',code:'STANDARD_50KL',nominalCapacityLitres:50000,status:'APPROVED',tankDiameterMmMilliunits:3000000,tankLengthMmMilliunits:7500000,maxDipMmMilliunits:3000000};
// Synthetic monotone test fixture only; production copies the actual saved source rows.
const rows=Array.from({length:301},(_,i)=>({dipMillimetresMilliunits:i*10000,volumeMilliunits:Math.round(i*53015000/300)}));
describe('Scoped confirmed 50 KL reference',()=>{
  it('allows only the two specified COCO 33 tanks',()=>{
    expect(isConfirmedFiftyKlTarget('394535',tank)).toBe(true);
    expect(isConfirmedFiftyKlTarget('394535',{...tank,tankNumber:3,productCode:'MS'})).toBe(true);
    expect(isConfirmedFiftyKlTarget('395633',tank)).toBe(false);
    expect(isConfirmedFiftyKlTarget('394535',{...tank,tankNumber:1})).toBe(false);
    expect(isConfirmedFiftyKlTarget('394535',{...tank,capacityLitres:20000})).toBe(false);
  });
  it('requires complete valid approved chart with matching dimensions and endpoints',()=>{
    expect(validConfirmedFiftyKlSource(source,rows)).toBe(true);
    expect(validConfirmedFiftyKlSource({...source,status:'DRAFT'},rows)).toBe(false);
    expect(validConfirmedFiftyKlSource({...source,tankLengthMmMilliunits:6500000},rows)).toBe(false);
    expect(validConfirmedFiftyKlSource({...source,requiresEngineeringReview:true},rows)).toBe(false);
    expect(validConfirmedFiftyKlSource(source,rows.slice(0,-1))).toBe(false);
    expect(validConfirmedFiftyKlSource(source,rows.map((r,i)=>i===100?{...r,volumeMilliunits:0}:r))).toBe(false);
  });
  it('preserves operational limits and rejects invalid ones',()=>{
    const limits={capacityLitres:50000,safeFillCapacityLitres:50000,minimumOperatingLevelLitres:5000};
    expect(validConfirmedFiftyKlLimits(limits)).toBe(true);
    expect(validConfirmedFiftyKlLimits({...limits,safeFillCapacityLitres:53015})).toBe(false);
    expect(validConfirmedFiftyKlLimits({...limits,minimumOperatingLevelLitres:50000})).toBe(false);
  });
  it('retains authority, explicit attestation, open-shift protection and atomic audit without claiming a certificate',()=>{
    const repo=readFileSync('src/worker/repositories/pumpRepository.ts','utf8');
    const method=repo.slice(repo.indexOf('async activateConfirmedFiftyKlReference'),repo.indexOf('async updateCalibrationChartStatus'));
    expect(method).toContain('findActiveOperationalShift');
    expect(method).toContain('EXISTING_CHART_PROTECTED');
    expect(method).toContain('confirmCompatibility!==true');
    expect(method).toContain('certificateProvided:false');
    expect(method).toContain('referenceDocument:null');
    expect(method).toContain('batch(batch)');
    expect(repo).toContain('if (chart.sourceFileName === CONFIRMED_50KL_SOURCE_MARKER) continue');
    const route=readFileSync('src/worker/routes/tankCalibration.ts','utf8');
    const section=route.slice(route.indexOf("tankCalibration.post('/tanks/:tankId/calibration/confirmed-50kl-reference'"));
    expect(section).toContain('canAuthorizeCalibrationActivation(c)');
    expect(section).toContain('verifyOutletAuthority');
    expect(section).toContain('activateConfirmedFiftyKlReference');
  });
});

describe('Confirmed 50 KL persistence in isolated test database',()=>{
  it('copies the existing reference atomically, retains limits, records attestation and avoids duplicate revisions',async()=>{
    const file='./.sqlite/confirmed-50kl-'+crypto.randomUUID()+'.db';
    fs.mkdirSync('./.sqlite',{recursive:true});
    const local=createLocalD1Database(file);
    try {
      const db=getDb(local);await seedDatabase(db);
      const now=new Date().toISOString();
      const [outlet]=await db.select().from(schema.retailOutlets).where(eq(schema.retailOutlets.id,'ro-1001'));
      const outletId='ro-test-confirmed-50kl';
      await db.insert(schema.retailOutlets).values({...outlet,id:outletId,roCode:'394535',name:'Test COCO 33',outletType:'COCO',status:'ACTIVE'});
      const tankId='tank-test-confirmed-50kl';
      await db.insert(schema.tanks).values({id:tankId,outletId,tankNumber:2,name:'Test HSD tank',productId:'prod-hsd',capacityLitres:50000,safeFillCapacityLitres:50000,minimumOperatingLevelLitres:5000,status:'ACTIVE',createdBy:'user-admin',createdAt:now,updatedAt:now});
      // Local test fixture only; no production source is synthesized or overwritten.
      await db.update(schema.globalTankCalibrationTemplates).set({status:'DRAFT'}).where(eq(schema.globalTankCalibrationTemplates.id,source.id));
      await db.delete(schema.globalTankCalibrationTemplatePoints).where(eq(schema.globalTankCalibrationTemplatePoints.templateId,source.id));
      for(let i=0;i<rows.length;i+=5)await db.insert(schema.globalTankCalibrationTemplatePoints).values(rows.slice(i,i+5).map((r,k)=>({...r,id:'test-50kl-point-'+(i+k),templateId:source.id,createdAt:now,createdBy:'user-admin'})));
      await db.update(schema.globalTankCalibrationTemplates).set({status:'APPROVED',revisionNumber:1,approvedAt:now,approvedBy:'user-admin'}).where(eq(schema.globalTankCalibrationTemplates.id,source.id));
      const repo=new PumpRepository(db);
      const confirm={sourceRevision:1,diameterMm:3000,lengthMm:7500,maxDipMm:3000,safeFillLitres:50000,minimumOperatingLitres:5000,confirmCompatibility:true};
      await expect(repo.activateConfirmedFiftyKlReference(tankId,'user-admin',{...confirm,confirmCompatibility:false})).rejects.toThrow();
      const applied=await repo.activateConfirmedFiftyKlReference(tankId,'user-admin',confirm);
      expect(applied.chart.status).toBe('ACTIVE');
      const copied=await repo.listCalibrationPoints(tankId,{chartId:applied.chart.id});
      expect(copied.map(r=>({dipMillimetresMilliunits:r.dipMillimetresMilliunits,volumeMilliunits:r.volumeMilliunits}))).toEqual(rows);
      expect((await repo.findTankById(tankId))?.safeFillCapacityLitres).toBe(50000);
      const [audit]=await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.entityId,applied.chart.id));
      expect(audit.action).toBe('TANK_CALIBRATION_ADMIN_CONFIRMED_50KL_REFERENCE');
      expect(JSON.parse(audit.newValueJson!).certificateProvided).toBe(false);
      const again=await repo.activateConfirmedFiftyKlReference(tankId,'user-admin',confirm);
      expect(again.alreadyApplied).toBe(true);
      expect(again.chart.id).toBe(applied.chart.id);
      expect((await repo.listCalibrationCharts(tankId)).length).toBe(1);
    } finally {local.close();if(fs.existsSync(file))fs.unlinkSync(file);}
  });
});
