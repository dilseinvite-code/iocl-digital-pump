import './operationsModern.css';
import './dailyOperationsModern.css';
import './lubeCommandCentre.css';
import React, { useState, useEffect } from 'react';
import { apiFetch } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { PERMISSIONS } from '../../shared/constants';
import {
  RetailOutlet,
  OperationalShift,
  LubeSku,
  LubeSkuPrice,
  LubeStockTransaction,
  LubeShiftSale,
  LubeStockSummaryItem,
  LubeShiftSummary,
} from '../../shared/types';
import {
  Package,
  GitBranch,
  ChevronRight,
  ArrowLeft,
  ClipboardList,
  ShoppingBag,
  BarChart3,
  Calendar,
  Boxes,
  ListChecks,
  Tag,
  AlertTriangle,
  Clock,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Lock,
  ShieldAlert,
} from 'lucide-react';
import { LubeSkuPanel } from '../components/lube/LubeSkuPanel';
import { LubePricePanel } from '../components/lube/LubePricePanel';
import { LubeInventoryPanel } from '../components/lube/LubeInventoryPanel';
import { LubeTransactionsPanel } from '../components/lube/LubeTransactionsPanel';
import { LubeSalesPanel } from '../components/lube/LubeSalesPanel';
import { LubeDailySummaryPanel } from '../components/lube/LubeDailySummaryPanel';
import { LubeSummaryPanel } from '../components/lube/LubeSummaryPanel';

import { useActiveOutlet } from '../context/ActiveOutletContext';
import { GroupedWorkspaceNav } from '../components/common/GroupedWorkspaceNav';
import { useShiftWorkbench } from '../context/ShiftWorkbenchContext';
import { resolveWorkbenchShift, toWorkbenchSelection } from '../utils/shiftWorkbench';
import { getLocalDateInputValue } from '../../shared/utils/dateUtils';
import { outletHierarchy, scopeLabel } from '../utils/commandCentre';

export const LubeOperationsPage: React.FC = () => {
  const { hasPermission, userCtx } = useAuth();
  const canRead = hasPermission(PERMISSIONS.LUBE_OPERATIONS_READ);
  const hasShiftsRead = hasPermission(PERMISSIONS.SHIFTS_READ);
  const hasOutletsRead = hasPermission(PERMISSIONS.OUTLETS_READ);

  const { activeOutletId, accessibleOutlets: outlets, loading: loadingOutlets, setActiveOutletId } = useActiveOutlet();
  const selectedOutletId = activeOutletId || '';
  const setSelectedOutletId = setActiveOutletId;
  const {selection,remember,navigate} = useShiftWorkbench();
  const initialSelection = React.useRef(selection);
  const shiftChoice = React.useRef('');

  const [shiftsList, setShiftsList] = useState<OperationalShift[]>([]);
  const [selectedShiftId, setSelectedShiftId] = useState<string>('');
  const [selectedShift, setSelectedShift] = useState<OperationalShift | null>(null);
  const [loadingShifts, setLoadingShifts] = useState(false);
  const [shiftListError,setShiftListError]=useState<string|null>(null);
  const [shiftListRevision,setShiftListRevision]=useState(0);
  const [shiftRecordsReady,setShiftRecordsReady]=useState(false);

  // Lube state
  const [skus, setSkus] = useState<LubeSku[]>([]);
  const [prices, setPrices] = useState<LubeSkuPrice[]>([]);
  const [stockSummary, setStockSummary] = useState<LubeStockSummaryItem[]>([]);
  const [lowStockItems, setLowStockItems] = useState<LubeStockSummaryItem[]>([]);
  const [transactions, setTransactions] = useState<LubeStockTransaction[]>([]);
  const [sales, setSales] = useState<LubeShiftSale[]>([]);
  const [shiftSummary, setShiftSummary] = useState<LubeShiftSummary | null>(null);

  const [loadingData, setLoadingData] = useState(false);
  const [activeTab, setActiveTab] = useState<'sales' | 'summary' | 'inventory' | 'skus' | 'prices' | 'transactions' | 'daily'>(hasShiftsRead?'sales':'inventory');

  // Action feedback
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Stale request guards
  const currentCtxRef = React.useRef({ outletId: '', shiftId: '' });
  const shiftsRequestRef = React.useRef<string>(''); // outletId for shifts request tracking

  // Auto clear success message after 5 seconds
  useEffect(() => {
    if (actionSuccess) {
      const timer = setTimeout(() => setActionSuccess(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [actionSuccess]);

  // Point 4: Synchronous State Reset on Outlet Switch
  useEffect(() => {
    setShiftsList([]);
    setSelectedShiftId('');
    setSelectedShift(null);
    setSkus([]);
    setPrices([]);
    setStockSummary([]);
    setLowStockItems([]);
    setTransactions([]);
    setSales([]);
    setShiftSummary(null);
  }, [selectedOutletId]);

  // Load Shifts when Outlet Changes
  useEffect(() => {
    if (!selectedOutletId) {
      return;
    }

    if (!hasShiftsRead) {
      setShiftsList([]);
      setSelectedShiftId('');
      setSelectedShift(null);
      setSales([]);
      setShiftSummary(null);
      return;
    }

    const loadShifts = async () => {
      setLoadingShifts(true);
      setShiftListError(null);
      const reqOutletId = selectedOutletId;
      shiftsRequestRef.current = reqOutletId;

      try {
        const res = await apiFetch<OperationalShift[]>(`/api/v1/outlets/${selectedOutletId}/shifts`);
        
        // Guard against stale async shifts response
        if (shiftsRequestRef.current !== reqOutletId) {
          return;
        }

        if (res.success && res.data) {
          const available=res.data.filter(s=>s.outletId===selectedOutletId);
          setShiftsList(available);
          const requested=initialSelection.current;
          const chosen=resolveWorkbenchShift(available,selectedOutletId,requested || {outletId:selectedOutletId,businessDate:getLocalDateInputValue(),shiftId:null});
          if (chosen) {
            shiftChoice.current=chosen.id;
            setSelectedShiftId(chosen.id);
            remember(toWorkbenchSelection(chosen));
          } else {
            setSelectedShiftId('');
            setSelectedShift(null);
            setSales([]);
            setShiftSummary(null);
          }
        } else {
          setShiftsList([]);
          setSelectedShiftId('');
          setSelectedShift(null);
          setSales([]);
          setShiftSummary(null);
          setShiftListError(res.error?.message || 'Failed to load operational shifts');
        }
      } catch (err: any) {
        if (shiftsRequestRef.current !== reqOutletId) {
          return;
        }
        setShiftsList([]);
        setSelectedShiftId('');
        setSelectedShift(null);
        setSales([]);
        setShiftSummary(null);
        setShiftListError(err.message || 'Failed to load operational shifts');
      } finally {
        if (shiftsRequestRef.current === reqOutletId) {
          setLoadingShifts(false);
        }
      }
    };

    loadShifts();
  }, [selectedOutletId, hasShiftsRead,shiftListRevision]);

  // Main data fetching function
  const loadOutletLubeData = async () => {
    if (!selectedOutletId) return;

    setLoadingData(true);
    setShiftRecordsReady(false);
    setActionError(null);

    const reqOutletId = selectedOutletId;
    const reqShiftId = selectedShiftId;
    currentCtxRef.current = { outletId: reqOutletId, shiftId: reqShiftId };

    try {
      const promises: Promise<any>[] = [
        apiFetch<LubeSku[]>(`/api/v1/outlets/${selectedOutletId}/lube/skus`),
        apiFetch<LubeSkuPrice[]>(`/api/v1/outlets/${selectedOutletId}/lube/prices`),
        apiFetch<LubeStockSummaryItem[]>(`/api/v1/outlets/${selectedOutletId}/lube/stock-summary`),
        apiFetch<LubeStockSummaryItem[]>(`/api/v1/outlets/${selectedOutletId}/lube/low-stock`),
        apiFetch<LubeStockTransaction[]>(`/api/v1/outlets/${selectedOutletId}/lube/stock-transactions`),
      ];

      const hasShiftContext = !!(selectedShiftId && hasShiftsRead);

      if (hasShiftContext) {
        promises.push(apiFetch<OperationalShift>(`/api/v1/shifts/${selectedShiftId}`));
        promises.push(apiFetch<LubeShiftSale[]>(`/api/v1/shifts/${selectedShiftId}/lube-sales`));
        promises.push(apiFetch<LubeShiftSummary>(`/api/v1/shifts/${selectedShiftId}/lube-summary`));
      }

      const results = await Promise.allSettled(promises);

      // Guard against stale async responses belonging to a previous outlet/shift context
      if (currentCtxRef.current.outletId !== reqOutletId || currentCtxRef.current.shiftId !== reqShiftId) {
        return;
      }

      let errorAccumulator: string[] = [];

      // 0. Lube SKUs
      const skusRes = results[0];
      if (skusRes.status === 'fulfilled' && skusRes.value.success) {
        setSkus(skusRes.value.data);
      } else {
        setSkus([]);
        const errMsg = skusRes.status === 'fulfilled' ? skusRes.value.error?.message : 'Network error';
        errorAccumulator.push(`SKU catalog failed: ${errMsg}`);
      }

      // 1. Lube Prices
      const pricesRes = results[1];
      if (pricesRes.status === 'fulfilled' && pricesRes.value.success) {
        setPrices(pricesRes.value.data);
      } else {
        setPrices([]);
        const errMsg = pricesRes.status === 'fulfilled' ? pricesRes.value.error?.message : 'Network error';
        errorAccumulator.push(`Prices failed: ${errMsg}`);
      }

      // 2. Stock Summary
      const stockRes = results[2];
      if (stockRes.status === 'fulfilled' && stockRes.value.success) {
        setStockSummary(stockRes.value.data);
      } else {
        setStockSummary([]);
        const errMsg = stockRes.status === 'fulfilled' ? stockRes.value.error?.message : 'Network error';
        errorAccumulator.push(`Stock summary failed: ${errMsg}`);
      }

      // 3. Low Stock Items
      const lowStockRes = results[3];
      if (lowStockRes.status === 'fulfilled' && lowStockRes.value.success) {
        setLowStockItems(lowStockRes.value.data);
      } else {
        setLowStockItems([]);
        const errMsg = lowStockRes.status === 'fulfilled' ? lowStockRes.value.error?.message : 'Network error';
        errorAccumulator.push(`Low stock warning check failed: ${errMsg}`);
      }

      // 4. Stock Transactions
      const txsRes = results[4];
      if (txsRes.status === 'fulfilled' && txsRes.value.success) {
        setTransactions(txsRes.value.data);
      } else {
        setTransactions([]);
        const errMsg = txsRes.status === 'fulfilled' ? txsRes.value.error?.message : 'Network error';
        errorAccumulator.push(`Transaction history failed: ${errMsg}`);
      }

      if (hasShiftContext && results[5] && results[6] && results[7]) {
        // 5. Shift Details
        const shiftRes = results[5];
        if (shiftRes.status === 'fulfilled' && shiftRes.value.success && shiftRes.value.data?.id===reqShiftId && shiftRes.value.data.outletId===reqOutletId) {
          setSelectedShift(shiftRes.value.data);
        } else {
          setSelectedShift(null);
          const errMsg = shiftRes.status === 'fulfilled' ? shiftRes.value.error?.message : 'Network error';
          errorAccumulator.push(`Shift details failed: ${errMsg}`);
        }

        // 6. Shift Sales Log
        const salesRes = results[6];
        if (salesRes.status === 'fulfilled' && salesRes.value.success) {
          setSales(salesRes.value.data);
        } else {
          setSales([]);
          const errMsg = salesRes.status === 'fulfilled' ? salesRes.value.error?.message : 'Network error';
          errorAccumulator.push(`Sales list failed: ${errMsg}`);
        }

        // 7. Lube Shift Summary
        const summaryRes = results[7];
        if (summaryRes.status === 'fulfilled' && summaryRes.value.success) {
          setShiftSummary(summaryRes.value.data);
        } else {
          setShiftSummary(null);
          const errMsg = summaryRes.status === 'fulfilled' ? summaryRes.value.error?.message : 'Network error';
          errorAccumulator.push(`Shift summary failed: ${errMsg}`);
        }
      } else {
        setSelectedShift(null);
        setSales([]);
        setShiftSummary(null);
      }

      if(hasShiftContext){
        const shiftResult=results[5], salesResult=results[6], summaryResult=results[7];
        setShiftRecordsReady(shiftResult?.status==='fulfilled'&&shiftResult.value.success&&shiftResult.value.data?.id===reqShiftId&&shiftResult.value.data.outletId===reqOutletId&&salesResult?.status==='fulfilled'&&salesResult.value.success&&Array.isArray(salesResult.value.data)&&summaryResult?.status==='fulfilled'&&summaryResult.value.success&&!!summaryResult.value.data&&skusRes.status==='fulfilled'&&skusRes.value.success&&Array.isArray(skusRes.value.data));
      }
      if (errorAccumulator.length > 0) {
        setActionError(errorAccumulator.join(' | '));
      }
    } catch (err: any) {
      if (currentCtxRef.current.outletId !== reqOutletId || currentCtxRef.current.shiftId !== reqShiftId) {
        return;
      }
      setActionError(err.message || 'Failed to load outlet lube metrics');
    } finally {
      if (currentCtxRef.current.outletId === reqOutletId && currentCtxRef.current.shiftId === reqShiftId) {
        setLoadingData(false);
      }
    }
  };

  useEffect(() => {
    loadOutletLubeData();
  }, [selectedOutletId, selectedShiftId, hasShiftsRead]);

  const handleRefresh = async () => {
    if(hasShiftsRead&&shiftListError)setShiftListRevision(v=>v+1);
    await loadOutletLubeData();
  };

  const selectedOutlet = outlets.find((o) => o.id === selectedOutletId);

  if (!canRead) {
    return (
      <div className="p-8 text-center bg-white border border-[#E2E8F0] rounded-2xl max-w-xl mx-auto my-12 space-y-3">
        <ShieldAlert className="w-12 h-12 text-rose-500 mx-auto" />
        <h2 className="text-lg font-bold text-[#17365D]">Access Restricted</h2>
        <p className="text-xs text-[#64748B]">
          You do not have permission (<code className="font-mono text-[#B8530D]">lube_operations.read</code>) to view Lube Operations.
        </p>
      </div>
    );
  }

  if (!hasOutletsRead) {
    return (
      <div className="p-8 text-center bg-white border border-[#E2E8F0] rounded-2xl max-w-xl mx-auto my-12 space-y-3">
        <ShieldAlert className="w-12 h-12 text-rose-500 mx-auto" />
        <h2 className="text-lg font-bold text-[#17365D]">Access Restricted</h2>
        <p className="text-xs text-[#64748B]">
          Outlet read permissions (<code className="font-mono text-[#B8530D]">outlets.read</code>) are required to access this workspace.
        </p>
      </div>
    );
  }

  const verifiedShift = selectedShift?.id===selectedShiftId && selectedShift.outletId===selectedOutletId && shiftRecordsReady && !loadingData && !loadingShifts ? selectedShift : null;
  const attention = loadingShifts || loadingData
    ? {tone:'info',title:'Loading lubricant records',detail:'Retrieving saved data for the selected outlet and shift.'}
    : shiftListError || actionError
    ? {tone:'attention',title:'Review operation feedback',detail:'Review the message below and refresh if any records could not be verified.'}
    : !hasShiftsRead
    ? {tone:'info',title:'Outlet inventory workspace',detail:'Inventory and product setup are available according to your permissions. Shift read access is required for shift sales.'}
    : selectedShiftId && !verifiedShift
    ? {tone:'attention',title:'Shift records not verified',detail:'Refresh and verify saved records before entering sales.'}
    : !verifiedShift
    ? {tone:'info',title:'Select a shift for sales',detail:'Choose an operational shift to view or record sales. Outlet inventory and product setup are available independently.'}
    : verifiedShift.status !== 'OPEN'
    ? {tone:'info',title:'Read-only shift',detail:'Historical or closing shift — sales records are locked/read-only.'}
    : {tone:'info',title:'Open shift selected',detail:'Review saved sales and use the existing entry controls where your permissions allow.'};

  return (
    <div className="operations-modern daily-command lube-command pb-10 max-w-[1500px] mx-auto">
      <header className="dc-heading">
        <div>
          <p className="dc-eyebrow"><span/> INDIANOIL WORKSPACE / DAILY WORK</p>
          <h1>Lube &amp; Auxiliary Inventory</h1>
          <p className="dc-muted">Shift sales, stock transactions, product setup and authoritative reconciliations.</p>
        </div>
        <button type="button" onClick={handleRefresh} aria-label="Refresh lube records"
          disabled={loadingData||loadingShifts} className="lube-refresh">
          <RefreshCw className={`w-3.5 h-3.5 ${loadingData?'animate-spin':''}`}/> Refresh
        </button>
      </header>

      <section aria-label="Selected outlet and operational shift" className="dc-panel dc-context">
        <div className="dc-hierarchy-head">
          <span className="dc-hierarchy-icon"><GitBranch size={18} aria-hidden="true"/></span>
          <div><h2>Organization hierarchy</h2><p>Primary access: <strong>{scopeLabel(userCtx?.primaryScope || 'UNKNOWN')}</strong> · Records apply to the selected retail outlet.</p></div>
        </div>
        {selectedOutlet && <ol aria-label="Selected outlet hierarchy" className="dc-hierarchy-path">
          {outletHierarchy(selectedOutlet).map((part,i)=><li key={part.label}>
            {i>0&&<ChevronRight size={14} className="dc-chevron" aria-hidden="true"/>}
            <span data-selected={i===4}><small>{part.label}</small><strong>{part.name}{part.code?' · '+part.code:''}</strong></span>
          </li>)}
        </ol>}
        <div className="lube-context-controls">
          <div>
            <label htmlFor="lube-outlet">Retail Outlet</label>
            <select
              id="lube-outlet"
              aria-label="Lube retail outlet"
              value={selectedOutletId}
              onChange={(e) => setSelectedOutletId(e.target.value)}
              disabled={loadingOutlets || loadingShifts || loadingData}
              className="lube-select"
            >
              {loadingOutlets ? (
                <option>Loading outlets...</option>
              ) : outlets.length === 0 ? (
                <option>No outlets accessible</option>
              ) : (
                outlets.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))
              )}
            </select>
          </div>

          <div>
            <label htmlFor="lube-shift">Operational Shift</label>
            <select
              id="lube-shift"
              aria-label="Lube operational shift"
              value={selectedShiftId}
              onChange={(e) => {
                const next=shiftsList.find(s=>s.id===e.target.value);
                shiftChoice.current=next?.id||'';
                setSelectedShift(null);
                setSales([]);setShiftSummary(null);currentCtxRef.current={outletId:selectedOutletId,shiftId:next?.id||''};
                setSelectedShiftId(next?.id||'');
                if(next)remember(toWorkbenchSelection(next));
              }}
              disabled={loadingOutlets || loadingShifts || loadingData || shiftsList.length === 0 || !hasShiftsRead}
              className="lube-select"
            >
              {!hasShiftsRead ? (
                <option>Shift permissions required</option>
              ) : loadingShifts ? (
                <option>Loading shifts...</option>
              ) : shiftsList.length === 0 ? (
                <option>No operational shifts</option>
              ) : (
                <><option value="">Select operational shift</option>{shiftsList.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.businessDate} · {s.shiftTemplateName || s.shiftTemplateCode || 'Shift'} ({s.status})
                  </option>
                ))}</>
              )}
            </select>
          </div>

        </div>
      </section>

      <div className="dc-hero-grid">
        <section className="dc-hero" aria-label="Current lubricant shift">
          <div className="dc-hero-content">
            <span className="dc-hero-tag"><ClipboardList size={14} aria-hidden="true"/> {verifiedShift?'SELECTED OPERATIONAL SHIFT':'LUBRICANT WORKSPACE'}</span>
            <div className="dc-hero-title">
              <div>
                <h2>{verifiedShift?(verifiedShift.shiftTemplateName || verifiedShift.shiftTemplateCode || 'Shift'):(selectedOutlet?.name || 'Select an outlet')}</h2>
                <p>{verifiedShift?verifiedShift.businessDate+' · '+(selectedOutlet?.name || 'Selected outlet'):'Outlet inventory and sales management'}</p>
              </div>
              <span className="dc-hero-art" aria-hidden="true"><Package size={58}/></span>
            </div>
            <div className="lube-hero-footer">
              <span className="lube-shift-status" data-tone={verifiedShift?.status==='OPEN'?'open':'neutral'}>{verifiedShift && verifiedShift.status!=='OPEN'?<Lock size={13}/>:<Clock size={13}/>} {verifiedShift?.status || (loadingData||loadingShifts?'LOADING':!hasShiftsRead?'OUTLET VIEW':selectedShiftId?'SHIFT NOT VERIFIED':'NO SHIFT SELECTED')}</span>
              {hasShiftsRead&&<button type="button" disabled={loadingData||loadingShifts} onClick={()=>navigate('daily-ops')} className="lube-back-link"><ArrowLeft size={14}/> Return to shift workbench</button>}
            </div>
          </div>
        </section>
        <section aria-label="Lubricant record status" className="dc-attention" data-tone={attention.tone}>
          <div className="dc-attention-top">
            <span className="dc-attention-icon">{attention.tone==='attention'?<AlertTriangle size={20}/>:verifiedShift && verifiedShift.status!=='OPEN'?<Lock size={20}/>:<ClipboardList size={20}/>}</span>
            <div><div className="dc-attention-kicker">LUBE RECORD STATUS</div><p className="dc-attention-context">Selected outlet · shift context</p></div>
          </div>
          <h3>{attention.title}</h3><p>{attention.detail}</p>
          <div className="dc-attention-footer"><ShieldAlert size={15}/><span>{verifiedShift && !actionError?`${sales.length} saved sales line${sales.length===1?'':'s'}. `:''}Sales and inventory records do not indicate financial approval.</span></div>
        </section>
      </div>

      {/* Global Toast Alerts */}
      {actionError && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/25 rounded-2xl flex items-start gap-3 text-rose-500 text-xs">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="flex-1">
            <h4 className="font-bold tracking-tight">Operation Failed</h4>
            <p className="mt-0.5">{actionError}</p>
          </div>
          <button onClick={() => setActionError(null)} className="text-rose-500/60 hover:text-rose-500 font-bold font-mono">Dismiss</button>
        </div>
      )}

      {actionSuccess && (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/25 rounded-2xl flex items-start gap-3 text-emerald-700 text-xs">
          <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="flex-1">
            <h4 className="font-bold tracking-tight">Operation Successful</h4>
            <p className="mt-0.5">{actionSuccess}</p>
          </div>
          <button onClick={() => setActionSuccess(null)} className="text-emerald-700/60 hover:text-emerald-700 font-bold font-mono">Dismiss</button>
        </div>
      )}

      {/* Segmented Workspace Tabs */}
      <section className="dc-panel lube-workspace-nav" aria-label="Lubricant work areas">
        <div className="lube-nav-heading"><div><h2>Operations workspace</h2><p>Choose a work area and task. Inventory and setup do not require a selected shift.</p></div></div>
      <GroupedWorkspaceNav<typeof activeTab> label="Lube workspace navigation" active={activeTab} onChange={setActiveTab}
        groups={[
          {id:'daily-work',label:'Daily Sales',items:[
            ...(hasShiftsRead?[{id:'sales' as const,label:'Shift Sales Log',icon:ShoppingBag},{id:'summary' as const,label:'Shift Summary',icon:BarChart3}]:[]),
            {id:'daily',label:'Daily Summary',icon:Calendar}]},
          {id:'inventory',label:'Inventory & Stock',items:[{id:'inventory',label:'Inventory Stock',icon:Boxes},{id:'transactions',label:'Transaction Ledger',icon:ListChecks}]},
          {id:'setup',label:'Product Setup',items:[{id:'skus',label:'SKU Catalog',icon:Package},{id:'prices',label:'Selling Prices',icon:Tag}]},
        ]}/>
      </section>

      {shiftListError&&<div role="alert" className="rounded-xl border border-red-200 bg-white p-4 text-sm text-red-800"><p>{shiftListError}</p><button type="button" disabled={loadingShifts} onClick={()=>setShiftListRevision(v=>v+1)} className="mt-3 rounded-lg bg-[#17365D] px-4 py-2 text-white disabled:opacity-50">Retry shift list</button></div>}
      {/* Main Tab Viewports */}
      <div className="dc-detail-panel lube-content">
        {(activeTab === 'sales' || activeTab === 'summary') && !hasShiftsRead ? (
          <div className="p-12 text-center bg-white border border-[#E2E8F0] rounded-2xl space-y-3">
            <Lock className="w-8 h-8 text-[#64748B] mx-auto" />
            <h4 className="text-sm font-semibold text-[#17365D]">Shift Permissions Required</h4>
            <p className="text-xs text-[#64748B] max-w-sm mx-auto">
              Shift operational features are not available because you do not have shift read permissions (shifts.read).
            </p>
          </div>
        ) : (activeTab==='sales'||activeTab==='summary')&&(loadingShifts||loadingData||!!shiftListError||!!selectedShiftId&&!shiftRecordsReady) ? (
          <div role="status" className="p-4 text-sm text-slate-600">{loadingShifts||loadingData?'Loading saved lubricant records…':'Shift records could not be fully verified. Refresh before recording sales.'}</div>
        ) : (
          <>
            {activeTab === 'sales' && (
              <LubeSalesPanel
                shift={selectedShift}
                skus={skus}
                sales={sales}
                loading={loadingData}
                onRefresh={handleRefresh}
                setError={setActionError}
                setSuccess={setActionSuccess}
              />
            )}
            {activeTab === 'summary' && (
              <LubeSummaryPanel
                shift={selectedShift}
                shiftSummary={shiftSummary}
                loading={loadingData}
                onRefresh={handleRefresh}
              />
            )}
          </>
        )}
        {activeTab === 'inventory' && (
          <LubeInventoryPanel
            stockSummary={stockSummary}
            lowStockItems={lowStockItems}
            loading={loadingData}
            onRefresh={handleRefresh}
          />
        )}
        {activeTab === 'skus' && (
          <LubeSkuPanel
            outletId={selectedOutletId}
            skus={skus}
            loading={loadingData}
            onRefresh={handleRefresh}
            setError={setActionError}
            setSuccess={setActionSuccess}
          />
        )}
        {activeTab === 'prices' && (
          <LubePricePanel
            outletId={selectedOutletId}
            skus={skus}
            prices={prices}
            loading={loadingData}
            onRefresh={handleRefresh}
            setError={setActionError}
            setSuccess={setActionSuccess}
          />
        )}
        {activeTab === 'transactions' && (
          <LubeTransactionsPanel
            outletId={selectedOutletId}
            skus={skus}
            transactions={transactions}
            loading={loadingData}
            onRefresh={handleRefresh}
            setError={setActionError}
            setSuccess={setActionSuccess}
          />
        )}
        {activeTab === 'daily' && (
          <LubeDailySummaryPanel
            outletId={selectedOutletId}
            defaultDate={selectedShift?.businessDate || getLocalDateInputValue()}
          />
        )}
      </div>
    </div>
  );
};
export default LubeOperationsPage;
