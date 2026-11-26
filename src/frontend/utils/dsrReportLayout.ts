import type { DailyDispenserSummary, DailyFuelSummary, DailyProductSummary, DailyTankReadingDetail } from '../../shared/types';
import { formatMilliunits } from '../../shared/precision';
import { isDsrMetricRecorded, type DsrMetric } from './dailyReadingPresentation';

/** Report-only presentation. Never modify or recompute authoritative source balances. */
const metrics: readonly [DsrMetric, keyof DailyProductSummary][] = [
  ['opening','openingStockMilliunits'], ['receipts','receiptsMilliunits'], ['available','availableStockMilliunits'],
  ['gross','grossSalesMilliunits'], ['testing','testingMilliunits'], ['net','netSalesMilliunits'],
  ['theoretical','theoreticalClosingMilliunits'], ['physical','physicalClosingMilliunits'], ['variance','varianceMilliunits'],
];
export const savedQuantity = (value: unknown): string =>
  typeof value === 'number' && Number.isSafeInteger(value) ? formatMilliunits(value) : 'Not recorded';
export function signedVariance(value: string): string {
  return /^\d+\.\d{3}$/.test(value) && Number(value) > 0 ? '+' + value : value;
}
/** Preserve unrecorded and invalid source values in the product rows, too. */
export function dsrDailyProductValues(product:DailyProductSummary):string[] {
  return metrics.map(([metric,key])=>{
    const value=isDsrMetricRecorded(product,metric)?savedQuantity(product[key]):'Not recorded';
    return metric==='variance'?signedVariance(value):value;
  });
}
function exactSum(values: readonly unknown[]): number | null {
  let sum = 0;
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) return null;
    sum += value;
    if (!Number.isSafeInteger(sum)) return null;
  }
  return sum;
}
export interface DsrDailyUnitTotal {
  unit: string;
  coverage: 'COMPLETE' | 'PARTIAL';
  values: string[];
}
/** Aggregate same-unit products only. Unknown units remain separate by product.
 * An unrecorded metric in *any* included product means no full total for that metric.
 */
export function dsrDailyUnitTotals(day: DailyFuelSummary): DsrDailyUnitTotal[] {
  const groups = new Map<string,{unit:string;products:DailyProductSummary[]}>();
  for (const product of day.byProduct) {
    const unit=product.unit?.trim() || '';
    const key=unit ? 'unit:'+unit : 'unknown:'+product.productId;
    if (!groups.has(key)) groups.set(key,{unit:unit || 'Unknown: '+product.productCode,products:[]});
    groups.get(key)!.products.push(product);
  }
  return [...groups.values()].map(({unit,products})=>{
    const values=metrics.map(([metric,key])=>{
      if(!products.every(p=>isDsrMetricRecorded(p,metric)))return 'Not recorded';
      return savedQuantity(exactSum(products.map(p=>p[key])));
    });
    return {unit,coverage:day.dayEntryStatus==='COMPLETE'&&products.every(p=>p.status==='COMPLETE')&&values.every(v=>v!=='Not recorded')?'COMPLETE':'PARTIAL',
      values:values.map((value,i)=>i===8?signedVariance(value):value)};
  });
}

export interface DsrTankRow {
  productCode: string;
  unit: string;
  tankNumber: string;
  opening?: DailyTankReadingDetail;
  closing?: DailyTankReadingDetail;
}
export type DsrTankPresentation =
 | { mode: 'PAIRED'; rows: DsrTankRow[] }
 | { mode: 'SAVED_READINGS'; rows: (DsrTankRow & { reading: DailyTankReadingDetail })[] };

/** The existing daily-summary API supplies tank IDs and reading types but not
 * a shift ID per tank reading. Never pair readings across multiple shifts or
 * silently overwrite duplicate types. Retain every actual saved reading.
 */
export function dsrTankPresentation(day: DailyFuelSummary): DsrTankPresentation {
  const saved = day.byProduct.flatMap(p=>(p.tankReadings??[]).map(reading=>({
    productCode:p.productCode, unit:p.unit||'Unknown', tankNumber:reading.tankNumber==='0'?'Unknown':String(reading.tankNumber??'Unknown'),
    productId:p.productId, reading,
  })));
  const seen=new Map<string,DsrTankRow>();
  let safeToPair=day.shiftsCount===1;
  for (const entry of saved) {
    const key=JSON.stringify([entry.productId,entry.reading.tankId]);
    if(!entry.reading.tankId) safeToPair=false;
    if(!seen.has(key))seen.set(key,{productCode:entry.productCode,unit:entry.unit,tankNumber:entry.tankNumber});
    const row=seen.get(key)!;
    const field=entry.reading.readingType==='OPENING'?'opening':entry.reading.readingType==='CLOSING'?'closing':null;
    if(!field || row[field])safeToPair=false;
    else row[field]=entry.reading;
  }
  if(safeToPair) return {mode:'PAIRED',rows:[...seen.values()].sort((a,b)=>
    a.tankNumber.localeCompare(b.tankNumber,undefined,{numeric:true})||a.productCode.localeCompare(b.productCode))};
  return {mode:'SAVED_READINGS',rows:saved};
}

export interface DsrDispenserSubtotal {
  unit: string; recorded: number; expected: number;
  gross: string; testing: string; net: string;
}
export function nozzleHasSavedMeters(n: DailyDispenserSummary['nozzles'][number]): boolean {
  return n.hasReading !== false && typeof n.openingTotalizerMilliunits==='number'&&Number.isSafeInteger(n.openingTotalizerMilliunits)
    &&typeof n.closingTotalizerMilliunits==='number'&&Number.isSafeInteger(n.closingTotalizerMilliunits)
    &&[n.grossSalesMilliunits,n.testingQuantityMilliunits,n.netSalesMilliunits].every(Number.isSafeInteger);
}
/** Recorded-only subtotals; a missing/unavailable nozzle never becomes a fabricated zero. */
export function dsrDispenserSubtotals(dispenser: DailyDispenserSummary, units: ReadonlyMap<string,string>): DsrDispenserSubtotal[] {
  const groups=new Map<string,{unit:string;nozzles:DailyDispenserSummary['nozzles']}>();
  for(const n of dispenser.nozzles){
    const unit=units.get(n.productId)?.trim()||'';
    const key=unit?'unit:'+unit:'unknown:'+n.productId;
    if(!groups.has(key))groups.set(key,{unit:unit||'Unknown: '+n.productCode,nozzles:[]});
    groups.get(key)!.nozzles.push(n);
  }
  return [...groups.values()].map(({unit,nozzles})=>{
    const recorded=nozzles.filter(nozzleHasSavedMeters);
    const sum=(key:'grossSalesMilliunits'|'testingQuantityMilliunits'|'netSalesMilliunits')=>
      recorded.length?savedQuantity(exactSum(recorded.map(n=>n[key]))):'Not recorded';
    return {unit,recorded:recorded.length,expected:nozzles.length,gross:sum('grossSalesMilliunits'),testing:sum('testingQuantityMilliunits'),net:sum('netSalesMilliunits')};
  });
}

export function operationalShiftClosure(day:DailyFuelSummary):string {
  if(day.shiftsCount===0)return 'NOT STARTED';
  const shifts=day.shifts??[];
  if(shifts.length!==day.shiftsCount||shifts.some(s=>!['OPEN','CLOSED','LOCKED'].includes(s.status)))return 'STATUS UNAVAILABLE';
  if(shifts.length===1)return shifts[0].status;
  if(shifts.every(s=>s.status==='CLOSED'||s.status==='LOCKED'))return 'ALL CLOSED / LOCKED';
  const locked=shifts.filter(s=>s.status==='CLOSED'||s.status==='LOCKED').length;
  return locked ? locked+'/'+shifts.length+' CLOSED / LOCKED' : 'OPEN';
}
