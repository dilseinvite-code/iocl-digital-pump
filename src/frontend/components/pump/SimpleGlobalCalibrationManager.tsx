import React, {useEffect, useMemo, useState} from 'react';
import {AlertTriangle, CheckCircle2, FileSpreadsheet, RefreshCw, UploadCloud} from 'lucide-react';
import {apiFetch, clearApiCache} from '../../services/api';
import type {GlobalTankCalibrationTemplate} from '../../../shared/types';
import {limitTenKlCalibrationCurve} from '../../../shared/tenKlCalibrationLimit';
import {scannedReferenceSpec, reviewScannedCalibrationCandidate} from '../../../shared/scannedCalibrationReference';
import {parseSimpleCalibrationCsv, type ParsedSimpleCalibrationCsv} from './simpleCalibrationCsv';
import {GLOBAL_TANK_CAPACITIES_LITRES, exceedsGlobalCalibrationLimit, globalCalibrationMaxLitres} from '../../../shared/globalTankTypes';

interface Props {
  selectedOutletId: string;
  selectedOutletName?: string;
  canWriteTankCalibration: boolean;
  canApproveCalibrationChart: boolean;
  initialSelectedCode?: string;
  onCalibrationAssigned?: () => void;
}
type UploadPreview = {charts: Array<{
  templateCode:string;templateName:string;sheetName:string;nominalCapacityLitres:number;
  maxDipMm:number;maxVolumeLitres:number;actualPointCount:number;eligibleForDraftImport:boolean;
  warnings:string[];errors:string[];points:Array<{dipMm:number;volumeLitres:number}>;
}>;eligibleChartsCount:number;workbookName:string;workbookSha256:string};
type ImportResponse = {importedTemplates:Array<{code:string;action:string;status:string}>;
  skippedCharts:Array<{templateCode:string;reason:string}>};
const fmt=(value:number)=>value.toLocaleString('en-IN',{maximumFractionDigits:3});
const MAX_FILE_BYTES=8*1024*1024;

export const SimpleGlobalCalibrationManager:React.FC<Props> = ({
  selectedOutletName,canWriteTankCalibration,initialSelectedCode,
})=>{
  const [templates,setTemplates]=useState<GlobalTankCalibrationTemplate[]>([]);
  const [defaultCharts,setDefaultCharts]=useState<Record<number,string>>({});
  const [settingDefault,setSettingDefault]=useState(false);
  const [detail,setDetail]=useState<GlobalTankCalibrationTemplate|null>(null);
  const [selectedCode,setSelectedCode]=useState('');
  const [file,setFile]=useState<File|null>(null);
  const [mode,setMode]=useState<'excel'|'csv'|null>(null);
  const [preview,setPreview]=useState<UploadPreview|null>(null);
  const [csv,setCsv]=useState<ParsedSimpleCalibrationCsv|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [showReadings,setShowReadings]=useState(false);
  const [creatingCustom,setCreatingCustom]=useState(false);
  const [newCapacity,setNewCapacity]=useState('');
  const [newTitle,setNewTitle]=useState('');
  const [savedExcel,setSavedExcel]=useState(false);
  const [acknowledgedSaveWarning,setAcknowledgedSaveWarning]=useState(false);
  const [acknowledgedDefaultWarning,setAcknowledgedDefaultWarning]=useState(false);

  const loadTemplates=async()=>{
    const result=await apiFetch<GlobalTankCalibrationTemplate[]>('/api/v1/calibration-templates');
    if(!result.success || !result.data)throw new Error(result.error?.message || 'Could not load calibration charts');
    setTemplates(result.data);
    setSelectedCode(current=>current || result.data?.find(t=>t.code==='EXCEL_10KL_REFERENCE')?.code || result.data?.[0]?.code || '');
  };
  const loadDefaults=async()=>{
    const r=await apiFetch<Array<{capacityLitres:number;templateId:string}>>('/api/v1/global-tank-defaults');
    if(r.success&&r.data)setDefaultCharts(Object.fromEntries(r.data.map(d=>[d.capacityLitres,d.templateId])));
  };
  useEffect(()=>{loadTemplates().catch(e=>setError(e.message));void loadDefaults();},[]);
  // A copied tank chart can open its exact global source, not an unrelated 10 KL default.
  useEffect(()=>{
    if(initialSelectedCode)setSelectedCode(initialSelectedCode);
  },[initialSelectedCode]);

  const chosen=templates.find(t=>t.code===selectedCode);
  const scannedSpec=chosen ? scannedReferenceSpec(chosen.nominalCapacityLitres) : null;
  const scannedReview=chosen && scannedSpec
    ? reviewScannedCalibrationCandidate({
        code:chosen.code,
        nominalCapacityLitres:chosen.nominalCapacityLitres,
        tankDiameterMm:detail?.id===chosen.id?detail.tankDiameterMm:chosen.tankDiameterMm,
        tankLengthMm:detail?.id===chosen.id?detail.tankLengthMm:chosen.tankLengthMm,
        maxDipMm:detail?.id===chosen.id?detail.maxDipMm:chosen.maxDipMm,
        points:(detail?.id===chosen.id?detail.points||[]:[]).map(p=>({dipMm:p.dipMillimetres,volumeLitres:p.volumeLitres})),
      })
    : null;
  const defaultOver15=Boolean(chosen&&exceedsGlobalCalibrationLimit(chosen.maxVolumeLitres||0,chosen.nominalCapacityLitres));
  const defaultHasWarning=Boolean(defaultOver15||(scannedReview&&!scannedReview.passed));
  const canSetAsDefault=Boolean(chosen && (chosen.pointsCount||0)>=2 &&
    (!defaultHasWarning || acknowledgedDefaultWarning));
  useEffect(()=>setAcknowledgedDefaultWarning(false),[chosen?.id]);
  const setDefault=async()=>{
    if(!chosen||!canSetAsDefault||settingDefault)return;
    setSettingDefault(true);setError('');setNotice('');
    try{
      const r=await apiFetch<{capacityLitres:number;templateId:string}>(
        '/api/v1/global-tank-defaults/'+chosen.nominalCapacityLitres,
        {method:'PUT',body:JSON.stringify({templateId:chosen.id,acknowledgedWarnings:defaultHasWarning&&acknowledgedDefaultWarning})});
      if(!r.success)throw new Error(r.error?.message||'Could not save default calibration');
      await loadDefaults();
      setNotice(chosen.nominalCapacityLitres/1000+' KL default saved. New tanks of this capacity will select this calibration automatically.');
    }catch(e:any){setError(e.message||'Default selection failed');}
    finally{setSettingDefault(false);}
  };
  useEffect(()=>{
    if(!chosen?.id){setDetail(null);return;}
    let cancelled=false;
    setDetail(null);
    apiFetch<GlobalTankCalibrationTemplate>('/api/v1/calibration-templates/'+encodeURIComponent(chosen.id))
      .then(res=>{if(!cancelled&&res.success&&res.data)setDetail(res.data);})
      .catch(()=>{});
    return ()=>{cancelled=true;};
  },[chosen?.id,chosen?.updatedAt]);
  const chartRows=detail?.id===chosen?.id?(detail?.points||[]):[];
  const capped10=useMemo(()=>{
    if(chosen?.code!=='EXCEL_10KL_REFERENCE' || chartRows.length<2)return null;
    try{return limitTenKlCalibrationCurve(chartRows);}catch{return null;}
  },[chosen?.code,chartRows]);
  const previewCharts=preview?.charts||[];
  const pendingWarnings=previewCharts.filter(ch=>ch.warnings?.length ||
    exceedsGlobalCalibrationLimit(ch.maxVolumeLitres,ch.nominalCapacityLitres));
  const selectedNominal=creatingCustom ? Number(newCapacity) : chosen?.nominalCapacityLitres;
  const tankTypeOptions = GLOBAL_TANK_CAPACITIES_LITRES;
  const csvExcess=Boolean(csv&&selectedNominal&&selectedNominal>0&&
    exceedsGlobalCalibrationLimit(csv.maxVolumeLitres,selectedNominal));
  const plainWarning=(message:string)=>{
    if(/ENGINEERING REVIEW REQUIRED|authorised engineer/i.test(message))
      return 'Volume exceeds the usual capacity range. Check dip/volume numbers and units. Re-upload a corrected chart if necessary.';
    if(/DIMENSION VERIFICATION REQUIRED|conflicting.*length/i.test(message))
      return 'The worksheet has conflicting tank dimensions. Check the length and diameter, then re-upload if needed.';
    return message;
  };
  const canReplaceExisting=Boolean(chosen&&chosen.status==='DRAFT' &&
    !(chosen.activeAssignedTanksCount||chosen.stagedDraftTanksCount));
  const excelOver15=Boolean(previewCharts.some(ch=>exceedsGlobalCalibrationLimit(ch.maxVolumeLitres,ch.nominalCapacityLitres)));
  const saveNeedsAcknowledgement=mode==='excel'?excelOver15:csvExcess;
  const previewGood=mode==='excel'?Boolean(preview?.eligibleChartsCount && previewCharts.every(ch=>ch.eligibleForDraftImport && (!exceedsGlobalCalibrationLimit(ch.maxVolumeLitres,ch.nominalCapacityLitres)||acknowledgedSaveWarning))):
    Boolean(csv?.valid && selectedNominal && (creatingCustom || canReplaceExisting) && (!csvExcess||acknowledgedSaveWarning));

  const choose=async(f:File|null)=>{
    setFile(f);setMode(null);setPreview(null);setCsv(null);setError('');setNotice('');setSavedExcel(false);setAcknowledgedSaveWarning(false);
    if(!f)return;
    const ext=f.name.toLowerCase().split('.').pop()||'';
    if(f.size>MAX_FILE_BYTES){setError('File too large. Upload a file smaller than 8 MB.');return;}
    if(ext==='pdf'||ext==='png'||ext==='jpg'||ext==='jpeg'){
      setError('Scanned PDF/photo cannot be converted reliably into certified dip readings here. Upload the table as Excel (.xlsx/.xls) or CSV. Keep the PDF as separate supporting evidence.');
      return;
    }
    if(!['xlsx','xls','csv'].includes(ext)){
      setError('Supported calibration data: Excel (.xlsx/.xls) or two-column CSV (.csv).');
      return;
    }
    setBusy(true);
    try{
      if(ext==='csv'){
        const data=parseSimpleCalibrationCsv(await f.text());
        setCsv(data);setMode('csv');
      } else {
        const body=new FormData();body.append('file',f);
        const resp=await apiFetch<UploadPreview>('/api/v1/calibration-templates/excel-preview',{method:'POST',body});
        if(!resp.success||!resp.data)throw new Error(resp.error?.message||'Excel sheet could not be read.');
        setPreview(resp.data);setMode('excel');
        if(!resp.data.charts.length)throw new Error('No 10, 15, 20 or 50 KL sheet detected. For a custom chart, export its dip/volume table to CSV and upload that.');
      }
    }catch(e:any){setError(e.message||'Unable to read file');}
    finally{setBusy(false);}
  };

  const save=async()=>{
    if(!file||busy)return;
    setBusy(true);setError('');setNotice('');
    try{
      if(mode==='excel'){
        if(!preview?.eligibleChartsCount || previewCharts.some(ch=>!ch.eligibleForDraftImport))throw new Error('Workbook contains unreadable or invalid dip/volume rows.');
        if(excelOver15&&!acknowledgedSaveWarning)throw new Error('Acknowledge the +15% warning before saving this non-operational draft.');
        const body=new FormData();body.append('file',file);body.append('confirmImport','true');
        if(excelOver15)body.append('acknowledgeOver15Warning','true');
        const resp=await apiFetch<ImportResponse>('/api/v1/calibration-templates/excel-import',{method:'POST',body});
        if(!resp.success||!resp.data)throw new Error(resp.error?.message || 'Could not save workbook.');
        const imported=resp.data.importedTemplates || [];
        const skipped=resp.data.skippedCharts || [];
        setNotice(imported.length+' chart(s) saved or retained as drafts. '+(skipped.length?skipped.length+' were protected or skipped; check and re-upload if needed.':'No duplicate charts created.'));
        setSavedExcel(true);
      }else if(mode==='csv'){
        if(!csv?.valid)throw new Error(csv?.errors[0]||'CSV needs valid dip/volume rows.');
        if(csvExcess&&!acknowledgedSaveWarning)throw new Error('Acknowledge the +15% warning before saving this non-operational draft.');
        let id=chosen?.id;
        if(creatingCustom){
          const nominal=Number(newCapacity);
          if(!tankTypeOptions.some(cap=>cap===nominal)||!newTitle.trim())throw new Error('Enter a chart name and a supported tank capacity (10, 15, 20 or 50 KL).');
          const code='CUSTOM_'+Date.now().toString(36).toUpperCase();
          const result=await apiFetch<GlobalTankCalibrationTemplate>('/api/v1/calibration-templates',{
            method:'POST',
            body:JSON.stringify({code,name:newTitle.trim(),nominalCapacityLitres:nominal,maxDipMm:csv.maxDipMm,status:'DRAFT'})
          });
          if(!result.success||!result.data)throw new Error(result.error?.message||'Could not create chart.');
          id=result.data.id;
          setSelectedCode(code);setCreatingCustom(false);
        }else if(!canReplaceExisting){
          throw new Error('This chart is already approved, assigned, or protected. Create a new custom draft instead of overwriting live or historical data.');
        }
        if(!id)throw new Error('Choose a chart or create a custom draft first.');
        const resp=await apiFetch<GlobalTankCalibrationTemplate>(
          '/api/v1/calibration-templates/'+encodeURIComponent(id)+'/import',{
            method:'POST',body:JSON.stringify({
              csvText:csv.normalizedCsv,status:'DRAFT',simpleUpload:true,allowOverCapacity:true,acknowledgeOver15Warning:csvExcess&&acknowledgedSaveWarning,
              sourceFileName:file.name,notes:'Uploaded through simplified calibration review. '+csv.warnings.join('; '),
            })
          });
        if(!resp.success||!resp.data)throw new Error(resp.error?.message||'Unable to save CSV chart.');
        setSelectedCode(resp.data.code);
        setNotice('Saved '+resp.data.pointsCount+' dip-to-volume readings as a draft. No live tank or DSR was modified.');
      }
      clearApiCache();
      await loadTemplates();
    }catch(e:any){setError(e.message||'Unable to save calibration');}
    finally{setBusy(false);}
  };

  return <div className="mx-auto max-w-6xl space-y-5 pb-10" data-testid="simple-global-calibration-manager">
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-[#17365D]">Calibration Charts</h2>
          <p className="mt-1 text-sm text-slate-600">Upload a chart, check the readings, then save. No certificate forms in this workspace.</p>
          <p className="mt-1 text-xs text-slate-500">{selectedOutletName || 'Global library'} · Saved charts are reusable references, not automatic live tank changes.</p>
        </div>
        <button type="button" className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-[#17365D]"
          onClick={()=>{setError('');loadTemplates().catch(e=>setError(e.message));}}><RefreshCw className="mr-1 inline h-4 w-4"/>Refresh</button>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {['1. Choose type / Upload','2. Review +15% limit','3. Save global chart'].map((name,i)=>
          <div key={name} className="rounded-xl bg-[#F4F7FB] p-3 text-sm font-semibold text-[#17365D]">
            <span className="mr-2 text-orange-600">{i+1}</span>{name.slice(3)}
          </div>)}
      </div>
    </section>

    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-testid="simple-calibration-upload">
      <div className="flex items-center gap-2"><UploadCloud className="h-5 w-5 text-orange-600"/><h3 className="font-bold text-[#17365D]">Upload calibration file</h3></div>
      <p className="mt-1 text-xs text-slate-500">Excel (.xlsx/.xls) or CSV (.csv), up to 8 MB. Scanned PDFs require a checked spreadsheet transcription.</p>
      <input type="file" accept=".xlsx,.xls,.csv,.pdf,.png,.jpg,.jpeg" disabled={!canWriteTankCalibration||busy}
        data-testid="simple-calibration-file-input"
        onChange={e=>{void choose(e.target.files?.[0]||null);e.currentTarget.value='';}}
        className="mt-3 block w-full rounded-lg border border-dashed border-slate-300 bg-[#F8FAFC] px-3 py-4 text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-[#17365D] file:px-3 file:py-2 file:text-white"/>
      {busy&&<p className="mt-3 flex items-center gap-2 text-sm text-[#17365D]"><RefreshCw className="h-4 w-4 animate-spin"/>Processing file...</p>}
      {file&&<p className="mt-2 text-xs text-slate-500">Selected: {file.name}</p>}
    </section>

    {mode==='csv'&&csv&&<section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-testid="simple-csv-preview">
      <h3 className="font-bold text-[#17365D]">CSV preview — {csv.points.length} readings</h3>
      <p className="mt-1 text-sm text-slate-600">Dip: 0–{fmt(csv.maxDipMm)} mm · Maximum volume: {fmt(csv.maxVolumeLitres)} L</p>
      <label className="mt-4 block text-xs font-semibold text-slate-600">Save into</label>
      <select className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={creatingCustom?'__new__':selectedCode}
        onChange={e=>{if(e.target.value==='__new__'){setCreatingCustom(true);}else{setCreatingCustom(false);setSelectedCode(e.target.value);}}}>
        {templates.map(t=><option key={t.id} value={t.code}>{t.name} ({Math.round(t.nominalCapacityLitres/1000)} KL) — {t.status}</option>)}
        <option value="__new__">Create a new custom chart</option>
      </select>
      {creatingCustom&&<div className="mt-3 grid gap-3 sm:grid-cols-2">
        <input aria-label="New chart name" placeholder="Chart name (e.g. Global 50 KL)" value={newTitle} onChange={e=>setNewTitle(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"/>
        <input aria-label="Nominal capacity in litres" placeholder="Nominal capacity (litres: 10000 / 15000 / 20000 / 50000)" type="number" min="1" value={newCapacity} onChange={e=>setNewCapacity(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"/>
      </div>}
      {csv.errors.length>0&&<div role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{csv.errors.slice(0,4).join(' · ')}</div>}
      {csv.warnings.length>0&&<div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{csv.warnings.join(' · ')}</div>}
      {csvExcess&&<div className="mt-3 flex gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900" data-testid="csv-over-capacity-warning">
        <AlertTriangle className="h-4 w-4 shrink-0"/>Maximum {fmt(csv.maxVolumeLitres)} L exceeds +15% of {fmt(globalCalibrationMaxLitres(selectedNominal||0))} L. You may acknowledge and save as DRAFT only; this does not activate a tank or approve stock calculations.
      </div>}
      <details className="mt-3"><summary className="cursor-pointer text-sm font-semibold text-[#17365D]">Show uploaded readings</summary>
        <div className="mt-2 max-h-60 overflow-auto rounded border border-slate-200">
          <table className="w-full text-left text-xs"><thead className="sticky top-0 bg-[#F4F7FB]"><tr><th className="p-2">Dip (mm)</th><th className="p-2">Volume (L)</th></tr></thead>
            <tbody>{csv.points.map((p,i)=><tr key={i} className="border-t border-slate-100"><td className="p-2">{fmt(p.dipMm)}</td><td className="p-2">{fmt(p.volumeLitres)}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </section>}

    {mode==='excel'&&preview&&<section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-testid="simple-excel-preview">
      <h3 className="font-bold text-[#17365D]">Review imported sheets</h3>
      <p className="mt-1 text-xs text-slate-500">{preview.workbookName} · {previewCharts.length} calibration charts detected</p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {previewCharts.map(ch=>{
          const over=exceedsGlobalCalibrationLimit(ch.maxVolumeLitres,ch.nominalCapacityLitres);
          return <div key={ch.sheetName} className="rounded-xl border border-slate-200 p-4" data-testid={'simple-chart-'+ch.templateCode}>
            <div className="flex items-start justify-between gap-3">
              <div><h4 className="font-bold text-[#17365D]">{ch.templateName}</h4><p className="text-xs text-slate-500">Sheet: {ch.sheetName}</p></div>
              <span className={'rounded px-2 py-1 text-xs font-medium '+(ch.eligibleForDraftImport?'bg-green-50 text-green-700':'bg-red-50 text-red-700')}>
                {ch.eligibleForDraftImport?'Ready to save':'Needs correction'}</span>
            </div>
            <p className="mt-2 text-sm text-slate-700">{fmt(ch.actualPointCount)} readings · Max {fmt(ch.maxVolumeLitres)} L · {fmt(ch.maxDipMm)} mm</p>
            {(over||ch.warnings?.length>0||ch.errors?.length>0)&&<div className="mt-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900" data-testid={'simple-warning-'+ch.templateCode}>
              <AlertTriangle className="mr-1 inline h-4 w-4"/>
              {over&&<p>Max volume exceeds {fmt(globalCalibrationMaxLitres(ch.nominalCapacityLitres))} L (+15%). This can be acknowledged for DRAFT reference storage only; operational activation remains separate.</p>}
              {(ch.errors||[]).concat(ch.warnings||[]).slice(0,3).map((w,i)=><p key={i}>{plainWarning(w)}</p>)}
            </div>}
            <details className="mt-3"><summary className="cursor-pointer text-xs font-semibold text-[#17365D]">View dip / volume readings</summary>
              <div className="mt-1 max-h-48 overflow-auto text-xs">{(ch.points||[]).map((p,i)=><div key={i} className="flex justify-between border-b border-slate-100 p-1.5"><span>{fmt(p.dipMm)} mm</span><span>{fmt(p.volumeLitres)} L</span></div>)}</div>
            </details>
          </div>;
        })}
      </div>
      {pendingWarnings.length>0&&<p className="mt-3 text-xs text-amber-900">Warnings are for review; they do not automatically change the uploaded table or permit unsafe tank activation.</p>}
    </section>}

    {(mode==='csv'||mode==='excel')&&<section className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      {saveNeedsAcknowledgement&&<label className="flex w-full items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        <input type="checkbox" checked={acknowledgedSaveWarning} onChange={e=>setAcknowledgedSaveWarning(e.target.checked)}
          data-testid="acknowledge-over-15-draft" className="mt-0.5"/>
        I understand this chart exceeds +15%. Save these exact uploaded rows as a non-operational DRAFT; do not silently modify or truncate volumes.
      </label>}
      <button type="button" disabled={!canWriteTankCalibration||busy||!previewGood||(mode==='excel'&&savedExcel)}
        data-testid="simple-save-calibration"
        className="rounded-xl bg-orange-600 px-6 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
        onClick={()=>{void save();}}>{busy?'Saving...':mode==='excel'&&savedExcel?'Draft saved':'Save calibration draft'}</button>
      <span className="text-xs text-slate-600">No automatic change to tanks, shift readings or financial records.</span>
    </section>}

    {notice&&<div role="status" className="flex items-start gap-2 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800"><CheckCircle2 className="h-5 w-5 shrink-0"/>{notice}</div>}
    {error&&<div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-testid="simple-saved-calibrations">
      <h3 className="font-bold text-[#17365D]">Saved calibration charts</h3>
      <p className="mt-1 text-xs text-slate-500">Save the chart for each capacity once. If multiple saved charts share a capacity, choose one as its default below. Add Underground Tank will then ask for only name and capacity.</p>
      <div className="mt-3 flex flex-wrap gap-2">{templates.map(t=><button key={t.id} type="button" onClick={()=>{setSelectedCode(t.code);setShowReadings(false);}}
        className={'rounded-lg border px-3 py-2 text-sm '+(t.code===selectedCode?'border-orange-500 bg-orange-50 text-[#17365D] font-bold':'border-slate-200 text-slate-600')}>
        {Math.round(t.nominalCapacityLitres/1000)} KL · {t.name} ({t.pointsCount} pts)
      </button>)}</div>
      {chosen&&<div className="mt-4 rounded-xl bg-[#F4F7FB] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h4 className="font-bold text-[#17365D]">{chosen.name}</h4>
          <p className="text-sm text-slate-600">{chosen.pointsCount} points · {chosen.status} · Max {fmt(chosen.maxVolumeLitres||0)} L</p></div>
          <button type="button" className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-[#17365D]" onClick={()=>setShowReadings(v=>!v)}>
            {showReadings?'Hide readings':'View readings'}</button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {defaultCharts[chosen.nominalCapacityLitres]===chosen.id
            ? <span className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs font-semibold text-green-800">Default for {chosen.nominalCapacityLitres/1000} KL — automatic selection enabled</span>
            : canWriteTankCalibration && <button type="button" disabled={!canSetAsDefault||settingDefault}
                onClick={()=>{void setDefault();}} className="rounded-lg bg-[#17365D] px-3 py-2 text-xs font-bold text-white disabled:opacity-40">
                {settingDefault?'Saving...':'Set as default for '+chosen.nominalCapacityLitres/1000+' KL'}
              </button>}
          {scannedReview&&!scannedReview.passed&&<div className="w-full rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900" data-testid="scanned-reference-checkpoint-warning">Warning: The stored digital readings differ from the source PDF at one or more sampled checkpoints, or the full scan is not loaded. Selecting this chart will use its **stored digital values**, not exact transcribed PDF values. {scannedReview.issues.slice(0,3).join(' ')}</div>}
          {scannedReview?.passed&&<span className="text-xs text-green-800">Full dip range and sampled scan checkpoints match. Full row-by-row transcription still requires review before live activation.</span>}
          {defaultHasWarning&&defaultCharts[chosen.nominalCapacityLitres]!==chosen.id&&<label className="flex w-full items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <input type="checkbox" data-testid="acknowledge-default-chart-warning" checked={acknowledgedDefaultWarning} onChange={e=>setAcknowledgedDefaultWarning(e.target.checked)} className="mt-0.5"/>
            I acknowledge the source/volume warning. Use this saved digital chart as a DRAFT reference for newly registered inactive tanks; do not mark it operationally approved.
          </label>}
          {!canSetAsDefault&&!defaultHasWarning&&<span className="text-xs text-amber-800">At least two numerical dip-to-volume readings must be saved before choosing a default.</span>}
        </div>
        {capped10&&<p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
          Full 10 KL reference range: 0–{fmt(capped10.operationalMaximumDipMm)} mm / 0–{fmt(capped10.operationalMaximumLitres)} L. No 11,000 L truncation. Physical safe-fill remains separate.
        </p>}
        {exceedsGlobalCalibrationLimit(chosen.maxVolumeLitres||0,chosen.nominalCapacityLitres)&&<p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
          Warning: Source maximum {fmt(chosen.maxVolumeLitres||0)} L exceeds the +15% threshold of {fmt(globalCalibrationMaxLitres(chosen.nominalCapacityLitres))} L. You can acknowledge it for DRAFT reference use; the system preserves every recorded number.
        </p>}
        {showReadings&&<div className="mt-3 max-h-72 overflow-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-left text-xs"><thead className="sticky top-0 bg-[#E8EEF5]"><tr><th className="p-2">Dip (mm)</th><th className="p-2">Volume (L)</th></tr></thead>
            <tbody>{chartRows.map((p,i)=><tr key={p.id||i} className="border-t border-slate-100"><td className="p-2">{fmt(p.dipMillimetres)}</td><td className="p-2">{fmt(p.volumeLitres)}</td></tr>)}</tbody>
          </table>
        </div>}
      </div>}
      <p className="mt-4 text-xs text-slate-500">Operational tank activation is intentionally separate and permission-controlled. This page does not request engineering-verification forms, issue certifications or change existing active charts.</p>
    </section>
  </div>;
};
