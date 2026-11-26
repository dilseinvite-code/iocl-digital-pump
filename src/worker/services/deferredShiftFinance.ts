import { and, eq, inArray, sql } from 'drizzle-orm';
import type { AppDatabase } from '../../db';
import { shiftFinancialReconciliations } from '../../db/schema';
import { deferredShiftFinance } from '../../db/deferredShiftFinanceTable';
import type { OperationalShift, ShiftFinancialReconciliation } from '../../shared/types';
import { PumpRepository } from '../repositories/pumpRepository';
import { FinancialRepository } from '../repositories/financialRepository';
import { FinancialService } from './financialService';

/** Compatibility: older deployments lacking the additive table keep the old workflow. */
export async function deferredFinanceAvailable(db: AppDatabase): Promise<boolean> {
  return (await db.all(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'deferred_shift_finance'`)).length === 1;
}

export async function deferredFinanceStates(db: AppDatabase, ids: string[]) {
  const states = new Map<string, 'PENDING' | 'COMPLETED' | 'REVIEW_REQUIRED'>();
  if (!ids.length || !await deferredFinanceAvailable(db)) return states;
  // Keep each D1 IN list comfortably below the hosted bind limit.
  for (let i = 0; i < ids.length; i += 80) {
    const rows = await db.select({
      id: deferredShiftFinance.operationalShiftId, state: deferredShiftFinance.financeStatus,
      savedRecon: deferredShiftFinance.financialReconciliationId, actualRecon: shiftFinancialReconciliations.id,
    }).from(deferredShiftFinance).leftJoin(shiftFinancialReconciliations, and(
      eq(shiftFinancialReconciliations.operationalShiftId, deferredShiftFinance.operationalShiftId),
      eq(shiftFinancialReconciliations.outletId, deferredShiftFinance.outletId),
    )).where(inArray(deferredShiftFinance.operationalShiftId, ids.slice(i,i+80)));
    for (const row of rows) states.set(row.id, row.state === 'PENDING' && !row.actualRecon ? 'PENDING' :
      row.state === 'COMPLETED' && row.savedRecon && row.savedRecon === row.actualRecon ? 'COMPLETED' : 'REVIEW_REQUIRED');
  }
  return states;
}

export async function financeEntryAllowed(db: AppDatabase, shift: OperationalShift | null): Promise<boolean> {
  if (!shift) return false;
  if (shift.status === 'OPEN') return true;
  if (shift.status !== 'CLOSED' || !await deferredFinanceAvailable(db)) return false;
  const rows = await db.all(sql`SELECT d.operational_shift_id FROM deferred_shift_finance d
    WHERE d.operational_shift_id = ${shift.id} AND d.outlet_id = ${shift.outletId}
      AND d.finance_status = 'PENDING'
      AND NOT EXISTS (SELECT 1 FROM shift_financial_reconciliations f WHERE f.operational_shift_id = d.operational_shift_id)`);
  return rows.length === 1;
}

/** No financial data is written by this operation. OPEN -> CLOSING reserves
 *  an exclusive operational lock while validating saved stock evidence.
 *  CLOSED + pending marker + audit are one D1 transaction. */
export class DeferredShiftFinanceService {
  constructor(private db: AppDatabase, private d1: D1Database,
    private pump: PumpRepository, private financeRepo: FinancialRepository,
    private finance: FinancialService) {}

  async closeOperations(shift: OperationalShift, actor: string, ip?: string, agent?: string) {
    if (!await deferredFinanceAvailable(this.db)) return { code: 'DEFERRED_FINANCE_UNAVAILABLE', message: 'Two-stage closure is not enabled for this database.' };
    if (shift.status !== 'OPEN') return { code: 'SHIFT_NOT_OPEN', message: 'Only an open shift can be operationally closed.' };
    const claimedAt = new Date().toISOString();
    try {
      const claim = await this.db.all(sql`UPDATE operational_shifts SET status='CLOSING', updated_at=${claimedAt}
        WHERE id=${shift.id} AND outlet_id=${shift.outletId} AND status='OPEN'
        RETURNING id`);
      if (claim.length !== 1) return { code: 'SHIFT_CLOSED_OR_CLOSING', message: 'Shift changed concurrently. Refresh before continuing.' };
    } catch {
      return { code: 'SHIFT_CLOSE_COMMIT_UNCERTAIN', message: 'Operational reservation requires verification. Refresh before retrying.' };
    }
    const rejected = async (code: string, message: string) => {
      // Restore only this reservation; no stock or financial evidence is
      // written. Never automatically reopen a different claim or partial close.
      try {
        const restored = await this.db.all(sql`UPDATE operational_shifts SET status='OPEN', updated_at=${new Date().toISOString()}
          WHERE id=${shift.id} AND outlet_id=${shift.outletId} AND status='CLOSING' AND updated_at=${claimedAt}
            AND NOT EXISTS (SELECT 1 FROM shift_financial_reconciliations WHERE operational_shift_id=${shift.id})
            AND NOT EXISTS (SELECT 1 FROM deferred_shift_finance WHERE operational_shift_id=${shift.id})
          RETURNING id`);
        if (restored.length === 1) return { code, message };
      } catch { /* never retry an ambiguous restore */ }
      return { code: 'SHIFT_CLOSE_COMMIT_UNCERTAIN', message: 'Refresh the shift and ask an authorized reviewer to verify the outcome.' };
    };
    try {
      if (await this.financeRepo.findShiftFinancialReconciliation(shift.id)) {
        // Existing partial close evidence is not a normal deferred-close candidate.
        return { code: 'SHIFT_CLOSE_REVIEW_REQUIRED', message: 'Existing financial reconciliation evidence requires authorized review. No rows were overwritten.' };
      }
      const check = await this.pump.validateShiftCompleteness(shift.id);
      if (!check.valid) return rejected(check.error || 'INCOMPLETE_TANK_STOCK_DATA', check.message || 'Complete tank readings and receipts.');
      const [tanks, tankReadings, nozzleSnapshots, nozzleReadings, unavailable] = await Promise.all([
        this.pump.listShiftTankSnapshots(shift.id), this.pump.listShiftTankReadings(shift.id),
        this.pump.listShiftNozzleSnapshots(shift.id), this.pump.listReadingsForShift(shift.id), this.pump.listUnavailabilityForShift(shift.id),
      ]);
      if (!nozzleSnapshots.length || nozzleSnapshots.some(n => !nozzleReadings.some(r => r.nozzleId === n.nozzleId) &&
          !unavailable.some(u=>u.nozzleId===n.nozzleId)))
        return rejected('INCOMPLETE_SHIFT_READINGS','Every nozzle must have a meter reading or approved unavailability.');
      for (const tank of tanks) {
        if (!(await this.pump.listCalibrationPoints(tank.tankId)).length)
          return rejected('CALIBRATION_EVIDENCE_MISMATCH','Tank calibration evidence is unavailable. Complete calibration and review the stock report.');
        const readings = tankReadings.filter(r => r.tankId===tank.tankId && ['OPENING','CLOSING'].includes(r.readingType));
        if (readings.some(r => (r.calibrationChartId ?? null) !== (tank.calibrationChartId ?? null) ||
            (r.calibrationRevision ?? null) !== (tank.calibrationRevision ?? null)))
          return rejected('CALIBRATION_EVIDENCE_MISMATCH','Tank reading calibration revisions differ from the shift snapshot. Authorized review is required.');
        if (tank.calibrationChartId && !(await this.db.all(sql`SELECT id FROM tank_calibration_charts
           WHERE id=${tank.calibrationChartId} AND tank_id=${tank.tankId} AND revision_number=${tank.calibrationRevision}`)).length)
          return rejected('CALIBRATION_EVIDENCE_MISMATCH','A shift calibration snapshot is unavailable. Authorized review is required.');
      }
      const revenue = await this.finance.calculateShiftFuelRevenue(shift.id);
      if (revenue.readingCoverage.status !== 'COMPLETE') return rejected('INCOMPLETE_SHIFT_READINGS', 'Complete every nozzle reading or approved unavailability before operational closure.');
      const cng = await this.finance.calculateShiftCngRevenue(shift.id);
      if (cng.cngApplicable && !cng.cngComplete) return rejected('INCOMPLETE_CNG_DATA', 'Complete CNG MFM readings before operational closure.');
      // Check lube revenue is readable; its source writes also require OPEN.
      await this.finance.calculateShiftLubeRevenue(shift.id);
      const saved = await this.pump.listShiftStockReconciliations(shift.id);
      const current = await this.pump.calculateAndSaveShiftStockReconciliation(shift.id, { persist: false });
      const fields = ['openingStockMilliunits', 'receiptQuantityMilliunits', 'salesQuantityMilliunits',
        'theoreticalClosingStockMilliunits', 'physicalClosingStockMilliunits', 'varianceMilliunits', 'varianceStatus'] as const;
      if (!current.length || saved.length !== current.length || !current.every(r =>
        saved.some(s => s.tankId === r.tankId && s.outletId === shift.outletId && s.productId === r.productId &&
          fields.every(f => s[f] === r[f])))) {
        return rejected('STOCK_RECONCILIATION_REQUIRED', 'Compute or refresh stock reconciliation and review tank differences before operational closure.');
      }
    } catch (err) {
      return rejected('OPERATIONAL_VALIDATION_FAILED', err instanceof Error ? err.message : 'Operational evidence could not be verified.');
    }

    // A unique close timestamp identifies this transaction's transition;
    // failures of any INSERT roll back the entire batch. Never retry an
    // ambiguous provider response automatically.
    const at = new Date().toISOString();
    try {
      const batch = await this.d1.batch([
        this.d1.prepare(`UPDATE operational_shifts SET status='CLOSED', closed_at=?, closed_by_user_id=?, updated_at=?
          WHERE id=? AND outlet_id=? AND status='CLOSING' AND updated_at=?
            AND NOT EXISTS (SELECT 1 FROM shift_financial_reconciliations WHERE operational_shift_id=?)
            AND NOT EXISTS (SELECT 1 FROM deferred_shift_finance WHERE operational_shift_id=?)
          RETURNING id`).bind(at, actor, at, shift.id, shift.outletId, claimedAt, shift.id, shift.id),
        this.d1.prepare(`INSERT INTO deferred_shift_finance
          (operational_shift_id,outlet_id,operational_closed_at,operational_closed_by_user_id,finance_status)
          SELECT id,outlet_id,closed_at,closed_by_user_id,'PENDING' FROM operational_shifts
          WHERE id=? AND outlet_id=? AND status='CLOSED' AND closed_at=? AND closed_by_user_id=?
          RETURNING operational_shift_id`).bind(shift.id, shift.outletId, at, actor),
        this.d1.prepare(`INSERT INTO audit_logs
          (id,user_id,action,entity_type,entity_id,old_value_json,new_value_json,ip_address,user_agent,created_at)
          SELECT ?,?,'SHIFT_OPERATIONAL_CLOSE','OPERATIONAL_SHIFT',operational_shift_id,
          '{"status":"OPEN"}',json_object('status','CLOSED','financeStatus','PENDING','at',operational_closed_at),?,?,?
          FROM deferred_shift_finance WHERE operational_shift_id=? AND operational_closed_at=? AND operational_closed_by_user_id=?
          RETURNING id`).bind('aud-'+crypto.randomUUID(), actor, ip ?? null, agent ?? null, at, shift.id, at, actor),
      ]);
      if (batch.length === 3 && batch.every(r => r.success && r.results.length === 1)) return null;
    } catch { /* commit uncertainty must be independently verified */ }
    return { code: 'SHIFT_CLOSE_COMMIT_UNCERTAIN', message: 'Operational closure outcome requires verification. Refresh the shift before retrying.' };
  }

  /** No return to OPEN or CLOSING: a subsequent shift may already be active.
   *  The guarded finance INSERT verifies present collections against the
   *  preview inside the same transaction as the completion marker + audit.
   *  A concurrent collection write is either included or rejects this attempt. */
  async finalizeFinance(shift: OperationalShift, actor: string, reason?: string, ip?: string, agent?: string) {
    if (!await financeEntryAllowed(this.db, shift) || shift.status !== 'CLOSED')
      return { code: 'FINANCE_NOT_PENDING', message: 'Only an explicitly deferred, operationally closed shift may be finalized.' };
    let recon: ShiftFinancialReconciliation;
    try {
      const sales = await this.finance.calculateShiftFuelRevenue(shift.id);
      if (sales.readingCoverage.status !== 'COMPLETE')
        return { code: 'INCOMPLETE_SHIFT_READINGS', message: 'Operational evidence is incomplete; authorized review is required.' };
      recon = await this.finance.performFinancialReconciliation(shift.id, reason, false);
    } catch (err) {
      const code = err instanceof Error ? err.message : 'FINANCIAL_RECONCILIATION_FAILED';
      return { code, message: code === 'VARIANCE_REASON_REQUIRED' ? 'Enter the verified reason for the sales/collection difference.' : 'Financial reconciliation could not be calculated. Review the recorded data.' };
    }
    const at = new Date().toISOString();
    const collectionChecks = ['CASH','POS_CARD','UPI','FLEET_CARD','CREDIT_SALE','DIRECT_BANK_DROP'].map(type =>
      `AND ? = COALESCE((SELECT SUM(c.amount_paise) FROM shift_collections c
        WHERE c.operational_shift_id=s.id AND c.outlet_id=s.outlet_id AND c.collection_type='${type}'),0)`).join('\n');
    try {
      const batch = await this.d1.batch([
        this.d1.prepare(`INSERT INTO shift_financial_reconciliations (
          id,operational_shift_id,outlet_id,fuel_sales_revenue_paise,cng_sales_revenue_paise,lube_sales_revenue_paise,
          authoritative_sales_revenue_paise,cash_collection_paise,pos_collection_paise,upi_collection_paise,
          fleet_card_collection_paise,credit_sales_paise,direct_bank_drop_paise,total_collections_paise,
          sales_collection_variance_paise,variance_status,variance_reason,calculated_at,created_at,updated_at)
          SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
          FROM operational_shifts s JOIN deferred_shift_finance d ON d.operational_shift_id=s.id AND d.outlet_id=s.outlet_id
          WHERE s.id=? AND s.outlet_id=? AND s.status='CLOSED' AND d.finance_status='PENDING'
            AND NOT EXISTS (SELECT 1 FROM shift_financial_reconciliations f WHERE f.operational_shift_id=s.id)
            ${collectionChecks} RETURNING id`).bind(
          recon.id, shift.id, shift.outletId, recon.fuelSalesRevenuePaise, recon.cngSalesRevenuePaise ?? null,
          recon.lubeSalesRevenuePaise ?? null,recon.authoritativeSalesRevenuePaise,recon.cashCollectionPaise,
          recon.posCollectionPaise,recon.upiCollectionPaise,recon.fleetCardCollectionPaise,recon.creditSalesPaise,
          recon.directBankDropPaise,recon.totalCollectionsPaise,recon.salesCollectionVariancePaise,recon.varianceStatus,
          recon.varianceReason ?? null,at,at,at,shift.id,shift.outletId,recon.cashCollectionPaise,recon.posCollectionPaise,
          recon.upiCollectionPaise,recon.fleetCardCollectionPaise,recon.creditSalesPaise,recon.directBankDropPaise),
        this.d1.prepare(`UPDATE deferred_shift_finance SET finance_status='COMPLETED',
          financial_reconciliation_id=?,financial_closed_at=?,financial_closed_by_user_id=?
          WHERE operational_shift_id=? AND outlet_id=? AND finance_status='PENDING'
            AND EXISTS (SELECT 1 FROM shift_financial_reconciliations f
              WHERE f.id=? AND f.operational_shift_id=deferred_shift_finance.operational_shift_id AND f.outlet_id=deferred_shift_finance.outlet_id)
          RETURNING operational_shift_id`).bind(recon.id,at,actor,shift.id,shift.outletId,recon.id),
        this.d1.prepare(`INSERT INTO audit_logs
          (id,user_id,action,entity_type,entity_id,old_value_json,new_value_json,ip_address,user_agent,created_at)
          SELECT ?,?,'FINANCIAL_RECONCILIATION','OPERATIONAL_SHIFT',operational_shift_id,
          '{"financeStatus":"PENDING"}',?,?,?,? FROM deferred_shift_finance
          WHERE operational_shift_id=? AND financial_reconciliation_id=? AND finance_status='COMPLETED'
          RETURNING id`).bind('aud-'+crypto.randomUUID(),actor,JSON.stringify({
          financeStatus:'COMPLETED', reconciliationId:recon.id, authoritativeSalesRevenuePaise:recon.authoritativeSalesRevenuePaise,
          totalCollectionsPaise:recon.totalCollectionsPaise,variancePaise:recon.salesCollectionVariancePaise,
          varianceStatus:recon.varianceStatus,varianceReason:recon.varianceReason,
        }),ip ?? null,agent ?? null,at,shift.id,recon.id),
      ]);
      if (batch.length === 3 && batch.every(r => r.success && r.results.length === 1)) return null;
      if (batch.every(r => r.success && r.results.length === 0))
        return { code: 'FINANCE_INPUTS_CHANGED', message: 'The shift or collections changed. Refresh and review before finalizing.' };
    } catch { /* do not infer failure from an ambiguous provider response */ }
    return { code: 'SHIFT_CLOSE_COMMIT_UNCERTAIN', message: 'Financial finalization outcome requires verification. Refresh and review before retrying.' };
  }
}
