import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Calendar, CalendarDays, CheckCircle2, ChevronDown, Clock3, Download, Eye, FileSearch, FileText, Fuel, Gauge, Info, LayoutList, RefreshCw, ShieldCheck, SlidersHorizontal, TrendingUp } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useActiveOutlet } from '../context/ActiveOutletContext';
import { useShiftWorkbench } from '../context/ShiftWorkbenchContext';
import { apiFetch } from '../services/api';
import { PERMISSIONS } from '../../shared/constants';
import type { DailyFuelSummary, OperationalShift } from '../../shared/types';
import { dsrStatusLabel, getDsrWorkflowStatus } from '../../shared/dsrWorkflowStatus';
import { getLocalDateInputValue, getLocalMonthInputValue } from '../../shared/utils/dateUtils';
import { formatMilliunits } from '../../shared/precision';
import { dsrDates, dsrPeriodProducts, dsrProductColumns, dsrProductValues, type DsrPeriod } from '../utils/dsrReport';
import { consolidateDsr, periodProductCells, periodProductHeaders, periodQuantity, type DsrReportFormat } from '../utils/dsrConsolidated';
import { operationalShiftClosure } from '../utils/dsrReportLayout';
import { SectionTitle, StatusPill } from '../components/common/OperationsUi';
import { DSR_REMARK_MAX_LENGTH, dsrRemarkError, dsrShiftHeader, formatDsrIst, resolveDsrShiftNames } from '../utils/dsrReportMetadata';

const input = 'ops-control';
const primary = 'ops-button';
const secondary = 'ops-button';
const labels: Record<DsrPeriod,string> = { DAY:'Daily', WEEK:'Weekly', MONTH:'Monthly', CUSTOM:'Custom range' };
const periodChoices = [
  {id:'DAY' as const,description:'One business date',icon:Calendar},
  {id:'WEEK' as const,description:'Monday to Sunday',icon:CalendarDays},
  {id:'MONTH' as const,description:'Calendar month',icon:LayoutList},
  {id:'CUSTOM' as const,description:'Choose start and end',icon:SlidersHorizontal},
];
const today = () => getLocalDateInputValue();
const dateLabel=(date:string)=>new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(date+'T00:00:00Z'));
const rangeLabel=(dates:string[])=>dateLabel(dates[0])+(dates.length>1?' – '+dateLabel(dates[dates.length-1]):'');
const cellTone=(value:string,variance=false)=>value==='Not recorded'?'missing':variance&&value.startsWith('-')?'negative':variance&&value.startsWith('+')?'positive':undefined;
const prettyQuantity=(value:number|null, signed=false)=>periodQuantity(value,signed).replace(/^(\+|-)?(\d+)(\.\d+)$/,(_,sign='',integer,decimal)=>sign+integer.replace(/\B(?=(\d{3})+(?!\d))/g,',')+decimal);

function MetricCard({label,value,detail,tone,icon:Icon}:{label:string;value:string;detail:string;tone:'success'|'warning'|'danger'|'neutral'|'info';icon:typeof Calendar}){
  return <div className="ops-metric-card" data-tone={tone}>
    <div className="flex items-center justify-between gap-2"><p className="ops-metric-label">{label}</p><span className="ops-metric-icon"><Icon size={16} aria-hidden="true"/></span></div>
    <p className={'mt-2 ops-metric-value'+(value==='Not recorded'?' !text-base':'')}>{value}</p>
    <p className="mt-1 ops-metric-detail">{detail}</p>
  </div>;
}

function QuantityTable({headers,rows,label,minWidth=1050,totalIndices=[],numericFrom=2,varianceColumn}:{
  headers:readonly string[];rows:string[][];label:string;minWidth?:number;totalIndices?:number[];numericFrom?:number;varianceColumn?:number;
}){
  return <div className="ops-table-scroll" role="region" aria-label={label} tabIndex={0}>
    <table className="ops-table" style={{minWidth}}><thead><tr>{headers.map((h,i)=><th scope="col" className={i>=numericFrom?'num':''} key={h}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((row,r)=><tr key={r} data-total={totalIndices.includes(r)}>{row.map((v,i)=><td key={i} data-tone={cellTone(v,i===varianceColumn)} className={(i>=numericFrom?'num':'')+(i===0?' font-semibold':'')}>{v}</td>)}</tr>)}</tbody></table>
    </div>;
}

function RetrievedReport({outletId, outletName, roCode, dates, period, canExport, generatedBy}: {
  outletId:string; outletName:string; roCode:string; dates:string[]; period:DsrPeriod; canExport:boolean; generatedBy:string;
}) {
  const [days,setDays] = useState<DailyFuelSummary[] | null>(null);
  const [busy,setBusy] = useState(false);
  const [progress,setProgress] = useState(0);
  const [error,setError] = useState('');
  const [exporting,setExporting] = useState(false);
  const [pdfUrl,setPdfUrl] = useState('');
  const [retrievedAt,setRetrievedAt] = useState('');
  const [shiftNames,setShiftNames] = useState<ReadonlyMap<string,string>>(new Map());
  const [reportFormat,setReportFormat]=useState<DsrReportFormat>(period==='DAY'?'DETAILED':'CONSOLIDATED');
  const [operatorRemarks,setOperatorRemarks] = useState<Record<string,string>>({});
  const invalidRemarks=Object.values(operatorRemarks).some(v=>!!dsrRemarkError(v));
  const alive = useRef(true);
  const run = useRef(0);
  const urlRef = useRef('');
  const clearPdf = () => {
    if(urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current=''; setPdfUrl('');
  };
  useEffect(()=>{
    alive.current=true;
    return ()=>{alive.current=false;run.current++;if(urlRef.current)URL.revokeObjectURL(urlRef.current);};
  },[]);
  const retrieve = async () => {
    const token = ++run.current;
    setBusy(true);setProgress(0);setError('');setDays(null);setOperatorRemarks({});setShiftNames(new Map());clearPdf();
    const result: DailyFuelSummary[]=[];
    try{
      // Bound concurrent requests. Each date uses the existing outlet-scoped DSR endpoint.
      for(let i=0;i<dates.length;i+=3){
        if(!alive.current || token!==run.current)return;
        const batch=dates.slice(i,i+3);
        const values=await Promise.all(batch.map(async date=>{
          const res=await apiFetch<DailyFuelSummary>('/api/v1/outlets/'+encodeURIComponent(outletId)+'/fuel/daily-summary?businessDate='+encodeURIComponent(date),{cache:'no-store'});
          if(!res.success || !res.data)throw new Error(date+': '+(res.error?.message || 'Could not retrieve DSR.'));
          if(res.data.outletId!==outletId || res.data.businessDate!==date)throw new Error('Unexpected outlet/date in DSR response.');
          return res.data;
        }));
        result.push(...values);
        if(alive.current && token===run.current)setProgress(result.length);
      }
      const retrieved=new Date().toISOString();
      const current=()=>alive.current&&token===run.current;
      if(!current())return;
      const names=await resolveDsrShiftNames(result,outletId,async()=>{
        const res=await apiFetch<OperationalShift[]>('/api/v1/outlets/'+encodeURIComponent(outletId)+'/shifts',{cache:'no-store'});
        return res.success&&Array.isArray(res.data)?res.data:[];
      },async id=>{
        const res=await apiFetch<OperationalShift>('/api/v1/shifts/'+encodeURIComponent(id),{cache:'no-store'});
        return res.success&&res.data?res.data:null;
      },current);
      if(current()){setShiftNames(names);setDays(result);setRetrievedAt(retrieved);}
    }catch(e){if(alive.current && token===run.current)setError(e instanceof Error?e.message:'Unable to retrieve report.');}
    finally{if(alive.current && token===run.current)setBusy(false);}
  };
  const exportPdf = async (preview:boolean) => {
    if(!days || !canExport || exporting || busy || invalidRemarks)return;
    const token=run.current;
    setExporting(true);setError('');
    try{
      const {generateDsrPdf}=await import('../utils/dsrReportPdf');
      const bytes=await generateDsrPdf({outletName,roCode,days,generatedAt:new Date().toISOString(),generatedBy,periodLabel:labels[period],retrievedAt,shiftNames,operatorRemarks,reportFormat});
      if(!alive.current || token!==run.current)return;
      const url=URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer],{type:'application/pdf'}));
      if(preview){clearPdf();urlRef.current=url;setPdfUrl(url);}
      else {
        const a=document.createElement('a');a.href=url;
        a.download='DSR-'+roCode.replace(/[^a-zA-Z0-9_-]/g,'_')+'-'+dates[0]+(dates.length>1?'--'+dates[dates.length-1]:'')+(period==='DAY'?'':'-'+reportFormat.toLowerCase())+'.pdf';
        document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
      }
    }catch(e){if(alive.current && token===run.current)setError(e instanceof Error?e.message:'PDF generation failed.');}
    finally{if(alive.current && token===run.current)setExporting(false);}
  };
  const totals=useMemo(()=>days?dsrPeriodProducts(days):[],[days]);
  const model=useMemo(()=>days?consolidateDsr(days):null,[days]);
  const consolidated=model&&period!=='DAY'&&reportFormat==='CONSOLIDATED'?model:null;
  const complete=model?.complete??0,none=model?.noEntry??0,partial=model?.partial??0;
  return <div className="space-y-5">
    <section className="ops-panel p-4 sm:p-5 space-y-4" aria-label="Retrieve and export DSR">
      <SectionTitle step="02" title="Retrieve & export" description="Load saved records for the selected outlet and business dates."/>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#dce5ef] bg-[#f4f7fb] p-3.5">
        <div className="min-w-0"><p className="text-xs font-semibold text-slate-600">Selected report</p><p className="mt-1 text-base font-bold text-[#17365D]">{rangeLabel(dates)}</p><p className="mt-1 text-xs text-slate-600 break-words">{outletName} · RO {roCode} · {dates.length} business date{dates.length!==1?'s':''}</p></div>
        {days&&<StatusPill status="RETRIEVED"/>}
      </div>
      {period!=='DAY'&&canExport&&<div>
        <p className="mb-2 text-sm font-bold text-[#17365D]">PDF report format</p>
        <div role="group" aria-label="PDF report format" className="grid gap-2 sm:grid-cols-2">
          {(['CONSOLIDATED','DETAILED'] as DsrReportFormat[]).map(f=>{
            const isConsolidated=f==='CONSOLIDATED', label=isConsolidated?'Consolidated DSR':'Detailed DSR';
            return <button key={f} type="button" aria-label={label} aria-pressed={reportFormat===f} disabled={busy||exporting} className="ops-choice" onClick={()=>{clearPdf();setReportFormat(f);}}>
              <span className="ops-choice-icon">{isConsolidated?<LayoutList size={19}/>:<FileText size={19}/>}</span>
              <span className="min-w-0 flex-1"><span className="ops-choice-title">{label}</span><span className="ops-choice-detail">{isConsolidated?'Recommended for management · compact summary':'For audit · daily tank and nozzle statements'}</span></span>
              {reportFormat===f&&<CheckCircle2 size={18} className="shrink-0 text-[#195c9d]" aria-hidden="true"/>}
            </button>;
          })}
        </div>
      </div>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy||exporting} className={days?secondary:primary} data-variant={days?'secondary':'primary'} onClick={retrieve}><RefreshCw className={'h-4 w-4'+(busy?' animate-spin':'')}/>{busy?'Retrieving '+progress+'/'+dates.length:days?'Refresh report':'Retrieve DSR'}</button>
        {canExport && <><button className={secondary} type="button" disabled={!days||busy||exporting||invalidRemarks} onClick={()=>exportPdf(true)}><Eye className="h-4 w-4"/>Preview PDF</button><button className={primary} data-variant={days?'primary':'secondary'} type="button" disabled={!days||busy||exporting||invalidRemarks} onClick={()=>exportPdf(false)}><Download className="h-4 w-4"/>{exporting?'Generating…':'Download PDF'}</button></>}
      </div>
      {busy&&<div><progress aria-label="DSR retrieval progress" className="w-full accent-[#195c9d]" max={dates.length} value={progress}/><p className="text-xs text-slate-600" role="status">Retrieving {progress} of {dates.length} business dates. All dates must load before export.</p></div>}
      {!canExport&&<p className="ops-notice" data-tone="info"><ShieldCheck size={15}/>Report viewing is available; PDF export requires Reports Generate permission.</p>}
      {!days&&!busy&&!error&&<p className="text-xs text-slate-600 flex gap-2 items-center"><Info size={15}/>Retrieve first, then preview or download your report.</p>}
      {error&&<div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 flex gap-2"><AlertTriangle size={17} className="shrink-0"/><span>{error} {days?'':'No incomplete retrieval will be exported.'}</span></div>}
    </section>

    {days&&model&&<>
      <section className="ops-panel p-4 sm:p-5 space-y-4" aria-label="Report coverage">
        <SectionTitle step="03" title="Review report coverage" description="Understand which business dates have usable operational records before interpreting totals."/>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          <MetricCard label="Business dates" value={String(days.length)} detail="Selected reporting period" tone="info" icon={CalendarDays}/>
          <MetricCard label="Complete" value={String(complete)} detail="Operational data complete" tone="success" icon={CheckCircle2}/>
          <MetricCard label="Partial" value={String(partial)} detail="Some records incomplete" tone="warning" icon={Clock3}/>
          <MetricCard label="No entry" value={String(none)} detail="No saved DSR records" tone="neutral" icon={FileSearch}/>
        </div>
        <div className="ops-coverage-track" aria-label={complete+' complete, '+partial+' partial, '+none+' no-entry business dates'} role="img">
          {([[complete,'success'],[partial,'warning'],[none,'neutral']] as const).filter(([count])=>count>0).map(([count,tone])=><span key={tone} data-tone={tone} style={{width:(count/days.length*100)+'%'}}/>)}
        </div>
        {complete!==days.length?<div className="ops-notice"><AlertTriangle size={17}/><div><strong>Incomplete period coverage</strong><p>Totals include recorded quantities only. Missing readings are not zero, and incomplete dates do not certify monthly totals.</p></div></div>:<div className="ops-notice" data-tone="info"><CheckCircle2 size={17}/><span>Every selected date has complete operational data. Financial reconciliation is shown separately.</span></div>}
      </section>

      {model.rows.filter(r=>r.isTotal).map(row=><section key={row.key} className="ops-panel p-4 sm:p-5 space-y-3" aria-label={'Recorded quantities '+row.unit}>
        <SectionTitle title={'Recorded quantities · '+row.unit} description="Saved subtotals only; different measurement units are never combined. Variance sums recorded daily differences, not overall period loss."/>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          {([{key:'gross',label:'Gross sales',icon:Gauge},{key:'testing',label:'Testing',icon:Fuel},{key:'net',label:'Net sales',icon:TrendingUp},{key:'variance',label:'Recorded variance',icon:AlertTriangle}] as const).map(({key,label,icon})=>{
            const m=row.measures[key],tone=key==='variance'&&m.value!==null?(m.value<0?'danger':m.value>0?'success':'neutral'):key==='net'?'info':'neutral';
            return <MetricCard key={key} label={label} value={prettyQuantity(m.value,key==='variance')} detail={m.fullDays+' / '+m.totalDays+' fully covered dates'} tone={tone} icon={icon}/>;
          })}
        </div>
      </section>)}

      {pdfUrl&&<section className="ops-panel p-4 space-y-3"><SectionTitle title="PDF preview" action={<button type="button" className={secondary} onClick={clearPdf}>Close preview</button>}/><iframe title="DSR PDF preview" src={pdfUrl} className="w-full h-[650px] border-0 rounded-lg"/><p className="text-xs text-slate-600">If your browser cannot display the preview, use Download PDF.</p></section>}

      {consolidated?<section className="ops-panel p-4 sm:p-5 space-y-3">
        <SectionTitle title="Product-wise consolidated quantities" description="Opening and physical closing use only the selected first and last dates. Sales days and [days] show fully covered dates."/>
        {consolidated.rows.length?<><QuantityTable headers={periodProductHeaders} label="Consolidated product quantities" rows={consolidated.rows.map(periodProductCells)} totalIndices={consolidated.rows.flatMap((r,i)=>r.isTotal?[i]:[])} varianceColumn={9}/><p className="text-xs text-slate-600">Scroll horizontally to view stock, receipts, sales and variance. Not recorded means a missing or unavailable value, not zero.</p></>:<div className="ops-notice" data-tone="info"><Info size={16}/>No recorded product quantities for the selected dates.</div>}
      </section>:<section className="ops-panel p-4 sm:p-5 space-y-3">
        <SectionTitle title="Product-wise net sales" description="Recorded-date subtotals only. Missing readings are not zero. Quantities of different units are never combined."/>
        {totals.length?<QuantityTable headers={['Product','Unit','Recorded days','Complete days','Recorded net sales','Coverage']} label="Product-wise net sales" minWidth={720} rows={totals.map(p=>[p.productCode+' — '+p.productName,p.unit,p.recordedDays+'/'+p.totalDays,p.completeDays+'/'+p.totalDays,p.recordedNetMilliunits===null?'Not recorded':formatMilliunits(p.recordedNetMilliunits),p.fullyRecorded?'Complete':'Incomplete subtotal'])}/>:<div className="ops-notice" data-tone="info"><Info size={16}/>No recorded product data for the selected dates.</div>}
      </section>}

      <section className="ops-panel p-4 sm:p-5 space-y-3" aria-label="Day-wise DSR records">
        <SectionTitle title="Day-wise DSR records" description="Expand a recorded date to review its readings and optional export remarks. Consecutive no-entry dates are grouped, not omitted."/>
        <div className="flex flex-wrap gap-2 text-xs text-slate-600"><span className="font-semibold">Operational DSR</span> · <span>Shift closure</span> · <span>Financial reconciliation</span></div>
        {model.dateGroups.map(g=>{
          const d=g.day,wf=getDsrWorkflowStatus(d);
          const noRecordedShift=g.noEntry&&d.shiftsCount===0&&wf.operational==='NOT_STARTED'&&wf.financial==='NOT_STARTED';
          return <details key={g.label} className="ops-record" data-empty={g.noEntry} open={days.length===1?true:undefined}>
            <summary>
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <span className="ops-choice-icon"><Calendar size={17}/></span>
                <div className="min-w-0"><p className="font-bold text-[#17365D] text-sm break-words">{g.count===1?dateLabel(d.businessDate):dateLabel(d.businessDate)+' – '+dateLabel(days[g.index+g.count-1].businessDate)}</p><p className="mt-1 text-xs text-slate-600">{g.noEntry?g.count+' date'+(g.count===1?'':'s')+' without DSR entries':dsrShiftHeader(d,shiftNames)}</p></div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {noRecordedShift?<StatusPill status={g.count===1?'NO ENTRY':g.count+' NO-ENTRY DATES'}/>:<>
                  <span className="flex flex-col items-start gap-1"><span className="text-[10px] font-semibold text-slate-600">Operations</span><StatusPill status={dsrStatusLabel(wf.operational)}/></span>
                  <span className="flex flex-col items-start gap-1"><span className="text-[10px] font-semibold text-slate-600">Shift</span><StatusPill status={operationalShiftClosure(d)}/></span>
                  <span className="flex flex-col items-start gap-1"><span className="text-[10px] font-semibold text-slate-600">Finance</span><StatusPill status={dsrStatusLabel(wf.financial)}/></span>
                </>}
                <ChevronDown size={18} className="ops-chevron text-slate-500" aria-hidden="true"/>
              </div>
            </summary>
            <div className="p-3 sm:p-4 space-y-3">
              {g.noEntry?<p className="text-sm text-slate-600">No saved DSR data for {g.count===1?'this date':'these '+g.count+' dates'}. No stock or sales values are inferred.</p>:<>
                <QuantityTable headers={['Product','Unit','Status',...dsrProductColumns]} label={'Product quantities '+d.businessDate} rows={d.byProduct.map(p=>[p.productCode,p.unit,p.status,...dsrProductValues(p)])} minWidth={1100} numericFrom={3} varianceColumn={11}/>
                {d.missingFields.length>0&&<details className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900"><summary className="!p-0 cursor-pointer font-semibold text-xs">Completion warnings ({d.missingFields.length}) <ChevronDown size={15}/></summary><ul className="mt-2 space-y-1 list-disc pl-5 text-xs">{d.missingFields.map((m,i)=><li key={i}>{m}</li>)}</ul></details>}
                {canExport&&<div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><label className="block text-xs font-semibold text-[#17365D]">Operator remarks on stock differences (optional)<textarea aria-label={'Operator remarks for '+d.businessDate} className={input+' mt-2 resize-y'} rows={2} maxLength={DSR_REMARK_MAX_LENGTH} disabled={busy||exporting} value={operatorRemarks[d.businessDate]??''} onChange={e=>{const value=e.target.value;clearPdf();setOperatorRemarks(prev=>({...prev,[d.businessDate]:value}));}} placeholder="Enter an explanation or follow-up action for the stock difference…"/></label><div className="flex flex-wrap justify-between gap-2 text-xs text-slate-600"><span>English text only. Export-only remarks; not saved to the shift. Refreshing the report clears them.</span><span>{(operatorRemarks[d.businessDate]??'').length}/{DSR_REMARK_MAX_LENGTH}</span></div>{dsrRemarkError(operatorRemarks[d.businessDate]??'')&&<p role="alert" className="mt-1 text-xs text-red-700">{dsrRemarkError(operatorRemarks[d.businessDate]??'')}</p>}</div>}
                <p className="text-xs text-slate-600">{reportFormat==='CONSOLIDATED'?'Select Detailed DSR for the full dispenser and nozzle meter statement.':'Full dispenser and nozzle meter statement is included in the PDF.'}</p>
              </>}
            </div>
          </details>;
        })}
      </section>
      <div className="flex items-start gap-2 px-1 text-xs text-slate-600"><ShieldCheck size={15} className="shrink-0 text-[#195c9d]"/><p>Retrieved {formatDsrIst(retrievedAt)}. This report reflects currently saved operational data, not an immutable historical snapshot. Operational completeness does not certify collections or final shift closure. No data is written.</p></div>
    </>}
  </div>;
}

export const DsrReportsPage: React.FC = () => {
  const {hasPermission,userCtx}=useAuth();
  const {activeOutletId,activeOutlet,accessibleOutlets,setActiveOutletId}=useActiveOutlet();
  const {selection, navigate}=useShiftWorkbench();
  const [mode,setMode]=useState<DsrPeriod>('DAY');
  const [anchor,setAnchor]=useState(() => selection?.businessDate || today());
  const [month,setMonth]=useState(getLocalMonthInputValue);
  const [from,setFrom]=useState(today);
  const [to,setTo]=useState(today);
  let dates:string[]=[];let validation='';
  try{dates=dsrDates(mode,anchor,month,from,to,today());}catch(e){validation=e instanceof Error?e.message:'Invalid dates.';}
  const canRead=hasPermission(PERMISSIONS.REPORTS_READ)&&hasPermission(PERMISSIONS.SHIFTS_READ);
  if(!canRead)return <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm">DSR Reports requires Reports Read and Shifts Read permissions.</div>;
  return <div className="ops-clarity space-y-5 pb-8">
    <header className="ops-hero p-5 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 max-w-2xl">
          <span className="ops-eyebrow">Finance & reports / DSR</span>
          <div className="flex items-center gap-3 mt-3"><FileText className="shrink-0 text-[#ffb17e]" size={28} aria-hidden="true"/><h1 className="text-2xl sm:text-3xl">Daily Sales Reports (DSR)</h1></div>
          <p className="mt-2 text-sm leading-relaxed">Review saved fuel stock and sales, check data coverage, and generate daily or management reports.</p>
        </div>
        <div className="ops-hero-context text-sm"><span className="block text-[11px] font-semibold uppercase tracking-wider">Active outlet</span><strong className="mt-1 block">{activeOutlet?activeOutlet.name:'Select an outlet'}</strong>{activeOutlet&&<span className="text-xs">RO {activeOutlet.roCode} · Read-only reporting</span>}</div>
      </div>
      {selection&&<div className="mt-4 flex flex-wrap items-center gap-3 border-t border-white/20 pt-3"><p className="text-xs flex-1">Workbench business date: {selection.businessDate}. DSR includes all shifts for the selected business dates.</p><button type="button" onClick={()=>navigate('daily-ops')} className="inline-flex items-center gap-2 rounded-lg border border-white/40 px-3 py-2 text-xs font-semibold text-white hover:bg-white/10"><ArrowLeft size={15}/>Return to shift workbench</button></div>}
    </header>
    <section className="ops-panel p-4 sm:p-5 space-y-4" aria-label="Report selection">
      <SectionTitle step="01" title="Select reporting period" description="Choose the outlet and business date range you want to review."/>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-2" role="group" aria-label="Report period">
        {periodChoices.map(({id,description,icon:Icon})=><button key={id} type="button" aria-label={labels[id]} aria-pressed={mode===id} onClick={()=>setMode(id)} className="ops-choice"><span className="ops-choice-icon"><Icon size={18}/></span><span className="min-w-0 flex-1"><span className="ops-choice-title">{labels[id]}</span><span className="ops-choice-detail">{description}</span></span>{mode===id&&<CheckCircle2 size={16} className="shrink-0 hidden sm:block text-[#195c9d]" aria-hidden="true"/>}</button>)}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <label className="text-xs font-semibold text-slate-700 min-w-0">Retail Outlet<select className={input+' mt-1.5'} value={activeOutletId||''} onChange={e=>setActiveOutletId(e.target.value)}><option value="" disabled>Select outlet</option>{accessibleOutlets.map(o=><option key={o.id} value={o.id}>{o.name} ({o.roCode})</option>)}</select></label>
        {(mode==='DAY'||mode==='WEEK')&&<label className="text-xs font-semibold text-slate-700 min-w-0">{mode==='DAY'?'Business date':'Any date in selected week (Mon–Sun)'}<input type="date" max={today()} className={input+' mt-1.5'} value={anchor} onChange={e=>setAnchor(e.target.value)}/></label>}
        {mode==='MONTH'&&<label className="text-xs font-semibold text-slate-700 min-w-0">Month<input type="month" max={today().slice(0,7)} className={input+' mt-1.5'} value={month} onChange={e=>setMonth(e.target.value)}/></label>}
        {mode==='CUSTOM'&&<><label className="text-xs font-semibold text-slate-700 min-w-0">From date<input type="date" max={today()} className={input+' mt-1.5'} value={from} onChange={e=>setFrom(e.target.value)}/></label><label className="text-xs font-semibold text-slate-700 min-w-0">To date<input type="date" max={today()} className={input+' mt-1.5'} value={to} onChange={e=>setTo(e.target.value)}/></label></>}
      </div>
      <p className="flex items-start gap-2 text-xs text-slate-600"><Calendar className="h-4 w-4 shrink-0"/>Current week/month ends at today; custom ranges support up to 92 days per PDF.</p>
      {validation&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{validation}</p>}
    </section>
    {activeOutlet&&dates.length>0&&!validation?<RetrievedReport key={activeOutlet.id+':'+mode+':'+dates.join(',')} outletId={activeOutlet.id} outletName={activeOutlet.name} roCode={activeOutlet.roCode} dates={dates} period={mode} canExport={hasPermission(PERMISSIONS.REPORTS_GENERATE)} generatedBy={userCtx?.user.name||'Authorized user'}/>:<div className="ops-panel p-4 text-sm text-slate-600">Select an accessible outlet and valid reporting period.</div>}
  </div>;
};
