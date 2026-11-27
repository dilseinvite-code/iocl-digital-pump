import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../services/api';
import { PERMISSIONS, PermissionCode } from '../../shared/constants';
import { useActiveOutlet } from '../context/ActiveOutletContext';
import type { DailyFuelSummary, OperationalShiftTankSnapshot, TankStockReading } from '../../shared/types';
import { getLocalDateInputValue } from '../../shared/utils/dateUtils';
import { getWorkDeskIndicators } from '../utils/workDesk';
import { StatusPill } from '../components/common/OperationsUi';
import { commandWorkflow, commandAttention, latestDashboardShift, dashboardTanks, outletHierarchy, scopeLabel, type DashboardTank } from '../utils/commandCentre';
import './commandCentre.css';
import { WorkspaceTaskFinder } from '../components/layout/WorkspaceTaskFinder';
import { dsrStatusLabel, getDsrWorkflowStatus } from '../../shared/dsrWorkflowStatus';
import { operationalShiftClosure } from '../utils/dsrReportLayout';
import {
  Building2,
  Users,
  ShieldCheck,
  Layers,
  FileText,
  Activity,
  CheckCircle2,
  Fuel,
  ClipboardList,
  Wallet,
  Wrench,
  ChevronRight, ArrowUpRight, ArrowRight, AlertTriangle, CalendarDays, CircleDot, Droplets, Gauge, GitBranch, MapPin, RefreshCw, LockKeyhole, Clock3, ChevronDown
} from 'lucide-react';

interface DashboardPageProps {
  onNavigate?: (tab: string) => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({ onNavigate }) => {
  const { userCtx, hasPermission } = useAuth();
  const { activeOutlet, activeOutletId, accessibleOutlets, loading: outletLoading, outletLoadError } = useActiveOutlet();
  const outletReady = !outletLoading && !outletLoadError && !!activeOutlet && activeOutlet.id === activeOutletId;
  const businessDate = getLocalDateInputValue();
  const canViewDaily = hasPermission(PERMISSIONS.SHIFTS_READ);
  const [dailyStatus, setDailyStatus] = useState<{ outletId: string; date: string; summary: DailyFuelSummary | null; error: string } | null>(null);
  const [revision, setRevision] = useState(0);
  const [governanceOpen, setGovernanceOpen] = useState(false);
  useEffect(() => {
    if (!outletReady || !activeOutletId || !canViewDaily || !userCtx) return;
    let cancelled = false;
    setDailyStatus(null);
    apiFetch<DailyFuelSummary>('/api/v1/outlets/' + encodeURIComponent(activeOutletId) + '/fuel/daily-summary?businessDate=' + encodeURIComponent(businessDate), { cache: 'no-store' })
      .then(res => { if (!cancelled) setDailyStatus({outletId: activeOutletId, date: businessDate, summary: res.success && res.data?.outletId === activeOutletId && res.data?.businessDate === businessDate ? res.data : null, error: res.success && res.data?.outletId === activeOutletId && res.data?.businessDate === businessDate ? '' : res.error?.message || 'Could not load today’s operational status.'}); })
      .catch(() => { if (!cancelled) setDailyStatus({outletId: activeOutletId, date: businessDate, summary: null, error: 'Could not load today’s operational status.'}); });
    return () => { cancelled = true; };
  }, [activeOutletId, outletReady, businessDate, canViewDaily, userCtx, revision]);
  const currentStatus = outletReady && canViewDaily && dailyStatus?.outletId === activeOutletId && dailyStatus?.date === businessDate ? dailyStatus : null;
  const summary = currentStatus?.summary;
  const indicators = summary ? getWorkDeskIndicators(summary) : [];
  const canMonitorTanks = canViewDaily && hasPermission(PERMISSIONS.TANK_STOCK_READ);
  const latestShift = latestDashboardShift(summary);
  const tankShiftId = latestShift?.id;
  const tankKey = canMonitorTanks && outletReady && tankShiftId ? JSON.stringify([activeOutletId,businessDate,tankShiftId,revision]) : null;
  const [tankMonitor, setTankMonitor] = useState<{key:string; tanks:DashboardTank[]; error:string}|null>(null);
  useEffect(()=>{
    if (!tankKey || !tankShiftId || !activeOutletId) return;
    let cancelled=false;
    setTankMonitor(null);
    const prefix='/api/v1/shifts/'+encodeURIComponent(tankShiftId);
    Promise.all([
      apiFetch<OperationalShiftTankSnapshot[]>(prefix+'/tank-snapshots',{cache:'no-store'}),
      apiFetch<TankStockReading[]>(prefix+'/tank-readings',{cache:'no-store'}),
    ]).then(([snapshots,readings])=>{
      if(cancelled)return;
      if(!snapshots.success || !readings.success || !Array.isArray(snapshots.data) || !Array.isArray(readings.data))throw new Error('Saved tank readings unavailable.');
      setTankMonitor({key:tankKey,tanks:dashboardTanks(snapshots.data,readings.data,activeOutletId,tankShiftId),error:''});
    }).catch(()=>{if(!cancelled)setTankMonitor({key:tankKey,tanks:[],error:'Could not load saved tank readings.'});});
    return()=>{cancelled=true;};
  },[tankKey,tankShiftId,activeOutletId]);
  const savedTanks = tankMonitor?.key===tankKey ? tankMonitor : null;
  const [stats, setStats] = useState({
    outletsCount: null as number | null,
    usersCount: null as number | null,
    scopesCount: null as number | null,
    statesCount: null as number | null,
    auditLogsCount: null as number | null,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!governanceOpen || !userCtx) return;
    let cancelled = false;
    const loadStats = async () => {
      setLoading(true);

      const [outletsRes, usersRes, scopesRes, statesRes, auditRes] = await Promise.all([
        hasPermission(PERMISSIONS.OUTLETS_READ) ? apiFetch<any[]>('/api/v1/outlets') : Promise.resolve({data: null}),
        hasPermission(PERMISSIONS.USERS_READ) ? apiFetch<any[]>('/api/v1/users') : Promise.resolve({data: null}),
        hasPermission(PERMISSIONS.SCOPES_READ) ? apiFetch<any[]>('/api/v1/scopes') : Promise.resolve({data: null}),
        hasPermission(PERMISSIONS.HIERARCHY_READ) ? apiFetch<any[]>('/api/v1/hierarchy/states') : Promise.resolve({data: null}),
        hasPermission(PERMISSIONS.AUDIT_READ) ? apiFetch<any[]>('/api/v1/audit-logs') : Promise.resolve({data: null}),
      ]);

      if (cancelled) return;
      setStats({
        outletsCount: outletsRes.data?.length ?? null,
        usersCount: usersRes.data?.length ?? null,
        scopesCount: scopesRes.data?.length ?? null,
        statesCount: statesRes.data?.length ?? null,
        auditLogsCount: auditRes.data?.length ?? null,
      });

      setLoading(false);
    };

    loadStats();
    return () => { cancelled = true; };
  }, [userCtx, governanceOpen]);

  if (!userCtx) return null;

  // Permission-aware shortcuts use the same tab IDs and authorization gates as the sidebar.
  const tasks = [
    { id: 'daily-ops', label: 'Shift & Readings', description: 'Open shifts, enter tank dips and nozzle meters, review stock and close shifts.', icon: ClipboardList, permission: PERMISSIONS.SHIFTS_READ, group: 'daily' },
    { id: 'stock-ops', label: 'Fuel Receipts', description: 'Receive tankers, record decantation and verify stock.', icon: Fuel, permission: PERMISSIONS.TANK_STOCK_READ, group: 'daily' },
    { id: 'financials', label: 'Collections & Finance', description: 'Record collections, handovers, deposits and reconciliation.', icon: Wallet, permission: PERMISSIONS.FINANCIAL_RECONCILIATION_READ, group: 'daily' },
    { id: 'cng-ops', label: 'CNG Operations', description: 'Manage CNG logs and readings.', icon: Fuel, permission: PERMISSIONS.CNG_OPERATIONS_READ, group: 'daily' },
    { id: 'lube-ops', label: 'Lube Operations', description: 'Manage lubricant inventory and sales.', icon: Layers, permission: PERMISSIONS.LUBE_OPERATIONS_READ, group: 'daily' },
    { id: 'dsr-reports', label: 'DSR Reports', description: 'Retrieve daily, weekly, monthly or custom PDF reports.', icon: FileText, permission: PERMISSIONS.REPORTS_READ, group: 'reports' },
    { id: 'reports', label: 'Monthly Reports', description: 'Review integrated monthly performance and PDF reports.', icon: FileText, permission: PERMISSIONS.REPORTS_READ, group: 'reports' },
    { id: 'documents', label: 'Documentation & Compliance', description: 'Licences, agreements, claims, evidence and compliance PDFs.', icon: ShieldCheck, permission: PERMISSIONS.DOCUMENTS_READ, group: 'reports' },
    { id: 'equipment-ops', label: 'Equipment & Maintenance', description: 'Equipment condition, breakdowns and maintenance.', icon: Wrench, permission: PERMISSIONS.EQUIPMENT_READ, group: 'support' },
    { id: 'utilities-ops', label: 'Utilities & Bills', description: 'Utility records and sub-meter readings.', icon: Activity, permission: PERMISSIONS.UTILITIES_READ, group: 'support' },
    { id: 'hr-workforce', label: 'Workforce & Roster', description: 'Staff, attendance and rosters.', icon: Users, permission: PERMISSIONS.HR_READ, group: 'support' },
    { id: 'municipal-taxes', label: 'Municipal Taxes', description: 'Manage tax records.', icon: FileText, permission: PERMISSIONS.MUNICIPAL_TAXES_READ, group: 'support' },
    { id: 'nfr-ops', label: 'NFR & Lease Management', description: 'Manage non-fuel leases.', icon: Building2, permission: PERMISSIONS.NFR_READ, group: 'support' },
    { id: 'outlets', label: 'Retail Outlets', description: 'Find outlets and manage assignments.', icon: Building2, permission: PERMISSIONS.OUTLETS_READ, group: 'setup' },
    { id: 'pump-infra', label: 'Pump Infrastructure', description: 'Tanks, nozzles, dispensers and calibration.', icon: Wrench, permission: PERMISSIONS.TANKS_READ, group: 'setup' },
    { id: 'products', label: 'Product Catalog', description: 'Maintain product masters.', icon: Layers, permission: PERMISSIONS.PRODUCTS_READ, group: 'setup' },
  ].filter(task => hasPermission(task.permission as PermissionCode) && (task.id !== 'dsr-reports' || canViewDaily));
  const tones: Record<string,string> = {'daily-ops':'blue','stock-ops':'blue','financials':'green','cng-ops':'cyan','lube-ops':'indigo','dsr-reports':'orange','reports':'orange','documents':'purple','equipment-ops':'slate','utilities-ops':'amber','hr-workforce':'indigo','municipal-taxes':'amber','nfr-ops':'purple','outlets':'blue','pump-infra':'cyan','products':'indigo'};
  const taskCard = (task: typeof tasks[number]) => {
    const Icon = task.icon;
    return <button key={task.id} type="button" disabled={!onNavigate}
      onClick={() => onNavigate?.(task.id)}
      data-module={task.id} data-color={tones[task.id]} className="cc-tile">
      <span className="cc-tile-icon"><Icon size={23} aria-hidden="true"/></span>
      <span className="cc-tile-copy"><strong>{task.label}</strong><span>{task.description}</span></span>
      <ArrowUpRight className="cc-tile-arrow" size={18} aria-hidden="true"/>
    </button>;
  };
  const featuredIds=['stock-ops','financials','dsr-reports','documents','pump-infra','equipment-ops'];
  const featured=featuredIds.flatMap(id=>tasks.filter(task=>task.id===id));
  const attention=summary ? commandAttention(summary) : null;
  const attentionTask=attention ? tasks.find(task=>task.id===attention.action) : undefined;
  const workflow = summary ? commandWorkflow(summary) : [];
  const canOpenShift = hasPermission(PERMISSIONS.SHIFTS_OPEN);
  const dailyCta=summary?.shiftsCount===0 && canOpenShift?'Start daily operations':'Open shift workspace';
  const localDate=new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'long',year:'numeric',timeZone:'Asia/Kolkata'}).format(new Date(businessDate+'T00:00:00+05:30'));
  const accessText=outletLoading?'Loading outlets…':outletLoadError?'Outlet list unavailable':accessibleOutlets.length+' accessible active '+(accessibleOutlets.length===1?'outlet':'outlets');
  const statusCards=summary?[
    {label:'Operational DSR',status:dsrStatusLabel(getDsrWorkflowStatus(summary).operational),description:'Fuel reading and stock report',icon:FileText,color:'blue'},
    {label:'Shift closure',status:operationalShiftClosure(summary),description:summary.shiftsCount+' recorded · '+summary.shifts.filter(x=>x.status==='OPEN').length+' open',icon:LockKeyhole,color:'slate'},
    {label:'Financial reconciliation',status:dsrStatusLabel(getDsrWorkflowStatus(summary).financial),description:'Payment collections and finance status',icon:Wallet,color:'green'},
  ]:[];
  const groupList=[
    {id:'daily',title:'Daily work',description:'Shift operations, fuel receipts, CNG, lubricants and collections.',icon:Fuel},
    {id:'reports',title:'Reports & compliance',description:'Daily and monthly reports, documentation and due dates.',icon:FileText},
    {id:'support',title:'Outlet support & maintenance',description:'Staff, equipment, bills, taxes and leases.',icon:Wrench},
    {id:'setup',title:'Outlet setup & masters',description:'Retail outlets, products, tanks and calibration.',icon:Layers},
  ] as const;

  return (
    <div className="command-dashboard option4-dashboard mx-auto max-w-[1500px] pb-10">
      <header className="cc-heading">
        <div><span className="cc-kicker"><span/> INDIANOIL WORKSPACE</span><h1>Outlet command centre</h1><p>Daily operations, reporting and financial tasks in one place.</p></div>
        <div className="cc-toolbar"><div className="cc-date"><CalendarDays size={20} aria-hidden="true"/><span><small>Business date</small><strong>{localDate}</strong></span></div>{onNavigate&&<WorkspaceTaskFinder activeTab="dashboard" onNavigate={onNavigate} compact/>}</div>
      </header>
      <section aria-label="Organization hierarchy" className="cc-hierarchy">
        <div className="cc-hierarchy-heading"><span className="cc-hierarchy-icon"><GitBranch size={19}/></span><div><h2>Organization hierarchy</h2><p>Primary access: <strong>{scopeLabel(userCtx.primaryScope)}</strong> · {accessText}</p></div>
          {hasPermission(PERMISSIONS.OUTLETS_READ)&&<button type="button" className="cc-subtle-button" disabled={!onNavigate} onClick={()=>onNavigate?.('outlets')}>Browse outlets <ArrowRight size={15}/></button>}
        </div>
        {outletReady && activeOutlet ? <ol aria-label="Selected outlet hierarchy" className="cc-breadcrumb">
          {outletHierarchy(activeOutlet).map((part,i)=><li key={part.label}>
            {i>0&&<ChevronRight className="cc-path-chevron" size={14} aria-hidden="true"/>}
            <span data-selected={i===4}><small>{part.label}</small><strong>{part.name}{part.code?' · '+part.code:''}</strong></span>
          </li>)}
        </ol>:<p className="cc-hierarchy-empty" role="status">{outletLoading?'Loading your accessible outlet…':outletLoadError?'Outlet selection unavailable.':'Select an accessible retail outlet in the top bar.'}</p>}
        <p className="cc-scope-note"><MapPin size={13} aria-hidden="true"/> All daily figures below refer only to the selected retail outlet, not the parent scope.</p>
      </section>
      <div className="cc-hero-grid">
        <section className="cc-hero">
          <div className="cc-hero-content">
            <span className="cc-hero-tag"><CircleDot size={13} aria-hidden="true"/> {canViewDaily?'Daily operations':'Assigned workspaces'}</span>
            <h2>{canViewDaily && outletReady ? summary?.shiftsCount===0 && canOpenShift?'Ready for your next shift?':'Your daily fuel workspace':'Your outlet workspace'}</h2>
            <p>{canViewDaily && outletReady?'Review readings, stock reconciliation and the daily sales report.':'Browse the modules available to your assigned role and scope.'}</p>
            {canViewDaily&&outletReady&&<button type="button" className="cc-primary-button" onClick={()=>onNavigate?.('daily-ops')} disabled={!onNavigate}>{dailyCta}<ArrowRight size={17}/></button>}
          </div>
          <div className="cc-hero-art" aria-hidden="true"><Fuel size={114} strokeWidth={1.35}/></div>
        </section>
        <section aria-label="Attention centre" className="cc-attention" data-tone={attention?.tone||'info'}>
          <div className="cc-attention-heading"><span className="cc-attention-icon">{attention?.tone==='clear'?<CheckCircle2 size={22}/>:attention?.tone==='attention'?<AlertTriangle size={22}/>:<CircleDot size={22}/>}</span><div><span>ATTENTION CENTRE</span><h3>Today's saved status</h3></div></div>
          {canViewDaily&&outletReady ? !currentStatus ? <p role="status">Loading saved status…</p> : currentStatus.error ? <><h3>Status unavailable</h3><p role="alert">{currentStatus.error}</p></> : attention && <><h3>{attention.title}</h3><p>{attention.detail}</p></> : <><h3>{outletReady?'Your assigned scope':'No outlet selected'}</h3><p>{outletReady?'Daily operational status is not available to your role.':'Select an accessible outlet to view its operations.'}</p></>}
          {attentionTask&&<button type="button" className="cc-attention-link" disabled={!onNavigate} onClick={()=>onNavigate?.(attentionTask.id)}>{attentionTask.label}<ArrowRight size={15}/></button>}
          {canViewDaily&&outletReady&&<button type="button" className="cc-refresh" onClick={()=>{setDailyStatus(null);setRevision(v=>v+1);}}><RefreshCw size={14} aria-hidden="true"/> Refresh status</button>}
        </section>
      </div>
      {canViewDaily && outletReady && <section aria-label="Today's operational status" className="cc-status-section">
        {summary && <><div className="cc-status-grid">
          {statusCards.map(card=><div key={card.label} className="cc-status-card" data-color={card.color}>
            <span className="cc-status-icon"><card.icon size={24} aria-hidden="true"/></span>
            <div><h3>{card.label}</h3><StatusPill status={card.status}/></div>
            <p>{card.description}</p>
          </div>)}
        </div>
        <section aria-label="Daily workflow" className="cc-panel cc-workflow">
          <div className="cc-section-heading"><div><h2>Daily workflow</h2><p>Saved indicators across all recorded shifts · not a mandatory sequence or a readiness-to-close decision.</p></div><span className="cc-workflow-count">{workflow.filter(s=>s.state==='complete').length} / {workflow.length} recorded indicators complete</span></div>
          <ol className="cc-workflow-grid">{workflow.map((item,i)=><li key={item.label} className="cc-step" data-state={item.state}>
            <span className="cc-step-dot">{item.state==='complete'?<CheckCircle2 size={20}/>:item.state==='pending'?<Clock3 size={19}/>:<span>{String(i+1).padStart(2,'0')}</span>}</span><strong>{item.label}</strong><span className="cc-step-detail">{item.detail}</span><span className="cc-step-state">{item.state==='complete'?'Complete':item.state==='pending'?'Pending':'Not recorded'}</span>
          </li>)}</ol>
          {indicators[2]&&<div className="cc-receipt-line"><Droplets size={15} aria-hidden="true"/><strong>Fuel receipts</strong><span>{indicators[2].detail}</span><span className="cc-receipt-state" data-state={indicators[2].state}>{indicators[2].state==='complete'?'Complete':indicators[2].state==='pending'?'Pending':'None recorded / not expected'}</span></div>}
          {summary.missingFields.length>0&&<details className="cc-warnings"><summary>Review completion warnings ({summary.missingFields.length}) <ChevronDown size={15}/></summary><ul>{summary.missingFields.map((m,i)=><li key={i}>{m}</li>)}</ul></details>}
        </section></>}
      </section>}
      <section aria-label="Quick actions" className="cc-quick">
        <div className="cc-section-heading"><div><span className="cc-kicker"><span/> YOUR WORKSPACE</span><h2>Quick access</h2><p>Go straight to the most-used modules available to your role.</p></div></div>
        <div className="cc-tiles">{featured.map(taskCard)}</div>
        {!featured.length&&<p className="cc-muted">Explore your assigned modules in the work areas below.</p>}
      </section>
      {canMonitorTanks&&outletReady&&<section aria-label="Saved tank stock overview" className="cc-panel cc-stock">
        <div className="cc-section-heading"><div><h2><Gauge size={21} aria-hidden="true"/> Saved tank stock</h2><p>{latestShift?'Shift #'+latestShift.shiftNumber+' · newest saved reading per tank in that shift':"Today's business date · selected outlet only"}. Not live stock.</p></div>{tasks.some(t=>t.id==='stock-ops')&&<button type="button" className="cc-subtle-button" onClick={()=>onNavigate?.('stock-ops')} disabled={!onNavigate}>Fuel & stock <ArrowRight size={15}/></button>}</div>
        {!currentStatus?<p className="cc-muted" role="status">Loading saved stock status…</p>:currentStatus.error?<p className="cc-muted">Saved stock unavailable while operational status is unavailable.</p>:!latestShift?<div className="cc-empty-stock"><Gauge size={32}/><span><strong>{summary?.shiftsCount?'Shift details unavailable':'No shift recorded today'}</strong><span>Tank indicators appear when the current shift has saved readings. No readings are assumed to be zero.</span></span></div>:!savedTanks?<p role="status" className="cc-muted">Loading shift tank snapshots…</p>:savedTanks.error?<p role="alert" className="cc-muted">{savedTanks.error}</p>:!savedTanks.tanks.length?<p className="cc-muted">No tank snapshots recorded for this shift.</p>:<div className="cc-tanks">
          {savedTanks.tanks.map(({snapshot,reading,percentage})=><div key={snapshot.tankId} className="cc-tank" data-color={snapshot.productCode==='HSD'?'green':snapshot.productCode==='XP95'?'orange':'blue'}>
            <div className="cc-tank-top"><span className="cc-tank-product">{snapshot.productCode}</span><span>Tank #{snapshot.tankNumber}</span></div>
            <div className="cc-tank-body">
              <div className="cc-tank-gauge" aria-hidden="true" data-known={percentage!==null}><div className="cc-tank-fill" style={{height:percentage===null?'0%':Math.min(100,Math.max(0,percentage))+'%'}}/><div className="cc-tank-lines"/>{percentage===null&&<span>—</span>}</div>
              <div className="cc-tank-copy"><strong>{reading ? (reading.netProductVolumeMilliunits/1000).toLocaleString('en-IN',{maximumFractionDigits:3})+' '+(snapshot.productUnit==='LITRE'?'L':snapshot.productUnit) : 'Not recorded'}</strong><small>{snapshot.tankName}</small><span>{Number.isSafeInteger(snapshot.capacityMilliunits)&&snapshot.capacityMilliunits>0?'Capacity '+(snapshot.capacityMilliunits/1000).toLocaleString('en-IN',{maximumFractionDigits:3})+' '+(snapshot.productUnit==='LITRE'?'L':snapshot.productUnit):'Capacity unavailable'}</span>{percentage!==null&&<span className={percentage>100?'cc-flag':''}>{percentage.toFixed(1)}% of nominal capacity{percentage>100?' · Above capacity':''}</span>}</div>
            </div>
            {reading&&<p className="cc-tank-time">{reading.readingType.replaceAll('_',' ')} · {new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit',timeZone:'Asia/Kolkata'}).format(new Date(reading.recordedAt))} IST</p>}
          </div>)}
        </div>}
        <p className="cc-muted">Read-only saved net volume / shift snapshot capacity. Missing or ambiguous readings remain unavailable.</p>
      </section>}
      <section aria-label="Work areas" className="cc-work-areas">
        <div className="cc-section-heading"><div><h2>All work areas</h2><p>Modules remain grouped by their operational responsibility and your permissions.</p></div></div>
        {groupList.map(group=>{const groupTasks=tasks.filter(task=>task.group===group.id);if(!groupTasks.length)return null;return <details key={group.id} className="cc-panel cc-module-group">
          <summary><span className="cc-group-icon"><group.icon size={20}/></span><span><strong>{group.title}</strong><small>{group.description}</small></span><span className="cc-group-count">{groupTasks.length} modules</span><ChevronDown size={18} className="cc-group-chevron"/></summary>
          <div className="cc-tiles">{groupTasks.map(taskCard)}</div>
        </details>;})}
      </section>

      <details className="option4-panel group" onToggle={e=>setGovernanceOpen(e.currentTarget.open)}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl p-5 focus-visible:outline-2 focus-visible:outline-[#17365D]">
          <span className="flex items-center gap-3">
            <span className="rounded-xl bg-[#F1F5F9] p-2.5 text-[#17365D]"><ShieldCheck className="h-5 w-5" /></span>
            <span>
              <span className="block text-sm font-bold text-[#17365D]">Access & governance</span>
              <span className="mt-0.5 block text-xs text-[#64748B]">Access & security information: role, assigned scopes and system controls</span>
            </span>
          </span>
          <ChevronRight className="h-5 w-5 text-[#64748B] transition-transform group-open:rotate-90" />
        </summary>
        <div aria-label="At a glance" className="grid grid-cols-2 gap-3 border-t border-[#E2E8F0] p-5 xl:grid-cols-4">
          {[
            {label:'Accessible outlets',value:loading?'…':stats.outletsCount,icon:Building2,tone:'orange',visible:hasPermission(PERMISSIONS.OUTLETS_READ)},
            {label:'Scoped users',value:loading?'…':stats.usersCount,icon:Users,tone:'blue',visible:hasPermission(PERMISSIONS.USERS_READ)},
            {label:'Permissions',value:userCtx.isGlobalAdmin?'ALL':userCtx.permissions.length,icon:ShieldCheck,tone:'purple',visible:true},
            {label:'Audit records',value:loading?'…':stats.auditLogsCount,icon:Activity,tone:'green',visible:hasPermission(PERMISSIONS.AUDIT_READ)}
          ].filter(metric=>metric.visible).map(metric=><div key={metric.label} data-tone={metric.tone} className="option4-stat p-4"><p className="text-xs text-[#64748B]">{metric.label}</p><p className="mt-2 text-xl font-bold text-[#17365D]">{metric.value ?? 'Unavailable'}</p></div>)}
        </div>
        <div className="grid gap-5 items-start border-t border-[#E2E8F0] p-5 lg:grid-cols-2">
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-[#17365D]">Your scope assignments</h3>
            <p className="text-xs text-[#64748B]">Role: {userCtx.roles.join(', ')} · Employee code: {userCtx.user.empCode}</p>
            {userCtx.scopes.map((scope, i) => (
              <div key={scope.id || i} className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-[#17365D]">{scope.scopeLevel}</span>
                  <span className="text-[#64748B]">Assigned by {scope.createdBy}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[#526477]">
                  {scope.stateName && <span>State: {scope.stateName}</span>}
                  {scope.divisionName && <span>Division: {scope.divisionName}</span>}
                  {scope.salesAreaName && <span>Sales area: {scope.salesAreaName}</span>}
                  {scope.outletName && <span>Outlet: {scope.outletName}</span>}
                  {scope.scopeLevel === 'GLOBAL' && <span>All-India IOCL facilities</span>}
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-[#17365D]">System controls</h3>
            {[
              ['Secure authentication', 'Session credentials are handled through server-side security controls.'],
              ['Scope enforcement', 'Backend permissions and scope restrictions remain active.'],
              ['Audit trail', 'System mutations are recorded for review.'],
            ].map(([label, description]) => (
              <div key={label} className="flex items-start gap-3 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                <div><p className="text-xs font-bold text-[#17365D]">{label}</p><p className="mt-1 text-xs text-[#64748B]">{description}</p></div>
              </div>
            ))}
          </div>
        </div>
      </details>
    </div>
  );
};
