import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  FileText,
  GitBranch,
  ChevronRight,
  BarChart3,
  ShieldCheck,
  Clock,
  Info,
  RefreshCw,
  AlertCircle,
  Zap,
  Fuel,
  Wrench,
  Users,
  Download,
  Eye,
  Loader2
} from 'lucide-react';
import { apiFetch, apiFetchBlob } from '../services/api';
import { MonthlyOperationsReport } from '../../shared/types';
import { useAuth } from '../context/AuthContext';
import { PERMISSIONS } from '../../shared/constants';

import { useActiveOutlet } from '../context/ActiveOutletContext';
import { getLocalMonthInputValue } from '../../shared/utils/dateUtils';
import './financialReportsModern.css';
import './dailyOperationsModern.css';
import './outletPerformanceCommandCentre.css';
import { outletHierarchy, scopeLabel } from '../utils/commandCentre';

export const ReportsPage: React.FC = () => {
  const { hasPermission, userCtx } = useAuth();
  const canGeneratePdf = hasPermission(PERMISSIONS.REPORTS_GENERATE);

  const { activeOutletId, accessibleOutlets: outlets, setActiveOutletId, loading: loadingOutlets } = useActiveOutlet();
  const selectedOutletId = activeOutletId || '';
  const setSelectedOutletId = setActiveOutletId;
  const selectedOutlet = outlets.find(o => o.id === selectedOutletId);

  const [selectedMonth, setSelectedMonth] = useState<string>(getLocalMonthInputValue());
  const [cutoffMode, setCutoffMode] = useState<'MONTH_END' | 'SELECTED_DATE' | 'LATEST_DATA'>('MONTH_END');
  const [cutoffDate, setCutoffDate] = useState<string>('');
  const [report, setReport] = useState<MonthlyOperationsReport | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const requestRef = useRef(0);
  const [loadedSelection, setLoadedSelection] = useState('');
  const selectionKey = JSON.stringify([selectedOutletId, selectedMonth, cutoffMode, cutoffMode === 'SELECTED_DATE' ? cutoffDate : '']);
  const [error, setError] = useState<string | null>(null);

  // PDF UI State
  const [pdfLoading, setPdfLoading] = useState<boolean>(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  // Clear stale PDF error whenever filters change
  useEffect(() => {
    setPdfError(null);
  }, [selectedOutletId, selectedMonth, cutoffMode, cutoffDate]);

  // Canonical Report & PDF URL parameters
  const buildPdfUrl = useCallback(() => {
    if (!selectedOutlet || !selectedOutletId || !selectedMonth) return null;
    if (cutoffMode === 'SELECTED_DATE' && !cutoffDate) return null;

    const params = new URLSearchParams({
      month: selectedMonth,
      cutoffMode,
    });

    if (cutoffMode === 'SELECTED_DATE' && cutoffDate) {
      params.set('cutoffDate', cutoffDate);
    }

    return `/api/v1/outlets/${selectedOutletId}/reports/monthly-operations/pdf?${params.toString()}`;
  }, [selectedOutlet, selectedOutletId, selectedMonth, cutoffMode, cutoffDate]);

  const fetchReport = useCallback(async () => {
    const request = ++requestRef.current;
    const current = () => request === requestRef.current;
    setLoadedSelection('');
    setReport(null);
    setError(null);
    if (!selectedOutlet || !selectedOutletId || !selectedMonth || (cutoffMode === 'SELECTED_DATE' && !cutoffDate)) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({ month: selectedMonth, cutoffMode });
      if (cutoffMode === 'SELECTED_DATE' && cutoffDate) params.set('cutoffDate', cutoffDate);
      const res = await apiFetch<MonthlyOperationsReport>(
        `/api/v1/outlets/${selectedOutletId}/reports/monthly-operations?${params.toString()}`
      );
      if (!current()) return;
      if (res.success && res.data) {
        const data = res.data;
        if (data.outletId !== selectedOutletId || data.month !== selectedMonth || data.cutoffMode !== cutoffMode ||
            (cutoffMode === 'SELECTED_DATE' && data.cutoffDate !== cutoffDate)) {
          setError('The returned report does not match the selected outlet or reporting period. Please refresh.');
        } else {
          setReport(data);
          setLoadedSelection(selectionKey);
        }
      } else {
        setError(res.error?.message || 'Failed to generate monthly operations report');
      }
    } catch {
      if (current()) setError('Unable to retrieve the monthly operations report. Please refresh.');
    } finally {
      if (current()) setLoading(false);
    }
  }, [selectedOutlet, selectedOutletId, selectedMonth, cutoffMode, cutoffDate, selectionKey]);

  useEffect(() => {
    void fetchReport();
    return () => { requestRef.current++; };
  }, [fetchReport]);

  const isPdfDisabled =
    !canGeneratePdf ||
    !selectedOutlet ||
    !selectedOutletId ||
    !selectedMonth ||
    pdfLoading ||
    (cutoffMode === 'SELECTED_DATE' && !cutoffDate);

  const handlePreviewPdf = async () => {
    if (isPdfDisabled) return;
    const pdfEndpoint = buildPdfUrl();
    if (!pdfEndpoint) {
      setPdfError('Invalid report parameters. Please select a valid cutoff date.');
      return;
    }

    // Open blank window synchronously on user click to prevent popup blockers
    const previewWindow = window.open('', '_blank');
    if (!previewWindow) {
      setPdfError(
        'Your browser blocked the PDF preview window. Please allow pop-ups for this site or use Download PDF.'
      );
      return;
    }

    setPdfLoading(true);
    setPdfError(null);

    try {
      const res = await apiFetchBlob(pdfEndpoint);
      if (!res.success || !res.blob) {
        if (previewWindow && !previewWindow.closed) {
          previewWindow.close();
        }
        setPdfError(res.error?.message || 'Failed to generate monthly operations report PDF.');
        return;
      }

      const previewUrl = URL.createObjectURL(res.blob);
      if (previewWindow && !previewWindow.closed) {
        previewWindow.opener = null;
        previewWindow.location.href = previewUrl;
      }

      setTimeout(() => {
        URL.revokeObjectURL(previewUrl);
      }, 60000);
    } catch (err: any) {
      if (previewWindow && !previewWindow.closed) {
        previewWindow.close();
      }
      setPdfError(err.message || 'Failed to generate monthly operations report PDF.');
    } finally {
      setPdfLoading(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (isPdfDisabled) return;
    const pdfEndpoint = buildPdfUrl();
    if (!pdfEndpoint) {
      setPdfError('Invalid report parameters. Please select a valid cutoff date.');
      return;
    }

    setPdfLoading(true);
    setPdfError(null);

    try {
      const res = await apiFetchBlob(pdfEndpoint);
      if (!res.success || !res.blob) {
        setPdfError(res.error?.message || 'Failed to generate monthly operations report PDF.');
        return;
      }

      const downloadUrl = URL.createObjectURL(res.blob);
      const filename =
        res.filename || `monthly-operations-${selectedOutletId}-${selectedMonth}.pdf`;

      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setTimeout(() => {
        URL.revokeObjectURL(downloadUrl);
      }, 1000);
    } catch (err: any) {
      setPdfError(err.message || 'Failed to generate monthly operations report PDF.');
    } finally {
      setPdfLoading(false);
    }
  };

  // Only display the currently verified selection. Missing records must not appear as complete coverage.
  const verifiedReport = selectedOutlet && loadedSelection === selectionKey && report && !loading ? report : null;
  const cutoffLabel = cutoffMode === 'MONTH_END' ? 'Complete Month' : cutoffMode === 'SELECTED_DATE' ? 'Selected Date' : 'Latest Data';
  const filterReady = !!selectedOutlet && !!selectedMonth && (cutoffMode !== 'SELECTED_DATE' || !!cutoffDate);
  const monthLabel = selectedMonth
    ? new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(selectedMonth + '-01T00:00:00Z'))
    : 'Select a month';
  const attention = loadingOutlets || loading
    ? { tone: 'info', title: 'Loading performance records', detail: 'Retrieving the saved report for the selected outlet and period.' }
    : !filterReady
    ? { tone: 'info', title: 'Choose reporting filters', detail: 'Select an accessible retail outlet, month and cutoff to view its performance.' }
    : error
    ? { tone: 'attention', title: 'Report unavailable', detail: 'Review the error below and refresh to retrieve the selected report.' }
    : !verifiedReport
    ? { tone: 'info', title: 'Retrieving saved report', detail: 'Performance figures will appear once the selected report is verified.' }
    : !verifiedReport.latestDataDate
    ? { tone: 'attention', title: 'No fuel or DG records found', detail: 'There are no fuel-shift or DG records within the reported period. Other available sections may still contain saved records.' }
    : verifiedReport.latestDataDate < verifiedReport.cutoffDate
    ? { tone: 'attention', title: 'Latest record precedes cutoff', detail: 'Fuel or DG records end before the reporting cutoff. This is a saved-data summary, not certification of complete monthly coverage.' }
    : { tone: 'info', title: 'Saved performance report available', detail: 'Figures reflect available records for this outlet. Financial reconciliation and daily evidence are reviewed independently.' };

  const reportSections = verifiedReport && verifiedReport.cutoffDate ? [
    {
      title: 'Shift & Fuel Sales', color: 'green', icon: Fuel, value: String(verifiedReport.fuelSummary.totalShiftsCount),
      unit: 'Closed operational shifts', rows: [
        ['Revenue in saved financial reconciliations', '₹' + (verifiedReport.fuelSummary.totalSalesPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })],
      ], note: 'This revenue comes from saved financial reconciliations; pending finance may not be included. See DSR for detailed fuel quantities.',
    },
    {
      title: 'DG Daily Operations', color: 'orange', icon: Zap, value: verifiedReport.dgSummary.totalRunningHoursStr ?? String(verifiedReport.dgSummary.totalRunHours),
      unit: 'Runtime (hours)', rows: [
        ['DG logs', verifiedReport.dgSummary.totalLogs],
        ['Diesel consumed', verifiedReport.dgSummary.totalDieselConsumedLitres + ' L'],
        ['Average daily runtime', verifiedReport.dgSummary.averageDailyRunHours + ' hrs/day'],
      ], note: 'Recorded DG runtime and diesel consumption; grid failure duration is not verified by this report.',
    },
    {
      title: 'Equipment Breakdowns', color: 'blue', icon: Wrench, value: String(verifiedReport.breakdownSummary.totalTickets),
      unit: 'Reported tickets', rows: [
        ['Open tickets', verifiedReport.breakdownSummary.openTickets],
        ['Resolved tickets', verifiedReport.breakdownSummary.resolvedTickets],
      ], note: 'Ticket counts reflect the existing maintenance report and current ticket statuses.',
    },
    {
      title: 'Workforce & Staff', color: 'indigo', icon: Users, value: String(verifiedReport.hrSummary.totalStaff),
      unit: 'Active staff', rows: [['Staff present days', verifiedReport.hrSummary.presentDaysCount + ' man-days']],
      note: 'Active staff is a current roster count; attendance reflects recorded presence for the period.',
    },
  ] : [];

  return (
    <div className="reports-modern daily-command performance-command pb-10 max-w-[1500px] mx-auto">
      <header className="dc-heading">
        <div><p className="dc-eyebrow"><span/> INDIANOIL WORKSPACE / FINANCE &amp; REPORTS</p>
          <h1>Outlet Performance Reports</h1>
          <p className="dc-muted">Monthly management overview of fuel operations, DG sets, maintenance and workforce.</p>
        </div>
        <button type="button" onClick={fetchReport} disabled={!filterReady || loading || loadingOutlets || pdfLoading}
          title="Refresh Report Data" aria-label="Refresh report" className="performance-refresh"><RefreshCw size={15} className={loading?'animate-spin':''}/> Refresh</button>
      </header>

      <section aria-label="Selected outlet and reporting period" className="dc-panel dc-context">
        <div className="dc-hierarchy-head">
          <span className="dc-hierarchy-icon"><GitBranch size={18} aria-hidden="true"/></span>
          <div><h2>Organization hierarchy</h2><p>Primary access: <strong>{scopeLabel(userCtx?.primaryScope || 'UNKNOWN')}</strong> · Report covers the selected authorized retail outlet.</p></div>
        </div>
        {selectedOutlet && <ol aria-label="Selected outlet hierarchy" className="dc-hierarchy-path">
          {outletHierarchy(selectedOutlet).map((node,index,all)=><li key={node.label}><span data-selected={index===all.length-1}><small>{node.label}</small><strong>{node.name}{node.code?' · '+node.code:''}</strong></span>{index<all.length-1&&<ChevronRight size={14} className="dc-chevron" aria-hidden="true"/>}</li>)}
        </ol>}
        <div className="performance-controls">
          <div className="performance-outlet"><label htmlFor="performance-outlet">Retail outlet</label>
            <select id="performance-outlet" value={selectedOutletId} disabled={loadingOutlets || pdfLoading}
              onChange={e=>setSelectedOutletId(e.target.value)}>
              {!selectedOutlet && <option value="">Select outlet...</option>}
              {outlets.map(o=><option key={o.id} value={o.id}>{o.roCode} — {o.name}</option>)}
            </select>
          </div>
          <div><label htmlFor="performance-month">Reporting month</label>
            <input id="performance-month" type="month" value={selectedMonth} disabled={pdfLoading} onChange={e=>setSelectedMonth(e.target.value)}/>
          </div>
          <div><label htmlFor="performance-cutoff-mode">Report cutoff</label>
            <select id="performance-cutoff-mode" value={cutoffMode} disabled={pdfLoading}
              onChange={e=>setCutoffMode(e.target.value as typeof cutoffMode)}>
              <option value="MONTH_END">Complete Month</option>
              <option value="SELECTED_DATE">Selected Date</option>
              <option value="LATEST_DATA">Latest Data</option>
            </select>
          </div>
          {cutoffMode==='SELECTED_DATE'&&<div><label htmlFor="performance-cutoff">Cutoff date</label>
            <input id="performance-cutoff" type="date" value={cutoffDate} disabled={pdfLoading} onChange={e=>setCutoffDate(e.target.value)}/>
          </div>}
        </div>
      </section>

      <div className="dc-hero-grid">
        <section className="dc-hero" aria-label="Report selection summary">
          <div className="dc-hero-content">
            <span className="dc-hero-tag"><BarChart3 size={14} aria-hidden="true"/> MONTHLY PERFORMANCE</span>
            <div className="dc-hero-title">
              <div><h2>{monthLabel}</h2><p>{selectedOutlet?selectedOutlet.name+' · '+selectedOutlet.roCode:'Select an authorized retail outlet'}</p></div>
              <span className="dc-hero-art" aria-hidden="true"><BarChart3 size={53}/></span>
            </div>
            <div className="performance-period-meta">
              <div><span>Report cutoff</span><strong>{cutoffLabel}{verifiedReport?.cutoffDate?' · '+verifiedReport.cutoffDate:cutoffMode==='SELECTED_DATE'&&cutoffDate?' · '+cutoffDate:''}</strong></div>
              <div><span>Latest fuel / DG record</span><strong>{verifiedReport?verifiedReport.latestDataDate||'No record found':'Not verified'}</strong></div>
            </div>
            {canGeneratePdf&&<div className="performance-export-actions">
              <button type="button" onClick={handlePreviewPdf} disabled={isPdfDisabled} className="performance-preview">
                {pdfLoading?<Loader2 size={16} className="animate-spin"/>:<Eye size={16}/>} {pdfLoading?'Generating PDF...':'Preview PDF'}
              </button>
              <button type="button" onClick={handleDownloadPdf} disabled={isPdfDisabled} className="performance-download">
                {pdfLoading?<Loader2 size={16} className="animate-spin"/>:<Download size={16}/>} {pdfLoading?'Generating PDF...':'Download PDF'}
              </button>
            </div>}
          </div>
        </section>
        <section className="dc-attention" data-tone={attention.tone} aria-label="Performance report status">
          <div className="dc-attention-top"><span className="dc-attention-icon">{attention.tone==='attention'?<AlertCircle size={21}/>:loading?<Clock size={21}/>:<FileText size={21}/>}</span>
            <div><div className="dc-attention-kicker">REPORTING &amp; DATA COVERAGE</div><p className="dc-attention-context">Selected outlet · saved report</p></div>
          </div>
          <h3>{attention.title}</h3><p>{attention.detail}</p>
          <div className="dc-attention-footer"><ShieldCheck size={15}/><span>Read-only reporting. Use DSR Reports for daily stock and nozzle detail; use Collections &amp; Finance for reconciliation.</span></div>
        </section>
      </div>

      {error && <div role="alert" className="performance-error"><AlertCircle size={19}/><span>{error}</span></div>}
      {pdfError && <div role="alert" className="performance-error"><AlertCircle size={19}/><span>{pdfError}</span><button type="button" onClick={()=>setPdfError(null)}>Dismiss</button></div>}

      <section className="dc-panel performance-overview" aria-label="Outlet performance overview" aria-busy={loading}>
        <div className="dc-section-heading">
          <div><h2>Monthly performance overview</h2><p>Fuel, equipment, DG and workforce indicators from the existing monthly operations report.</p></div>
          <span className="performance-overview-tag">{verifiedReport?.cutoffDate?'Saved figures':'Report not verified'}</span>
        </div>
        {reportSections.length>0?<div className="performance-card-grid">
          {reportSections.map(section=>{const Icon=section.icon;return <article key={section.title} className="performance-card" data-color={section.color}>
            <div className="performance-card-head"><span className="dc-card-icon"><Icon size={21} aria-hidden="true"/></span><h3>{section.title}</h3></div>
            <div className="performance-metric"><strong>{section.value}</strong><span>{section.unit}</span></div>
            <dl>{section.rows.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
            <p className="performance-card-note"><Info size={13} aria-hidden="true"/>{section.note}</p>
          </article>})}
        </div>:<div role="status" className="performance-empty">
          {loading||loadingOutlets?<Loader2 size={26} className="animate-spin"/>:<FileText size={26}/>}
          <div><h3>{loading||loadingOutlets?'Loading performance indicators':!filterReady?'Select reporting filters':verifiedReport&&!verifiedReport.cutoffDate?'No records for the latest-data cutoff':'Report figures unavailable'}</h3>
          <p>{verifiedReport&&!verifiedReport.cutoffDate?'Select a different month or cutoff; no verified reporting period was returned.':!filterReady?'Choose a month, outlet and valid cutoff to view saved figures.':'Figures are shown only when a matching report is returned, rather than displaying missing data as zero.'}</p></div>
        </div>}
      </section>

      <section className="dc-panel performance-report-guide" aria-label="Report purpose">
        <span className="dc-card-icon" data-color="cyan"><FileText size={20}/></span>
        <div><h2>Performance report vs DSR</h2><p>This report gives management an integrated monthly view. DSR Reports remain the source for shift-wise and consolidated fuel stock, sales quantities and detailed tank and nozzle statements. The existing monthly PDF includes the full report register.</p></div>
      </section>
    </div>
  );
};
