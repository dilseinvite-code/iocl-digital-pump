import React, { useState, useEffect } from 'react';
import { CngShiftLog, OperationalShift } from '../../../shared/types';
import { apiFetch } from '../../services/api';
import { Scale, ArrowRight, CheckCircle2, AlertTriangle, Save, Info } from 'lucide-react';

interface CngMfmPanelProps {
  shiftId: string;
  shiftStatus: OperationalShift['status'];
  log: CngShiftLog | null;
  canWrite: boolean;
  onLogSaved: (savedLog: CngShiftLog) => void;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

export const CngMfmPanel: React.FC<CngMfmPanelProps> = ({
  shiftId,
  shiftStatus,
  log,
  canWrite,
  onLogSaved,
  onError,
  onSuccess,
}) => {
  const [openingKg, setOpeningKg] = useState('');
  const [closingKg, setClosingKg] = useState('');
  const [gridIntakeKg, setGridIntakeKg] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);

  // Sync inputs when log changes
  useEffect(() => {
    if (log) {
      setOpeningKg(log.mfmOpeningKg ?? '');
      setClosingKg(log.mfmClosingKg ?? '');
      setGridIntakeKg(log.gridIntakeKg ?? '');
      setNotes(log.notes ?? '');
    } else {
      setOpeningKg('');
      setClosingKg('');
      setGridIntakeKg('');
      setNotes('');
    }
    setClientError(null);
  }, [log, shiftId]);

  const isEditable = canWrite && shiftStatus === 'OPEN';

  const validateInputs = (): boolean => {
    setClientError(null);

    const trimmedOpening = openingKg.trim();
    const trimmedClosing = closingKg.trim();
    const trimmedGrid = gridIntakeKg.trim();

    if (!trimmedOpening) {
      setClientError('Opening MFM reading is required.');
      return false;
    }
    if (!trimmedClosing) {
      setClientError('Closing MFM reading is required.');
      return false;
    }

    const decimalRegex = /^\d+(\.\d{1,3})?$/;
    if (!decimalRegex.test(trimmedOpening)) {
      setClientError('Opening MFM must be a non-negative decimal with at most 3 decimal places.');
      return false;
    }
    if (!decimalRegex.test(trimmedClosing)) {
      setClientError('Closing MFM must be a non-negative decimal with at most 3 decimal places.');
      return false;
    }
    if (trimmedGrid && !decimalRegex.test(trimmedGrid)) {
      setClientError('Grid intake must be a non-negative decimal with at most 3 decimal places.');
      return false;
    }

    const opNum = parseFloat(trimmedOpening);
    const clNum = parseFloat(trimmedClosing);
    if (clNum < opNum) {
      setClientError('Closing MFM reading must be greater than or equal to opening reading.');
      return false;
    }

    return true;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEditable || submitting) return;

    if (!validateInputs()) {
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        mfmOpeningKg: openingKg.trim(),
        mfmClosingKg: closingKg.trim(),
        gridIntakeKg: gridIntakeKg.trim() ? gridIntakeKg.trim() : null,
        notes: notes.trim() ? notes.trim() : null,
      };

      const res = await apiFetch<CngShiftLog>(`/api/v1/shifts/${shiftId}/cng-log`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });

      if (res.success && res.data) {
        onSuccess('CNG MFM log saved successfully.');
        onLogSaved(res.data);
      } else {
        const code = res.error?.code;
        let msg = res.error?.message || 'Failed to save CNG MFM log';
        if (code === 'SHIFT_CLOSED') {
          msg = 'Cannot update MFM log because the operational shift is closed or locked.';
        } else if (code === 'CNG_NOT_AVAILABLE_AT_OUTLET') {
          msg = 'CNG operations are not configured or available for this retail outlet.';
        } else if (code === 'VALIDATION_ERROR') {
          msg = res.error?.message || 'Invalid MFM reading values entered.';
        }
        onError(msg);
      }
    } catch (err: any) {
      onError(err.message || 'An unexpected error occurred while saving MFM log.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="dc-detail-panel cng-panel">
      <div className="dc-detail-heading cng-panel-heading">
        <div className="dc-detail-title">
          <div className="dc-detail-icon" data-color="orange">
            <Scale className="w-5 h-5" />
          </div>
          <div>
            <h2>
              CNG MFM & Grid Reconciliation
            </h2>
            <p>
              Mass Flow Meter dispensing log and upstream pipeline intake reconciliation
            </p>
          </div>
        </div>

        {!isEditable && (
          <div className="cng-readonly">
            <Info className="w-3.5 h-3.5" />
            <span>Read-only Mode</span>
          </div>
        )}
      </div>

      <div className="cng-panel-body">
        {clientError && (
          <div className="p-3.5 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-center gap-2.5 text-xs text-rose-400">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{clientError}</span>
          </div>
        )}

        {/* Authoritative Server Calculated Cards */}
        <div className="cng-metrics">
          <div className="cng-metric" data-color="blue">
            <span className="cng-metric-icon"><Scale size={16} aria-hidden="true"/></span>
            <div className="cng-metric-label">
              Authoritative Net Sales
            </div>
            <div className="cng-metric-value">
              {log ? `${log.netSalesKg} kg` : <span className="text-slate-600 font-normal text-base">Not recorded</span>}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              Closing − Opening (server validated)
            </div>
          </div>

          <div className="cng-metric" data-color="cyan">
            <span className="cng-metric-icon"><ArrowRight size={16} aria-hidden="true"/></span>
            <div className="cng-metric-label">
              Pipeline Grid Intake
            </div>
            <div className="cng-metric-value">
              {log?.gridIntakeKg != null ? (
                `${log.gridIntakeKg} kg`
              ) : (
                <span className="text-slate-600 font-normal text-base">Not recorded</span>
              )}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              Upstream custody meter transfer
            </div>
          </div>

          <div className="cng-metric" data-color={log?.gridSalesVarianceKg == null ? 'neutral' : parseFloat(log.gridSalesVarianceKg) === 0 ? 'green' : 'orange'}>
            <span className="cng-metric-icon">{log?.gridSalesVarianceKg == null ? <Info size={16} aria-hidden="true"/> : parseFloat(log.gridSalesVarianceKg) === 0 ? <CheckCircle2 size={16} aria-hidden="true"/> : <AlertTriangle size={16} aria-hidden="true"/>}</span>
            <div className="cng-metric-label">
              Grid vs Sales Variance
            </div>
            <div
              className={`cng-metric-value ${
                log?.gridSalesVarianceKg != null
                  ? parseFloat(log.gridSalesVarianceKg) === 0
                    ? 'text-emerald-400'
                    : 'text-amber-400'
                  : 'text-slate-600 font-normal text-base'
              }`}
            >
              {log?.gridSalesVarianceKg != null ? `${log.gridSalesVarianceKg} kg` : '—'}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              {log?.gridSalesVarianceKg != null
                ? parseFloat(log.gridSalesVarianceKg) === 0
                  ? 'Balanced intake vs sales'
                  : 'Variance between grid & pump'
                : 'Requires grid intake entry'}
            </div>
          </div>
        </div>

        {/* Controlled Entry Form */}
        <form onSubmit={handleSave} className="cng-entry-form space-y-4">
          <div className="cng-entry-grid">
            <div>
              <label htmlFor="cng-mfm-opening" className="block text-xs font-semibold text-slate-300 mb-1.5">
                MFM Opening Reading (kg) <span className="text-orange-500">*</span>
              </label>
              <input
                type="text"
                inputMode="decimal"
                id="cng-mfm-opening"
                value={openingKg}
                onChange={(e) => setOpeningKg(e.target.value)}
                disabled={!isEditable || submitting}
                placeholder={isEditable ? "e.g. 10500.000" : "Not recorded"}
                className="cng-input font-mono"
              />
              <span className="text-[10px] text-slate-500 mt-1 block">Up to 3 decimal digits</span>
            </div>

            <div>
              <label htmlFor="cng-mfm-closing" className="block text-xs font-semibold text-slate-300 mb-1.5">
                MFM Closing Reading (kg) <span className="text-orange-500">*</span>
              </label>
              <input
                type="text"
                inputMode="decimal"
                id="cng-mfm-closing"
                value={closingKg}
                onChange={(e) => setClosingKg(e.target.value)}
                disabled={!isEditable || submitting}
                placeholder={isEditable ? "e.g. 11250.500" : "Not recorded"}
                className="cng-input font-mono"
              />
              <span className="text-[10px] text-slate-500 mt-1 block">Must be ≥ Opening reading</span>
            </div>

            <div>
              <label htmlFor="cng-grid-intake" className="block text-xs font-semibold text-slate-300 mb-1.5">
                Grid Intake Reading (kg) <span className="text-slate-500">(Optional)</span>
              </label>
              <input
                type="text"
                inputMode="decimal"
                id="cng-grid-intake"
                value={gridIntakeKg}
                onChange={(e) => setGridIntakeKg(e.target.value)}
                disabled={!isEditable || submitting}
                placeholder={isEditable ? "e.g. 750.500" : "Not recorded"}
                className="cng-input font-mono"
              />
              <span className="text-[10px] text-slate-500 mt-1 block">Leave empty if not recorded</span>
            </div>
          </div>

          <div>
            <label htmlFor="cng-notes" className="block text-xs font-semibold text-slate-300 mb-1.5">
              Operational Remarks / Notes <span className="text-slate-500">(Optional)</span>
            </label>
            <textarea
              id="cng-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={!isEditable || submitting}
              rows={2}
              placeholder={isEditable ? "e.g. Compressor trip observed at 14:00, grid pressure stable..." : "No remarks recorded"}
              className="cng-input"
            />
          </div>

          {isEditable && (
            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white font-bold text-xs uppercase tracking-wider rounded-xl shadow-lg shadow-orange-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                <Save className="w-4 h-4" />
                <span>{submitting ? 'Saving MFM Log...' : log ? 'Update CNG Log' : 'Save CNG Log'}</span>
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
};
