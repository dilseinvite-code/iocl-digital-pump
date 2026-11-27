import { WorkspaceCommandContext } from '../components/common/WorkspaceCommandContext';
import './adminModern.css';
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useActiveOutlet } from '../context/ActiveOutletContext';
import { apiFetch } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { State, Division, SalesArea } from '../../shared/types';
import { PERMISSIONS } from '../../shared/constants';
import { Layers, Plus, Pencil, Trash2, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';

type HierarchyTab = 'states' | 'divisions' | 'salesAreas';
type HierarchyUnit = State | Division | SalesArea;
const unitLabels: Record<HierarchyTab, string> = { states: 'State Office', divisions: 'Divisional Office', salesAreas: 'Sales Area' };
const unitEndpoints: Record<HierarchyTab, string> = { states: 'states', divisions: 'divisions', salesAreas: 'sales-areas' };

export const HierarchyPage: React.FC = () => {
  const { hasPermission, userCtx } = useAuth();
  const { refreshAccessibleOutlets } = useActiveOutlet();
  const [states, setStates] = useState<State[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [salesAreas, setSalesAreas] = useState<SalesArea[]>([]);
  const [loading, setLoading] = useState(true);

  const [activeTab, setActiveTab] = useState<HierarchyTab>('states');
  const [modal, setModal] = useState<{ tab: HierarchyTab; unit: HierarchyUnit | null; deleting?: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const refreshRef = useRef<HTMLButtonElement | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Forms
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [selectedParentId, setSelectedParentId] = useState('');

  const fetchHierarchy = async (force = false) => {
    setLoading(true);
    setListError(null);
    const options: RequestInit = force ? { cache: 'no-store' } : {};
    const [stRes, divRes, saRes] = await Promise.all([
      apiFetch<State[]>('/api/v1/hierarchy/states', options),
      apiFetch<Division[]>('/api/v1/hierarchy/divisions', options),
      apiFetch<SalesArea[]>('/api/v1/hierarchy/sales-areas', options),
    ]);

    if (stRes.data) setStates(stRes.data);
    if (divRes.data) setDivisions(divRes.data);
    if (saRes.data) setSalesAreas(saRes.data);
    if (!stRes.success || !divRes.success || !saRes.success) setListError('Some hierarchy records could not be loaded. Refresh and try again.');

    setLoading(false);
  };

  useEffect(() => {
    fetchHierarchy();
  }, []);

  const mayEdit = (tab: HierarchyTab, unit: HierarchyUnit) => {
    if (!userCtx || !hasPermission(PERMISSIONS.HIERARCHY_WRITE)) return false;
    if (userCtx.isGlobalScope) return true;
    const stateIds = userCtx.accessibleStateIds || [];
    const divisionIds = userCtx.accessibleDivisionIds || [];
    const areaIds = userCtx.accessibleSalesAreaIds || [];
    if (tab === 'states') return stateIds.includes(unit.id);
    if (tab === 'divisions') return divisionIds.includes(unit.id) || stateIds.includes((unit as Division).stateId);
    const area = unit as SalesArea;
    return areaIds.includes(area.id) || divisionIds.includes(area.divisionId) || !!(area.stateId && stateIds.includes(area.stateId));
  };

  const openModal = (tab: HierarchyTab, unit: HierarchyUnit | null, trigger: HTMLElement, deleting = false) => {
    triggerRef.current = trigger;
    setErrorMsg(null);
    setSuccessMsg(null);
    setCode(unit?.code || '');
    setName(unit?.name || '');
    setSelectedParentId(unit && 'divisionId' in unit ? unit.divisionId : unit && 'stateId' in unit ? unit.stateId || '' : '');
    setModal({ tab, unit, deleting });
  };
  const closeModal = () => {
    if (saving) return;
    setModal(null);
    setErrorMsg(null);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modal || saving) return;
    setErrorMsg(null);
    if (modal.deleting && modal.unit) {
      setSaving(true);
      const res = await apiFetch<{ id: string }>('/api/v1/hierarchy/' + unitEndpoints[modal.tab] + '/' + encodeURIComponent(modal.unit.id), {
        method: 'DELETE',
        body: JSON.stringify({ expectedUpdatedAt: modal.unit.updatedAt }),
      });
      setSaving(false);
      if (res.success) {
        setModal(null);
        setSuccessMsg(unitLabels[modal.tab] + ' deleted successfully.');
        await fetchHierarchy(true);
        void refreshAccessibleOutlets();
        requestAnimationFrame(() => refreshRef.current?.focus());
      } else {
        setErrorMsg(res.error?.message || 'Failed to delete unit safely.');
      }
      return;
    }
    const normalizedCode = code.trim().toUpperCase();
    const normalizedName = name.trim();
    if (normalizedCode.length < 2 || normalizedCode.length > 10 || normalizedName.length < 2) {
      setErrorMsg('Enter a code of 2–10 characters and a name of at least 2 characters.');
      return;
    }
    const editing = modal.unit;
    const baseUrl = '/api/v1/hierarchy/' + unitEndpoints[modal.tab];
    const body = editing
      ? { code: normalizedCode, name: normalizedName, expectedUpdatedAt: editing.updatedAt }
      : { code: normalizedCode, name: normalizedName, status: 'ACTIVE',
          ...(modal.tab === 'divisions' ? { stateId: selectedParentId } : modal.tab === 'salesAreas' ? { divisionId: selectedParentId } : {}) };
    setSaving(true);
    const res = await apiFetch<HierarchyUnit>(editing ? baseUrl + '/' + encodeURIComponent(editing.id) : baseUrl, {
      method: editing ? 'PATCH' : 'POST',
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (res.success) {
      setModal(null);
      setSuccessMsg(unitLabels[modal.tab] + (editing ? ' updated successfully.' : ' created successfully.'));
      await fetchHierarchy(true);
      if (editing) void refreshAccessibleOutlets();
    } else {
      setErrorMsg(res.error?.message || (editing ? 'Failed to update unit' : 'Failed to create unit'));
    }
  };

  const renderActions = (tab: HierarchyTab, unit: HierarchyUnit) => mayEdit(tab, unit) && (
    <div className="pt-2 border-t border-[#E2E8F0] flex flex-wrap gap-2 justify-end">
      <button type="button" aria-label={'Edit ' + unit.name} onClick={e => openModal(tab, unit, e.currentTarget)}
        className="inline-flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 rounded-lg border border-[#C8D9ED] bg-[#EEF5FF] text-[#17365D] text-xs font-bold hover:bg-[#DCEBFF] focus-visible:outline-2 focus-visible:outline-[#2354C6]">
        <Pencil size={14} aria-hidden="true"/> Edit
      </button>
      <button type="button" aria-label={'Delete ' + unit.name} onClick={e => openModal(tab, unit, e.currentTarget, true)}
        className="inline-flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 rounded-lg border border-red-200 bg-red-50 text-red-800 text-xs font-bold hover:bg-red-100 focus-visible:outline-2 focus-visible:outline-red-600">
        <Trash2 size={14} aria-hidden="true"/> Delete
      </button>
    </div>
  );
  const statusBadge = (status: HierarchyUnit['status']) => (
    <span className={'px-2 py-0.5 rounded text-[10px] font-mono border ' + (status==='ACTIVE'?'bg-emerald-500/10 text-emerald-700 border-emerald-500/30':'bg-[#F1F5F9] text-[#475569] border-[#CBD5E1]')}>{status}</span>
  );

  return (
    <div className="admin-modern daily-command workspace-command pb-10">
      {/* Header */}
      <div className="workspace-command-heading flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#E2E8F0]">
        <div>
          <div className="flex items-center gap-2">
            <Layers className="w-6 h-6 text-orange-500" />
            <h1 className="text-xl font-extrabold text-[#17365D]">Organizational Hierarchy</h1>
          </div>
          <p className="text-xs text-[#64748B] mt-1">
            Admin → State Office → Divisional Office → Sales Area / Field Officer → Retail Outlet
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button type="button" ref={refreshRef} onClick={()=>void fetchHierarchy(true)} disabled={loading} aria-label="Refresh hierarchy"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#D7E0EA] text-[#17365D] bg-white text-xs font-semibold hover:bg-[#F1F5F9] disabled:opacity-50">
            <RefreshCw size={14} aria-hidden="true"/> Refresh
          </button>
          {hasPermission(PERMISSIONS.HIERARCHY_WRITE) && (
          <button
            onClick={e => openModal(activeTab, null, e.currentTarget)}
            className="px-4 py-2 bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-600 hover:to-amber-700 text-[#17365D] text-xs font-bold rounded-lg shadow-lg shadow-orange-500/20 flex items-center gap-2 self-start sm:self-auto"
          >
            <Plus className="w-4 h-4" />
            <span>Add Hierarchy Unit</span>
          </button>
          )}
        </div>
      </div>
      <WorkspaceCommandContext module="hierarchy" />

      {/* Tabs */}
      <div className="workspace-command-tabs flex items-center gap-2 border-b border-[#E2E8F0] pb-2">
        <button
          aria-pressed={activeTab === 'states'}
              onClick={() => setActiveTab('states')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold font-mono transition-colors ${
            activeTab === 'states' ? 'bg-orange-500 text-white' : 'text-[#64748B] hover:text-[#17365D] bg-[#F1F5F9]'
          }`}
        >
          State Offices ({states.length})
        </button>

        <button
          aria-pressed={activeTab === 'divisions'}
              onClick={() => setActiveTab('divisions')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold font-mono transition-colors ${
            activeTab === 'divisions' ? 'bg-orange-500 text-white' : 'text-[#64748B] hover:text-[#17365D] bg-[#F1F5F9]'
          }`}
        >
          Divisional Offices ({divisions.length})
        </button>

        <button
          aria-pressed={activeTab === 'salesAreas'}
              onClick={() => setActiveTab('salesAreas')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold font-mono transition-colors ${
            activeTab === 'salesAreas' ? 'bg-orange-500 text-white' : 'text-[#64748B] hover:text-[#17365D] bg-[#F1F5F9]'
          }`}
        >
          Sales Areas ({salesAreas.length})
        </button>
      </div>

      {successMsg && <div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 p-3 text-sm font-semibold"><CheckCircle2 size={17}/>{successMsg}</div>}
      {listError && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 p-3 text-sm"><span>{listError}</span><button type="button" onClick={()=>void fetchHierarchy(true)} className="inline-flex items-center gap-1 font-bold"><RefreshCw size={14}/> Refresh</button></div>}
      {/* Content */}
      {loading ? (
        <div className="py-12 text-center text-xs text-[#64748B] font-mono animate-pulse">
          Loading hierarchy structural units...
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {activeTab === 'states' && states.map(s => (
            <div key={s.id} className="bg-white border border-[#E2E8F0] rounded-xl p-5 space-y-2 shadow-lg">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-[#B8530D]">{s.code}</span>
                {statusBadge(s.status)}
              </div>
              <h3 className="font-extrabold text-sm text-[#17365D]">{s.name}</h3>
              <p className="text-[11px] text-[#64748B] font-mono break-all">ID: {s.id}</p>
              {renderActions('states', s)}
            </div>
          ))}

          {activeTab === 'divisions' && divisions.map(d => (
            <div key={d.id} className="bg-white border border-[#E2E8F0] rounded-xl p-5 space-y-2 shadow-lg">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-cyan-400">{d.code}</span>
                {statusBadge(d.status)}
              </div>
              <h3 className="font-extrabold text-sm text-[#17365D]">{d.name}</h3>
              <p className="text-[11px] text-[#64748B] font-mono">Parent State: <strong className="text-[#17365D]">{d.stateName || d.stateId}</strong></p>
              {renderActions('divisions', d)}
            </div>
          ))}

          {activeTab === 'salesAreas' && salesAreas.map(sa => (
            <div key={sa.id} className="bg-white border border-[#E2E8F0] rounded-xl p-5 space-y-2 shadow-lg">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-emerald-700">{sa.code}</span>
                {statusBadge(sa.status)}
              </div>
              <h3 className="font-extrabold text-sm text-[#17365D]">{sa.name}</h3>
              <p className="text-[11px] text-[#64748B] font-mono">Parent Division: <strong className="text-[#17365D]">{sa.divisionName || sa.divisionId}</strong></p>
              {renderActions('salesAreas', sa)}
            </div>
          ))}
        </div>
      )}

      {/* Create/edit is mounted outside the page container so the dialog
          remains viewport-fixed, including on small screens. */}
      {modal && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm"
          onKeyDown={e => {
            if (e.key === 'Escape') closeModal();
            if (e.key === 'Tab') {
              const focusable = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)'));
              const first = focusable[0], last = focusable[focusable.length - 1];
              if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
              else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
            }
          }}>
          <div role="dialog" aria-modal="true" aria-labelledby="hierarchy-modal-title" className="admin-modern bg-white border border-[#E2E8F0] rounded-2xl max-w-md w-full max-h-[90dvh] overflow-y-auto p-6 shadow-2xl space-y-4">
            <div>
              <p className="text-[10px] font-bold tracking-wider uppercase text-[#A95215]">Organizational hierarchy</p>
              <h2 id="hierarchy-modal-title" className="text-lg font-bold text-[#17365D]">{modal.deleting ? 'Delete' : modal.unit ? 'Edit' : 'Add'} {unitLabels[modal.tab]}</h2>
              {modal.unit && !modal.deleting && <p className="text-xs text-[#64748B] mt-1">Update the name or code. Existing status, parent relationships and linked outlets will not change.</p>}
            </div>

            {errorMsg && (
              <div role="alert" className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-800 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleSave} className="space-y-3 text-xs">
              {modal.deleting && modal.unit ? (
                <>
                  <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-900 space-y-2">
                    <div className="flex items-center gap-2 font-bold"><Trash2 size={18} aria-hidden="true"/> Permanently delete this unit?</div>
                    <p className="text-sm font-bold break-words">{modal.unit.name}</p>
                    <p className="font-mono break-all">{modal.unit.code}</p>
                    <p>This action cannot be undone. Only units without linked child units, outlets, scope assignments or officer posting history can be deleted. No linked records will be deleted.</p>
                  </div>
                  <div className="pt-3 flex flex-wrap items-center justify-end gap-3">
                    <button type="button" autoFocus onClick={closeModal} disabled={saving} className="px-4 py-2 bg-[#F1F5F9] text-[#475569] rounded-lg font-semibold hover:bg-[#E8EEF5]">Cancel</button>
                    <button type="submit" disabled={saving} className="px-4 py-2 bg-red-700 hover:bg-red-800 text-white rounded-lg font-bold shadow-md disabled:opacity-60">{saving ? 'Deleting…' : 'Delete Unit'}</button>
                  </div>
                </>
              ) : (<>
              {modal.tab !== 'states' && (
                <div>
                  <label htmlFor="hierarchy-parent" className="block text-[#475569] font-semibold mb-1">{modal.tab==='divisions'?'Parent State Office':'Parent Divisional Office'}</label>
                  {modal.unit ? (
                    <div id="hierarchy-parent" className="w-full px-3 py-2 bg-[#F1F5F9] border border-[#D7E0EA] rounded-lg text-[#17365D]">
                      {modal.tab==='divisions' ? (modal.unit as Division).stateName || selectedParentId : (modal.unit as SalesArea).divisionName || selectedParentId}
                      <span className="block text-[10px] text-[#64748B] mt-1">Read only</span>
                    </div>
                  ) : (
                    <select id="hierarchy-parent" required disabled={saving} value={selectedParentId} onChange={e=>setSelectedParentId(e.target.value)}
                      className="w-full px-3 py-2 bg-[#F1F5F9] border border-[#D7E0EA] rounded-lg text-[#17365D]">
                      <option value="">-- Choose parent --</option>
                      {(modal.tab==='divisions'?states:divisions).map(p=><option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
                    </select>
                  )}
                </div>
              )}
              <div>
                <label htmlFor="hierarchy-code" className="block text-[#475569] font-semibold mb-1">Code</label>
                <input id="hierarchy-code" type="text" required autoFocus minLength={2} maxLength={10} placeholder="CODE-001" disabled={saving}
                  value={code} onChange={e=>setCode(e.target.value)}
                  className="w-full px-3 py-2 bg-[#F1F5F9] border border-[#D7E0EA] rounded-lg text-[#17365D] font-mono"/>
              </div>
              <div>
                <label htmlFor="hierarchy-name" className="block text-[#475569] font-semibold mb-1">Name</label>
                <input id="hierarchy-name" type="text" required minLength={2} placeholder="Unit Name" disabled={saving}
                  value={name} onChange={e=>setName(e.target.value)}
                  className="w-full px-3 py-2 bg-[#F1F5F9] border border-[#D7E0EA] rounded-lg text-[#17365D]"/>
              </div>
              <div className="pt-3 flex flex-wrap items-center justify-end gap-3">
                <button type="button" onClick={closeModal} disabled={saving} className="px-4 py-2 bg-[#F1F5F9] text-[#475569] rounded-lg font-semibold hover:bg-[#E8EEF5]">Cancel</button>
                <button type="submit" disabled={saving} className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-bold shadow-md disabled:opacity-60">
                  {saving?'Saving…':modal.unit?'Save Changes':'Create Unit'}
                </button>
              </div>
              </>)}
            </form>
          </div>
        </div>, document.body
      )}

    </div>
  );
};
