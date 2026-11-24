import {describe,expect,it} from 'vitest';
import {evaluateComplianceStatus,getCocoReportStatus,getCocoReportDueDate,type CocoComplianceMergedItem,type CocoOnePagerRow} from '../src/shared/cocoComplianceUtils';
import {buildMasterSummaries,projectClaims,type CocoReportMasterData} from '../src/worker/services/cocoReportingMasterData';
import {printableSectionTables} from '../src/worker/services/cocoSectionWisePdfProjection';
const asOf='2026-11-23';
describe('COCO report synchronization',()=>{
 it('keeps paid bills separate from true licence expiry',()=>{
  const p={hasRecordOrModuleData:true,statusYesNo:'YES' as const,validityDueDate:'2026-11-10',paymentStatus:'PAID' as const,reportDate:asOf};
  expect(evaluateComplianceStatus({...p,categoryCode:'ELECTRICITY_BILL'})).toMatchObject({complianceStatus:'VALID',daysUntilDue:null});
  expect(evaluateComplianceStatus({...p,categoryCode:'PESO_LICENCE'}).complianceStatus).toBe('EXPIRED');
 });
 it('uses actual agreement and claims records and excludes future settlements',()=>{
  const fixture:CocoReportMasterData={assets:[],inspections:[],agreements:[{id:'a',agreementType:'SERVICE_PROVIDER',agreementName:'Service Provider',agreementNumber:'SP1',startDate:'2024-08-01',endDate:'2027-07-31',counterpartyName:'Provider',agreementDocumentId:null}] as CocoReportMasterData['agreements'],claims:[{id:'c1',approvalStatus:'DRAFT',amountPaise:7210800,invoiceNumber:'same',dueDate:'2025-01-31'},{id:'c2',approvalStatus:'APPROVED',amountPaise:100000,invoiceNumber:'same',dueDate:'2026-11-01'}] as CocoReportMasterData['claims'],settlements:[{claimId:'c2',amountPaise:20000,paymentDate:'2026-11-22',receiptDocumentId:'r1'},{claimId:'c2',amountPaise:80000,paymentDate:'2026-11-24',receiptDocumentId:'r2'}] as CocoReportMasterData['settlements']};
  expect(projectClaims(fixture,asOf)[1].paidPaise).toBe(20000);
  const m=buildMasterSummaries(fixture,asOf);
  expect(m.get('SERVICE_PROVIDER_CONTRACT')).toMatchObject({source:'AGREEMENTS_REGISTER',dueDate:'2027-07-31',statusYesNo:'YES'});
  expect(m.get('WAGES_INCENTIVES_MISC')).toMatchObject({source:'CLAIMS_REGISTER',amountPaise:7290800,paymentStatus:'OVERDUE',recordCount:2});
  expect(m.get('WAGES_INCENTIVES_MISC')?.actionRequired).toContain('same');
 });
 it('does not assume an active asset is working, ignores future inspections',()=>{
  const fixture:CocoReportMasterData={agreements:[],claims:[],settlements:[],assets:[{id:'dg',name:'Generator',equipmentType:'DG_SET'}] as CocoReportMasterData['assets'],inspections:[{equipmentAssetId:'dg',inspectedOn:'2026-11-24',condition:'WORKING',createdAt:'2026-11-24T09:00:00Z'}] as CocoReportMasterData['inspections']};
  expect(buildMasterSummaries(fixture,asOf).has('GENERATOR_MAINTENANCE')).toBe(false);
  const inspected = {...fixture,inspections:[{equipmentAssetId:'dg',inspectedOn:'2026-11-22',condition:'NOT_WORKING',createdAt:'2026-11-22T09:00:00Z'}] as CocoReportMasterData['inspections']};
  expect(buildMasterSummaries(inspected,asOf).get('GENERATOR_MAINTENANCE')).toMatchObject({statusYesNo:'NO',actionRequired:'Repair / replacement required.'});
 });
 it('renumbers filtered print rows without mutating source records',()=>{
  const section={title:'Claims & Payments',subtitle:'',note:'',noteTitle:'',tables:[{title:'Claims',source:'Claims',headers:['Sr.','Particular','Status'],widths:[20,100,50],rows:[['1','Missing','Not Recorded'],['5','Real','Pending Approval']]}]};
  expect(printableSectionTables(section)[0].rows).toEqual([['1','Real','Pending Approval']]);
  expect(section.tables[0].rows[1][0]).toBe('5');
 });
});

import { PDFDocument } from 'pdf-lib';
import { CocoCompliancePdfService } from '../src/worker/services/cocoCompliancePdfService';
describe('COCO final report refinements',()=>{
 it('uses common labels and distinguishes tax assessment period from bill due date',()=>{
  const base={categoryCode:'PESO_LICENCE',complianceStatus:'VALID',statusYesNo:'YES',paymentStatus:'PAID'} as CocoComplianceMergedItem;
  expect(getCocoReportStatus(base)).toBe('Valid');
  const tax={...base,categoryCode:'PROPERTY_TAX',validityDueDate:'2027-03-31',paymentDate:'2026-08-11',linkedModuleData:{paymentDueDate:'2026-08-10'}} as CocoComplianceMergedItem;
  expect(getCocoReportStatus(tax)).toBe('Paid Late');
  expect(getCocoReportDueDate(tax)).toContain('Period end:');
  expect(getCocoReportDueDate(tax)).toContain('Due:');
  expect(getCocoReportStatus({...base,categoryCode:'WATER_COOLER_MAINTENANCE',complianceStatus:'ACTION_REQUIRED',actionRequired:'Service dates missing; verify service evidence.'})).toBe('Service dates missing');
 });
 it('fits a representative COCO 56 report with land lease and claim remarks on one A4 page',async()=>{
  const names=['PESO Licence','Property Tax','Lease Rent','Electricity Bill','Water Bill','Water Cooler','Weights & Measures Stamping','Fire Extinguisher Refilling','POS / Automation','Generator','CCTV Health Status','Service Provider Contract Agreement','Wages, Incentives & Miscellaneous Bills','Land Lease'];
  const rows:CocoOnePagerRow[]=names.map((particular,index)=>({srNo:index+1,categoryCode:'TEST_'+index,particular,statusYesNoDisplay:index===12?'Pending Approval':index>=6&&index<=10?'Not Recorded':index===5?'Service dates missing':'Valid',validityDueDateDisplay:'-',amountInrDisplay:'-',frequencyDisplay:'Yearly',remarksActionRequiredDisplay:index===12?'7 claims | 7 pending approval: Rs. 7,61,450 | 0 approved unpaid: Rs. 0 | 0 rejected | Action: Review repeated invoice reference(s): 2026-M-003':index>=6&&index<=10?'Not Recorded - Compliance entry pending':'Reference recorded',complianceStatus:'VALID',paymentStatus:'NOT_RECORDED',authoritativeSource:'MANUAL',hasDiscrepancy:false}));
  const bytes=await CocoCompliancePdfService.generateOnePagerPdf({outletId:'fixture',outletName:'COCO 56',roCode:'369465',reportDate:'2026-11-24',generatedAt:'2026-11-24T09:00:00Z',generatedBy:'Test',rows,customRows:[],summary:{totalCategories:14,validCount:7,expiringSoonCount:0,expiredCount:0,paymentPendingCount:0,pendingApprovalCount:1,actionRequiredCount:1,notRecordedCount:5,notApplicableCount:0,discrepancyCount:0}});
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
 });
});
