import type { DailyFuelSummary, DailyShiftSummaryItem, OperationalShiftTankSnapshot, RetailOutlet, TankStockReading } from '../../shared/types';
import { getDsrWorkflowStatus, dsrStatusLabel } from '../../shared/dsrWorkflowStatus';
import { operationalShiftClosure } from './dsrReportLayout';
import { getWorkDeskIndicators, type WorkDeskIndicator } from './workDesk';

const SCOPE_LABELS: Record<string,string> = {GLOBAL:'Global',STATE:'State',DIVISION:'Division',SALES_AREA:'Sales area',OUTLET:'Retail outlet'};
export const scopeLabel = (scope: string) => SCOPE_LABELS[scope] || scope.replaceAll('_',' ');

/** Use only the hierarchy on an already accessible RO; never infer authority
 * from the breadcrumb or use it to fetch other regions. */
export function outletHierarchy(outlet: RetailOutlet) {
  return [
    {label:'Global',name:'India'},
    {label:'State',name:outlet.stateName || 'Name unavailable'},
    {label:'Division',name:outlet.divisionName || 'Name unavailable'},
    {label:'Sales area',name:outlet.salesAreaName || 'Name unavailable'},
    {label:'Retail outlet',name:outlet.name,code:outlet.roCode},
  ];
}

/** Indicators are independent saved-data signals, not an enforced step sequence. */
export function commandWorkflow(summary: DailyFuelSummary): WorkDeskIndicator[] {
  const [opening, meters, , closing, reconciliation, closure] = getWorkDeskIndicators(summary);
  const operational = getDsrWorkflowStatus(summary).operational;
  return [
    {label:'Shift recorded', detail:summary.shiftsCount ? summary.shiftsCount+' recorded' : 'No shift recorded', state:summary.shiftsCount ? 'complete' : 'unrecorded'},
    {label:'Tank readings', detail:summary.completion.expectedTanks>0 ? 'Open '+opening.detail+' · Close '+closing.detail : 'No expected readings recorded',
      state:opening.state==='complete' && closing.state==='complete' ? 'complete' : opening.state==='unrecorded' && closing.state==='unrecorded' ? 'unrecorded' : 'pending'},
    {...meters,label:'Nozzle meters'},
    reconciliation,
    closure,
    {label:'Operational DSR',detail:dsrStatusLabel(operational),state:operational==='COMPLETED'?'complete':operational==='NOT_STARTED'?'unrecorded':'pending'},
  ];
}

export function commandAttention(summary: DailyFuelSummary) {
  const status = getDsrWorkflowStatus(summary);
  if (summary.shiftsCount === 0) return {tone:'attention',title:'No shift recorded',detail:'Review the business date and open the shift workspace when ready.',action:'daily-ops'};
  if (status.operational === 'BLOCKED' || summary.missingFields.length || status.operational === 'IN_PROGRESS') return {
    tone:'attention',title:'Review fuel operations',detail:summary.missingFields.length ? summary.missingFields.length+' saved completion '+(summary.missingFields.length===1?'warning':'warnings')+' to review.' : 'Review the saved readings and stock reconciliation.',action:'daily-ops'};
  if (status.financial === 'PENDING' || status.financial === 'REVIEW_REQUIRED') return {
    tone:'attention',title:status.financial==='PENDING'?'Finance pending':'Finance review required',detail:'Operational and financial completion are tracked separately.',action:'financials'};
  if (operationalShiftClosure(summary)==='OPEN'||summary.shifts.some(s=>s.status==='OPEN')) return {tone:'info',title:'Shift still open',detail:'Review the shift workspace before closing operations.',action:'daily-ops'};
  if (status.financial==='UNKNOWN'||operationalShiftClosure(summary)==='STATUS UNAVAILABLE') return {tone:'info',title:'Status unavailable',detail:'Some closure or finance evidence could not be determined.',action:'daily-ops'};
  if (status.operational==='COMPLETED'&&status.financial==='COMPLETED') return {tone:'clear',title:'Recorded operations complete',detail:'The saved operational and financial statuses are complete.',action:'dsr-reports'};
  return {tone:'info',title:'Review saved status',detail:'Use the independent indicators to review today’s work.',action:'daily-ops'};
}

/** The day response identifies shifts, but its flattened tank readings cannot
 * be reliably associated with each shift. Fetch only the latest identified
 * shift's actual snapshots/readings to avoid guessing from flattened totals. */
export function latestDashboardShift(summary: DailyFuelSummary | null | undefined): DailyShiftSummaryItem | null {
  if (!summary?.shiftsCount || summary.shifts?.length!==summary.shiftsCount) return null;
  const shifts = summary.shifts;
  if (shifts.some(s=>!s.id || s.businessDate!==summary.businessDate || !Number.isSafeInteger(s.shiftNumber) || s.shiftNumber<1)) return null;
  if (new Set(shifts.map(s=>s.id)).size!==shifts.length || new Set(shifts.map(s=>s.shiftNumber)).size!==shifts.length) return null;
  return [...shifts].sort((a,b)=>b.shiftNumber-a.shiftNumber)[0];
}

export type DashboardTank = {snapshot:OperationalShiftTankSnapshot; reading:TankStockReading | null; percentage:number | null};
/** No invented zeros, no cross-shift/product readings and no inferred live stock.
 * If two latest readings share a timestamp but differ, decline to pick one. */
export function dashboardTanks(snapshots: OperationalShiftTankSnapshot[], readings: TankStockReading[], outletId:string, shiftId:string): DashboardTank[] {
  const belongs = (r:{outletId:string;operationalShiftId:string}) => r.outletId===outletId && r.operationalShiftId===shiftId;
  if (!snapshots.every(belongs) || !readings.every(belongs) || new Set(snapshots.map(s=>s.tankId)).size!==snapshots.length) throw new Error('Tank records do not match the selected shift.');
  return [...snapshots].sort((a,b)=>a.tankNumber-b.tankNumber).map(snapshot=>{
    const related = readings.filter(r=>r.tankId===snapshot.tankId && r.productId===snapshot.productId);
    const timed = related.map(r=>({r,time:Date.parse(r.recordedAt)})).sort((a,b)=>b.time-a.time);
    const latest = timed[0];
    const unambiguous = latest && timed.every(r=>Number.isFinite(r.time)) && timed.filter(r=>r.time===latest.time).length===1;
    const reading = unambiguous && Number.isSafeInteger(latest.r.netProductVolumeMilliunits) && latest.r.netProductVolumeMilliunits>=0 ? latest.r : null;
    const percentage = reading && Number.isSafeInteger(snapshot.capacityMilliunits) && snapshot.capacityMilliunits>0 ? reading.netProductVolumeMilliunits/snapshot.capacityMilliunits*100 : null;
    return {snapshot,reading,percentage};
  });
}
