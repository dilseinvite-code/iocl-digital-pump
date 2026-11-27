import {PERMISSIONS,type PermissionCode} from '../../../shared/constants';

export type WorkspaceTask = {
  id:string; label:string; description:string; tab:string; keywords:string;
  permissions:readonly PermissionCode[]; section?:string;
};

/** Links to existing authorized workspaces. No writes or operating-state changes are performed here. */
export const WORKSPACE_TASKS: readonly WorkspaceTask[] = [
  {id:'daily',label:'Open shift & daily readings',description:'Daily Operations · shift workbench',tab:'daily-ops',keywords:'shift daily work operating nozzle dips meter dsr',permissions:[PERMISSIONS.SHIFTS_READ]},
  {id:'meter',label:'Enter nozzle meter readings',description:'Daily Operations · nozzle readings',tab:'daily-ops',keywords:'nozzle meter opening closing readings',permissions:[PERMISSIONS.SHIFTS_READ,PERMISSIONS.METER_READINGS_READ]},
  {id:'dip',label:'Record tank stock dips',description:'Fuel Receipts & Stock · Opening stock',tab:'stock-ops',section:'OPENING',keywords:'tank dip calibration litres inventory opening reading',permissions:[PERMISSIONS.TANK_STOCK_READ]},
  {id:'receipt',label:'Record tanker fuel receipt',description:'Fuel Receipts & Stock · Fuel Receipts',tab:'stock-ops',section:'RECEIPTS',keywords:'fuel delivery stock tanker decantation invoice unloading',permissions:[PERMISSIONS.TANK_STOCK_READ,PERMISSIONS.FUEL_RECEIPTS_READ]},
  {id:'closing',label:'Record closing tank stock',description:'Fuel Receipts & Stock · Closing stock',tab:'stock-ops',section:'CLOSING',keywords:'closing dip inventory stock litres end shift',permissions:[PERMISSIONS.TANK_STOCK_READ]},
  {id:'reconcile-stock',label:'Review stock reconciliation',description:'Fuel Receipts & Stock · Reconciliation',tab:'stock-ops',section:'RECONCILIATION',keywords:'stock variance difference shortage excess reconcile',permissions:[PERMISSIONS.TANK_STOCK_READ]},
  {id:'collections',label:'Shift collections',description:'Finance · Collections',tab:'financials',section:'collections',keywords:'cash upi cards collections finance payments',permissions:[PERMISSIONS.FINANCIAL_RECONCILIATION_READ,PERMISSIONS.COLLECTIONS_READ]},
  {id:'handover',label:'Cash handovers',description:'Finance · Cash handovers',tab:'financials',section:'handovers',keywords:'cash handover money collection finance',permissions:[PERMISSIONS.FINANCIAL_RECONCILIATION_READ,PERMISSIONS.CASH_HANDOVER_READ]},
  {id:'deposit',label:'Bank deposit',description:'Finance · Bank deposits',tab:'financials',section:'deposits',keywords:'bank deposit cash money transfer finance verify',permissions:[PERMISSIONS.FINANCIAL_RECONCILIATION_READ,PERMISSIONS.BANK_DEPOSITS_READ]},
  {id:'finance-reconcile',label:'Financial reconciliation',description:'Finance · Reconciliation',tab:'financials',section:'reconciliation',keywords:'reconcile cash bank sales variance finance',permissions:[PERMISSIONS.FINANCIAL_RECONCILIATION_READ]},
  {id:'credit',label:'Credit customers',description:'Finance · Credit customer master',tab:'financials',section:'credit-parties',keywords:'credit customer ledger parties master sales',permissions:[PERMISSIONS.FINANCIAL_RECONCILIATION_READ,PERMISSIONS.CREDIT_PARTIES_READ]},
  {id:'prices',label:'Product price master',description:'Finance · Product prices',tab:'financials',section:'prices',keywords:'prices ms hsd petrol diesel rate master',permissions:[PERMISSIONS.FINANCIAL_RECONCILIATION_READ,PERMISSIONS.PRODUCT_PRICES_READ]},
  {id:'dsr',label:'Daily Sales Report (DSR)',description:'DSR Reports · view & export',tab:'dsr-reports',keywords:'daily sales report dsr export print pdf period',permissions:[PERMISSIONS.REPORTS_READ,PERMISSIONS.SHIFTS_READ]},
  {id:'monthly',label:'Monthly performance report',description:'Outlet Performance Reports · monthly performance',tab:'reports',keywords:'monthly financial operational performance export report',permissions:[PERMISSIONS.REPORTS_READ]},
  {id:'calibration',label:'Tank calibration charts',description:'Pump Infrastructure · Tank Calibration',tab:'pump-infra',section:'globalCalibration',keywords:'calibration caliberation 10kl 20kl chart import remap dip to volume litres',permissions:[PERMISSIONS.TANKS_READ,PERMISSIONS.TANK_CALIBRATION_READ]},
  {id:'tanks',label:'Underground tanks',description:'Pump Infrastructure · Underground Tanks',tab:'pump-infra',section:'tanks',keywords:'tank add activate deactivate remove delete restore name capacity fuel',permissions:[PERMISSIONS.TANKS_READ]},
  {id:'dispensers',label:'Dispensers and DU',description:'Pump Infrastructure · Dispensers',tab:'pump-infra',section:'dispensers',keywords:'dispenser mpd du petrol pump equipment',permissions:[PERMISSIONS.TANKS_READ,PERMISSIONS.DISPENSERS_READ]},
  {id:'nozzles',label:'Nozzle mapping',description:'Pump Infrastructure · Nozzles',tab:'pump-infra',section:'nozzles',keywords:'nozzle assign map product fuel dispenser tank',permissions:[PERMISSIONS.TANKS_READ,PERMISSIONS.NOZZLES_READ]},
  {id:'fuel',label:'Fuel grade mapping',description:'Pump Infrastructure · Fuel Mapping',tab:'pump-infra',section:'fuelMapping',keywords:'fuel product grade ms hsd diesel petrol',permissions:[PERMISSIONS.TANKS_READ]},
  {id:'shift-templates',label:'Shift schedule templates',description:'Pump Infrastructure · Shift Templates',tab:'pump-infra',section:'shifts',keywords:'shift schedule roster template times',permissions:[PERMISSIONS.TANKS_READ,PERMISSIONS.SHIFT_TEMPLATES_READ]},
  {id:'outlets',label:'Retail outlet setup',description:'Retail Outlets · directory',tab:'outlets',keywords:'ro outlet station branch retail store',permissions:[PERMISSIONS.OUTLETS_READ]},
  {id:'products',label:'Product catalog',description:'Product Catalog · fuel and items',tab:'products',keywords:'products catalog item master petrol diesel',permissions:[PERMISSIONS.PRODUCTS_READ]},
  {id:'documents',label:'Licence expiry & documents',description:'Documents · renewals and compliance',tab:'documents',keywords:'license licence expiry overdue due renewals alerts documents compliance upload',permissions:[PERMISSIONS.DOCUMENTS_READ]},
  {id:'equipment',label:'Equipment maintenance',description:'Equipment & Breakdowns · repairs',tab:'equipment-ops',keywords:'equipment service repairs breakdown preventive maintenance',permissions:[PERMISSIONS.EQUIPMENT_READ]},
  {id:'workforce',label:'Staff & attendance',description:'Workforce & Roster · staff',tab:'hr-workforce',keywords:'hr employee attendance roster leaves staff',permissions:[PERMISSIONS.HR_READ]},
  {id:'utilities',label:'Utility bills & meters',description:'Utilities & Sub-Meters · electricity and water',tab:'utilities-ops',keywords:'electricity power meter water bill dg generator utilities',permissions:[PERMISSIONS.UTILITIES_READ]},
  {id:'municipal',label:'Municipal taxes',description:'Municipal Taxes · dues',tab:'municipal-taxes',keywords:'tax dues municipality property',permissions:[PERMISSIONS.MUNICIPAL_TAXES_READ]},
  {id:'nfr',label:'NFR leases & rent',description:'NFR · leasing',tab:'nfr-ops',keywords:'vendor lease rent space non fuel revenue',permissions:[PERMISSIONS.NFR_READ]},
  {id:'cng',label:'CNG operations',description:'CNG Operations · records',tab:'cng-ops',keywords:'cng compressed gas pump meter',permissions:[PERMISSIONS.CNG_OPERATIONS_READ]},
  {id:'lube',label:'Lubricant inventory',description:'Lube Operations · stock and sales',tab:'lube-ops',keywords:'lube lubricant oil inventory sales',permissions:[PERMISSIONS.LUBE_OPERATIONS_READ]},
  {id:'users',label:'User directory',description:'Administration · users',tab:'users',keywords:'user manager accounts create admin staff access',permissions:[PERMISSIONS.USERS_READ]},
  {id:'scopes',label:'Scope assignments',description:'Administration · permissions by outlet',tab:'scopes',keywords:'scope outlet users assignment hierarchy',permissions:[PERMISSIONS.SCOPES_READ]},
  {id:'audit',label:'Audit trail',description:'Administration · change history',tab:'audit',keywords:'audit history log who changed action',permissions:[PERMISSIONS.AUDIT_READ]},
];

export function findWorkspaceTasks(query:string,hasPermission:(permission:PermissionCode)=>boolean,limit=8):WorkspaceTask[]{
 const terms=query.toLowerCase().trim().split(/\s+/).filter(Boolean);
 if(!terms.length)return [];
 return WORKSPACE_TASKS.filter(t=>t.permissions.every(hasPermission))
   .filter(t=>{
     const haystack=(t.label+' '+t.description+' '+t.keywords).toLowerCase();
     return terms.every(term=>haystack.includes(term));
   }).sort((a,b)=>{
      const phrase=terms.join(' ');
      const score=(t:WorkspaceTask)=>{
        const label=t.label.toLowerCase();
        return (label.startsWith(phrase)?5:0)+(label.includes(phrase)?3:0);
      };
      return score(b)-score(a);
   }).slice(0,limit);
}

/** A task only navigates to a workspace, never bypasses server permissions. */
export function openWorkspaceTask(task:WorkspaceTask,onNavigate:(tab:string)=>void):void{
 if(typeof window!=='undefined'){
   const url=new URL(window.location.href);
   if(task.section)url.searchParams.set('workspaceTask',task.tab+':'+task.section);
   else url.searchParams.delete('workspaceTask');
   window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash);
 }
 onNavigate(task.tab);
 if(typeof window!=='undefined'){
   window.dispatchEvent(new CustomEvent('iocl:workspace-task',{detail:{tab:task.tab,section:task.section||''}}));
 }
}

export function consumeWorkspaceSection(tab:string,allowed:readonly string[]):string|null{
 if(typeof window==='undefined')return null;
 const url=new URL(window.location.href);
 const selected=url.searchParams.get('workspaceTask');
 if(!selected?.startsWith(tab+':'))return null;
 const section=selected.substring(tab.length+1);
 url.searchParams.delete('workspaceTask');
 window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash);
 return allowed.includes(section)?section:null;
}
