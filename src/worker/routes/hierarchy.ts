import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../../db';
import { HierarchyRepository } from '../repositories/hierarchyRepository';
import { OutletRepository } from '../repositories/outletRepository';
import { AuditRepository } from '../repositories/auditRepository';
import { requireAuth, AppContext, EnvBindings } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { ScopeService } from '../services/scopeService';
import { StateSchema, DivisionSchema, SalesAreaSchema } from '../../shared/validators';
import { PERMISSIONS } from '../../shared/constants';

const hierarchy = new Hono<{ Bindings: EnvBindings }>();

hierarchy.use('*', requireAuth as any);

// States - Safe Ancestor Visibility for Navigation & Breadcrumbs
hierarchy.get('/states', async (c: AppContext) => {
  const db = getDb(c.env.DB);
  const repo = new HierarchyRepository(db);
  const outletRepo = new OutletRepository(db);
  const allStates = await repo.listStates();

  if (c.var.user.isGlobalScope) {
    return c.json({ success: true, data: allStates, error: null });
  }

  // Derive visible state IDs (includes assigned states and ancestor states for child scopes)
  const visibleStateIds = await ScopeService.getVisibleStateIds(c.var.user, repo, outletRepo);
  const filtered = allStates.filter(st => visibleStateIds.includes(st.id));

  return c.json({
    success: true,
    data: filtered,
    error: null,
  });
});

hierarchy.post('/states', requirePermission(PERMISSIONS.HIERARCHY_WRITE) as any, async (c: AppContext) => {
  if (!c.var.user.isGlobalScope) {
    return c.json({ success: false, data: null, error: { code: 'FORBIDDEN', message: 'Only GLOBAL accounts can register new State Offices.' } }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const parseResult = StateSchema.safeParse(body);

  if (!parseResult.success) {
    return c.json({
      success: false,
      data: null,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid state payload', details: parseResult.error.flatten() },
    }, 400);
  }

  const db = getDb(c.env.DB);
  const repo = new HierarchyRepository(db);
  const auditRepo = new AuditRepository(db);

  const nowIso = new Date().toISOString();
  const created = await repo.createState({
    id: `st-${crypto.randomUUID()}`,
    code: parseResult.data.code.toUpperCase(),
    name: parseResult.data.name,
    status: parseResult.data.status,
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  await auditRepo.logAction({
    id: `aud-${crypto.randomUUID()}`,
    userId: c.var.user.user.id,
    action: 'STATE_CREATE',
    entityType: 'STATE',
    entityId: created.id,
    newValue: created as unknown as Record<string, unknown>,
    ipAddress: c.req.header('cf-connecting-ip') || null,
    userAgent: c.req.header('user-agent') || null,
    createdAt: nowIso,
  });

  return c.json({ success: true, data: created, error: null }, 201);
});

// Divisions - Safe Ancestor Visibility
hierarchy.get('/divisions', async (c: AppContext) => {
  const stateId = c.req.query('stateId');
  const db = getDb(c.env.DB);
  const repo = new HierarchyRepository(db);
  const outletRepo = new OutletRepository(db);
  const allDivisions = await repo.listDivisions(stateId);

  if (c.var.user.isGlobalScope) {
    return c.json({ success: true, data: allDivisions, error: null });
  }

  const visibleDivIds = await ScopeService.getVisibleDivisionIds(c.var.user, repo, outletRepo);
  const filtered = allDivisions.filter(div => visibleDivIds.includes(div.id));

  return c.json({
    success: true,
    data: filtered,
    error: null,
  });
});

hierarchy.post('/divisions', requirePermission(PERMISSIONS.HIERARCHY_WRITE) as any, async (c: AppContext) => {
  const body = await c.req.json().catch(() => ({}));
  const parseResult = DivisionSchema.safeParse(body);

  if (!parseResult.success) {
    return c.json({
      success: false,
      data: null,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid division payload', details: parseResult.error.flatten() },
    }, 400);
  }

  const db = getDb(c.env.DB);
  const repo = new HierarchyRepository(db);
  const auditRepo = new AuditRepository(db);

  // STRICT OPERATIONAL AUTHORIZATION: Visible ancestor does NOT grant creation rights
  if (!await ScopeService.canAccessState(c.var.user, parseResult.data.stateId)) {
    return c.json({ success: false, data: null, error: { code: 'FORBIDDEN', message: 'Cannot register Divisional Office outside your assigned State.' } }, 403);
  }

  const parentState = await repo.findStateById(parseResult.data.stateId);
  if (!parentState) {
    return c.json({
      success: false,
      data: null,
      error: { code: 'INVALID_PARENT', message: 'Parent State Office does not exist.' },
    }, 400);
  }

  const nowIso = new Date().toISOString();
  const created = await repo.createDivision({
    id: `div-${crypto.randomUUID()}`,
    stateId: parseResult.data.stateId,
    code: parseResult.data.code.toUpperCase(),
    name: parseResult.data.name,
    status: parseResult.data.status,
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  await auditRepo.logAction({
    id: `aud-${crypto.randomUUID()}`,
    userId: c.var.user.user.id,
    action: 'DIVISION_CREATE',
    entityType: 'DIVISION',
    entityId: created.id,
    newValue: created as unknown as Record<string, unknown>,
    ipAddress: c.req.header('cf-connecting-ip') || null,
    userAgent: c.req.header('user-agent') || null,
    createdAt: nowIso,
  });

  return c.json({ success: true, data: created, error: null }, 201);
});

// Sales Areas - Safe Ancestor Visibility
hierarchy.get('/sales-areas', async (c: AppContext) => {
  const divisionId = c.req.query('divisionId');
  const db = getDb(c.env.DB);
  const repo = new HierarchyRepository(db);
  const outletRepo = new OutletRepository(db);
  const allSalesAreas = await repo.listSalesAreas(divisionId);

  if (c.var.user.isGlobalScope) {
    return c.json({ success: true, data: allSalesAreas, error: null });
  }

  const visibleSaIds = await ScopeService.getVisibleSalesAreaIds(c.var.user, repo, outletRepo);
  const filtered = allSalesAreas.filter(sa => visibleSaIds.includes(sa.id));

  return c.json({
    success: true,
    data: filtered,
    error: null,
  });
});

hierarchy.post('/sales-areas', requirePermission(PERMISSIONS.HIERARCHY_WRITE) as any, async (c: AppContext) => {
  const body = await c.req.json().catch(() => ({}));
  const parseResult = SalesAreaSchema.safeParse(body);

  if (!parseResult.success) {
    return c.json({
      success: false,
      data: null,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid sales area payload', details: parseResult.error.flatten() },
    }, 400);
  }

  const db = getDb(c.env.DB);
  const repo = new HierarchyRepository(db);
  const auditRepo = new AuditRepository(db);

  // STRICT OPERATIONAL AUTHORIZATION
  if (!await ScopeService.canAccessDivision(c.var.user, parseResult.data.divisionId, repo)) {
    return c.json({ success: false, data: null, error: { code: 'FORBIDDEN', message: 'Cannot register Sales Area outside your assigned Divisional Office.' } }, 403);
  }

  const parentDiv = await repo.findDivisionById(parseResult.data.divisionId);
  if (!parentDiv) {
    return c.json({
      success: false,
      data: null,
      error: { code: 'INVALID_PARENT', message: 'Parent Divisional Office does not exist.' },
    }, 400);
  }

  const nowIso = new Date().toISOString();
  const created = await repo.createSalesArea({
    id: `sa-${crypto.randomUUID()}`,
    divisionId: parseResult.data.divisionId,
    code: parseResult.data.code.toUpperCase(),
    name: parseResult.data.name,
    status: parseResult.data.status,
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  await auditRepo.logAction({
    id: `aud-${crypto.randomUUID()}`,
    userId: c.var.user.user.id,
    action: 'SALES_AREA_CREATE',
    entityType: 'SALES_AREA',
    entityId: created.id,
    newValue: created as unknown as Record<string, unknown>,
    ipAddress: c.req.header('cf-connecting-ip') || null,
    userAgent: c.req.header('user-agent') || null,
    createdAt: nowIso,
  });

  return c.json({ success: true, data: created, error: null }, 201);
});


// Edit labels/codes in place. Changing parent IDs, unit status, or scope
// assignments is deliberately a separate administrative operation.
const hierarchyEditSchema = z.object({
  code: z.string().trim().min(2).max(10).toUpperCase(),
  name: z.string().trim().min(2),
  expectedUpdatedAt: z.string().min(1),
}).strict();

const hierarchyEditTargets = {
  states: { table: 'states', entity: 'STATE' },
  divisions: { table: 'divisions', entity: 'DIVISION' },
  'sales-areas': { table: 'sales_areas', entity: 'SALES_AREA' },
} as const;

function editHierarchyUnit(kind: keyof typeof hierarchyEditTargets) {
  return async (c: AppContext) => {
    const id = c.req.param('id')!;
    const repo = new HierarchyRepository(getDb(c.env.DB));
    const target = hierarchyEditTargets[kind];
    // Use strict operational scope checks, not the wider ancestor visibility
    // granted by the GET endpoints for navigation.
    const current = kind === 'states' ? await repo.findStateById(id)
      : kind === 'divisions' ? await repo.findDivisionById(id)
      : await repo.findSalesAreaById(id);
    if (!current) return c.json({ success: false, data: null, error: { code: 'NOT_FOUND', message: 'Hierarchy unit not found.' } }, 404);
    const allowed = kind === 'states' ? await ScopeService.canAccessState(c.var.user, id)
      : kind === 'divisions' ? await ScopeService.canAccessDivision(c.var.user, id, repo)
      : await ScopeService.canAccessSalesArea(c.var.user, id, repo);
    if (!allowed) return c.json({ success: false, data: null, error: { code: 'FORBIDDEN', message: 'Cannot edit a hierarchy unit outside your assigned scope.' } }, 403);

    const parsed = hierarchyEditSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Enter a valid code (2–10 characters) and name (at least 2 characters). Only code and name may be edited.', details: parsed.error.flatten() } }, 400);
    const { code, name, expectedUpdatedAt } = parsed.data;
    if (current.updatedAt !== expectedUpdatedAt) return c.json({ success: false, data: null, error: { code: 'STALE_HIERARCHY_UNIT', message: 'This unit was updated elsewhere. Close the form, refresh the list and try again.' } }, 409);
    if (current.code === code && current.name === name) return c.json({ success: true, data: current, error: null });
    // Table names come only from the static allowlist above; all request values
    // are bound parameters. Existing IDs and ancestry are never written.
    const d1 = c.env.DB;
    const duplicate = await d1.prepare(`SELECT id FROM ${target.table} WHERE upper(trim(code)) = ? AND id <> ? LIMIT 1`).bind(code, id).first();
    if (duplicate) return c.json({ success: false, data: null, error: { code: 'DUPLICATE_CODE', message: 'Another unit of this type already uses that code.' } }, 409);
    const priorTime = Date.parse(current.updatedAt);
    const now = new Date(Math.max(Date.now(), Number.isFinite(priorTime) ? priorTime + 1 : 0)).toISOString();
    const updated = { ...current, code, name, updatedAt: now };
    try {
      // D1 batch is transactional: the edit and its audit entry either both
      // succeed, or neither does. A stale edit produces no audit row.
      const auditId = `aud-${crypto.randomUUID()}`;
      const results = await d1.batch([
        d1.prepare(`INSERT INTO audit_logs
          (id,user_id,action,entity_type,entity_id,old_value_json,new_value_json,ip_address,user_agent,created_at)
          SELECT ?,?,?,?,?,?,?,?,?,? FROM ${target.table} AS unit
          WHERE unit.id=? AND unit.updated_at=? AND NOT EXISTS
            (SELECT 1 FROM ${target.table} WHERE upper(trim(code))=? AND id<>?)
          RETURNING id`)
          .bind(auditId, c.var.user.user.id, target.entity + '_UPDATE', target.entity, id,
            JSON.stringify(current), JSON.stringify(updated),
            c.req.header('cf-connecting-ip') || null, c.req.header('user-agent') || null, now,
            id, expectedUpdatedAt, code, id),
        d1.prepare(`UPDATE ${target.table} SET code=?, name=?, updated_at=?
          WHERE id=? AND updated_at=? AND EXISTS (SELECT 1 FROM audit_logs WHERE id=?)
          RETURNING id`).bind(code, name, now, id, expectedUpdatedAt, auditId),
      ]);
      if (results[0].results?.length !== 1 || results[1].results?.length !== 1) return c.json({ success: false, data: null, error: { code: 'HIERARCHY_CONFLICT', message: 'The unit or code changed while saving. Close the form, refresh and try again.' } }, 409);
      return c.json({ success: true, data: updated, error: null });
    } catch (error) {
      const message = String(error) + ' ' + String((error as Error)?.cause || '');
      if (/UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE/i.test(message)) return c.json({ success: false, data: null, error: { code: 'DUPLICATE_CODE', message: 'Another unit of this type already uses that code.' } }, 409);
      return c.json({ success: false, data: null, error: { code: 'HIERARCHY_UPDATE_FAILED', message: 'Unable to save this hierarchy unit. Refresh the list before trying again.' } }, 503);
    }
  };
}
hierarchy.patch('/states/:id', requirePermission(PERMISSIONS.HIERARCHY_WRITE) as any, editHierarchyUnit('states'));
hierarchy.patch('/divisions/:id', requirePermission(PERMISSIONS.HIERARCHY_WRITE) as any, editHierarchyUnit('divisions'));
hierarchy.patch('/sales-areas/:id', requirePermission(PERMISSIONS.HIERARCHY_WRITE) as any, editHierarchyUnit('sales-areas'));

export default hierarchy;
