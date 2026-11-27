import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import app from '../src/worker/app';
import { createLocalD1Database } from '../src/db/localD1';
import { getDb } from '../src/db';
import { seedDatabase } from '../src/db/seed';

describe('In-place organizational hierarchy editing', () => {
  let db: ReturnType<typeof createLocalD1Database>;
  let file: string;
  let env: any;
  let admin: string;
  const origin = 'http://localhost:3000';
  const endpoint = (kind: string, id?: string) => '/api/v1/hierarchy/' + kind + (id ? '/' + id : '');
  const request = async (path: string, cookie = admin, method = 'GET', body?: unknown) => {
    const res = await app.fetch(new Request('http://localhost' + path, {
      method, headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), env);
    return { status: res.status, json: await res.json() as any };
  };
  const login = async (email: string) => {
    const res = await app.fetch(new Request('http://localhost/api/v1/auth/login', {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Password@123' }),
    }), env);
    expect(res.status).toBe(200);
    return res.headers.get('set-cookie')!.split(';')[0];
  };
  async function unit(kind: string, id: string) {
    const res = await request(endpoint(kind));
    expect(res.status).toBe(200);
    return res.json.data.find((x: any) => x.id === id);
  }
  const payload = (current: any, overrides: any = {}) => ({ code: current.code, name: current.name, expectedUpdatedAt: current.updatedAt, ...overrides });
  const patch = (kind: string, id: string, data: unknown, cookie = admin) => request(endpoint(kind, id), cookie, 'PATCH', data);
  beforeEach(async () => {
    file = './.sqlite/test_hierarchy_edit_' + crypto.randomUUID() + '.db';
    db = createLocalD1Database(file);
    await seedDatabase(getDb(db as any));
    env = { DB: db, DOCUMENTS_BUCKET: {} };
    admin = await login('admin@iocl.in');
  });
  afterEach(() => {
    db?.close();
    for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(file + suffix); } catch {} }
  });

  it('updates all three unit levels in place and preserves outlet ancestry and scope assignments, with audit history', async () => {
    const linkage = () => db.prepare("SELECT id,state_id,division_id,sales_area_id FROM retail_outlets ORDER BY id").all();
    const scopes = () => db.prepare("SELECT id,user_id,scope_level,state_id,division_id,sales_area_id,outlet_id FROM user_scope_assignments ORDER BY id").all();
    const originalLinks = (await linkage()).results;
    const originalScopes = (await scopes()).results;
    for (const [kind, id, updatedCode, updatedName, entity] of [
      ['states','state-wb',' WB-NEW ','West Bengal Renamed','STATE'],
      ['divisions','div-kol',' kol-new ','Kolkata Renamed','DIVISION'],
      ['sales-areas','sa-cen',' cen-new ','Central Renamed','SALES_AREA'],
    ]) {
      const before = await unit(kind,id);
      const result = await patch(kind,id,payload(before,{code:updatedCode,name:' '+updatedName+' '}));
      expect(result.status).toBe(200);
      expect(result.json.data).toMatchObject({id,code:updatedCode.trim().toUpperCase(),name:updatedName,status:before.status,createdAt:before.createdAt});
      expect(result.json.data.updatedAt).not.toBe(before.updatedAt);
      expect(await unit(kind,id)).toMatchObject(result.json.data);
      const audit = await db.prepare('SELECT * FROM audit_logs WHERE action=? AND entity_id=?').bind(entity+'_UPDATE',id).first<any>();
      expect(JSON.parse(audit!.old_value_json)).toMatchObject({id,name:before.name,code:before.code});
      expect(JSON.parse(audit!.new_value_json)).toMatchObject({id,name:updatedName,code:updatedCode.trim().toUpperCase()});
    }
    expect((await linkage()).results).toEqual(originalLinks);
    expect((await scopes()).results).toEqual(originalScopes);
    expect((await unit('divisions','div-kol')).stateName).toBe('West Bengal Renamed');
    expect((await unit('sales-areas','sa-cen')).divisionName).toBe('Kolkata Renamed');
    const outlets = await request('/api/v1/outlets');
    expect(outlets.json.data.find((x:any)=>x.id==='ro-1001')).toMatchObject({stateName:'West Bengal Renamed',divisionName:'Kolkata Renamed',salesAreaName:'Central Renamed'});
  });

  it('rejects invalid, duplicate, stale and ancestry-changing requests and omits no-op audit entries', async () => {
    const state = await unit('states','state-wb');
    expect((await patch('states',state.id,payload(state,{code:' ppso '}))).json.error.code).toBe('DUPLICATE_CODE');
    expect((await patch('states',state.id,payload(state,{name:'  '}))).status).toBe(400);
    expect((await patch('states',state.id,payload(state,{code:'TOO-LONG-CODE'}))).status).toBe(400);
    expect((await patch('states',state.id,payload(state,{status:'INACTIVE'}))).status).toBe(400);
    expect((await patch('states','missing',payload(state))).status).toBe(404);
    expect((await patch('states',state.id,payload(state))).status).toBe(200);
    const div = await unit('divisions','div-kol');
    const sa = await unit('sales-areas','sa-cen');
    expect((await patch('divisions',div.id,payload(div,{stateId:'state-pb'}))).status).toBe(400);
    expect((await patch('sales-areas',sa.id,payload(sa,{divisionId:'div-ldh'}))).status).toBe(400);
    expect((await patch('states',state.id,payload(state,{name:'First saved name'}))).status).toBe(200);
    const stale = await patch('states',state.id,payload(state,{name:'Stale edit'}));
    expect(stale.status).toBe(409);
    expect(stale.json.error.code).toBe('STALE_HIERARCHY_UNIT');
    expect((await unit('states',state.id)).name).toBe('First saved name');
    expect((await db.prepare("SELECT count(*) AS n FROM audit_logs WHERE action IN ('STATE_UPDATE','DIVISION_UPDATE','SALES_AREA_UPDATE')").first<any>())!.n).toBe(1);
  });

  it('requires permission AND operational scope, not visibility of ancestors', async () => {
    const state = await unit('states','state-wb');
    const division = await unit('divisions','div-kol');
    const foreign = await unit('divisions','div-ldh');
    const so = await login('wbso@iocl.in');
    expect((await patch('states', state.id, payload(state,{name:'Unpermitted'}),so)).status).toBe(403);
    // Grant only the existing hierarchy-write permission in the disposable test
    // database. Scope remains exactly as seeded.
    await db.prepare("INSERT INTO role_permissions (role_id,permission_id) VALUES ('role-so','perm-h-w'),('role-fo','perm-h-w')").run();
    const writer = await login('wbso@iocl.in');
    expect((await patch('divisions',division.id,payload(division,{name:'In scope update'}),writer)).status).toBe(200);
    expect((await patch('divisions',foreign.id,payload(foreign,{name:'Out of scope update'}),writer)).status).toBe(403);
    const fo = await login('fo.central@iocl.in');
    const visible = await request(endpoint('states'),fo);
    expect(visible.json.data.some((x:any)=>x.id===state.id)).toBe(true);
    expect((await patch('states',state.id,payload(state,{name:'Ancestor update'}),fo)).status).toBe(403);
    expect((await patch('divisions',division.id,payload(await unit('divisions',division.id),{name:'Ancestor division'}),fo)).status).toBe(403);
    expect((await patch('states',state.id,payload(state),'')).status).toBe(401);
  });

  it('rolls back the update if the audit insert fails', async () => {
    const state = await unit('states','state-wb');
    await db.prepare("CREATE TRIGGER hierarchy_audit_failure BEFORE INSERT ON audit_logs WHEN NEW.action='STATE_UPDATE' BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END").run();
    const result = await patch('states',state.id,payload(state,{name:'Must roll back'}));
    expect(result.status).toBe(503);
    expect(await unit('states',state.id)).toEqual(state);
  });
});
