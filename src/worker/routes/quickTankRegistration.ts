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
import { scannedReferenceSpec, reviewScannedCalibrationCandidate } from '../../shared/scannedCalibrationReference';
import {isOperatorSuppliedReference,isOperatorSuppliedSourceMetadata} from '../../shared/operatorSuppliedCalibration';

export const quickTankRegistrationRoutes = new Hono<{ Bindings: EnvBindings }>();
quickTankRegistrationRoutes.use('*', requireAuth as any);

const registerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  capacityLitres: z.number().int().refine(isGlobalTankCapacity, 'Select 10, 15, 20 or 50 KL'),
}).strict();
const defaultSchema = z.object({ templateId: z.string().min(1), acknowledgedWarnings: z.boolean().optional() }).strict();
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
  const warnings: string[] = [];
  // +15% is a recorded warning for reference/DRAFT use only.
  // This function does not authorize ACTIVE/APPROVED tank charts or fuel stock operations.
  if (maxVolume > globalCalibrationMaxLitres(template.nominalCapacityLitres) + 0.000001) {
    warnings.push('Source chart exceeds the nominal capacity +15% threshold. Draft/reference use only.');
  }
  // The supplied PDF and older digital workbook have differing sample readings.
  // Report this difference honestly; the admin may acknowledge using the existing
  // digital draft values, which are NOT claimed to be an exact PDF transcription.
  if (scannedReferenceSpec(template.nominalCapacityLitres)) {
    const review = reviewScannedCalibrationCandidate({
      code: template.code,
      nominalCapacityLitres: template.nominalCapacityLitres,
      tankDiameterMm: template.tankDiameterMm,
      tankLengthMm: template.tankLengthMm,
      maxDipMm: template.maxDipMm,
      points: points.map(p=>({
        dipMm:p.dipMillimetresMilliunits / 1000,
        volumeLitres:p.volumeMilliunits / 1000,
      })),
    });
    if (!review.passed) {
      warnings.push('Saved digital readings do not match all sampled readings or dimensions on the supplied scanned chart. This selection uses the stored digital draft values, not an exact transcription of the PDF.');
    }
  }
  return { template, points, maxVolume, warnings };
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
      return errResponse(c, 'INVALID_GLOBAL_CHART', 'Choose a saved chart with valid numerical dip and volume readings for this capacity.'); 
    }
    if (isOperatorSuppliedSourceMetadata(selected.template) &&
        !isOperatorSuppliedReference(selected.template,selected.points)) {
      return errResponse(c,'SUPPLIED_CHART_RECONCILIATION_REQUIRED',
        'The stored Excel chart differs from the supplied PDF checkpoints. Correct the numerical values before making this the default for new tanks.',409);
    }
    if (selected.warnings.length && parsed.data.acknowledgedWarnings !== true) {
      return errResponse(c, 'WARNING_ACKNOWLEDGEMENT_REQUIRED', selected.warnings.join(' '), 409);
    }
    const now = new Date().toISOString();
    await (db as any).batch([
      db.insert(schema.globalTankCapacityDefaults)
        .values({ capacityLitres: capacity, templateId: selected.template.id, updatedAt: now, updatedBy: c.var.user!.user.id })
        .onConflictDoUpdate({ target: schema.globalTankCapacityDefaults.capacityLitres,
          set: { templateId: selected.template.id, updatedAt: now, updatedBy: c.var.user!.user.id } }),
      db.insert(schema.auditLogs).values({
        id: 'aud-' + crypto.randomUUID(), userId: c.var.user!.user.id,
        action: 'GLOBAL_TANK_DEFAULT_SET', entityType: 'GLOBAL_TANK_CAPACITY_DEFAULT',
        entityId: String(capacity), newValueJson: JSON.stringify({ capacityLitres: capacity, templateId: selected.template.id, acknowledgedWarnings: parsed.data.acknowledgedWarnings === true, warnings: selected.warnings }),
        ipAddress: c.req.header('cf-connecting-ip') || null,
        userAgent: c.req.header('user-agent') || null, createdAt: now,
      }),
    ]);
    return c.json({ success: true, data: { capacityLitres: capacity, templateId: selected.template.id, warnings: selected.warnings }, error: null });
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
    const suppliedCode=capacityLitres===10000?'EXCEL_10KL_REFERENCE':
      capacityLitres===20000?'EXCEL_20KL_REFERENCE':null;
    const suppliedTemplate=suppliedCode?allTemplates.find(t=>t.code===suppliedCode):null;
    // Prefer the operator's actual 10/20 KL reference when present, not a different standard.
    if(suppliedTemplate){
      selected=await validatedReference(db,suppliedTemplate.id);
      if(!selected||!isOperatorSuppliedReference(selected.template,selected.points)){
        return errResponse(c,'SUPPLIED_CHART_INCOMPLETE',
          'The operator-provided chart needs complete numerical readings. A different standard chart will not be substituted.',409);
      }
    }else if (defaults.length) {
      selected = await validatedReference(db, defaults[0].templateId);
      if (!selected || selected.template.nominalCapacityLitres !== capacityLitres) {
        return errResponse(c, 'DEFAULT_CHART_INVALID', 'The saved default chart has invalid or missing numerical dip readings. Correct its draft before using it.', 409);
      }
    } else {
      const eligible = [];
      for (const candidate of allTemplates) {
        const checked = await validatedReference(db, candidate.id);
        if (checked) eligible.push(checked);
      }
      if (eligible.length !== 1 || (eligible[0]?.warnings.length ?? 0) > 0) {
        return errResponse(c, eligible.length ? 'DEFAULT_CHART_REQUIRED' : 'CALIBRATION_NOT_FOUND',
          eligible.length ? 'Select a default chart in Calibration Charts once. Acknowledge any +15% or scanned-source difference warnings before using it as a draft reference.' :
            'No usable numerical dip-to-volume chart exists for this capacity. A scanned PDF alone does not contain the structured rows needed by the calculator.', 409);
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
    await (db as any).batch([
      db.insert(schema.pendingUndergroundTanks).values(row),
      db.insert(schema.auditLogs).values({
        id: 'aud-' + crypto.randomUUID(), userId: c.var.user!.user.id,
        action: 'TANK_REGISTRATION_PENDING_CREATE', entityType: 'PENDING_TANK',
        entityId: row.id, newValueJson: JSON.stringify({ name, capacityLitres, templateId: row.templateId, status: row.status }),
        ipAddress: c.req.header('cf-connecting-ip') || null,
        userAgent: c.req.header('user-agent') || null, createdAt: now,
      }),
    ]);
    return c.json({ success: true, data: { ...row, templateName: selected.template.name,
      message: 'Tank setup saved with linked numerical calibration. Select a fuel grade to complete setup; the tank remains inactive until activated.' }, error: null }, 201);
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
    // Deterministic IDs make concurrent finalizations safe: duplicate requests
    // collide on the tank primary key and the full D1 batch rolls back.
    const id = 'tank-' + pendingId;
    const chartId = 'tcc-' + pendingId;
    const safeFillProvisional = Math.round(pending.capacityLitres * 0.9);
    // Reuse complete operator-supplied numeric data without a redundant
    // template approval step. Physical tank status remains INACTIVE.
    const operatorSupplied=isOperatorSuppliedReference(source.template,source.points);
    const inheritsApprovedGlobalChart =
      (source.template.status === 'APPROVED' || source.template.status === 'ACTIVE') &&
      source.warnings.length === 0 &&
      !source.template.requiresEngineeringReview &&
      !source.template.requiresDimensionVerification;
    const chartStatus=operatorSupplied||inheritsApprovedGlobalChart?'ACTIVE':'DRAFT';
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
        revisionNumber: 1, status: chartStatus, chartUnitDip: 'MM', chartUnitVolume: 'LITRES',
        tankDiameterMmMilliunits: source.template.tankDiameterMmMilliunits,
        tankLengthMmMilliunits: source.template.tankLengthMmMilliunits,
        maxDipMmMilliunits: source.template.maxDipMmMilliunits,
        chartCapacityMilliunits: pending.capacityLitres * 1000,
        sourceFileName: source.template.sourceFileName || 'global-chart',
        referenceDocument: source.template.referenceDocument || null,
        notes: operatorSupplied
          ? 'Operator-supplied complete numerical chart reused without repeated approval. Scanned/digital differences remain on the source record.'
          : inheritsApprovedGlobalChart
            ? 'Automatically linked to an approved chart; tank remains INACTIVE.'
            : 'Reference chart linked; tank remains INACTIVE.',
        effectiveFrom: now.slice(0, 10),
        approvedBy: inheritsApprovedGlobalChart ? (source.template.approvedBy || c.var.user!.user.id) : null,
        approvedAt: inheritsApprovedGlobalChart ? (source.template.approvedAt || now) : null,
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
    // Cloudflare D1 accepts at most 100 bound parameters per SQL statement.
    // Each calibration point inserts 7 bound columns (id, chartId, tankId,
    // dip, volume, createdAt, createdBy). 12 rows = 84 parameters.
    // Keep all chunks in the same atomic D1 batch; a failure rolls back
    // the tank, its chart, every reading, and the pending-status update.
    const POINTS_PER_D1_INSERT = 12;
    for (let offset = 0; offset < points.length; offset += POINTS_PER_D1_INSERT) {
      stmts.push(db.insert(schema.tankCalibrationPoints).values(points.slice(offset, offset + POINTS_PER_D1_INSERT)));
    }
    stmts.push(db.update(schema.pendingUndergroundTanks).set({
      status: 'FINALIZED', finalizedTankId: id, updatedAt: now,
    }).where(and(eq(schema.pendingUndergroundTanks.id, pendingId),
      eq(schema.pendingUndergroundTanks.status, 'PENDING_FUEL'))));
    stmts.push(db.insert(schema.auditLogs).values({
      id: 'aud-' + crypto.randomUUID(), userId: c.var.user!.user.id,
      action: 'TANK_REGISTER_FINALIZE', entityType: 'TANK', entityId: id,
      newValueJson: JSON.stringify({ pendingId, name: pending.name, tankNumber: nextNumber,
        capacityLitres: pending.capacityLitres, productId: parsed.data.productId,
        templateId: source.template.id, calibrationStatus: chartStatus,
        inheritedGlobalApproval: inheritsApprovedGlobalChart, operatorSuppliedReference:operatorSupplied, tankStatus: 'INACTIVE' }),
      ipAddress: c.req.header('cf-connecting-ip') || null,
      userAgent: c.req.header('user-agent') || null, createdAt: now,
    }));
    try {
      // D1 batch is atomic: never leave a tank without its draft chart after a failed mapping.
      await (db as any).batch(stmts);
    } catch (error) {
      // No partial tank records should survive an unsuccessful atomic batch.
      // Do not expose SQL statements or their bound values to the client.
      const reason = error instanceof Error ? error.message : String(error);
      const duplicateNumber = /unique constraint failed.*tanks\.(outlet_id|tank_number)|idx_tanks_outlet_tank_num/i.test(reason);
      const kind = duplicateNumber ? 'DUPLICATE_TANK_NUMBER'
        : /too many sql variables|too many bound parameters/i.test(reason) ? 'D1_BIND_LIMIT'
        : /foreign key constraint failed/i.test(reason) ? 'FOREIGN_KEY'
        : 'UNKNOWN';
      console.error('[QUICK_TANK_FINALIZE_FAILED]', {
        outletId, pendingId, chartPointCount: points.length, tankNumber: nextNumber, kind,
      });
      return duplicateNumber
        ? errResponse(c, 'TANK_NUMBER_CONFLICT', 'Another tank already uses this number. Refresh and retry the pending registration.', 409)
        : errResponse(c, 'TANK_FINALIZATION_FAILED', 'Could not save the tank and calibration together. Your pending registration remains available. Please retry after refreshing; if it continues, contact support.', 500);
    }
    return c.json({ success: true, data: {
      id, tankNumber: nextNumber, name: pending.name, status: 'INACTIVE',
      calibrationStatus: chartStatus, chartId, pointsCount: source.points.length,
      message: operatorSupplied
        ? 'Your supplied 10/20 KL chart is linked and ready. Set tank status when needed.'
        : inheritsApprovedGlobalChart
          ? 'Approved calibration linked; tank is INACTIVE until used.'
          : 'Reference chart linked. Complete numerical data is required for operation.',
    }, error: null }, 201);
  }
);

export default quickTankRegistrationRoutes;
