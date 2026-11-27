import type { DailyFuelSummary, DailyShiftSummaryItem, OperationalShift } from '../../shared/types';

const ist = new Intl.DateTimeFormat('en-GB', {
  timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',
  hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',
});
/** Format timestamps, never reinterpret the selected business date. */
export function formatDsrIst(timestamp: string): string {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(timestamp)) return 'Time unavailable';
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return 'Time unavailable';
  const p = Object.fromEntries(ist.formatToParts(date).map(({type,value})=>[type,value]));
  return `${p.day} ${p.month} ${p.year} ${p.hour}:${p.minute}:${p.second} IST`;
}

export const DSR_REMARK_MAX_LENGTH = 240;
/** Standard-font PDF export supports printable English text. Reject unsupported
 * input rather than silently corrupting a free-text operator explanation. */
export function normalizeDsrRemark(value:string):string {
  if(value.length>DSR_REMARK_MAX_LENGTH)throw new Error(`Use at most ${DSR_REMARK_MAX_LENGTH} characters.`);
  const normalized=value.replace(/[–—]/g,'-').replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/\s+/g,' ').trim();
  if(/[^\x20-\x7e]/.test(normalized))throw new Error('Use English text and standard punctuation for the PDF remarks.');
  return normalized;
}
export function dsrRemarkError(value:string):string {
  try{normalizeDsrRemark(value);return '';}catch(e){return e instanceof Error?e.message:'Invalid remarks.';}
}

export type DsrShiftNames = ReadonlyMap<string,string>;
export function dsrShiftName(shift:DailyShiftSummaryItem,names:DsrShiftNames):string {
  return names.get(shift.id) || `Shift #${shift.shiftNumber} (name unavailable)`;
}
export function dsrShiftHeader(day:DailyFuelSummary,names:DsrShiftNames):string {
  if(!day.shiftsCount)return 'No recorded shift';
  if(day.shifts?.length!==day.shiftsCount)return `Shifts: ${day.shiftsCount} (details unavailable)`;
  return day.shiftsCount===1 ? `Shift: ${dsrShiftName(day.shifts[0],names)}` : `Shifts: ${day.shiftsCount} (see shift-wise table)`;
}

/** Use the established scoped GET routes. Resolve recent names in one read, then
 * historical IDs in bounded batches. A failed/mismatched lookup is not guessed. */
export async function resolveDsrShiftNames(
  days:DailyFuelSummary[],outletId:string,
  recent:()=>Promise<OperationalShift[]>,detail:(id:string)=>Promise<OperationalShift|null>,
  isCurrent:()=>boolean=()=>true,
):Promise<Map<string,string>> {
  const expected=new Map<string,{shift:DailyShiftSummaryItem;date:string}>();
  for(const day of days)if(day.outletId===outletId)for(const shift of day.shifts??[]){
    if(shift.id && shift.businessDate===day.businessDate)expected.set(shift.id,{shift,date:day.businessDate});
  }
  const names=new Map<string,string>();
  if(!expected.size||!isCurrent())return names;
  const accept=(candidate:OperationalShift|null)=>{
    if(!candidate)return;
    const item=expected.get(candidate.id),name=candidate.shiftTemplateName?.trim();
    if(item&&candidate.outletId===outletId&&candidate.businessDate===item.date&&candidate.shiftTemplateId===item.shift.shiftTemplateId&&name&&name.toLowerCase()!=='unknown')names.set(candidate.id,name);
  };
  try{for(const candidate of await recent())accept(candidate);}catch{/* metadata only; exact historical lookup below */}
  const missing=[...expected.keys()].filter(id=>!names.has(id));
  for(let i=0;i<missing.length&&isCurrent();i+=3){
    await Promise.all(missing.slice(i,i+3).map(async id=>{
      try{const candidate=await detail(id);if(candidate?.id===id&&isCurrent())accept(candidate);}catch{/* retain explicit unavailable label */}
    }));
  }
  return names;
}
