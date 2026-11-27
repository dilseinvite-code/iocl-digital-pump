import React from 'react';
import { LubeStockSummaryItem } from '../../../shared/types';
import { AlertTriangle, AlertCircle, CheckCircle, RefreshCw, Boxes } from 'lucide-react';

interface LubeInventoryPanelProps {
  stockSummary: LubeStockSummaryItem[];
  lowStockItems: LubeStockSummaryItem[];
  loading: boolean;
  onRefresh: () => void;
}

export const LubeInventoryPanel: React.FC<LubeInventoryPanelProps> = ({
  stockSummary,
  lowStockItems,
  loading,
  onRefresh,
}) => {
  return (
    <div className="lube-panel space-y-6">
        <div className="dc-detail-heading lube-panel-heading">
        <div className="dc-detail-title">
          <span className="dc-detail-icon" data-color="cyan"><Boxes size={20} aria-hidden="true"/></span>
          <div>
            <h3>Current Inventory</h3>
            <p>Real-time authoritative stock balance for all registered SKUs</p>
          </div>
        </div>
          <button
            onClick={onRefresh}
            className="lube-refresh" aria-label="Refresh inventory stock"
            disabled={loading}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      {/* Low Stock Alert Panel */}
      {lowStockItems.length > 0 && (
        <div className="p-4 bg-amber-500/10 border border-amber-500/25 rounded-2xl space-y-3">
          <div className="flex items-center gap-2.5 text-amber-500">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <h4 className="text-sm font-bold tracking-tight">Low Stock Alert ({lowStockItems.length})</h4>
          </div>
          <p className="text-xs text-slate-300">
            The following stock keeping units are at or below their configured reorder thresholds. Consider logging fresh stock receipts.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pt-1">
            {lowStockItems.map((item) => (
              <div
                key={item.lubeSkuId}
                className="p-3 bg-slate-950 border border-slate-800 rounded-xl flex items-center justify-between text-xs"
              >
                <div>
                  <div className="font-bold text-slate-100">{item.skuName}</div>
                  <div className="text-[11px] text-slate-400 font-mono mt-0.5">{item.skuCode}</div>
                </div>
                <div className="text-right">
                  <div className="font-mono font-bold text-rose-500 tabular-nums">
                    {item.currentStock} {item.stockUnit}
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                    Limit: {item.reorderThreshold}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stock Summary Area */}
      <div className="space-y-4">


        {loading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-8 h-8 text-orange-500 animate-spin" />
          </div>
        ) : stockSummary.length === 0 ? (
          <div className="lube-empty space-y-3">
            <AlertCircle className="w-8 h-8 text-slate-500 mx-auto" />
            <h4 className="text-sm font-semibold text-white">No Inventory Records found</h4>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              Please make sure SKUs are configured and opening balances or receipts are recorded.
            </p>
          </div>
        ) : (
          <div className="lube-metric-grid">
            {stockSummary.map((item) => (
              <div
                key={item.lubeSkuId}
                className="lube-metric lube-stock-card space-y-4" data-color={item.isLowStock?'orange':'cyan'}
              >
                <div className="space-y-1.5">
                  <div className="flex items-start justify-between gap-4">
                    <h4 className="text-sm font-bold text-white tracking-tight leading-tight">
                      {item.skuName}
                    </h4>
                    {item.isLowStock ? (
                      <span className="text-[10px] font-semibold text-amber-500 shrink-0 font-mono tracking-wide uppercase">
                        Low Stock
                      </span>
                    ) : (
                      <span className="text-[10px] font-semibold text-emerald-500 shrink-0 font-mono tracking-wide uppercase">
                        Normal
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-slate-400">
                    <span className="font-mono font-semibold">{item.skuCode}</span>
                    <span aria-hidden="true" className="text-slate-600">·</span>
                    <span>{item.category}</span>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
                  <div>
                    <div className="text-[10px] text-slate-500 font-semibold tracking-wider font-mono uppercase">
                      Current Stock
                    </div>
                    <div className="text-xl font-bold font-mono text-white mt-0.5 tabular-nums">
                      {item.currentStock} <span className="text-[11px] font-normal">{item.stockUnit}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-slate-500 font-semibold tracking-wider font-mono uppercase">
                      Min Threshold
                    </div>
                    <div className="text-sm font-bold font-mono text-slate-300 mt-1 tabular-nums">
                      {item.reorderThreshold} <span className="text-[10px] text-slate-500 font-normal">{item.stockUnit}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
