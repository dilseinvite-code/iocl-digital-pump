import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import app from '../src/worker/app';
import { createLocalD1Database } from '../src/db/localD1';
import { getDb } from '../src/db';
import * as schema from '../src/db/schema';
import { seedDatabase } from '../src/db/seed';
import { and, eq } from 'drizzle-orm';

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
});
