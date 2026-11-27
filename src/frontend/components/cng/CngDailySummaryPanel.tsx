import React, { useState, useEffect } from 'react';
import { CngDailySummary } from '../../../shared/types';
import { apiFetch } from '../../services/api';
import { Calendar, BarChart3, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';

interface CngDailySummaryPanelProps {
  outletId: string;
  defaultDate: string;
  refreshTrigger?: number;
}

export const CngDailySummaryPanel: React.FC<CngDailySummaryPanelProps> = ({
  outletId,
  defaultDate,
  refreshTrigger = 0,
}) => {
  const [selectedDate, setSelectedDate] = useState(defaultDate);
  const [summary, setSummary] = useState<CngDailySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync date when defaultDate changes from parent selected shift
  useEffect(() => {
    if (defaultDate) {
      setSelectedDate(defaultDate);
    }
  }, [defaultDate]);

  const loadSummary = async (date: string) => {
    if (!outletId || !date) return;
    setLoading(true);
    setError(null);

    try {
      const res = await apiFetch<CngDailySummary>(
        `/api/v1/outlets/${outletId}/cng/daily-summary?businessDate=${date}`
      );

      if (res.success && res.data) {
        setSummary(res.data);
      } else {
        setError(res.error?.message || 'Failed to load daily CNG summary');
        setSummary(null);
      }
    } catch (err: any) {
      setError(err.message || 'Network error fetching daily summary');
      setSummary(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedDate && outletId) {
      loadSummary(selectedDate);
    }
  }, [outletId, selectedDate, refreshTrigger]);

  return (
    <div className="dc-detail-panel cng-panel">
      <div className="dc-detail-heading cng-panel-heading">
        <div className="dc-detail-title">
          <div className="dc-detail-icon" data-color="blue">
            <BarChart3 className="w-5 h-5" />
          </div>
          <div>
            <h2>
              Daily CNG Summary
            </h2>
            <p>
              Aggregated 24-hour business date sales and custody transfer reconciliation
            </p>
          </div>
        </div>

        <div className="cng-date-controls">
          <div className="cng-date-field">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <input
              type="date" aria-label="CNG summary business date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="cng-date-input"
            />
          </div>
          <button
            type="button"
            onClick={() => loadSummary(selectedDate)}
            disabled={loading}
            className="cng-refresh" aria-label="Refresh daily CNG summary"
            title="Refresh Daily Summary"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="cng-panel-body">
        {loading ? (
          <div role="status" className="cng-pressure-empty">Loading daily CNG summary…</div>
        ) : error ? (
          <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-400 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : !summary || summary.shiftCount === 0 ? (
          <div className="cng-pressure-empty">
            No CNG operations recorded for the selected business date.
          </div>
        ) : (
          <div className="space-y-4">
            {/* Status banner */}
            {summary.gridDataComplete ? (
              <div className="cng-summary-banner p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center gap-2 text-xs text-emerald-400">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span className="font-semibold">Grid Data Complete:</span>
                <span className="text-slate-300">
                  All {summary.shiftCount} shifts on {summary.businessDate} have verified grid intake recorded.
                </span>
              </div>
            ) : (
              <div className="cng-summary-banner p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-center gap-2 text-xs text-amber-400">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span className="font-semibold">Incomplete Grid Intake:</span>
                <span className="text-slate-300">
                  Grid intake data is incomplete for one or more shifts. Aggregate variance is unconfirmed.
                </span>
              </div>
            )}

            {/* Aggregated Metrics Cards */}
            <div className="cng-metrics cng-daily-metrics">
              <div className="cng-metric" data-color="blue">
                <span className="cng-metric-icon"><BarChart3 size={16} aria-hidden="true"/></span>
                <div className="cng-metric-label">
                  Total MFM Sales
                </div>
                <div className="cng-metric-value">
                  {summary.totalMfmSalesKg} kg
                </div>
                <div className="text-[10px] text-slate-500 mt-1">Sum across {summary.shiftCount} shift(s)</div>
              </div>

              <div className="cng-metric" data-color="cyan">
                <span className="cng-metric-icon"><BarChart3 size={16} aria-hidden="true"/></span>
                <div className="cng-metric-label">
                  Total Grid Intake
                </div>
                <div className="cng-metric-value">
                  {summary.gridDataComplete && summary.gridIntakeKg != null ? (
                    `${summary.gridIntakeKg} kg`
                  ) : (
                    <span className="text-amber-400 text-sm font-bold font-sans">Incomplete</span>
                  )}
                </div>
                <div className="text-[10px] text-slate-500 mt-1">
                  {summary.gridDataComplete ? 'Verified upstream intake' : 'Missing shift intake'}
                </div>
              </div>

              <div className="cng-metric" data-color={!summary.gridDataComplete || summary.gridSalesVarianceKg == null ? 'neutral' : parseFloat(summary.gridSalesVarianceKg) === 0 ? 'green' : 'orange'}>
                <span className="cng-metric-icon">{summary.gridDataComplete && summary.gridSalesVarianceKg != null && parseFloat(summary.gridSalesVarianceKg) === 0 ? <CheckCircle2 size={16} aria-hidden="true"/> : <BarChart3 size={16} aria-hidden="true"/>}</span>
                <div className="cng-metric-label">
                  Grid vs Sales Variance
                </div>
                <div
                  className={`cng-metric-value ${
                    summary.gridDataComplete && summary.gridSalesVarianceKg != null
                      ? parseFloat(summary.gridSalesVarianceKg) === 0
                        ? 'text-emerald-400'
                        : 'text-amber-400'
                      : 'text-slate-600'
                  }`}
                >
                  {summary.gridDataComplete && summary.gridSalesVarianceKg != null ? (
                    `${summary.gridSalesVarianceKg} kg`
                  ) : (
                    <span className="text-slate-600 text-base font-normal">—</span>
                  )}
                </div>
                <div className="text-[10px] text-slate-500 mt-1">
                  {summary.gridDataComplete ? 'Net reconciliation balance' : 'Pending complete grid logs'}
                </div>
              </div>

              <div className="cng-metric" data-color="purple">
                <span className="cng-metric-icon"><Calendar size={16} aria-hidden="true"/></span>
                <div className="cng-metric-label">
                  Participating Shifts
                </div>
                <div className="cng-metric-value">
                  {summary.shiftCount}
                </div>
                <div className="text-[10px] text-slate-500 mt-1">Recorded for {summary.businessDate}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
