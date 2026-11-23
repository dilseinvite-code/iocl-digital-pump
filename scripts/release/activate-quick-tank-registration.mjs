/**
 * GitHub Actions production release for the two-input global-calibrated tank flow.
 * Additive migration 0041 ONLY. No existing tank, stock, chart, or fuel record updates.
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const NAME = 'iocl-digital-pump-manager';
const DB = 'iocl-pump-manager-d1';
const UUID = '305f76c6-c940-443f-86a9-33c309a55578';
const ACCOUNT = '93888554ef9d9e0b8c18b322683a9652';
const MIGRATION = '0041_simple_tank_registration.sql';
const token = process.env.CLOUDFLARE_API_TOKEN || '';
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || '';
function guard(ok, msg) { if (!ok) throw Error('RELEASE BLOCKED: ' + msg); }
function run(args) {
  return execFileSync('./node_modules/.bin/wrangler', args, {
    encoding: 'utf8', maxBuffer: 50 * 1024 * 1024,
    env: { ...process.env, CLOUDFLARE_SEND_METRICS: 'false' },
  });
}
function query(sql) {
  const json = JSON.parse(run(['d1', 'execute', DB, '--remote', '--config', 'wrangler.jsonc',
    '--command', sql, '--json']));
  guard(Array.isArray(json) && Array.isArray(json[0]?.results), 'D1 read-only query failed');
  return json[0].results;
}
async function cf(route) {
  const response = await fetch('https://api.cloudflare.com/client/v4/accounts/' + accountId + '/d1/database/' + UUID + route, {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
    signal: AbortSignal.timeout(35000),
  });
  guard(response.ok, 'Cloudflare metadata HTTP ' + response.status);
  const json = await response.json();
  guard(json?.success === true, 'Cloudflare identity or recovery point unavailable');
  return json.result;
}
const protectedTables = [
  'retail_outlets','products','outlet_products','tanks','tank_calibration_charts',
  'tank_calibration_points','global_tank_calibration_templates','global_tank_calibration_template_points',
  'tank_stock_readings','fuel_receipts','fuel_receipt_tank_lines',
];
function captureCounts() {
  const out = {};
  for (const table of protectedTables) {
    const rows = query('SELECT COUNT(*) AS count FROM "' + table + '"');
    out[table] = Number(rows[0]?.count);
    guard(Number.isInteger(out[table]), 'Could not verify count of ' + table);
  }
  return out;
}
try {
  console.log('[1/5] Verify target, D1 recovery bookmark, and migration allowlist.');
  guard(token.length >= 12 && accountId === ACCOUNT, 'Cloudflare account mismatch or missing token');
  const config = JSON.parse(fs.readFileSync('wrangler.jsonc', 'utf8'));
  guard(config.name === NAME && config.vars?.ENVIRONMENT === 'production' &&
    config.d1_databases?.length === 1 &&
    config.d1_databases[0].database_id === UUID &&
    config.d1_databases[0].database_name === DB, 'Unexpected Worker or D1 target');
  const db = await cf('');
  guard(db.uuid === UUID && db.name === DB && db.version === 'production', 'D1 identity mismatch');
  const bookmark = await cf('/time_travel/bookmark');
  guard(typeof bookmark?.bookmark === 'string' && bookmark.bookmark.length >= 20, 'No D1 recovery bookmark');
  guard(fs.existsSync('migrations/' + MIGRATION), 'Expected additive migration missing');

  console.log('[2/5] Capture protected-table counts. Never replace active charts.');
  const before = captureCounts();
  const applied = query("SELECT COUNT(*) AS count FROM d1_migrations WHERE name='" + MIGRATION + "'")[0]?.count;
  guard(applied === 0 || applied === 1, 'Migration tracking must be 0 or 1');
  if (applied === 0) {
    console.log('[3/5] Apply only the additive table-creation migration 0041.');
    run(['d1', 'execute', DB, '--remote', '--config', 'wrangler.jsonc',
      '--file', 'migrations/' + MIGRATION, '--yes']);
    const names = query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('global_tank_capacity_defaults','pending_underground_tanks') ORDER BY name");
    guard(names.length === 2, 'New registration tables were not created');
    run(['d1', 'execute', DB, '--remote', '--config', 'wrangler.jsonc',
      '--command', "INSERT OR IGNORE INTO d1_migrations (name) VALUES ('" + MIGRATION + "')", '--yes']);
  } else {
    console.log('[3/5] Migration already recorded; skipping.');
  }

  console.log('[4/5] Deploy Worker code; no data seed or destructive migration.');
  const tables = query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('global_tank_capacity_defaults','pending_underground_tanks')");
  guard(tables.length === 2, 'Required new tables missing before deploy');
  run(['deploy', '--config', 'wrangler.jsonc']);

  console.log('[5/5] Ensure all protected legacy table counts stayed unchanged.');
  const after = captureCounts();
  guard(protectedTables.every(name => before[name] === after[name]), 'Existing operational table counts changed; investigate!');
  console.log('SUCCESS: Two-field registration Worker deployed, migration 0041 applied.');
  console.log('Existing tanks, stock, calibration histories and fuel records not modified by release.');
} catch (e) {
  console.error('STOPPED: ' + (e instanceof Error ? e.message : 'Unknown release failure'));
  process.exitCode = 1;
}
