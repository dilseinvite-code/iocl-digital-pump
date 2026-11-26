import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { operationalShifts, retailOutlets, users, shiftFinancialReconciliations } from './schema';

// Explicitly deferred financial closure; operational shift remains CLOSED.
export const deferredShiftFinance = sqliteTable('deferred_shift_finance', {
  operationalShiftId: text('operational_shift_id').primaryKey().notNull().references(() => operationalShifts.id),
  outletId: text('outlet_id').notNull().references(() => retailOutlets.id),
  operationalClosedAt: text('operational_closed_at').notNull(),
  operationalClosedByUserId: text('operational_closed_by_user_id').notNull().references(() => users.id),
  financeStatus: text('finance_status', { enum: ['PENDING', 'COMPLETED'] }).notNull().default('PENDING'),
  financialReconciliationId: text('financial_reconciliation_id').unique().references(() => shiftFinancialReconciliations.id),
  financialClosedAt: text('financial_closed_at'),
  financialClosedByUserId: text('financial_closed_by_user_id').references(() => users.id),
});
