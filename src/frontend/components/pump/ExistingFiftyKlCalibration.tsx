import React, { useEffect, useState } from 'react';
import type { Tank, TankCalibrationChart, TankCalibrationPoint, GlobalTankCalibrationTemplate } from '../../../shared/types';
import { apiFetch, clearApiCache } from '../../services/api';
import { reviewReusableGlobalChart } from './reusableGlobalChart';

const STANDARD_50KL = 'gtct-std-50kl';
const fields = [
  ['tankIdentifier','Physical tank identifier','text'],
  ['tankSerialNumber','Tank serial / reference number','text'],
  ['verifiedDiameterMm','Certified diameter (mm)','number'],
  ['verifiedLengthMm','Certified length (mm)','number'],
  ['verifiedMaxDipMm','Certified maximum dip (mm)','number'],
  ['issuingAuthority','Certificate issuing authority','text'],
  ['certificateNumber','Official certificate number','text'],
  ['verificationDate','Verification date','date'],
  ['engineeringApprover','Actual engineering approver','text'],
  ['supportingDocumentId','Official certificate Document Vault ID','text'],
] as const;

export function isFiftyKlSourceReady(source: GlobalTankCalibrationTemplate | null): boolean {
  return Boolean(source && source.id === STANDARD_50KL && source.nominalCapacityLitres === 50000 &&
    ['APPROVED','ACTIVE'].includes(source.status) && (source.points?.length ?? 0) >= 2 &&
    source.points?.length === source.pointsCount &&
    !source.requiresEngineeringReview && !source.requiresDimensionVerification && !source.isOverCapacityCeiling);
}

type Props = {
  tank: Tank; chart: TankCalibrationChart | null; points: TankCalibrationPoint[];
  canAssign: boolean; onChanged: (chartId:string)=>Promise<void>;
};

export function ExistingFiftyKlCalibration({tank,chart,points,canAssign,onChanged}: Props) {
  const [source,setSource] = useState<GlobalTankCalibrationTemplate|null>(null);
  const [busy,setBusy] = useState(false);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [preview,setPreview] = useState(false);
  const [verify,setVerify] = useState(false);
  const [values,setValues] = useState<Record<string,string>>({});
  const [confirmed,setConfirmed] = useState(false);
  const [verifiedEvidence,setVerifiedEvidence] = useState(false);
  const base = '/api/v1/calibration-templates/' + STANDARD_50KL;
  const tankBase = '/api/v1/tanks/' + encodeURIComponent(tank.id) + '/calibration';
  const linked = chart?.sourceTemplateId === STANDARD_50KL;
  const ready = isFiftyKlSourceReady(source);
  const review = reviewReusableGlobalChart(chart,points,source,tank.capacityLitres);
  useEffect(()=>{
    let cancelled=false;
    setLoading(true);
    apiFetch<GlobalTankCalibrationTemplate>(base,{cache:'no-store'}).then(res=>{
      if(cancelled)return;
      if(!res.success||!res.data) throw new Error(res.error?.message || '50 KL global source could not be loaded.');
      setSource(res.data);
    }).catch(e=>{if(!cancelled)setError(e.message);}).finally(()=>{if(!cancelled)setLoading(false);});
    return ()=>{cancelled=true;};
  },[base,tank.id]);

  const check = async () => {
    const res = await apiFetch<{previews:Array<{tankId:string;hasProtectedDraft:boolean;isCompatible:boolean;currentActiveChart:unknown}>}>(base+'/assign-preview',{
      method:'POST',body:JSON.stringify({tankIds:[tank.id]})
    });
    if(!res.success) throw new Error(res.error?.message || 'Tank compatibility could not be verified.');
    const p = res.data?.previews?.find(x=>x.tankId===tank.id);
    if(!p?.isCompatible)throw new Error('Tank is not confirmed compatible with the source.');
    if(!linked && (p.hasProtectedDraft || p.currentActiveChart))throw new Error('An existing chart is protected. Review its revision rather than replacing it.');
    return true;
  };
  const run = async (fn:()=>Promise<void>) => {
    if(busy)return;
    setBusy(true);setError('');
    try { await fn(); } catch(e:any) {setError(e.message || 'Calibration action failed.');}
    finally {setBusy(false);}
  };
  const assign = () => run(async()=>{
    if(!ready||!preview||!canAssign||linked)return;
    await check();
    const res = await apiFetch<{assignments:Array<{tankId:string;chartId:string;preservedExistingDraft?:boolean}>}>(base+'/assign',{
      method:'POST',body:JSON.stringify({tankIds:[tank.id],notes:'Existing tank: certified compatible 50 KL global reference, staged as DRAFT.'})
    });
    if(!res.success)throw new Error(res.error?.message || 'Could not link global chart.');
    const item = res.data?.assignments?.find(x=>x.tankId===tank.id);
    if(!item || item.preservedExistingDraft)throw new Error('An existing draft was preserved; review its revision.');
    setConfirmed(false);
    await onChanged(item.chartId);
  });
  const saveVerification = (event:React.FormEvent) => {
    event.preventDefault();
    void run(async()=>{
      if(!verifiedEvidence||!canAssign||!ready)return;
      const res = await apiFetch(tankBase+'/engineering-verify',{
        method:'POST',body:JSON.stringify({...values,decision:'VERIFIED',verifiedCapacityLitres:tank.capacityLitres,
          verifiedDiameterMm:Number(values.verifiedDiameterMm),verifiedLengthMm:Number(values.verifiedLengthMm),
          verifiedMaxDipMm:Number(values.verifiedMaxDipMm)})
      });
      if(!res.success)throw new Error(res.error?.message || 'Could not record engineering verification.');
      clearApiCache();
      setVerify(false);setPreview(false);
      await check();setPreview(true);
    });
  };
  const activate = () => run(async()=>{
    if(!linked||!chart||!review.ready||!confirmed||!canAssign)return;
    await check();
    const res=await apiFetch<TankCalibrationChart>(tankBase+'/charts/'+encodeURIComponent(chart.id)+'/status',{
      method:'POST',body:JSON.stringify({status:'ACTIVE',confirmActivation:true,notes:'Certified 50 KL source matched; physical compatibility and operating limits confirmed by administrator.'})
    });
    if(!res.success)throw new Error(res.error?.message || 'Could not activate chart.');
    await onChanged(chart.id);
  });

  return <section className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 space-y-3" data-testid="existing-50kl-global-calibration">
    <div><h3 className="font-bold text-[#17365D]">Global 50 KL Calibration</h3>
    <p className="text-xs text-slate-600">Reuse the saved reference without uploading readings. Tank-specific certification is required; assignment creates a draft and never activates a tank.</p></div>
    {loading && <p role="status" className="text-xs">Checking global reference…</p>}
    {source && <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs text-slate-700">
      <div><strong>{source.name}</strong><br/>{source.status} · Rev #{source.revisionNumber}</div>
      <div>{source.pointsCount} saved readings<br/>Max dip: {source.maxDipMm ?? '—'} mm</div>
      <div>Chart max: {source.maxVolumeLitres?.toLocaleString('en-IN') ?? '—'} L<br/>Safe-fill: {tank.safeFillCapacityLitres.toLocaleString('en-IN')} L (unchanged)</div>
      <div>Reference diameter: {source.tankDiameterMm ?? '—'} mm</div><div>Reference length: {source.tankLengthMm ?? '—'} mm</div>
    </div>}
    {!loading && !ready && <p role="status" className="text-xs text-amber-800">No usable approved standard 50 KL source is available. Review the global library.</p>}
    {ready && canAssign && !linked && <>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={()=>void run(async()=>{setPreview(false);await check();setPreview(true);})} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-[#17365D]">Check tank compatibility</button>
        <button type="button" data-testid="link-global-50kl-chart" disabled={busy||!preview} onClick={()=>void assign()} className="rounded-lg bg-[#17365D] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Link Global 50 KL Chart</button>
        <button type="button" disabled={busy} onClick={()=>{setVerify(v=>!v);setPreview(false);}} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs">Record certificate verification</button>
      </div>
      {preview && <p className="text-xs text-emerald-800" role="status">Compatible according to saved verification. Link as DRAFT; activation is separate.</p>}
      {verify && <form onSubmit={saveVerification} className="space-y-3 rounded-lg border border-amber-200 bg-white p-3">
        <p className="text-xs text-amber-900">Enter only actual tank-specific certificate information. Upload the official PDF/image to Document Vault first. Do not copy nominal template dimensions as proof.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {fields.map(([key,label,type])=><label key={key} className="text-xs text-slate-700">{label}<input required type={type} min={type==='number'?1:undefined} step={type==='number'?'any':undefined}
            value={values[key]||''} onChange={e=>{setValues(v=>({...v,[key]:e.target.value}));setVerifiedEvidence(false);}}
            className="block w-full rounded-md border border-slate-300 p-2 mt-1 text-sm"/></label>)}
        </div>
        <label className="flex gap-2 text-xs"><input type="checkbox" checked={verifiedEvidence} onChange={e=>setVerifiedEvidence(e.target.checked)}/>I have verified this physical tank against the official certificate and entered the actual details.</label>
        <button type="submit" disabled={busy||!verifiedEvidence} className="rounded-lg bg-[#17365D] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Save verification and check compatibility</button>
      </form>}
    </>}
    {linked && chart && chart.status !== 'ACTIVE' && <>
      <p role="status" className="text-xs text-slate-700">Linked revision #{chart.revisionNumber}: {chart.status}. {review.message}</p>
      {canAssign && ready && review.ready && ['DRAFT','APPROVED'].includes(chart.status) && <>
        <label className="flex gap-2 text-xs text-amber-900"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I confirm the approved chart matches the physical tank and its saved safe-fill and minimum operating limits are approved. Activation changes future dip conversion.</label>
        <button type="button" data-testid="activate-global-50kl-chart" disabled={busy||!confirmed} onClick={()=>void activate()} className="rounded-lg bg-[#17365D] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Activate linked 50 KL chart</button>
      </>}
    </>}
    {busy && <p role="status" className="text-xs">Checking / saving calibration…</p>}
    {error && <p role="alert" className="rounded-lg bg-amber-50 border border-amber-200 p-2 text-xs text-amber-900">{error}</p>}
  </section>;
}
