import {describe,it,expect} from 'vitest';
import {findWorkspaceTasks,WORKSPACE_TASKS} from '../src/frontend/components/layout/workspaceTaskCatalog';
import {PERMISSIONS,type PermissionCode} from '../src/shared/constants';
const access=(...allowed:PermissionCode[])=>(permission:PermissionCode)=>allowed.includes(permission);
describe('Task-first navigation across IOCL workspaces',()=>{
 it('maps all actions to existing modules and keeps task IDs unique',()=>{
   const modules=new Set(['daily-ops','stock-ops','financials','dsr-reports','reports','pump-infra','outlets','products','documents','equipment-ops','hr-workforce','utilities-ops','municipal-taxes','nfr-ops','cng-ops','lube-ops','users','scopes','audit']);
   for(const task of WORKSPACE_TASKS)expect(modules.has(task.tab),task.id).toBe(true);
   expect(new Set(WORKSPACE_TASKS.map(x=>x.id)).size).toBe(WORKSPACE_TASKS.length);
 });
 it('finds deep work areas by plain-language queries',()=>{
   const all=()=>true;
   expect(findWorkspaceTasks('tank calibration',all)[0]).toMatchObject({id:'calibration',section:'globalCalibration'});
   expect(findWorkspaceTasks('bank deposit',all)[0]).toMatchObject({id:'deposit',section:'deposits'});
   expect(findWorkspaceTasks('tanker fuel',all)[0]).toMatchObject({id:'receipt',section:'RECEIPTS'});
   expect(findWorkspaceTasks('licence expiry',all)[0]).toMatchObject({id:'documents',tab:'documents'});
 });
 it('does not reveal restricted tasks',()=>{
   const shiftOnly=access(PERMISSIONS.SHIFTS_READ);
   expect(findWorkspaceTasks('bank deposit',shiftOnly)).toHaveLength(0);
   expect(findWorkspaceTasks('calibration',shiftOnly)).toHaveLength(0);
   expect(findWorkspaceTasks('shift',shiftOnly).some(t=>t.id==='daily')).toBe(true);
 });
});
