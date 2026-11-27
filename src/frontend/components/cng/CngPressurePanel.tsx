import React from 'react';
import { CngPressureReading, OperationalShift } from '../../../shared/types';
import { Gauge, Plus, Edit2, Trash2, Clock, AlertCircle } from 'lucide-react';

interface CngPressurePanelProps {
  shiftId: string;
  shiftStatus: OperationalShift['status'];
  readings: CngPressureReading[];
  canWrite: boolean;
  onAddClick: () => void;
  onEditClick: (reading: CngPressureReading) => void;
  onDeleteClick: (readingId: string) => void;
  deletingId: string | null;
}

function formatIsoToReadable(isoStr: string): string {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    return isNaN(d.getTime()) ? isoStr : d.toLocaleString();
  } catch {
    return isoStr;
  }
}

export const CngPressurePanel: React.FC<CngPressurePanelProps> = ({
  shiftStatus,
  readings,
  canWrite,
  onAddClick,
  onEditClick,
  onDeleteClick,
  deletingId,
}) => {
  const isEditable = canWrite && shiftStatus === 'OPEN';

  return (
    <div className="dc-detail-panel cng-panel">
      <div className="dc-detail-heading cng-panel-heading">
        <div className="dc-detail-title">
          <div className="dc-detail-icon" data-color="cyan">
            <Gauge className="w-5 h-5" />
          </div>
          <div>
            <h2>
              Compressor & Cascade Pressure Readings
            </h2>
            <p>
              High-pressure cascade logs, suction & discharge stage measurements
            </p>
          </div>
        </div>

        {isEditable && (
          <button
            type="button"
            onClick={onAddClick}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white rounded-xl text-xs font-bold shadow-lg shadow-orange-500/20 transition-all self-start sm:self-auto"
          >
            <Plus className="w-4 h-4" />
            <span>Add Pressure Reading</span>
          </button>
        )}
      </div>

      <div className="cng-panel-body">
        {readings.length === 0 ? (
          <div className="cng-pressure-empty">
            <Gauge className="w-8 h-8 text-[#427f99]" />
            <p className="text-sm font-medium text-slate-400">
              No compressor pressure readings have been recorded.
            </p>
            {isEditable && (
              <p className="text-xs text-slate-500">
                Click &quot;Add Pressure Reading&quot; to log stages for this operational shift.
              </p>
            )}
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto cng-pressure-table" role="region" aria-label="Compressor pressure readings" tabIndex={0}>
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-900 text-slate-400 font-mono uppercase text-[10px] border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4">Recorded At</th>
                    <th className="py-3 px-4">Unit</th>
                    <th className="py-3 px-4 text-right">Suction</th>
                    <th className="py-3 px-4 text-right">Discharge</th>
                    <th className="py-3 px-4 text-right">Cascade / LCNG</th>
                    <th className="py-3 px-4">Notes</th>
                    {isEditable && <th className="py-3 px-4 text-center">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {readings.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-900/50 transition-colors">
                      <td className="py-3 px-4 text-slate-300 font-sans whitespace-nowrap">
                        {formatIsoToReadable(r.recordedAt)}
                      </td>
                      <td className="py-3 px-4">
                        <span className="cng-unit">
                          {r.pressureUnit}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-white">
                        {r.suctionPressure ?? <span className="text-slate-600">—</span>}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-white">
                        {r.dischargePressure ?? <span className="text-slate-600">—</span>}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-white">
                        {r.cascadePressure ?? <span className="text-slate-600">—</span>}
                      </td>
                      <td className="py-3 px-4 font-sans text-slate-400 max-w-[200px] truncate" title={r.notes || undefined}>
                        {r.notes || <span className="text-slate-600">—</span>}
                      </td>
                      {isEditable && (
                        <td className="py-3 px-4 text-center whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => onEditClick(r)}
                              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                              title="Edit Reading"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeleteClick(r.id)}
                              disabled={deletingId === r.id}
                              className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors disabled:opacity-50"
                              title="Delete Reading"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Stacked Cards */}
            <div className="md:hidden space-y-3">
              {readings.map((r) => (
                <div
                  key={r.id}
                  className="cng-pressure-card space-y-3"
                >
                  <div className="flex items-center justify-between text-xs pb-2 border-b border-slate-800/80">
                    <div className="flex items-center gap-1.5 text-slate-400">
                      <Clock className="w-3.5 h-3.5 text-slate-500" />
                      <span>{formatIsoToReadable(r.recordedAt)}</span>
                    </div>
                    <span className="cng-unit font-mono">
                      {r.pressureUnit}
                    </span>
                  </div>

                  <div className="cng-pressure-metrics">
                    <div className="cng-pressure-value">
                      <div className="text-[10px] uppercase text-slate-500">Suction</div>
                      <div className="text-xs font-bold text-white mt-0.5">
                        {r.suctionPressure ?? <span className="text-slate-600">—</span>}
                      </div>
                    </div>
                    <div className="cng-pressure-value">
                      <div className="text-[10px] uppercase text-slate-500">Discharge</div>
                      <div className="text-xs font-bold text-white mt-0.5">
                        {r.dischargePressure ?? <span className="text-slate-600">—</span>}
                      </div>
                    </div>
                    <div className="cng-pressure-value">
                      <div className="text-[10px] uppercase text-slate-500">Cascade</div>
                      <div className="text-xs font-bold text-white mt-0.5">
                        {r.cascadePressure ?? <span className="text-slate-600">—</span>}
                      </div>
                    </div>
                  </div>

                  {r.notes && (
                    <div className="text-xs text-slate-400 bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/60 italic">
                      &quot;{r.notes}&quot;
                    </div>
                  )}

                  {isEditable && (
                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800/60">
                      <button
                        type="button"
                        onClick={() => onEditClick(r)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        <span>Edit</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteClick(r.id)}
                        disabled={deletingId === r.id}
                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-lg text-xs font-medium border border-rose-500/30 disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete</span>
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
