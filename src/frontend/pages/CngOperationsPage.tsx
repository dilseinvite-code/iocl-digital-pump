import './operationsModern.css';
import './dailyOperationsModern.css';
import './cngCommandCentre.css';
import React, { useState, useEffect } from 'react';
import { apiFetch } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { PERMISSIONS } from '../../shared/constants';
import {
  RetailOutlet,
  OperationalShift,
  CngShiftLog,
  CngPressureReading,
} from '../../shared/types';
import {
  Flame,
  Building2,
  Clock,
  GitBranch,
  ChevronRight,
  ArrowLeft,
  ClipboardList,
  AlertTriangle,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Lock,
  ShieldAlert,
} from 'lucide-react';
import { CngMfmPanel } from '../components/cng/CngMfmPanel';
import { CngPressurePanel } from '../components/cng/CngPressurePanel';
import { CngDailySummaryPanel } from '../components/cng/CngDailySummaryPanel';
import { CngPressureModal } from '../components/cng/CngPressureModal';

import { useActiveOutlet } from '../context/ActiveOutletContext';
import { useShiftWorkbench } from '../context/ShiftWorkbenchContext';
import { resolveWorkbenchShift, toWorkbenchSelection } from '../utils/shiftWorkbench';
import { getLocalDateInputValue } from '../../shared/utils/dateUtils';
import { outletHierarchy, scopeLabel } from '../utils/commandCentre';

export const CngOperationsPage: React.FC = () => {
  const { hasPermission, userCtx } = useAuth();
  const canRead = hasPermission(PERMISSIONS.CNG_OPERATIONS_READ);
  const canWrite = hasPermission(PERMISSIONS.CNG_OPERATIONS_WRITE);

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

  // CNG Shift specific data
  const [cngLog, setCngLog] = useState<CngShiftLog | null>(null);
  const [pressureReadings, setPressureReadings] = useState<CngPressureReading[]>([]);
  const [loadingShiftData, setLoadingShiftData] = useState(false);
  const [dailySummaryRefreshCounter, setDailySummaryRefreshCounter] = useState(0);

  // Pressure Modal state
  const [pressureModalOpen, setPressureModalOpen] = useState(false);
  const [editingPressureReading, setEditingPressureReading] = useState<CngPressureReading | null>(null);
  const [deletingPressureId, setDeletingPressureId] = useState<string | null>(null);

  // Global action feedback
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Auto clear success message after 5 seconds
  useEffect(() => {
    if (actionSuccess) {
      const timer = setTimeout(() => setActionSuccess(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [actionSuccess]);

  // Load Shifts when Outlet Changes
  useEffect(() => {
    if (!selectedOutletId) {
      setShiftsList([]);
      setSelectedShiftId('');
      setSelectedShift(null);
      return;
    }

    let current=true;
    const loadShifts = async () => {
      setLoadingShifts(true);
      setShiftListError(null);
      setActionError(null);
      try {
        const res = await apiFetch<OperationalShift[]>(`/api/v1/outlets/${selectedOutletId}/shifts`);
        if(!current)return;
        if (res.success && Array.isArray(res.data)) {
          const available=res.data.filter(s=>s.outletId===selectedOutletId);
          setShiftsList(available);
          const requested=initialSelection.current;
          const chosen=resolveWorkbenchShift(available,selectedOutletId,requested || {outletId:selectedOutletId,businessDate:getLocalDateInputValue(),shiftId:null});
          if (chosen) {
            shiftChoice.current=chosen.id;
            setSelectedShiftId(chosen.id);
            remember(toWorkbenchSelection(chosen));
          } else {
            shiftChoice.current='';
            setSelectedShiftId('');
            setSelectedShift(null);
            setCngLog(null);
            setPressureReadings([]);
          }
        } else {
          setShiftsList([]);shiftChoice.current='';setSelectedShiftId('');setSelectedShift(null);
          setShiftListError(res.error?.message||'Failed to load operational shifts.');
        }
      } catch (err: any) {
        if(current){setShiftsList([]);shiftChoice.current='';setSelectedShiftId('');setSelectedShift(null);setShiftListError(err.message || 'Failed to load operational shifts');}
      } finally {
        if(current)setLoadingShifts(false);
      }
    };

    loadShifts();
    return ()=>{current=false;};
  }, [selectedOutletId,shiftListRevision]);

  // Load Selected Shift Details, CNG Log, and Pressure Readings
  const loadShiftData = async () => {
    if (!selectedShiftId) {
      setSelectedShift(null);
      setCngLog(null);
      setPressureReadings([]);
      return;
    }

    const requestShift=selectedShiftId;
    setLoadingShiftData(true);
    setActionError(null);

    try {
      const [shiftRes, logRes, pressureRes] = await Promise.all([
        apiFetch<OperationalShift>(`/api/v1/shifts/${selectedShiftId}`),
        apiFetch<CngShiftLog | null>(`/api/v1/shifts/${selectedShiftId}/cng-log`),
        apiFetch<CngPressureReading[]>(`/api/v1/shifts/${selectedShiftId}/cng-pressure-readings`),
      ]);

      if(shiftChoice.current!==requestShift)return;
      if (shiftRes.success && shiftRes.data?.id===requestShift && shiftRes.data.outletId===selectedOutletId && logRes.success && pressureRes.success) {
        setSelectedShift(shiftRes.data);
      } else {
        setSelectedShift(null);setActionError('Unable to verify shift or load all CNG records. Refresh before entering data.');
      }

      if (logRes.success) {
        setCngLog(logRes.data);
      } else {
        setCngLog(null);
      }

      if (pressureRes.success && pressureRes.data) {
        setPressureReadings(pressureRes.data);
      } else {
        setPressureReadings([]);
      }
    } catch (err: any) {
      if(shiftChoice.current===requestShift){setSelectedShift(null);setCngLog(null);setPressureReadings([]);setActionError(err.message || 'Failed to load shift CNG records');}
    } finally {
      if(shiftChoice.current===requestShift)setLoadingShiftData(false);
    }
  };

  useEffect(() => {
    loadShiftData();
  }, [selectedShiftId]);

  const reloadPressureReadings = async () => {
    if (!selectedShiftId) return;
    try {
      const res = await apiFetch<CngPressureReading[]>(`/api/v1/shifts/${selectedShiftId}/cng-pressure-readings`);
      if (res.success && res.data) {
        setPressureReadings(res.data);
      }
    } catch {
      // keep existing state on transient fetch error
    }
  };

  const handleRefresh = async () => {
    if(!selectedShiftId){setShiftListRevision(v=>v+1);return;}
    await loadShiftData();
    setDailySummaryRefreshCounter((c) => c + 1);
  };

  const handleAddPressure = () => {
    setEditingPressureReading(null);
    setPressureModalOpen(true);
  };

  const handleEditPressure = (reading: CngPressureReading) => {
    setEditingPressureReading(reading);
    setPressureModalOpen(true);
  };

  const handleDeletePressure = async (readingId: string) => {
    if (!window.confirm('Are you sure you want to delete this compressor pressure reading?')) {
      return;
    }

    setDeletingPressureId(readingId);
    setActionError(null);

    try {
      const res = await apiFetch(`/api/v1/cng-pressure-readings/${readingId}`, {
        method: 'DELETE',
      });

      if (res.success) {
        setActionSuccess('Pressure reading deleted successfully.');
        await reloadPressureReadings();
      } else {
        const code = res.error?.code;
        let msg = res.error?.message || 'Failed to delete pressure reading';
        if (code === 'SHIFT_CLOSED') {
          msg = 'Cannot delete reading because the operational shift is closed or locked.';
        } else if (code === 'CNG_NOT_AVAILABLE_AT_OUTLET') {
          msg = 'CNG operations not available at this outlet.';
        } else if (code === 'NOT_FOUND') {
          msg = 'Pressure reading not found or already deleted.';
        }
        setActionError(msg);
      }
    } catch (err: any) {
      setActionError(err.message || 'Network error deleting pressure reading');
    } finally {
      setDeletingPressureId(null);
    }
  };

  const selectedOutlet = outlets.find((o) => o.id === selectedOutletId);

  if (!canRead) {
    return (
      <div className="p-8 text-center bg-white border border-[#E2E8F0] rounded-2xl max-w-xl mx-auto my-12 space-y-3">
        <ShieldAlert className="w-12 h-12 text-rose-500 mx-auto" />
        <h2 className="text-lg font-bold text-[#17365D]">Access Restricted</h2>
        <p className="text-xs text-[#64748B]">
          You do not have permission (<code className="font-mono text-[#B8530D]">cng_operations.read</code>) to view CNG Operations.
        </p>
      </div>
    );
  }

  const attention = loadingShifts || loadingShiftData
    ? {tone:'info', title:'Loading CNG records', detail:'Retrieving saved records for the selected outlet and shift.'}
    : !selectedShift
    ? {tone:'info', title:'Choose an operational shift', detail:'Select a verified shift to view its saved CNG records.'}
    : selectedShift.status !== 'OPEN'
    ? {tone:'info', title:'Read-only shift', detail:'Historical shift — CNG records are read-only.'}
    : !canWrite
    ? {tone:'info', title:'Read-only access', detail:'Read-only mode — write permission required to modify.'}
    : !cngLog
    ? {tone:'attention', title:'MFM log not recorded', detail:'Record opening and closing meter readings for this shift.'}
    : cngLog.gridIntakeKg == null
    ? {tone:'attention', title:'Grid intake not recorded', detail:'Grid intake is optional; variance cannot be confirmed without it.'}
    : {tone:'info', title:'MFM log recorded', detail:'Review the saved meter readings and grid reconciliation below.'};

  return (
    <div className="operations-modern daily-command cng-command pb-10 max-w-[1500px] mx-auto">
      <header className="dc-heading">
        <div>
          <p className="dc-eyebrow"><span/> INDIANOIL WORKSPACE / DAILY WORK</p>
          <h1>CNG Operations</h1>
          <p className="dc-muted">MFM sales, grid intake and compressor pressure monitoring.</p>
        </div>
        <button type="button" onClick={handleRefresh}
          disabled={loadingShifts||loadingShiftData||pressureModalOpen||!!deletingPressureId}
          aria-label="Refresh CNG records" title="Refresh Shift Data" className="cng-refresh">
          <RefreshCw className={`w-3.5 h-3.5 ${loadingShiftData ? 'animate-spin' : ''}`}/> Refresh
        </button>
      </header>

      <section aria-label="Selected outlet and operational shift" className="dc-panel dc-context">
        <div className="dc-hierarchy-head">
          <span className="dc-hierarchy-icon"><GitBranch size={18} aria-hidden="true"/></span>
          <div><h2>Organization hierarchy</h2><p>Primary access: <strong>{scopeLabel(userCtx?.primaryScope || 'UNKNOWN')}</strong> · Records apply only to the selected retail outlet and shift.</p></div>
        </div>
        {selectedOutlet && <ol aria-label="Selected outlet hierarchy" className="dc-hierarchy-path">
          {outletHierarchy(selectedOutlet).map((part,i)=><li key={part.label}>
            {i>0&&<ChevronRight size={14} className="dc-chevron" aria-hidden="true"/>}
            <span data-selected={i===4}><small>{part.label}</small><strong>{part.name}{part.code?' · '+part.code:''}</strong></span>
          </li>)}
        </ol>}
        <div className="cng-context-controls">
            <div>
              <label htmlFor="cng-outlet">Retail Outlet</label>
              <select
                id="cng-outlet"
                aria-label="CNG retail outlet"
                value={selectedOutletId}
                onChange={(e) => setSelectedOutletId(e.target.value)}
                disabled={loadingOutlets}
                className="cng-select"
              >
                {outlets.length === 0 ? (
                  <option value="">No outlets available</option>
                ) : (
                  outlets.map((o) => (
                    <option key={o.id} value={o.id} className="bg-white text-[#17365D]">
                      {o.name} ({o.roCode})
                    </option>
                  ))
                )}
              </select>
            </div>

            <div>
              <label htmlFor="cng-shift">Operational Shift</label>
              <select
                id="cng-shift"
                aria-label="CNG operational shift"
                value={selectedShiftId}
                onChange={(e) => {
                const next=shiftsList.find(s=>s.id===e.target.value);
                shiftChoice.current=next?.id||'';
                setSelectedShift(null);
                setCngLog(null);setPressureReadings([]);setEditingPressureReading(null);setPressureModalOpen(false);
                setSelectedShiftId(next?.id||'');
                if(next)remember(toWorkbenchSelection(next));
              }}
                disabled={loadingShifts || loadingShiftData || pressureModalOpen || !!deletingPressureId || shiftsList.length === 0}
                className="cng-select"
              >
                {shiftsList.length === 0 ? (
                  <option value="">No shifts available</option>
                ) : (
                  <><option value="">Select operational shift</option>{shiftsList.map((s) => (
                    <option key={s.id} value={s.id} className="bg-white text-[#17365D]">
                      {s.businessDate} • {s.shiftTemplateName || 'Shift'} [{s.status}]
                    </option>
                  ))}</>
                )}
              </select>
            </div>

        </div>
      </section>

      <div className="dc-hero-grid">
        <section className="dc-hero" aria-label="Current CNG shift">
          <div className="dc-hero-content">
            <span className="dc-hero-tag"><ClipboardList size={14} aria-hidden="true"/> {selectedShift ? 'SELECTED OPERATIONAL SHIFT' : 'CNG WORKSPACE'}</span>
            <div className="dc-hero-title">
              <div>
                <h2>{selectedShift ? selectedShift.shiftTemplateName || 'Shift' : 'Select a shift to continue'}</h2>
                <p>{selectedShift ? selectedShift.businessDate+' · '+(selectedOutlet?.name || 'Selected outlet') : 'CNG readings are linked to a verified operational shift.'}</p>
              </div>
              <span className="dc-hero-art" aria-hidden="true"><Flame size={58}/></span>
            </div>
            <div className="cng-hero-footer">
              <span className="cng-shift-status" data-tone={selectedShift?.status==='OPEN'?'open':'neutral'}>{selectedShift && selectedShift.status!=='OPEN'?<Lock size={13}/>:<Clock size={13}/>} {selectedShift?.status || (loadingShifts||loadingShiftData?'LOADING':'NO SHIFT SELECTED')}</span>
              {hasPermission(PERMISSIONS.SHIFTS_READ)&&<button type="button" disabled={loadingShiftData||pressureModalOpen||!!deletingPressureId} onClick={()=>navigate('daily-ops')} className="cng-back-link"><ArrowLeft size={14}/> Return to shift workbench</button>}
            </div>
          </div>
        </section>
        <section aria-label="CNG attention centre" className="dc-attention" data-tone={attention.tone}>
          <div className="dc-attention-top">
            <span className="dc-attention-icon">{attention.tone==='attention'?<AlertTriangle size={20}/>:selectedShift && selectedShift.status!=='OPEN'?<Lock size={20}/>:<ClipboardList size={20}/>}</span>
            <div><div className="dc-attention-kicker">CNG RECORD STATUS</div><p className="dc-attention-context">Selected outlet · selected shift</p></div>
          </div>
          <h3>{attention.title}</h3><p>{attention.detail}</p>
          <div className="dc-attention-footer"><ShieldAlert size={15}/><span>{selectedShift && !loadingShiftData && !loadingShifts ? `${pressureReadings.length} pressure reading${pressureReadings.length===1?'':'s'} recorded. ` : ''}Record indicators are not safety or shift-close clearance.</span></div>
        </section>
      </div>

      {/* Global Alerts */}
      {actionError && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl flex items-center justify-between text-xs text-rose-700 shadow-lg">
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{actionError}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-[#64748B] hover:text-[#17365D]"
          >
            ✕
          </button>
        </div>
      )}

      {actionSuccess && (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex items-center justify-between text-xs text-emerald-700 shadow-lg">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{actionSuccess}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionSuccess(null)}
            className="text-[#64748B] hover:text-[#17365D]"
          >
            ✕
          </button>
        </div>
      )}

      {/* Empty States */}
      {loadingShifts||loadingShiftData?<div role="status" className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">Loading saved CNG records…</div>:shiftListError?<div role="alert" className="rounded-xl border border-red-200 bg-white p-4 text-sm text-red-800"><p>{shiftListError}</p><button type="button" onClick={()=>setShiftListRevision(v=>v+1)} className="mt-3 rounded-lg bg-[#17365D] px-4 py-2 text-white">Retry</button></div>:outlets.length === 0 ? (
        <div className="py-16 text-center bg-white border border-[#E2E8F0] rounded-2xl space-y-2">
          <Building2 className="w-10 h-10 text-slate-600 mx-auto" />
          <h3 className="text-base font-bold text-[#17365D]">No Retail Outlets Available</h3>
          <p className="text-xs text-[#64748B] max-w-sm mx-auto">
            You do not currently have access to any retail outlets. Check your scope assignments with your administrator.
          </p>
        </div>
      ) : shiftsList.length === 0 ? (
        <div className="py-16 text-center bg-white border border-[#E2E8F0] rounded-2xl space-y-2">
          <Clock className="w-10 h-10 text-slate-600 mx-auto" />
          <h3 className="text-base font-bold text-[#17365D]">No Operational Shifts</h3>
          <p className="text-xs text-[#64748B] max-w-sm mx-auto">
            No operational shifts exist for this outlet. Open a shift in Shift Operations to record CNG dispensing and pressures.
          </p>
        </div>
      ) : !selectedShift ? (
        <div className="py-16 text-center bg-white border border-[#E2E8F0] rounded-2xl space-y-2">
          <Clock className="w-10 h-10 text-slate-600 mx-auto" />
          <h3 className="text-base font-bold text-[#17365D]">Select a Shift</h3>
          <p className="text-xs text-[#64748B] max-w-sm mx-auto">
            Choose an operational shift from the dropdown above to view and manage CNG operations.
          </p>
        </div>
      ) : (
        <div className="cng-detail-stack">
          {/* Section 1: CNG MFM & Grid Intake */}
          <CngMfmPanel
            shiftId={selectedShift.id}
            shiftStatus={selectedShift.status}
            log={cngLog}
            canWrite={canWrite}
            onLogSaved={(savedLog) => {
              setCngLog(savedLog);
              setDailySummaryRefreshCounter((c) => c + 1);
            }}
            onError={(msg) => setActionError(msg)}
            onSuccess={(msg) => setActionSuccess(msg)}
          />

          {/* Section 2: Compressor & Cascade Pressure Monitoring */}
          <CngPressurePanel
            shiftId={selectedShift.id}
            shiftStatus={selectedShift.status}
            readings={pressureReadings}
            canWrite={canWrite}
            onAddClick={handleAddPressure}
            onEditClick={handleEditPressure}
            onDeleteClick={handleDeletePressure}
            deletingId={deletingPressureId}
          />

          {/* Section 3: Daily CNG Summary */}
          {selectedOutletId && selectedShift && (
            <CngDailySummaryPanel
              outletId={selectedOutletId}
              defaultDate={selectedShift.businessDate}
              refreshTrigger={dailySummaryRefreshCounter}
            />
          )}

          {/* Add / Edit Pressure Modal */}
          <CngPressureModal
            isOpen={pressureModalOpen}
            shiftId={selectedShift.id}
            initialData={editingPressureReading}
            onClose={() => {
              setPressureModalOpen(false);
              setEditingPressureReading(null);
            }}
            onSaved={async () => {
              await reloadPressureReadings();
            }}
            onError={(msg) => setActionError(msg)}
            onSuccess={(msg) => setActionSuccess(msg)}
          />
        </div>
      )}
    </div>
  );
};
