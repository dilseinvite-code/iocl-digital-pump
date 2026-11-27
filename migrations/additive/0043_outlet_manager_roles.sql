-- Add only the two subordinate outlet-manager roles; never modify existing roles,
-- role permissions, users, outlet assignments, or operational records.
INSERT OR IGNORE INTO roles (id,code,name,description) VALUES
 ('role-dealer-manager','DEALER_MANAGER','Dealer Manager','Subordinate to Dealer; assigned-outlet operations'),
 ('role-csp-manager','CSP_MANAGER','CSP Manager','Subordinate to CSP; assigned-outlet operations');

-- Each new role receives the intersection of its parent's existing grants and
-- the approved day-to-day operational/reporting allowlist. No administrative,
-- master-data, financial approval, or permission-management grants.
INSERT OR IGNORE INTO role_permissions (role_id,permission_id)
SELECT manager.id, rp.permission_id
FROM roles parent
JOIN roles manager ON (parent.code='DEALER' AND manager.code='DEALER_MANAGER')
                  OR (parent.code='CSP' AND manager.code='CSP_MANAGER')
JOIN role_permissions rp ON rp.role_id=parent.id
JOIN permissions p ON p.id=rp.permission_id
WHERE p.code IN (
  'outlets.read',
  'hierarchy.read',
  'documents.read',
  'products.read',
  'outlet_products.read',
  'tanks.read',
  'dispensers.read',
  'nozzles.read',
  'shift_templates.read',
  'shifts.read',
  'shifts.open',
  'shifts.close',
  'meter_readings.read',
  'meter_readings.write',
  'tank_calibration.read',
  'tank_stock.read',
  'tank_stock.write',
  'fuel_receipts.read',
  'fuel_receipts.write',
  'quality.read',
  'quality.write',
  'stock_reconciliation.read',
  'cng_operations.read',
  'cng_operations.write',
  'lube_operations.read',
  'lube_inventory.write',
  'lube_sales.write',
  'equipment.read',
  'equipment_tickets.create',
  'hr.attendance.read',
  'hr.attendance.write',
  'hr.nozzle_assignment.write',
  'hr.uniform.read',
  'dg_log.read',
  'dg_log.write',
  'reports.read',
  'reports.generate',
  'product_prices.read',
  'credit_parties.read',
  'collections.read',
  'collections.write',
  'cash_handover.read',
  'cash_handover.write',
  'bank_deposits.read',
  'financial_reconciliation.read'
);
