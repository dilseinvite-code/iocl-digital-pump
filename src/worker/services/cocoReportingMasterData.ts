import { eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from '../../db/schema';
import { formatIndianCurrencyFromPaise, type LinkedModuleSummary } from '../../shared/cocoComplianceUtils';

async function legacySafe<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try { return await promise; } catch (err) {
    const cause = err instanceof Error && 'cause' in err ? String(err.cause) : '';
    if (/no such table/i.test(String(err) + ' ' + cause)) return fallback;
    throw err;
  }
}
export async function loadCocoReportMasterData(db: DrizzleD1Database<typeof schema>, outletId: string) {
  const [agreements, claims, settlements, assets, inspections] = await Promise.all([
    legacySafe(db.select().from(schema.cocoAgreementDetails).where(eq(schema.cocoAgreementDetails.outletId, outletId)).all(), []),
    legacySafe(db.select().from(schema.cocoExpenseClaims).where(eq(schema.cocoExpenseClaims.outletId, outletId)).all(), []),
    legacySafe(db.select().from(schema.cocoClaimSettlements).where(eq(schema.cocoClaimSettlements.outletId, outletId)).all(), []),
    db.select().from(schema.equipmentAssets).where(eq(schema.equipmentAssets.outletId, outletId)).all(),
    legacySafe(db.select().from(schema.cocoAssetInspections).where(eq(schema.cocoAssetInspections.outletId, outletId)).all(), []),
  ]);
  return {agreements,claims,settlements,assets,inspections};
}
export type CocoReportMasterData = Awaited<ReturnType<typeof loadCocoReportMasterData>>;
export function projectClaims(data: CocoReportMasterData, asOf: string) {
  return data.claims.map(claim => ({...claim,paidPaise:data.settlements.filter(p=>p.claimId===claim.id && p.paymentDate<=asOf).reduce((sum,p)=>sum+p.amountPaise,0)}));
}
export function buildMasterSummaries(data: CocoReportMasterData, asOf: string): Map<string, LinkedModuleSummary> {
  const map = new Map<string, LinkedModuleSummary>();
  for (const [kind, code] of [['LAND_LEASE','LAND_LEASE'],['SERVICE_PROVIDER','SERVICE_PROVIDER_CONTRACT']] as const) {
    const records=data.agreements.filter(a=>a.agreementType===kind);
    if (!records.length) continue;
    const active=records.filter(a=>a.endDate && a.endDate>=asOf && (!a.startDate || a.startDate<=asOf));
    const primary=[...(active.length?active:records)].sort((a,b)=>active.length?(a.endDate||'').localeCompare(b.endDate||''):(b.endDate||'').localeCompare(a.endDate||''))[0];
    const review=Boolean(primary.remarks?.startsWith('EXCEL_SOURCE_UNVERIFIED') || !primary.endDate || (primary.startDate && primary.startDate>asOf));
    map.set(code,{source:'AGREEMENTS_REGISTER',sourceLabel:'Agreements Register',recordCount:records.length,referenceNumber:primary.agreementNumber,dueDate:primary.endDate,issueDate:primary.startDate,amountPaise:null,frequency:'Tenure',paymentStatus:'NOT_APPLICABLE',paidAt:null,statusYesNo:review?'NO':'YES',actionRequired:review?'Verify agreement dates and supporting evidence.':null,reportStatusLabel:review?'Review Required':undefined,documentIds:records.flatMap(a=>a.agreementDocumentId?[a.agreementDocumentId]:[]),summaryText:[primary.agreementName,primary.counterpartyName,records.length+' agreement record(s)'].filter(Boolean).join(' | ')});
  }
  const claims=projectClaims(data,asOf);
  if(claims.length){
    const drafts=claims.filter(c=>c.approvalStatus==='DRAFT');
    const approved=claims.filter(c=>c.approvalStatus==='APPROVED');
    const rejected=claims.filter(c=>c.approvalStatus==='REJECTED');
    const pending=approved.filter(c=>c.paidPaise<c.amountPaise);
    const approvalPaise=drafts.reduce((s,c)=>s+c.amountPaise,0);
    const unpaidPaise=pending.reduce((s,c)=>s+Math.max(0,c.amountPaise-c.paidPaise),0);
    const overdue=pending.some(c=>c.dueDate && c.dueDate<asOf);
    const dueDates=pending.flatMap(c=>c.dueDate?[c.dueDate]:[]).sort();
    const hasPending=drafts.length>0||pending.length>0;
    const refs=claims.flatMap(c=>c.invoiceNumber?[c.invoiceNumber.trim()]:[]).filter(Boolean);
    const duplicates=[...new Set(refs.filter((r,i)=>refs.indexOf(r)!==i))];
    map.set('WAGES_INCENTIVES_MISC',{source:'CLAIMS_REGISTER',sourceLabel:'Claims & Settlements Register',recordCount:claims.length,referenceNumber:null,dueDate:dueDates[0]??null,amountPaise:approvalPaise+unpaidPaise,frequency:'As Recorded',paymentStatus:overdue?'OVERDUE':hasPending?'PENDING':approved.length?'PAID':'NOT_RECORDED',paidAt:null,statusYesNo:hasPending||rejected.length?'NO':'YES',reportStatusLabel:drafts.length&&!pending.length?'Pending Approval':pending.length?(overdue?'Overdue':'Payment Pending'):rejected.length?'Review Required':'Paid',actionRequired:duplicates.length?'Review repeated invoice reference(s): '+duplicates.join(', '):rejected.length?'Review rejected claims.':null,documentIds:[...claims.flatMap(c=>c.invoiceDocumentId?[c.invoiceDocumentId]:[]),...data.settlements.filter(p=>p.paymentDate<=asOf).map(p=>p.receiptDocumentId)],summaryText:claims.length+' claims | '+drafts.length+' pending approval: '+formatIndianCurrencyFromPaise(approvalPaise)+' | '+pending.length+' approved unpaid: '+formatIndianCurrencyFromPaise(unpaidPaise)+' | '+rejected.length+' rejected'});
  }
  const definitions: Array<[string, (a: CocoReportMasterData['assets'][number]) => boolean]> = [
    ['WATER_COOLER_MAINTENANCE', a => /water[\s-]*cooler/i.test(a.name)],
    ['POS_AUTOMATION', a => /\b(pos|automation|fcc)\b/i.test(a.name)],
    ['GENERATOR_MAINTENANCE', a => a.equipmentType === 'DG_SET' || /\b(generator|dg set)\b/i.test(a.name)],
    ['CCTV_HEALTH_STATUS', a => /\b(cctv|camera|dvr|nvr)\b/i.test(a.name)],
  ];
  for (const [code, matches] of definitions) {
    const assets = data.assets.filter(matches);
    if (!assets.length) continue;
    const latest = assets.flatMap(a => {
      const i = data.inspections.filter(i=>i.equipmentAssetId===a.id && i.inspectedOn<=asOf)
        .sort((x,y)=>y.inspectedOn.localeCompare(x.inspectedOn)||y.createdAt.localeCompare(x.createdAt))[0];
      return i ? [i] : [];
    });
    // Inventory without an as-of inspection is not maintenance evidence.
    // Preserve the canonical missing/manual status; the detailed asset table
    // still explicitly flags the need for operational inspection.
    if (!latest.length) continue;
    const bad = latest.filter(i=>i.condition!=='WORKING').length;
    const missing = assets.length-latest.length;
    const due = latest.flatMap(i=>i.nextServiceDate?[i.nextServiceDate]:[]).sort()[0]??null;
    const overdue = due !== null && due < asOf;
    const issue = bad ? 'Repair / replacement required.' : missing ? 'Operational inspection missing.' : overdue ? 'Recorded service due date has passed.' : null;
    map.set(code,{source:'ASSET_INSPECTIONS',sourceLabel:'Asset Inspections',recordCount:assets.length,referenceNumber:null,dueDate:due,amountPaise:null,frequency:null,paymentStatus:'NOT_RECORDED',paidAt:null,
      statusYesNo:issue?'NO':'NOT_RECORDED',actionRequired:issue,reportStatusLabel:issue?'Action Required':undefined,
      documentIds:latest.flatMap(i=>i.evidenceDocumentId?[i.evidenceDocumentId]:[]),
      summaryText:latest.length+'/'+assets.length+' assets inspected; '+bad+' not working / scrapped. Inspection alone is not proof of completed preventive maintenance.'});
  }
  return map;
}
