-- 0041: two-input underground tank registration + one default chart per capacity.
-- Additive only. Does not alter active tanks, fuel mappings, stock, or calibration histories.
CREATE TABLE IF NOT EXISTS global_tank_capacity_defaults (
  capacity_litres INTEGER PRIMARY KEY NOT NULL CHECK (capacity_litres IN (10000,15000,20000,50000)),
  template_id TEXT NOT NULL REFERENCES global_tank_calibration_templates(id),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_global_tank_capacity_defaults_template ON global_tank_capacity_defaults(template_id);

CREATE TABLE IF NOT EXISTS pending_underground_tanks (
  id TEXT PRIMARY KEY NOT NULL,
  outlet_id TEXT NOT NULL REFERENCES retail_outlets(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  capacity_litres INTEGER NOT NULL CHECK (capacity_litres IN (10000,15000,20000,50000)),
  template_id TEXT NOT NULL REFERENCES global_tank_calibration_templates(id),
  status TEXT NOT NULL DEFAULT 'PENDING_FUEL' CHECK (status IN ('PENDING_FUEL','FINALIZED')),
  finalized_tank_id TEXT REFERENCES tanks(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_pending_underground_tanks_outlet_status ON pending_underground_tanks(outlet_id,status);
CREATE INDEX IF NOT EXISTS idx_pending_underground_tanks_template ON pending_underground_tanks(template_id);
