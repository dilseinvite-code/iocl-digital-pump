import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import app from '../src/worker/app';
import { createLocalD1Database } from '../src/db/localD1';
import { getDb } from '../src/db';
import * as schema from '../src/db/schema';
import { seedDatabase } from '../src/db/seed';
import {parseSimpleCalibrationCsv} from '../src/frontend/components/pump/simpleCalibrationCsv';
import {join} from 'node:path';
import {SCANNED_CALIBRATION_REFERENCES} from '../src/shared/scannedCalibrationReference';
import {operatorPdfSource} from '../src/shared/operatorPdfSourceData';
import { and, eq } from 'drizzle-orm';

const requirePdfCsv=(kl:10|20)=>{
  const file=join(process.cwd(),'docs/calibration/pdf-source-candidates','scanned-'+kl+'kl-10mm.csv');
  const parsed=parseSimpleCalibrationCsv(fs.readFileSync(file,'utf8'));
  if(!parsed.valid||parsed.errors.length)throw new Error('Unusable scanned PDF chart: '+parsed.errors.join('; '));
  return parsed.points;
};

describe('Two-input global-calibration tank registration', () => {
  let localD1: any;
  let env: any;
  let dbPath: string;
  let cookie: string;

  beforeEach(async () => {
    dbPath = './.sqlite/test_quick_tanks_' + Math.random().toString(36).slice(2) + '.db';
    localD1 = createLocalD1Database(dbPath);
    const db = getDb(localD1);
    await seedDatabase(db);
    env = { DB: localD1, DOCUMENTS_BUCKET: null };
    const logged = await app.fetch(new Request('http://localhost/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({ email: 'admin@iocl.in', password: 'Password@123' }),
    }), env);
    expect(logged.status).toBe(200);
    cookie = logged.headers.get('set-cookie')?.split(';')[0] || '';
  });

  afterEach(() => {
    try { localD1.close(); } catch {}
    for (const ext of ['', '-wal', '-shm']) try { fs.unlinkSync(dbPath + ext); } catch {}
  });

  const request = (method: string, path: string, payload?: any) => app.fetch(
    new Request('http://localhost/api/v1' + path, {
      method, headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'http://localhost:3000' },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    }), env
  );

  async function createCalibratedFifteenKlVariants() {
    const db = getDb(localD1);
    const now = new Date().toISOString();
    await db.insert(schema.globalTankCalibrationTemplates).values({
      id:'gtct-test-std-15kl', code:'TEST_STANDARD_15KL',
      name:'Test standard 15 KL', nominalCapacityLitres:15000,
      revisionNumber:1, status:'DRAFT',
      tankDiameterMmMilliunits:1940000, tankLengthMmMilliunits:5500000,
      maxDipMmMilliunits:1940000, createdBy:'user-admin',
      createdAt:now, updatedAt:now,
    });
    await db.insert(schema.globalTankCalibrationTemplatePoints).values([
      { id: 'quick-std-0', templateId: 'gtct-test-std-15kl', dipMillimetresMilliunits: 0, volumeMilliunits: 0, createdAt: now, createdBy: 'user-admin' },
      { id: 'quick-std-1', templateId: 'gtct-test-std-15kl', dipMillimetresMilliunits: 1940000, volumeMilliunits: 16246300, createdAt: now, createdBy: 'user-admin' },
    ]);
    await db.insert(schema.globalTankCalibrationTemplates).values({
      id: 'gtct-quick-alt', code: 'QUICK_ALT_15KL', name: 'Second 15KL reference',
      nominalCapacityLitres: 15000, revisionNumber: 1, status: 'DRAFT',
      tankDiameterMmMilliunits: 1940000, tankLengthMmMilliunits: 5500000,
      maxDipMmMilliunits: 1940000, createdBy: 'user-admin', createdAt: now, updatedAt: now,
    });
    await db.insert(schema.globalTankCalibrationTemplatePoints).values([
      { id: 'quick-alt-0', templateId: 'gtct-quick-alt', dipMillimetresMilliunits: 0, volumeMilliunits: 0, createdAt: now, createdBy: 'user-admin' },
      { id: 'quick-alt-1', templateId: 'gtct-quick-alt', dipMillimetresMilliunits: 1940000, volumeMilliunits: 16240000, createdAt: now, createdBy: 'user-admin' },
    ]);
  }

  it('requires a one-time default for two saved charts, registers by only name and capacity, and never invents a fuel grade', async () => {
    const db = getDb(localD1);
    await createCalibratedFifteenKlVariants();
    const beforeTanks = await db.select().from(schema.tanks);
    const noDefault = await request('POST', '/outlets/ro-1001/tanks/quick-register',
      { name: 'New MS Underground Tank', capacityLitres: 15000 });
    expect(noDefault.status).toBe(409);
    expect(((await noDefault.json()) as any).error.code).toBe('DEFAULT_CHART_REQUIRED');

    const selectDefault = await request('PUT', '/global-tank-defaults/15000', { templateId: 'gtct-test-std-15kl' });
    expect(selectDefault.status).toBe(200);

    const created = await request('POST', '/outlets/ro-1001/tanks/quick-register',
      { name: 'New MS Underground Tank', capacityLitres: 15000 });
    expect(created.status).toBe(201);
    const createdJson = (await created.json()) as any;
    expect(createdJson.data.templateId).toBe('gtct-test-std-15kl');
    expect(createdJson.data.status).toBe('PENDING_FUEL');
    expect((await db.select().from(schema.tanks)).length).toBe(beforeTanks.length);

    const pending = await request('GET', '/outlets/ro-1001/pending-tanks');
    expect(pending.status).toBe(200);
    expect(((await pending.json()) as any).data).toHaveLength(1);

    const mapped = await request('POST',
      '/outlets/ro-1001/pending-tanks/' + createdJson.data.id + '/finalize', { productId: 'prod-ms' });
    expect(mapped.status).toBe(201);
    const mappedJson = (await mapped.json()) as any;
    expect(mappedJson.data.status).toBe('INACTIVE');
    expect(mappedJson.data.calibrationStatus).toBe('DRAFT');
    expect(mappedJson.data.pointsCount).toBe(2);

    const tank = (await db.select().from(schema.tanks).where(eq(schema.tanks.id, mappedJson.data.id)))[0];
    expect(tank).toBeDefined();
    expect(tank.productId).toBe('prod-ms');
    expect(tank.capacityLitres).toBe(15000);
    expect(tank.safeFillCapacityLitres).toBe(13500);
    const charts = await db.select().from(schema.tankCalibrationCharts)
      .where(eq(schema.tankCalibrationCharts.tankId, tank.id));
    expect(charts).toHaveLength(1);
    expect(charts[0].status).toBe('DRAFT');
    expect(charts[0].sourceTemplateId).toBe('gtct-test-std-15kl');
    const points = await db.select().from(schema.tankCalibrationPoints)
      .where(eq(schema.tankCalibrationPoints.chartId, charts[0].id));
    expect(points).toHaveLength(2);
    expect(points[1].volumeMilliunits).toBe(16246300);
    const pendingAfter = await db.select().from(schema.pendingUndergroundTanks)
      .where(and(eq(schema.pendingUndergroundTanks.id, createdJson.data.id),
        eq(schema.pendingUndergroundTanks.status, 'FINALIZED')));
    expect(pendingAfter).toHaveLength(1);
    expect(pendingAfter[0].finalizedTankId).toBe(tank.id);
    // A repeated submit must never create another physical tank or chart.
    const retry = await request('POST',
      '/outlets/ro-1001/pending-tanks/' + createdJson.data.id + '/finalize', { productId: 'prod-ms' });
    expect(retry.status).toBe(409);
    expect((await db.select().from(schema.tanks)).length).toBe(beforeTanks.length + 1);
    const audit = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.entityId, tank.id));
    expect(audit.some(a => a.action === 'TANK_REGISTER_FINALIZE')).toBe(true);
  });


  it('requires chart activation and independent operator confirmations before making a newly registered tank ACTIVE', async () => {
    const db = getDb(localD1);
    await createCalibratedFifteenKlVariants();
    const chosen = await request('PUT', '/global-tank-defaults/15000', { templateId: 'gtct-test-std-15kl' });
    expect(chosen.status).toBe(200);
    const queued = await request('POST', '/outlets/ro-1001/tanks/quick-register', {
      name: 'Activation Test Tank', capacityLitres: 15000,
    });
    expect(queued.status).toBe(201);
    const pendingId = ((await queued.json()) as any).data.id;
    const finalized = await request('POST', '/outlets/ro-1001/pending-tanks/' + pendingId + '/finalize', {
      productId: 'prod-ms',
    });
    expect(finalized.status).toBe(201);
    const tankId = ((await finalized.json()) as any).data.id;
    const payload = {
      name: 'Activation Test Tank', productId: 'prod-ms', capacityLitres: 15000,
      safeFillCapacityLitres: 13500, minimumOperatingLevelLitres: 0, status: 'ACTIVE',
    };
    const unconfirmed = await request('PUT', '/tanks/' + tankId, payload);
    expect(unconfirmed.status).toBe(409);
    expect(((await unconfirmed.json()) as any).error.code).toBe('TANK_ACTIVATION_CONFIRMATION_REQUIRED');

    const confirmedPayload = { ...payload, confirmPhysicalCompatibility: true, confirmOperationalLimits: true };
    const draftBlocked = await request('PUT', '/tanks/' + tankId, confirmedPayload);
    expect(draftBlocked.status).toBe(409);
    expect(((await draftBlocked.json()) as any).error.code).toBe('TANK_ACTIVE_CALIBRATION_REQUIRED');

    const patchBlocked = await request('PATCH', '/tanks/' + tankId + '/status', { status: 'ACTIVE' });
    expect(patchBlocked.status).toBe(409);
    expect(((await patchBlocked.json()) as any).error.code).toBe('TANK_ACTIVATION_CONFIRMATION_REQUIRED');
    expect((await db.select().from(schema.tanks).where(eq(schema.tanks.id, tankId)))[0].status).toBe('INACTIVE');

    const chart = (await db.select().from(schema.tankCalibrationCharts)
      .where(eq(schema.tankCalibrationCharts.tankId, tankId)))[0];
    expect(chart.status).toBe('DRAFT');
    // This isolated fixture simulates an independently approved/activated chart.
    // Live production chart approval is performed ONLY by the governed chart API.
    await db.update(schema.tankCalibrationCharts).set({
      status: 'ACTIVE', approvedBy: 'user-admin', approvedAt: new Date().toISOString(),
    }).where(eq(schema.tankCalibrationCharts.id, chart.id));

    const badLimits = await request('PUT', '/tanks/' + tankId, {
      ...confirmedPayload, minimumOperatingLevelLitres: 13500,
    });
    expect(badLimits.status).toBe(409);
    expect(((await badLimits.json()) as any).error.code).toBe('TANK_OPERATING_LIMITS_INVALID');

    const good = await request('PUT', '/tanks/' + tankId, confirmedPayload);
    expect(good.status).toBe(200);
    expect(((await good.json()) as any).data.status).toBe('ACTIVE');
    const audit = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.entityId, tankId));
    expect(audit.some(a => a.action === 'QUICK_TANK_OPERATIONAL_ACTIVATION')).toBe(true);

    // After the tank is activated, later ordinary edits do not require re-confirming it.
    const rename = await request('PUT', '/tanks/' + tankId, { name: 'Approved Activation Test Tank' });
    expect(rename.status).toBe(200);
  });

  it('reuses a fully approved, warning-free global chart without second approval while leaving the tank INACTIVE', async () => {
    const db = getDb(localD1);
    const now = new Date().toISOString();
    const templateId = 'gtct-std-50kl';
    // Fixture only: emulate a global template that already completed its
    // one-time approval. Production approval is governed by its own API.
    await db.insert(schema.globalTankCalibrationTemplatePoints).values([
      { id:'fixture-50kl-zero', templateId, dipMillimetresMilliunits:0, volumeMilliunits:0, createdAt:now, createdBy:'user-admin' },
      { id:'fixture-50kl-full', templateId, dipMillimetresMilliunits:3000000, volumeMilliunits:53015000, createdAt:now, createdBy:'user-admin' },
    ]);
    await db.update(schema.globalTankCalibrationTemplates).set({
      status:'APPROVED', approvedBy:'user-admin', approvedAt:now,
    }).where(eq(schema.globalTankCalibrationTemplates.id,templateId));
    const chosen = await request('PUT', '/global-tank-defaults/50000', {templateId});
    expect(chosen.status).toBe(200);
    const queued = await request('POST', '/outlets/ro-1001/tanks/quick-register', {
      name:'Reusable verified global tank', capacityLitres:50000,
    });
    expect(queued.status).toBe(201);
    const pendingId = ((await queued.json()) as any).data.id;
    const finalized = await request('POST','/outlets/ro-1001/pending-tanks/'+pendingId+'/finalize',{
      productId:'prod-hsd',
    });
    expect(finalized.status).toBe(201);
    const data = ((await finalized.json()) as any).data;
    expect(data.calibrationStatus).toBe('ACTIVE');
    expect(data.status).toBe('INACTIVE');
    expect(data.pointsCount).toBe(2);
    const [chart] = await db.select().from(schema.tankCalibrationCharts)
      .where(eq(schema.tankCalibrationCharts.tankId,data.id));
    expect(chart.status).toBe('ACTIVE');
    expect(chart.sourceTemplateId).toBe(templateId);
    expect(chart.approvedBy).toBe('user-admin');
    const [tank] = await db.select().from(schema.tanks).where(eq(schema.tanks.id,data.id));
    expect(tank.status).toBe('INACTIVE');
    expect(tank.safeFillCapacityLitres).toBe(45000); // still a provisional value
  });

  it.each([
    { capacity: 20000, templateId: 'gtct-std-20kl', count: 211, maxLitres: 21628.93 },
    { capacity: 50000, templateId: 'gtct-std-50kl', count: 301, maxLitres: 53015 },
  ])('finalizes a full $count-point $capacity L chart under the actual D1 bound-parameter limit', async ({capacity,templateId,count,maxLitres}) => {
    const db = getDb(localD1);
    const now = new Date().toISOString();
    // Synthetic monotonic points exist ONLY in this isolated local test DB.
    // They are not claimed to be the original signed scanned calibration.
    const values = Array.from({ length:count }, (_,i)=>({
      id: 'test-quick-full-' + capacity + '-' + i,
      templateId,
      dipMillimetresMilliunits: i * 10000,
      volumeMilliunits: Math.round(maxLitres * 1000 * i / (count-1)),
      createdAt: now,
      createdBy: 'user-admin',
    }));
    for(let i=0;i<values.length;i+=40){
      await db.insert(schema.globalTankCalibrationTemplatePoints).values(values.slice(i,i+40));
    }
    const pick = await request('PUT','/global-tank-defaults/'+capacity,{
      templateId, acknowledgedWarnings:true,
    });
    expect(pick.status).toBe(200);
    const queued = await request('POST','/outlets/ro-1001/tanks/quick-register',{
      name:'Full chart '+capacity,capacityLitres:capacity,
    });
    expect(queued.status).toBe(201);
    const pendingId=((await queued.json()) as any).data.id;
    const before=await db.select().from(schema.tanks);
    const originalBatch = localD1.batch.bind(localD1);
    const pointInsertBindCounts:number[]=[];
    localD1.batch = async (statements:any[])=>{
      // Local SQLite normally permits >100 variables; simulate production D1
      // enforcing a hard 100-bound-parameters ceiling PER prepared statement.
      for(const stmt of statements){
        const binds=(stmt as any).params as unknown[]|undefined;
        expect(binds).toBeDefined();
        const count=binds!.length;
        if(count>100)throw new Error('D1_ERROR: too many SQL variables');
        if((stmt as any).sql?.includes('tank_calibration_points')){
          pointInsertBindCounts.push(count);
        }
      }
      return originalBatch(statements);
    };
    let finalized:Response;
    try{
      finalized=await request('POST','/outlets/ro-1001/pending-tanks/'+pendingId+'/finalize',{
        productId:'prod-hsd',
      });
    }finally{
      localD1.batch=originalBatch;
    }
    expect(finalized.status).toBe(201);
    const saved=(await finalized.json()) as any;
    expect(saved.data.status).toBe('INACTIVE');
    expect(saved.data.calibrationStatus).toBe('DRAFT');
    expect(saved.data.pointsCount).toBe(count);
    expect(pointInsertBindCounts.length).toBeGreaterThan(1);
    expect(pointInsertBindCounts.every(x=>x<=100)).toBe(true);
    const after=await db.select().from(schema.tanks);
    expect(after).toHaveLength(before.length+1);
    const charts=await db.select().from(schema.tankCalibrationCharts)
      .where(eq(schema.tankCalibrationCharts.tankId,saved.data.id));
    expect(charts).toHaveLength(1);
    expect(charts[0].status).toBe('DRAFT');
    const savedPoints=await db.select().from(schema.tankCalibrationPoints)
      .where(eq(schema.tankCalibrationPoints.chartId,charts[0].id));
    expect(savedPoints).toHaveLength(count);
    expect(savedPoints[count-1].volumeMilliunits).toBe(Math.round(maxLitres*1000));
    const pending=await db.select().from(schema.pendingUndergroundTanks)
      .where(eq(schema.pendingUndergroundTanks.id,pendingId));
    expect(pending[0].status).toBe('FINALIZED');
    expect(pending[0].finalizedTankId).toBe(saved.data.id);
    // Retrying the same pending ID must never create a duplicate tank.
    const retry=await request('POST','/outlets/ro-1001/pending-tanks/'+pendingId+'/finalize',{
      productId:'prod-hsd',
    });
    expect(retry.status).toBe(409);
    expect(await db.select().from(schema.tanks)).toHaveLength(before.length+1);
  });

  it('rejects unsupported capacity and unreviewed charts, with no tank or pending mutation', async () => {
    const db = getDb(localD1);
    const wrongCapacity = await request('POST', '/outlets/ro-1001/tanks/quick-register',
      { name: 'Bad capacity', capacityLitres: 25000 });
    expect(wrongCapacity.status).toBe(400);

    const missingChart = await request('POST', '/outlets/ro-1001/tanks/quick-register',
      { name: '10 KL without a saved chart', capacityLitres: 10000 });
    expect(missingChart.status).toBe(409);
    expect(((await missingChart.json()) as any).error.code).toBe('CALIBRATION_NOT_FOUND');
    expect(await db.select().from(schema.pendingUndergroundTanks)).toHaveLength(0);

    const now = new Date().toISOString();
    await db.insert(schema.globalTankCalibrationTemplatePoints).values([
      { id:'bad-std-0', templateId:'gtct-std-20kl', dipMillimetresMilliunits:0, volumeMilliunits:0, createdAt:now, createdBy:'user-admin' },
      { id:'bad-std-1', templateId:'gtct-std-20kl', dipMillimetresMilliunits:2100000, volumeMilliunits:23001000, createdAt:now, createdBy:'user-admin' },
    ]);
    // Above +15% and the scanned-reference mismatch are WARNING-only for
    // draft defaults; the administrator must explicitly acknowledge both.
    const notAcknowledged = await request('PUT','/global-tank-defaults/20000',{templateId:'gtct-std-20kl'});
    expect(notAcknowledged.status).toBe(409);
    expect(((await notAcknowledged.json()) as any).error.code).toBe('WARNING_ACKNOWLEDGEMENT_REQUIRED');
    const acknowledged = await request('PUT','/global-tank-defaults/20000',{
      templateId:'gtct-std-20kl',acknowledgedWarnings:true,
    });
    expect(acknowledged.status).toBe(200);
    const accepted = (await acknowledged.json()) as any;
    expect(accepted.data.warnings.join(' ')).toContain('+15%');
    const registered = await request('POST','/outlets/ro-1001/tanks/quick-register',
      { name:'Warning-only draft tank',capacityLitres:20000 });
    expect(registered.status).toBe(201);
    const draft = (await registered.json()) as any;
    expect(draft.data.status).toBe('PENDING_FUEL');
    expect(draft.data.templateId).toBe('gtct-std-20kl');
    const audit=await db.select().from(schema.auditLogs)
      .where(eq(schema.auditLogs.action,'GLOBAL_TANK_DEFAULT_SET'));
    expect(audit.some(x=>x.newValueJson?.includes('"acknowledgedWarnings":true'))).toBe(true);
  });
  it.each([10,20] as const)('reuses the complete PDF-transcribed %i KL reference with every dip row unchanged',async kl=>{
    // All 195/211 candidate points are consumed directly from the scanned PDF
    // review CSVs. This isolated test never updates the live D1 or legacy Excel.
    const calibration=requirePdfCsv(kl);
    const spec=SCANNED_CALIBRATION_REFERENCES[kl===10?10000:20000];
    expect(calibration).toHaveLength(spec.expectedPoints);
    const now=new Date().toISOString();
    const templateId='gtct-e2e-pdf-'+kl;
    const db=getDb(localD1);
    await db.insert(schema.globalTankCalibrationTemplates).values({
      id:templateId,code:spec.code,name:'Operator supplied '+kl+' KL PDF candidate',
      nominalCapacityLitres:kl*1000,revisionNumber:1,status:'DRAFT',
      tankDiameterMmMilliunits:spec.tankDiameterMm*1000,
      tankLengthMmMilliunits:spec.tankLengthMm*1000,
      maxDipMmMilliunits:spec.maxDipMm*1000,
      createdBy:'user-admin',createdAt:now,updatedAt:now,
    });
    const sourceRows=calibration.map((p,i)=>({
      id:'operator-pdf-'+kl+'-point-'+i,templateId,
      dipMillimetresMilliunits:p.dipMm*1000,
      volumeMilliunits:Math.round(p.volumeLitres*1000),
      createdAt:now,createdBy:'user-admin',
    }));
    for(let i=0;i<sourceRows.length;i+=12)
      await db.insert(schema.globalTankCalibrationTemplatePoints).values(sourceRows.slice(i,i+12));
    const registered=await request('POST','/outlets/ro-1001/tanks/quick-register',{
      name:'Supplied '+kl+'KL Tank',capacityLitres:kl*1000,
    });
    expect(registered.status).toBe(201);
    const pending=(await registered.json() as any).data;
    expect(pending.templateId).toBe(templateId);
    const finalized=await request('POST','/outlets/ro-1001/pending-tanks/'+pending.id+'/finalize',{productId:'prod-ms'});
    expect(finalized.status).toBe(201);
    const result=(await finalized.json() as any).data;
    expect(result.calibrationStatus).toBe('ACTIVE');
    expect(result.status).toBe('INACTIVE');
    expect(result.pointsCount).toBe(spec.expectedPoints);
    const [linkedChart]=await db.select().from(schema.tankCalibrationCharts)
      .where(eq(schema.tankCalibrationCharts.tankId,result.id));
    expect(linkedChart.sourceTemplateId).toBe(templateId);
    const copied=await db.select().from(schema.tankCalibrationPoints)
      .where(eq(schema.tankCalibrationPoints.chartId,linkedChart.id));
    const sorted=(rows:ReadonlyArray<{dipMillimetresMilliunits:number;volumeMilliunits:number}>)=>
      rows.map(p=>[p.dipMillimetresMilliunits,p.volumeMilliunits]).sort((a,b)=>a[0]-b[0]);
    expect(sorted(copied)).toEqual(sorted(sourceRows));
    if(kl===20)expect(sourceRows.find(p=>p.dipMillimetresMilliunits===2020000)?.volumeMilliunits).toBe(21359520);
    const activated=await request('PUT','/tanks/'+result.id,{
      name:'Supplied '+kl+'KL Tank',productId:'prod-ms',capacityLitres:kl*1000,
      safeFillCapacityLitres:kl*900,minimumOperatingLevelLitres:0,status:'ACTIVE',
      confirmPhysicalCompatibility:true,confirmOperationalLimits:true,
    });
    expect(activated.status).toBe(200);
    const [tank]=await db.select().from(schema.tanks).where(eq(schema.tanks.id,result.id));
    expect(tank.status).toBe('ACTIVE');
    expect((await db.select().from(schema.tankCalibrationPoints)
      .where(eq(schema.tankCalibrationPoints.chartId,linkedChart.id))).length).toBe(spec.expectedPoints);
  });

  it.each([10,20] as const)('creates a separate immutable %iKL PDF source through the API and reuses it for a new tank',async kl=>{
    const source=operatorPdfSource(kl*1000)!;
    const imported=await request('POST','/calibration-templates',{
      ...source,status:'APPROVED',allowOverCapacity:true,
      sourceFileName:'Calibration Chart.pdf',
      notes:'Operator-supplied scanned chart revision, user confirmed 202cm 20KL reading.',
    });
    expect(imported.status).toBe(201);
    const record=(await imported.json() as any).data;
    expect(record.code).toBe(source.code);
    expect(record.status).toBe('APPROVED');
    expect(record.pointsCount).toBe(source.points.length);
    expect(record.maxVolumeLitres).toBe(source.maxVolumeLitres);
    const db=getDb(localD1);
    const original=await db.select().from(schema.globalTankCalibrationTemplatePoints)
      .where(eq(schema.globalTankCalibrationTemplatePoints.templateId,record.id));
    expect(original.length).toBe(source.points.length);
    const normalized=(rows:ReadonlyArray<{dipMillimetresMilliunits:number;volumeMilliunits:number}>)=>
      rows.map(p=>[p.dipMillimetresMilliunits,p.volumeMilliunits]).sort((a,b)=>a[0]-b[0]);
    const expected=source.points.map(p=>({
      dipMillimetresMilliunits:p.dipMm*1000,volumeMilliunits:Math.round(p.volumeLitres*1000)
    }));
    expect(normalized(original)).toEqual(normalized(expected));
    if(kl===20){
      expect(original.find(p=>p.dipMillimetresMilliunits===2020000)?.volumeMilliunits).toBe(21359520);
    }
    const duplicate=await request('POST','/calibration-templates',{
      ...source,status:'APPROVED',allowOverCapacity:true,
    });
    expect(duplicate.status).toBe(409);
    const tampered={...source,points:source.points.map((p,i)=>i===202?{
      ...p,volumeLitres:p.volumeLitres+10,
    }:p)};
    if(kl===20){
      const invalid=await request('POST','/calibration-templates',{
        ...tampered,status:'APPROVED',allowOverCapacity:true,
      });
      expect(invalid.status).toBe(409);
      expect(((await invalid.json()) as any).error.code).toBe('PDF_SOURCE_ROWS_MISMATCH');
    }
    const pending=await request('POST','/outlets/ro-1001/tanks/quick-register',{
      name:'PDF '+kl+' KL reference tank',capacityLitres:kl*1000,
    });
    expect(pending.status).toBe(201);
    const registration=(await pending.json() as any).data;
    expect(registration.templateId).toBe(record.id);
    const finalized=await request('POST','/outlets/ro-1001/pending-tanks/'+registration.id+'/finalize',{productId:'prod-ms'});
    expect(finalized.status).toBe(201);
    const tank=(await finalized.json() as any).data;
    expect(tank.status).toBe('INACTIVE');
    expect(tank.calibrationStatus).toBe('ACTIVE');
    expect(tank.pointsCount).toBe(source.points.length);
    const [linked]=await db.select().from(schema.tankCalibrationCharts)
      .where(eq(schema.tankCalibrationCharts.tankId,tank.id));
    expect(linked.sourceTemplateId).toBe(record.id);
    const copied=await db.select().from(schema.tankCalibrationPoints)
      .where(eq(schema.tankCalibrationPoints.chartId,linked.id));
    expect(normalized(copied)).toEqual(normalized(expected));
  });

  it('remaps an EXISTING 20 KL tank to a new PDF revision without changing its historical chart or stock reading',async()=>{
    const db=getDb(localD1),source=operatorPdfSource(20000)!;
    const [template]=await db.select().from(schema.globalShiftTemplates);
    expect(template).toBeTruthy();
    const oldChartId='tcc-legacy-tank-ro1-1-r1';
    const originalPoints=await db.select().from(schema.tankCalibrationPoints)
      .where(eq(schema.tankCalibrationPoints.chartId,oldChartId));
    const now=new Date().toISOString();
    const shiftId='shift-pdf-history-'+Math.random().toString(36).slice(2);
    await db.insert(schema.operationalShifts).values({
      id:shiftId,outletId:'ro-1001',shiftTemplateId:template.id,businessDate:'2024-02-14',
      startedAt:'2024-02-14T08:00:00.000Z',closedAt:'2024-02-14T16:00:00.000Z',
      status:'CLOSED',openedByUserId:'user-admin',closedByUserId:'user-admin',
      createdAt:now,updatedAt:now,
    });
    await db.insert(schema.operationalShiftTanks).values({
      id:'snap-pdf-historical-'+shiftId,operationalShiftId:shiftId,outletId:'ro-1001',
      tankId:'tank-ro1-1',tankNumber:1,tankName:'Tank 1 - MS (20 KL)',
      productId:'prod-ms',productCode:'MS',productName:'Motor Spirit',productUnit:'LITRE',
      capacityMilliunits:20000000,safeFillCapacityMilliunits:19000000,
      calibrationChartId:oldChartId,calibrationRevision:1,createdAt:now,
    });
    await db.insert(schema.tankStockReadings).values({
      id:'reading-pdf-historical-'+shiftId,operationalShiftId:shiftId,outletId:'ro-1001',
      tankId:'tank-ro1-1',productId:'prod-ms',readingType:'OPENING',source:'MANUAL',
      productDipMmMilliunits:1000000,waterDipMmMilliunits:0,
      grossObservedVolumeMilliunits:8500000,waterVolumeMilliunits:0,
      netProductVolumeMilliunits:8500000,calibrationChartId:oldChartId,
      calibrationRevision:1,recordedAt:now,recordedByUserId:'user-admin',
      createdAt:now,updatedAt:now,
    });
    const installed=await request('POST','/calibration-templates',{
      ...source,status:'APPROVED',allowOverCapacity:true,sourceFileName:'Calibration Chart.pdf',
    });
    expect(installed.status).toBe(201);
    const record=(await installed.json() as any).data;
    const preview=await request('GET','/tanks/tank-ro1-1/calibration/operator-pdf-remap');
    expect(preview.status).toBe(200);
    const p=(await preview.json() as any).data;
    expect(p.ready).toBe(true);
    expect(p.alreadyApplied).toBe(false);
    expect(p.sourceTemplateId).toBe(record.id);
    expect(p.previousActiveChartId).toBe(oldChartId);
    expect(p.previousHistoricalReadings).toBe(1);
    expect(p.sourceReadings).toBe(211);
    const applied=await request('POST','/tanks/tank-ro1-1/calibration/operator-pdf-remap',{
      expectedActiveChartId:p.previousActiveChartId,
    });
    expect(applied.status).toBe(200);
    const changed=(await applied.json() as any).data;
    expect(changed.alreadyApplied).toBe(false);
    expect(changed.chart.revisionNumber).toBe(2);
    expect(changed.chart.status).toBe('ACTIVE');
    expect(changed.chart.sourceTemplateId).toBe(record.id);
    const [old]=await db.select().from(schema.tankCalibrationCharts)
      .where(eq(schema.tankCalibrationCharts.id,oldChartId));
    expect(old.status).toBe('SUPERSEDED');
    const oldPoints=await db.select().from(schema.tankCalibrationPoints)
      .where(eq(schema.tankCalibrationPoints.chartId,oldChartId));
    expect(oldPoints).toEqual(originalPoints);
    const [historical]=await db.select().from(schema.tankStockReadings)
      .where(eq(schema.tankStockReadings.operationalShiftId,shiftId));
    expect(historical.calibrationChartId).toBe(oldChartId);
    expect(historical.calibrationRevision).toBe(1);
    expect(historical.netProductVolumeMilliunits).toBe(8500000);
    const [snapshot]=await db.select().from(schema.operationalShiftTanks)
      .where(eq(schema.operationalShiftTanks.operationalShiftId,shiftId));
    expect(snapshot.calibrationChartId).toBe(oldChartId);
    const future=await db.select().from(schema.tankCalibrationPoints)
      .where(eq(schema.tankCalibrationPoints.chartId,changed.chart.id));
    expect(future).toHaveLength(211);
    expect(future.find(x=>x.dipMillimetresMilliunits===2020000)?.volumeMilliunits).toBe(21359520);
    const duplicate=await request('POST','/tanks/tank-ro1-1/calibration/operator-pdf-remap',{
      expectedActiveChartId:oldChartId,
    });
    expect(duplicate.status).toBe(200);
    expect((await duplicate.json() as any).data.alreadyApplied).toBe(true);
    const revisions=await db.select().from(schema.tankCalibrationCharts)
      .where(eq(schema.tankCalibrationCharts.tankId,'tank-ro1-1'));
    expect(revisions).toHaveLength(2);
  });

  it('blocks calibration remap during an OPEN shift and for the seeded 25 KL Tank #2',async()=>{
    const db=getDb(localD1);
    const source=operatorPdfSource(20000)!;
    expect((await request('POST','/calibration-templates',{
      ...source,status:'APPROVED',allowOverCapacity:true,
    })).status).toBe(201);
    const wrong=await request('GET','/tanks/tank-ro1-2/calibration/operator-pdf-remap');
    expect(wrong.status).toBe(200);
    const wrongPreview=(await wrong.json() as any).data;
    expect(wrongPreview.ready).toBe(false);
    expect(wrongPreview.code).toBe('INVALID_TANK_CAPACITY');
    const [shiftTemplate]=await db.select().from(schema.globalShiftTemplates);
    const now=new Date().toISOString(),shiftId='shift-pdf-open-'+Math.random().toString(36).slice(2);
    await db.insert(schema.operationalShifts).values({
      id:shiftId,outletId:'ro-1001',shiftTemplateId:shiftTemplate.id,businessDate:'2024-05-22',
      startedAt:now,status:'OPEN',openedByUserId:'user-admin',
      createdAt:now,updatedAt:now,
    });
    const blocked=await request('GET','/tanks/tank-ro1-1/calibration/operator-pdf-remap');
    expect(blocked.status).toBe(200);
    const blockingPreview=(await blocked.json() as any).data;
    expect(blockingPreview.ready).toBe(false);
    expect(blockingPreview.code).toBe('SHIFT_OPEN_CALIBRATION_REMAP_BLOCKED');
    const rejected=await request('POST','/tanks/tank-ro1-1/calibration/operator-pdf-remap',{
      expectedActiveChartId:blockingPreview.previousActiveChartId,
    });
    expect(rejected.status).toBe(409);
    expect(((await rejected.json()) as any).error.code).toBe('SHIFT_OPEN_CALIBRATION_REMAP_BLOCKED');
    const [legacy]=await db.select().from(schema.tankCalibrationCharts)
      .where(eq(schema.tankCalibrationCharts.id,'tcc-legacy-tank-ro1-1-r1'));
    expect(legacy.status).toBe('ACTIVE');
    const charts=await db.select().from(schema.tankCalibrationCharts)
      .where(eq(schema.tankCalibrationCharts.tankId,'tank-ro1-1'));
    expect(charts).toHaveLength(1);
  });

  it('rejects stale existing-tank calibration previews instead of silently overwriting a newer chart',async()=>{
    const source=operatorPdfSource(20000)!;
    expect((await request('POST','/calibration-templates',{
      ...source,status:'APPROVED',allowOverCapacity:true,
    })).status).toBe(201);
    const p=await request('GET','/tanks/tank-ro1-1/calibration/operator-pdf-remap');
    const preview=(await p.json() as any).data;
    expect(preview.ready).toBe(true);
    const wrong=await request('POST','/tanks/tank-ro1-1/calibration/operator-pdf-remap',{
      expectedActiveChartId:'not-the-current-active-revision',
    });
    expect(wrong.status).toBe(409);
    expect(((await wrong.json()) as any).error.code).toBe('STALE_CALIBRATION_PREVIEW');
  });

});
