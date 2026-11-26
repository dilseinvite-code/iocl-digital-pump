-- Additive only: no historical shift, stock, collection or finance rows changed.
-- CLOSED continues to mean operationally immutable. Only explicitly deferred
-- closures have a row here; legacy CLOSED/LOCKED shifts are never reopened.
CREATE TABLE IF NOT EXISTS deferred_shift_finance (
  operational_shift_id TEXT PRIMARY KEY NOT NULL REFERENCES operational_shifts(id),
  outlet_id TEXT NOT NULL REFERENCES retail_outlets(id),
  operational_closed_at TEXT NOT NULL,
  operational_closed_by_user_id TEXT NOT NULL REFERENCES users(id),
  finance_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (finance_status IN ('PENDING', 'COMPLETED')),
  financial_reconciliation_id TEXT UNIQUE REFERENCES shift_financial_reconciliations(id),
  financial_closed_at TEXT,
  financial_closed_by_user_id TEXT REFERENCES users(id),
  CHECK ((finance_status = 'PENDING' AND financial_reconciliation_id IS NULL
          AND financial_closed_at IS NULL AND financial_closed_by_user_id IS NULL)
      OR (finance_status = 'COMPLETED' AND financial_reconciliation_id IS NOT NULL
          AND financial_closed_at IS NOT NULL AND financial_closed_by_user_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_deferred_shift_finance_outlet_status
  ON deferred_shift_finance(outlet_id, finance_status);
