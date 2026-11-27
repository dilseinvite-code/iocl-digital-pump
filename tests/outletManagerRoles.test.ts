import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import app from '../src/worker/app';
import { createLocalD1Database } from '../src/db/localD1';
import { getDb } from '../src/db';
import { seedDatabase } from '../src/db/seed';
import { OUTLET_MANAGER_PERMISSION_CODES } from '../src/shared/constants';
import { ScopeService } from '../src/worker/services/scopeService';

describe('Dealer and CSP subordinate outlet managers',()=>{
  let db: ReturnType<typeof createLocalD1Database>, file:string, env:any, admin:string;
  const origin='http://localhost:3000';
  const request=async(path:string,method='GET',body?:any,cookie=admin)=>{
    const response=await app.fetch(new Request('http://localhost/api/v1'+path,{
      method,headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),
    }),env);
    return {status:response.status,json:await response.json() as any,cookie:response.headers.get('set-cookie')?.split(';')[0]||''};
  };
  const login=(email:string)=>request('/auth/login','POST',{email,password:'Password@123'},'');
  const payload=(role:string,outletId='ro-1001')=>({empCode:'MAN-'+role,name:'Manager '+role,email:role.toLowerCase()+'@example.invalid',phone:'1234567890',password:'Password@123',roleCodes:[role],initialScope:{scopeLevel:'OUTLET',outletId}});
  const create=async(role:string,outletId='ro-1001')=>{
    const response=await request('/users','POST',payload(role,outletId));
    expect(response.status).toBe(201);
    return response.json.data;
  };
  beforeEach(async()=>{
    file='./.sqlite/test_manager_'+crypto.randomUUID()+'.db';
    db=createLocalD1Database(file); await seedDatabase(getDb(db as any));
    env={DB:db,DOCUMENTS_BUCKET:{}}; const res=await login('admin@iocl.in');expect(res.status).toBe(200);admin=res.cookie;
  });
  afterEach(()=>{db?.close();for(const suffix of ['','-wal','-shm'])try{fs.unlinkSync(file+suffix)}catch{}});
  it('installs both roles, in branch order, with parent-subset grants and no existing-role mutation',async()=>{
    const roles=(await request('/roles')).json.data;
    for(const [role,parent] of [['DEALER_MANAGER','DEALER'],['CSP_MANAGER','CSP']]){
      const child=roles.find((r:any)=>r.code===role),p=roles.find((r:any)=>r.code===parent);
      expect(child.parentRoleCode).toBe(parent);
      expect(roles.indexOf(child)).toBe(roles.indexOf(p)+1);
      const grants=child.permissions.map((v:any)=>v.code);
      expect(grants).toContain('outlets.read');expect(grants).toContain('meter_readings.write');
      expect(grants.every((v:any)=>p.permissions.some((a:any)=>a.code===v)&&(OUTLET_MANAGER_PERMISSION_CODES as readonly string[]).includes(v))).toBe(true);
      expect(grants).not.toContain('users.create');expect(grants).not.toContain('hierarchy.write');expect(grants).not.toContain('bank_deposits.verify');
      expect(ScopeService.getRoleLevel(role)).toBeLessThan(ScopeService.getRoleLevel(parent));
    }
    const select=()=>db.prepare("SELECT * FROM role_permissions ORDER BY role_id,permission_id").all();
    const before=(await select()).results;
    const sql=fs.readFileSync('migrations/additive/0043_outlet_manager_roles.sql','utf8');
    await db.exec(sql);await db.exec(sql);
    expect((await select()).results).toEqual(before);
  });
  it('provisions both manager types with explicit outlet scope, login and strict cross-outlet denial',async()=>{
    for(const role of ['DEALER_MANAGER','CSP_MANAGER']){
      const manager=await create(role);
      const session=await login(payload(role).email);expect(session.status).toBe(200);
      const me=await request('/auth/me','GET',undefined,session.cookie);
      expect(me.json.data.roles).toEqual([role]);
      expect(me.json.data.isGlobalScope).toBe(false);
      expect(me.json.data.accessibleOutletIds).toEqual(['ro-1001']);
      const outlets=await request('/outlets','GET',undefined,session.cookie);
      expect(outlets.json.data.map((o:any)=>o.id)).toEqual(['ro-1001']);
      expect((await request('/outlets/ro-1003','GET',undefined,session.cookie)).status).toBe(403);
      expect((await request('/users','GET',undefined,session.cookie)).status).toBe(403);
      expect((await request('/scopes','POST',{userId:manager.id,scopeLevel:'GLOBAL'},session.cookie)).status).toBe(403);
      expect((await request('/scopes','POST',{userId:manager.id,scopeLevel:'GLOBAL'})).status).toBe(400);
      expect((await request('/outlets/ro-1003/assignments','POST',{userId:manager.id,assignmentType:'DEALER'})).status).toBe(400);
      expect((await request('/scopes','DELETE',undefined,session.cookie)).status).not.toBe(200);
      const scope=manager.initialScope;
      expect((await request('/scopes/'+scope.id,'DELETE')).status).toBe(200);
      expect((await request('/auth/me','GET',undefined,session.cookie)).status).toBe(403);
      expect((await login(payload(role).email)).status).toBe(403);
    }
  });
  it('rejects mixed roles, missing or broad initial scope, and foreign branch grants', async()=>{
    const data=payload('DEALER_MANAGER');
    for(const invalid of [{...data,initialScope:undefined},{...data,initialScope:{scopeLevel:'GLOBAL'}},{...data,roleCodes:['DEALER_MANAGER','ADMIN']}]) {
      expect((await request('/users','POST',invalid)).status).toBe(400);
    }
    await db.prepare("INSERT INTO role_permissions (role_id,permission_id) VALUES ('role-dealer','perm-u-c'),('role-csp','perm-u-c')").run();
    const dealer=(await login('dealer.parkstreet@iocl.in')).cookie;
    const csp=(await login('csp.parkstreet@iocl.in')).cookie;
    expect((await request('/users','POST',payload('CSP_MANAGER'),dealer)).status).toBe(403);
    expect((await request('/users','POST',payload('DEALER_MANAGER'),csp)).status).toBe(403);
    expect((await request('/users','POST',payload('DEALER_MANAGER','ro-1003'),dealer)).status).toBe(403);
    expect((await request('/users','POST',payload('DEALER_MANAGER'),dealer)).status).toBe(201);
    expect((await request('/users','POST',payload('CSP_MANAGER'),csp)).status).toBe(201);
  });
  it('ignores erroneous wider scopes and standalone outlet assignments even if present in DB',async()=>{
    const manager=await create('DEALER_MANAGER'),now=new Date().toISOString();
    await db.prepare("INSERT INTO user_scope_assignments(id,user_id,scope_level,created_at,created_by) VALUES ('bad-global',?,'GLOBAL',?,'user-admin')").bind(manager.id,now).run();
    await db.prepare("INSERT INTO outlet_user_assignments(id,outlet_id,user_id,assignment_type,effective_from,is_active,created_at,created_by) VALUES ('bad-assignment','ro-1003',?,'CSP',?,1,?,'user-admin')").bind(manager.id,now,now).run();
    const session=await login(payload('DEALER_MANAGER').email);
    expect(session.status).toBe(200);
    const me=await request('/auth/me','GET',undefined,session.cookie);
    expect(me.json.data.isGlobalScope).toBe(false);
    expect(me.json.data.accessibleOutletIds).toEqual(['ro-1001']);
  });
});
