import type { DailyFuelSummary, DailyProductSummary } from '../../shared/types';
import { dsrStatusLabel, getDsrWorkflowStatus } from '../../shared/dsrWorkflowStatus';
import { isDsrMetricRecorded } from './dailyReadingPresentation';
import { operationalShiftClosure, savedQuantity, signedVariance } from './dsrReportLayout';

export type DsrReportFormat = 'CONSOLIDATED' | 'DETAILED';
export type PeriodMetric = 'gross'|'testing'|'net'|'receipts'|'variance';
const metrics:PeriodMetric[]=['gross','testing','net','receipts','variance'];
const keys:Record<PeriodMetric,keyof DailyProductSummary>={gross:'grossSalesMilliunits',testing:'testingMilliunits',net:'netSalesMilliunits',receipts:'receiptsMilliunits',variance:'varianceMilliunits'};
type Amounts = Record<PeriodMetric,number|null> & {opening:number|null;physical:number|null};
const emptyAmounts=():Amounts=>({gross:null,testing:null,net:null,receipts:null,variance:null,opening:null,physical:null});
export interface PeriodMeasure { value:number|null; fullDays:number; totalDays:number; recordedEntries:number; expectedEntries:number }
interface PeriodProduct { key:string; unitKey:string; code:string; name:string; unit:string; days:Amounts[] }
export interface PeriodRow {
  key:string; code:string; name:string; unit:string; isTotal:boolean;
  measures:Record<PeriodMetric,PeriodMeasure>; opening:number|null; physical:number|null;
}
export interface PeriodDayUnit {
  measures:Record<PeriodMetric,PeriodMeasure>;
  productNet:(number|null)[];
}
export interface PeriodUnit { key:string; unit:string; products:PeriodProduct[]; days:PeriodDayUnit[] }
export interface PeriodDateGroup { label:string; day:DailyFuelSummary; index:number; count:number; noEntry:boolean }
export interface ConsolidatedDsr { rows:PeriodRow[]; units:PeriodUnit[]; dateGroups:PeriodDateGroup[]; complete:number; partial:number; noEntry:number; totalDays:number }

const exact=(v:unknown):number|null=>typeof v==='number'&&Number.isSafeInteger(v)?v:null;
function sum(values:readonly (number|null)[],requireAll=false):number|null {
  if(!values.length||(requireAll&&values.some(v=>v===null)))return null;
  let result=0,found=false;
  for(const value of values){if(value===null)continue;found=true;result+=value;if(!Number.isSafeInteger(result))return null;}
  return found?result:null;
}
function validAmounts(day:DailyFuelSummary,p:DailyProductSummary|undefined):Amounts {
  if(!p||day.dayEntryStatus==='NO_ENTRY'||p.status==='NO_ENTRY')return emptyAmounts();
  const values=emptyAmounts();
  for(const m of metrics)if(isDsrMetricRecorded(p,m))values[m]=exact(p[keys[m]]);
  // Display the three sales metrics as a consistent set, not a mixture of different coverage.
  if(values.gross===null||values.testing===null||values.net===null)values.gross=values.testing=values.net=null;
  if(isDsrMetricRecorded(p,'opening'))values.opening=exact(p.openingStockMilliunits);
  if(isDsrMetricRecorded(p,'physical'))values.physical=exact(p.physicalClosingMilliunits);
  return values;
}
function measure(byDay:(number|null)[][]):PeriodMeasure {
  const entries=byDay.flat();
  return {value:sum(entries),fullDays:byDay.filter(v=>v.length>0&&v.every(n=>n!==null)&&sum(v,true)!==null).length,
    totalDays:byDay.length,recordedEntries:entries.filter(v=>v!==null).length,expectedEntries:entries.length};
}
function buildRow(products:PeriodProduct[],isTotal:boolean,totalDays:number):PeriodRow {
  const p=products[0];
  const measures=Object.fromEntries(metrics.map(m=>[m,measure(Array.from({length:totalDays},(_,i)=>products.map(x=>x.days[i][m])))])) as PeriodRow['measures'];
  return {key:isTotal?'total:'+p.unitKey:p.key,code:isTotal?'RECORDED TOTAL':p.code,name:isTotal?'Recorded subtotal':p.name,unit:p.unit,isTotal,measures,
    // No stock balances from intervening days are substituted at either boundary.
    opening:sum(products.map(x=>x.days[0].opening),true),physical:sum(products.map(x=>x.days[totalDays-1].physical),true)};
}
const groupKey=(p:DailyProductSummary)=>JSON.stringify([p.productId,p.unit?.trim()||'']);
const trulyNoEntry=(day:DailyFuelSummary)=>day.dayEntryStatus==='NO_ENTRY'&&day.shiftsCount===0&&getDsrWorkflowStatus(day).operational==='NOT_STARTED'&&getDsrWorkflowStatus(day).financial==='NOT_STARTED';
const nextDate=(previous:string,current:string)=>Date.parse(current+'T00:00:00Z')-Date.parse(previous+'T00:00:00Z')===86400000;

/** Report-only summary of authoritative daily product metrics. Known quantities
 * are added once in integer milliunits; absent/invalid quantities are never zero.
 * A unit subtotal can contain known products on partially covered dates; its
 * full-day counts require every product in the selected-period roster. */
export function consolidateDsr(days:DailyFuelSummary[]):ConsolidatedDsr {
  const roster=new Map<string,PeriodProduct>();
  days.forEach((day,i)=>{
    if(day.dayEntryStatus==='NO_ENTRY')return;
    const seen=new Map<string,DailyProductSummary|null>();
    for(const p of day.byProduct){
      const key=groupKey(p),unit=p.unit?.trim()||'';
      if(!roster.has(key))roster.set(key,{key,unitKey:unit?'unit:'+unit:'unknown:'+p.productId,code:p.productCode,name:p.productName,unit:unit||'Unknown: '+p.productCode,days:days.map(emptyAmounts)});
      seen.set(key,seen.has(key)?null:p); // ambiguous duplicate rows remain unrecorded
    }
    for(const [key,p] of seen)roster.get(key)!.days[i]=validAmounts(day,p??undefined);
  });
  const grouped=new Map<string,PeriodProduct[]>();
  for(const p of [...roster.values()].sort((a,b)=>a.code.localeCompare(b.code)||a.key.localeCompare(b.key))){
    if(!grouped.has(p.unitKey))grouped.set(p.unitKey,[]);grouped.get(p.unitKey)!.push(p);
  }
  const rows:PeriodRow[]=[],units:PeriodUnit[]=[];
  for(const [key,products] of grouped){
    rows.push(...products.map(p=>buildRow([p],false,days.length)),buildRow(products,true,days.length));
    units.push({key,unit:products[0].unit,products,days:days.map((_,i)=>({
      measures:Object.fromEntries(metrics.map(m=>[m,measure([products.map(p=>p.days[i][m])])])) as PeriodDayUnit['measures'],productNet:products.map(p=>p.days[i].net),
    }))});
  }
  const dateGroups:PeriodDateGroup[]=[];
  for(let i=0;i<days.length;){
    const day=days[i],noEntry=day.dayEntryStatus==='NO_ENTRY';let end=i;
    if(trulyNoEntry(day))while(end+1<days.length&&trulyNoEntry(days[end+1])&&nextDate(days[end].businessDate,days[end+1].businessDate))end++;
    dateGroups.push({day,index:i,count:end-i+1,noEntry,label:end===i?day.businessDate:day.businessDate+' to '+days[end].businessDate});i=end+1;
  }
  const complete=days.filter(d=>d.dayEntryStatus==='COMPLETE').length,noEntry=days.filter(d=>d.dayEntryStatus==='NO_ENTRY').length;
  return {rows,units,dateGroups,complete,partial:days.length-complete-noEntry,noEntry,totalDays:days.length};
}

export const periodQuantity=(value:number|null,variance=false)=>variance?signedVariance(savedQuantity(value)):savedQuantity(value);
export function coveredPeriodQuantity(m:PeriodMeasure,variance=false):string {
  return periodQuantity(m.value,variance)+(m.value===null?'':` [${m.fullDays}/${m.totalDays}]`);
}
export function dayUnitQuantity(m:PeriodMeasure,variance=false):string {
  return periodQuantity(m.value,variance)+(m.value!==null&&m.recordedEntries<m.expectedEntries?' *':'');
}
export const periodProductHeaders=['Product','Unit','Opening (first date)','Receipts [days]','Gross sales','Testing','Net sales','Sales days','Closing physical (last date)','Variance [days]'];
export function periodProductCells(row:PeriodRow):string[] {
  const m=row.measures;
  return [row.code,row.unit,periodQuantity(row.opening),coveredPeriodQuantity(m.receipts),periodQuantity(m.gross.value),periodQuantity(m.testing.value),periodQuantity(m.net.value),`${m.net.fullDays}/${m.net.totalDays}`,periodQuantity(row.physical),coveredPeriodQuantity(m.variance,true)];
}
export function periodDateStatusCells(g:PeriodDateGroup):string[] {
  const wf=getDsrWorkflowStatus(g.day);
  return [g.label,g.noEntry?'NO ENTRY':dsrStatusLabel(wf.operational),operationalShiftClosure(g.day),dsrStatusLabel(wf.financial),String(g.count)];
}
