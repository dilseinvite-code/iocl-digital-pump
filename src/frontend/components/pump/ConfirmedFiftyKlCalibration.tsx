import React,{useEffect,useState} from 'react';
import type {Tank, TankCalibrationChart, GlobalTankCalibrationTemplate} from '../../../shared/types';
import {apiFetch,clearApiCache} from '../../services/api';
import {CONFIRMED_50KL_SOURCE_ID,validConfirmedFiftyKlSource,validConfirmedFiftyKlLimits} from '../../../shared/confirmedFiftyKlReference';

export function ConfirmedFiftyKlCalibration({tank,canAssign,onChanged}:{tank:Tank;canAssign:boolean;onChanged:(id:string)=>Promise<void>}) {
  const [source,setSource]=useState<GlobalTankCalibrationTemplate|null>(null);
  const [loading,setLoading]=useState(true);
  const [confirmed,setConfirmed]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  useEffect(()=>{
    let cancelled=false;
    apiFetch<GlobalTankCalibrationTemplate>('/api/v1/calibration-templates/'+CONFIRMED_50KL_SOURCE_ID,{cache:'no-store'})
      .then(res=>{if(cancelled)return;if(!res.success||!res.data)throw new Error(res.error?.message||'Could not load global chart.');setSource(res.data);})
      .catch(e=>{if(!cancelled)setError(e.message);}).finally(()=>{if(!cancelled)setLoading(false);});
    return ()=>{cancelled=true;};
  },[tank.id]);
  const ready=!!source&&validConfirmedFiftyKlSource(source,source.points||[])&&validConfirmedFiftyKlLimits(tank);
  const activate=async()=>{
    if(!canAssign||!confirmed||!source||!ready||busy)return;
    setBusy(true);setError('');
    try{
      const res=await apiFetch<{chart:TankCalibrationChart;alreadyApplied:boolean}>('/api/v1/tanks/'+encodeURIComponent(tank.id)+'/calibration/confirmed-50kl-reference',{
        method:'POST',body:JSON.stringify({sourceRevision:source.revisionNumber,diameterMm:3000,lengthMm:7500,maxDipMm:3000,
          safeFillLitres:tank.safeFillCapacityLitres,minimumOperatingLitres:tank.minimumOperatingLevelLitres,confirmCompatibility:true})
      });
      if(!res.success||!res.data)throw new Error(res.error?.message||'Could not activate the reference.');
      clearApiCache();await onChanged(res.data.chart.id);
    }catch(e:any){setError(e.message||'Could not activate chart.');}finally{setBusy(false);}
  };
  return <section data-testid="confirmed-50kl-reference" className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 space-y-3">
    <h3 className="font-bold text-[#17365D]">Use Global 50 KL Calibration</h3>
    {loading&&<p className="text-xs" role="status">Checking saved chart…</p>}
    {source&&<p className="text-xs text-slate-700">{source.status} · {source.pointsCount} saved readings · Max dip {source.maxDipMm} mm · {source.maxVolumeLitres?.toLocaleString('en-IN')} L chart maximum</p>}
    {!loading&&!ready&&<p role="alert" className="text-xs text-amber-800">Saved source or tank operating limits need review.</p>}
    {ready&&canAssign&&<>
      <label className="flex gap-2 text-xs text-slate-700"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>I confirm this tank matches 3,000 mm diameter × 7,500 mm length, 3,000 mm maximum dip, and the saved approved safe-fill ({tank.safeFillCapacityLitres.toLocaleString('en-IN')} L) and minimum operating ({tank.minimumOperatingLevelLitres.toLocaleString('en-IN')} L) limits.</label>
      <button type="button" disabled={busy||!confirmed} onClick={()=>void activate()} className="rounded-lg bg-[#17365D] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy?'Applying chart…':'Use 50 KL chart for Tank #'+tank.tankNumber}</button>
      <p className="text-xs text-slate-600">Administrator-confirmed operational reference; no tank-specific certificate is recorded. Historical readings are unchanged.</p>
    </>}
    {error&&<p role="alert" className="text-xs text-amber-900">{error}</p>}
  </section>;
}
