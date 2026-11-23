import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../../db';
import * as schema from '../../db/schema';
import { PumpRepository } from '../repositories/pumpRepository';
import { OutletRepository } from '../repositories/outletRepository';
import { ScopeService } from '../services/scopeService';
import { requireAuth, type AppContext, type EnvBindings } from '../middleware/auth';
import { requirePermission } from '../middleware/permission';
import { PERMISSIONS } from '../../shared/constants';
import { globalCalibrationMaxLitres, isGlobalTankCapacity } from '../../shared/globalTankTypes';

export const quickTankRegistrationRoutes = new Hono<{ Bindings: EnvBindings }>();
quickTankRegistrationRoutes.use('*', requireAuth as any);

const registerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  capacityLitres: z.number().int().refine(isGlobalTankCapacity, 'Select 10, 15, 20 or 50 KL'),
}).strict();
const defaultSchema = z.object({ templateId: z.string().min(1) }).strict();
const finalizeSchema = z.object({ productId: z.string().min(1) }).strict();

const errResponse = (c: AppContext, code: string, message: string, status: 400 | 403 | 404 | 409 | 500 = 400) =>
  c.json({ success: false, data: null, error: { code, message } }, status);

async function canAccessOutlet(c: AppContext, outletId: string) {
  return ScopeService.canAccessOutlet(c.var.user!, outletId, new OutletRepository(getDb(c.env.DB)));
}

/** This check governs REFERENCE/DRAFT use only, not operational activation. */
async function validatedReference(db: ReturnType<typeof getDb>, id: string) {
  const repo = new PumpRepository(db);
  const template = await repo.findGlobalTankCalibrationTemplateById(id);
  if (!template || !isGlobalTankCapacity(template.nominalCapacityLitres) ||
      ['ARCHIVED', 'SUPERSEDED'].includes(template.status)) return null;
  const points = await repo.listGlobalTankCalibrationTemplatePoints(template.id);
  if (points.length < 2) return null;
  if (points[0].dipMillimetresMilliunits !== 0 || points[0].volumeMilliunits !== 0) return null;
  let prevDip = -1;
  let prevVolume = -1;
  for (const pt of points) {
    if (!Number.isFinite(pt.dipMillimetresMilliunits) || !Number.isFinite(pt.volumeMilliunits) ||
        pt.dipMillimetresMilliunits <= prevDip || pt.volumeMilliunits < prevVolume ||
        pt.dipMillimetresMilliunits < 0 || pt.volumeMilliunits < 0) return null;
    prevDip = pt.dipMillimetresMilliunits;
    prevVolume = pt.volumeMilliunits;
  }
  const maxVolume = prevVolume / 1000;
  if (maxVolume > globalCalibrationMaxLitres(template.nominalCapacityLitres) + 0.000001) return null;
  return { template, points, maxVolume };
}

quickTankRegistrationRoutes.get(
  '/global-tank-defaults',
  requirePermission(PERMISSIONS.TANK_CALIBRATION_READ) as any,
  async (c: AppContext) => {
    const db = getDb(c.env.DB);
    const rows = await db.select().from(schema.globalTankCapacityDefaults);
    return c.json({ success: true, data: rows, error: null });
  }
);

quickTankRegistrationRoutes.put(
  '/global-tank-defaults/:capacity',
  requirePermission(PERMISSIONS.TANK_CALIBRATION_WRITE) as any,
  async (c: AppContext) => {
    const capacity = Number(c.req.param('capacity'));
    if (!isGlobalTankCapacity(capacity)) return errResponse(c, 'INVALID_CAPACITY', 'Only 10, 15, 20 and 50 KL are supported');
    const parsed = defaultSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return errResponse(c, 'VALIDATION_ERROR', 'Choose a saved calibration chart');
    const db = getDb(c.env.DB);
    const selected = await validatedReference(db, parsed.data.templateId);
    if (!selected || selected.template.nominalCapacityLitres !== capacity) {
      return errResponse(c, 'INVALID_GLOBAL_CHART', 'The chosen chart must have valid readings within the +15% limit and match this tank capacity');
    }
    const now = new Date().toISOString();
    await db.insert(schema.globalTankCapacityDefaults)
      .values({ capacityLitres: capacity, templateId: selected.template.id, updatedAt: now, updatedBy: c.var.user!.user.id })
      .onConflictDoUpdate({ target: schema.globalTankCapacityDefaults.capacityLitres,
        set: { templateId: selected.template.id, updatedAt: now, updatedBy: c.var.user!.user.id } });
    return c.json({ success: true, data: { capacityLitres: capacity, templateId: selected.template.id }, error: null });
  }
);

quickTankRegistrationRoutes.get(
  '/outlets/:outletId/pending-tanks',
  requirePermission(PERMISSIONS.TANKS_READ) as any,
  async (c: AppContext) => {
    const outletId = c.req.param('outletId');
    if (!outletId || !await canAccessOutlet(c, outletId)) return errResponse(c, 'FORBIDDEN', 'Outlet access denied', 403);
    const rows = await getDb(c.env.DB).select().from(schema.pendingUndergroundTanks)
      .where(and(eq(schema.pendingUndergroundTanks.outletId, outletId),
        eq(schema.pendingUndergroundTanks.status, 'PENDING_FUEL')));
    return c.json({ success: true, data: rows, error: null });
  }
);

quickTankRegistrationRoutes.post(
  '/outlets/:outletId/tanks/quick-register',
  requirePermission(PERMISSIONS.TANKS_WRITE) as any,
  requirePermission(PERMISSIONS.TANK_CALIBRATION_READ) as any,
  async (c: AppContext) => {
    const outletId = c.req.param('outletId');
    if (!outletId || !await canAccessOutlet(c, outletId)) return errResponse(c, 'FORBIDDEN', 'Outlet access denied', 403);
    const parsed = registerSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return errResponse(c, 'VALIDATION_ERROR', 'Enter a tank name and select 10, 15, 20 or 50 KL');
    const { name, capacityLitres } = parsed.data;
    const db = getDb(c.env.DB);
    const repo = new PumpRepository(db);
    const defaults = await db.select().from(schema.globalTankCapacityDefaults)
      .where(eq(schema.globalTankCapacityDefaults.capacityLitres, capacityLitres)).limit(1);
    const allTemplates = await repo.listGlobalTankCalibrationTemplates({ nominalCapacityLitres: capacityLitres });
    let selected;
    if (defaults.length) {
      selected = await validatedReference(db, defaults[0].templateId);
      if (!selected || selected.template.nominalCapacityLitres !== capacityLitres) {
        return errResponse(c, 'DEFAULT_CHART_INVALID', 'Default calibration chart is no longer valid. Select a valid default in Calibration Charts.', 409);
      }
    } else {
      const eligible = [];
      for (const candidate of allTemplates) {
        const checked = await validatedReference(db, candidate.id);
        if (checked) eligible.push(checked);
      }
      if (eligible.length !== 1) {
        return errResponse(c, eligible.length ? 'DEFAULT_CHART_REQUIRED' : 'CALIBRATION_NOT_FOUND',
          eligible.length ? 'Multiple valid charts exist for this capacity. Set one default once under Calibration Charts.' :
            'No valid global calibration chart is saved for this capacity. Upload it once under Calibration Charts.', 409);
      }
      selected = eligible[0];
    }

    const now = new Date().toISOString();
    const row = {
      id: 'pgt-' + crypto.randomUUID(),
      outletId, name, capacityLitres,
      templateId: selected.template.id,
      status: 'PENDING_FUEL' as const,
      finalizedTankId: null,
      createdAt: now, updatedAt: now, createdBy: c.var.user!.user.id,
    };
    await db.insert(schema.pendingUndergroundTanks).values(row);
    return c.json({ success: true, data: { ...row, templateName: selected.template.name,
      message: 'Registered with global calibration as a non-operational draft. Map the fuel grade separately to create an operational tank.' }, error: null }, 201);
  }
);

quickTankRegistrationRoutes.post(
  '/outlets/:outletId/pending-tanks/:id/finalize',
  requirePermission(PERMISSIONS.TANKS_WRITE) as any,
  requirePermission(PERMISSIONS.TANK_CALIBRATION_WRITE) as any,
  async (c: AppContext) => {
    const outletId = c.req.param('outletId');
    const pendingId = c.req.param('id');
    if (!pendingId) return errResponse(c, 'BAD_REQUEST', 'Pending tank ID is required');
    if (!outletId || !await canAccessOutlet(c, outletId)) return errResponse(c, 'FORBIDDEN', 'Outlet access denied', 403);
    const parsed = finalizeSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return errResponse(c, 'VALIDATION_ERROR', 'Select a mapped fuel grade');
    const db = getDb(c.env.DB);
    const repo = new PumpRepository(db);
    const [pending] = await db.select().from(schema.pendingUndergroundTanks)
      .where(and(eq(schema.pendingUndergroundTanks.id, pendingId),
        eq(schema.pendingUndergroundTanks.outletId, outletId))).limit(1);
    if (!pending) return errResponse(c, 'NOT_FOUND', 'Pending tank registration not found', 404);
    if (pending.status !== 'PENDING_FUEL') return errResponse(c, 'ALREADY_FINALIZED', 'This registration was already finalized', 409);
    const product = await repo.findProductById(parsed.data.productId);
    const mapped = await repo.findOutletProduct(outletId, parsed.data.productId);
    if (!product || product.unit !== 'LITRE' || product.status !== 'ACTIVE' ||
        !mapped || mapped.status !== 'ACTIVE') {
      return errResponse(c, 'INVALID_PRODUCT', 'Select an active liquid fuel grade mapped to this outlet', 400);
    }
    const source = await validatedReference(db, pending.templateId);
    if (!source || source.template.nominalCapacityLitres !== pending.capacityLitres) {
      return errResponse(c, 'INVALID_GLOBAL_CHART', 'Saved calibration has become invalid. Correct it in Calibration Charts before mapping fuel.', 409);
    }
    const tanks = await repo.listTanksByOutlet(outletId);
    const nextNumber = tanks.reduce((n, tank) => Math.max(n, tank.tankNumber), 0) + 1;
    const now = new Date().toISOString();
    const id = 'tank-' + crypto.randomUUID();
    const chartId = 'tcc-' + crypto.randomUUID();
    const safeFillProvisional = Math.round(pending.capacityLitres * 0.9);
    const stmts: any[] = [
      db.insert(schema.tanks).values({
        id, outletId, tankNumber: nextNumber, name: pending.name,
        productId: parsed.data.productId, capacityLitres: pending.capacityLitres,
        // Not an approved safe-fill number. The tank remains INACTIVE until reviewed.
        safeFillCapacityLitres: safeFillProvisional, minimumOperatingLevelLitres: 0,
        status: 'INACTIVE', commissionedAt: null,
        createdAt: now, updatedAt: now, createdBy: c.var.user!.user.id,
      }),
      db.insert(schema.tankCalibrationCharts).values({
        id: chartId, tankId: id, sourceTemplateId: source.template.id,
        revisionNumber: 1, status: 'DRAFT', chartUnitDip: 'MM', chartUnitVolume: 'LITRES',
        tankDiameterMmMilliunits: source.template.tankDiameterMmMilliunits,
        tankLengthMmMilliunits: source.template.tankLengthMmMilliunits,
        maxDipMmMilliunits: source.template.maxDipMmMilliunits,
        chartCapacityMilliunits: pending.capacityLitres * 1000,
        sourceFileName: source.template.sourceFileName || 'global-chart',
        referenceDocument: source.template.referenceDocument || null,
        notes: 'Auto-linked as non-operational draft from saved global tank capacity chart; physical dimensions and safe-fill require review.',
        effectiveFrom: now.slice(0, 10), approvedBy: null, approvedAt: null,
        createdAt: now, createdBy: c.var.user!.user.id,
        updatedAt: now, updatedBy: c.var.user!.user.id,
      }),
    ];
    const points = source.points.map((p, i) => ({
      id: 'tcp-' + chartId + '-' + (i + 1), chartId, tankId: id,
      dipMillimetresMilliunits: p.dipMillimetresMilliunits,
      volumeMilliunits: p.volumeMilliunits,
      createdAt: now, createdBy: c.var.user!.user.id,
    }));
    for (let offset = 0; offset < points.length; offset += 75) {
      stmts.push(db.insert(schema.tankCalibrationPoints).values(points.slice(offset, offset + 75)));
    }
    stmts.push(db.update(schema.pendingUndergroundTanks).set({
      status: 'FINALIZED', finalizedTankId: id, updatedAt: now,
    }).where(and(eq(schema.pendingUndergroundTanks.id, pendingId),
      eq(schema.pendingUndergroundTanks.status, 'PENDING_FUEL'))));
    try {
      // D1 batch is atomic: never leave a tank without its draft chart after a failed mapping.
      await (db as any).batch(stmts);
    } catch {
      return errResponse(c, 'TANK_CREATE_CONFLICT', 'Could not finalize tank; check duplicate tank numbers or retry after refreshing.', 409);
    }
    return c.json({ success: true, data: {
      id, tankNumber: nextNumber, name: pending.name, status: 'INACTIVE',
      calibrationStatus: 'DRAFT', chartId, pointsCount: source.points.length,
      message: 'Tank created with a draft global chart. Review physical compatibility and safe-fill before activating.',
    }, error: null }, 201);
  }
);

export default quickTankRegistrationRoutes;
