import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import app from '../src/worker/app';
import { createLocalD1Database } from '../src/db/localD1';
import { getDb } from '../src/db';
import { seedDatabase } from '../src/db/seed';

describe('Safe organizational hierarchy maintenance', () => {
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

  async function createUnit(kind: string, code: string, parent: Record<string, string> = {}) {
    const result = await request(endpoint(kind), admin, 'POST', { code, name: 'Disposable ' + code, status: 'ACTIVE', ...parent });
    expect(result.status).toBe(201);
    return result.json.data;
  }
  const remove = (kind: string, item: any, cookie = admin, details: any = {}) =>
    request(endpoint(kind, item.id), cookie, 'DELETE', { expectedUpdatedAt: item.updatedAt, ...details });
  const deletionAudits = async () => (await db.prepare("SELECT * FROM audit_logs WHERE action IN ('STATE_DELETE','DIVISION_DELETE','SALES_AREA_DELETE') ORDER BY created_at").all<any>()).results;

  it('deletes only empty units, bottom-up, with original values in the audit trail', async () => {
    const state = await createUnit('states','DEL-ST');
    const div = await createUnit('divisions','DEL-DIV',{stateId:state.id});
    const area = await createUnit('sales-areas','DEL-SA',{divisionId:div.id});
    const allOutlets = (await db.prepare('SELECT * FROM retail_outlets ORDER BY id').all()).results;
    const allAssignments = (await db.prepare('SELECT * FROM user_scope_assignments ORDER BY id').all()).results;
    expect((await remove('states',state)).json.error.message).toContain('Divisional Offices');
    expect((await remove('divisions',div)).json.error.message).toContain('Sales Areas');
    expect((await deletionAudits()).length).toBe(0);
    for (const [kind, item, entity] of [
      ['sales-areas',area,'SALES_AREA'], ['divisions',div,'DIVISION'], ['states',state,'STATE'],
    ] as const) {
      expect((await remove(kind,item)).status).toBe(200);
      expect(await unit(kind,item.id)).toBeUndefined();
      const audit = (await deletionAudits()).find(a=>a.entity_id===item.id);
      expect(audit?.action).toBe(entity+'_DELETE');
      expect(audit?.user_id).toBe('user-admin');
      expect(JSON.parse(audit!.old_value_json)).toMatchObject({id:item.id,code:item.code,name:item.name});
      expect(audit?.new_value_json).toBeNull();
      expect((await remove(kind,item)).status).toBe(404);
    }
    expect((await deletionAudits()).length).toBe(3);
    expect((await db.prepare('SELECT * FROM retail_outlets ORDER BY id').all()).results).toEqual(allOutlets);
    expect((await db.prepare('SELECT * FROM user_scope_assignments ORDER BY id').all()).results).toEqual(allAssignments);
  });

  it('blocks deletion of linked outlets, scope assignments and historical officer postings', async () => {
    const state = await createUnit('states','LINK-ST');
    const area = await unit('sales-areas','sa-nor');
    const outletBlocked = await remove('sales-areas',area);
    expect(outletBlocked.status).toBe(409);
    expect(outletBlocked.json.error.message).toContain('Retail Outlets');
    expect(await unit('sales-areas',area.id)).toEqual(area);
    const now = new Date().toISOString();
    await db.prepare("INSERT INTO user_scope_assignments (id,user_id,scope_level,state_id,created_at,created_by) VALUES ('delete-test-scope','user-so','STATE',?,?,'user-admin')").bind(state.id,now).run();
    const scopeBlocked = await remove('states',state);
    expect(scopeBlocked.status).toBe(409);
    expect(scopeBlocked.json.error.message).toContain('user scope assignments');
    const division = await createUnit('divisions','POST-DIV',{stateId:'state-wb'});
    await db.prepare("INSERT INTO org_departments (id,code,name,created_by,created_at,updated_at) VALUES ('delete-dept','DELDEP','Delete Fixture','user-admin',?,?)").bind(now,now).run();
    await db.prepare("INSERT INTO org_officers (id,employee_code,full_name,designation_title,department_id,created_by,created_at,updated_at) VALUES ('delete-officer','DEL-OFF','Delete Fixture','Officer','delete-dept','user-admin',?,?)").bind(now,now).run();
    await db.prepare("INSERT INTO org_officer_postings (id,officer_id,scope_level,division_id,effective_from,effective_to,status,created_by,created_at,updated_at) VALUES ('delete-posting','delete-officer','DIVISION',?,'2020-01-01','2020-12-31','INACTIVE','user-admin',?,?)").bind(division.id,now,now).run();
    const postingBlocked = await remove('divisions',division);
    expect(postingBlocked.status).toBe(409);
    expect(postingBlocked.json.error.message).toContain('officer postings');
    expect((await db.prepare("SELECT division_id FROM org_officer_postings WHERE id='delete-posting'").first<any>())!.division_id).toBe(division.id);
    expect((await db.prepare("SELECT state_id FROM user_scope_assignments WHERE id='delete-test-scope'").first<any>())!.state_id).toBe(state.id);
    expect(await unit('states',state.id)).toEqual(state);
    expect(await unit('divisions',division.id)).toMatchObject(division);
    expect(await deletionAudits()).toHaveLength(0);
  });

  it('enforces strict permissions, scope, payload and stale-version checks for deletion', async () => {
    const div = await createUnit('divisions','WB-DEL',{stateId:'state-wb'});
    const foreign = await createUnit('divisions','PB-DEL',{stateId:'state-pb'});
    const so = await login('wbso@iocl.in');
    expect((await remove('divisions',div,so)).status).toBe(403);
    expect((await remove('divisions',div,'')).status).toBe(401);
    await db.prepare("INSERT INTO role_permissions (role_id,permission_id) VALUES ('role-so','perm-h-w'),('role-fo','perm-h-w')").run();
    const writer = await login('wbso@iocl.in');
    expect((await remove('divisions',foreign,writer)).status).toBe(403);
    const fo = await login('fo.central@iocl.in');
    expect((await remove('divisions',await unit('divisions','div-kol'),fo)).status).toBe(403);
    expect((await remove('divisions',div,writer,{expectedUpdatedAt:'stale'})).json.error.code).toBe('STALE_HIERARCHY_UNIT');
    expect((await remove('divisions',div,writer,{force:true})).status).toBe(400);
    expect((await request(endpoint('divisions',div.id),writer,'DELETE')).status).toBe(400);
    expect((await deletionAudits()).length).toBe(0);
    expect((await remove('divisions',div,writer)).status).toBe(200);
  });

  it('rolls back on audit/deletion failure and rechecks links inside the batch', async () => {
    const state = await createUnit('states','RACE-ST');
    await db.prepare("CREATE TRIGGER delete_audit_failure BEFORE INSERT ON audit_logs WHEN NEW.action='STATE_DELETE' BEGIN SELECT RAISE(ABORT,'fixture failure'); END").run();
    expect((await remove('states',state)).status).toBe(503);
    expect(await unit('states',state.id)).toEqual(state);
    expect(await deletionAudits()).toHaveLength(0);
    await db.prepare('DROP TRIGGER delete_audit_failure').run();
    await db.prepare("CREATE TRIGGER delete_unit_failure BEFORE DELETE ON states WHEN OLD.id=? BEGIN SELECT RAISE(ABORT,'fixture failure'); END".replace('?', "'" + state.id + "'")).run();
    expect((await remove('states',state)).status).toBe(503);
    expect(await unit('states',state.id)).toEqual(state);
    expect(await deletionAudits()).toHaveLength(0);
    await db.prepare('DROP TRIGGER delete_unit_failure').run();
    // Model a dependency committed after the initial reference check.
    const batch = db.batch.bind(db);
    const now = new Date().toISOString();
    db.batch = (async (statements: any) => {
      await db.prepare("INSERT INTO divisions (id,state_id,code,name,status,created_at,updated_at) VALUES ('racing-child',?,'RACE-D','Racing child','ACTIVE',?,?)").bind(state.id,now,now).run();
      return batch(statements);
    }) as typeof db.batch;
    const race = await remove('states',state);
    expect(race.status).toBe(409);
    expect(race.json.error.code).toBe('HIERARCHY_CONFLICT');
    expect(await deletionAudits()).toHaveLength(0);
    expect(await unit('states',state.id)).toEqual(state);
    expect((await unit('divisions','racing-child')).stateId).toBe(state.id);
  });

});
