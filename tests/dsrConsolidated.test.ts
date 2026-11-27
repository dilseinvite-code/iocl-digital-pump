import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import type { DailyFuelSummary, DailyProductSummary } from '../src/shared/types';
import { consolidateDsr, periodProductCells, dayUnitQuantity, coveredPeriodQuantity, periodDateStatusCells } from '../src/frontend/utils/dsrConsolidated';
import { generateDsrPdf } from '../src/frontend/utils/dsrReportPdf';

const product=(overrides:Partial<DailyProductSummary>={}):DailyProductSummary=>({
  productId:'ms',productCode:'MS',productName:'Motor Spirit',unit:'LITRE',status:'COMPLETE',missingFields:[],
  openingStockMilliunits:500000,receiptsMilliunits:20000,availableStockMilliunits:520000,
  grossSalesMilliunits:110000,testingMilliunits:10000,netSalesMilliunits:100000,
  theoreticalClosingMilliunits:420000,physicalClosingMilliunits:421000,varianceMilliunits:1000,tankReadings:[],
  ...overrides,
} as DailyProductSummary);
const day=(businessDate:string,byProduct:DailyProductSummary[],dayEntryStatus:DailyFuelSummary['dayEntryStatus']='COMPLETE')=>({
  businessDate,byProduct,dayEntryStatus,status:dayEntryStatus==='NO_ENTRY'?'NOT_STARTED':dayEntryStatus==='COMPLETE'?'COMPLETE':'IN_PROGRESS',
  operationalDsrStatus:dayEntryStatus==='NO_ENTRY'?'NOT_STARTED':dayEntryStatus==='COMPLETE'?'COMPLETED':'IN_PROGRESS',
  financialReconciliationStatus:dayEntryStatus==='NO_ENTRY'?'NOT_STARTED':dayEntryStatus==='COMPLETE'?'PENDING':'REVIEW_REQUIRED',
  shiftsCount:dayEntryStatus==='NO_ENTRY'?0:1,shifts:dayEntryStatus==='NO_ENTRY'?[]:[{id:'fixture-'+businessDate,shiftNumber:1,status:'CLOSED',businessDate}],
  byDispenser:[],missingFields:[],completion:{expectedTanks:1,openingTankReadings:dayEntryStatus==='COMPLETE'?1:0,closingTankReadings:dayEntryStatus==='COMPLETE'?1:0,
    expectedNozzles:1,nozzleMeterReadings:dayEntryStatus==='COMPLETE'?1:0,completedReceipts:0,totalReceipts:0,reconciliationComplete:dayEntryStatus==='COMPLETE'}
} as unknown as DailyFuelSummary);
const missing=()=>product({status:'PARTIAL',openingStockMilliunits:0,receiptsMilliunits:0,grossSalesMilliunits:0,testingMilliunits:0,netSalesMilliunits:0,physicalClosingMilliunits:0,varianceMilliunits:0,
  missingFields:['No opening tank reading','No closing tank reading','DU 1 / Nozzle 1 missing meter reading']});
const sparseMonth=()=>Array.from({length:27},(_,i)=>{const d='2026-11-'+String(i+1).padStart(2,'0');
  return i===0?day(d,[missing()],'PARTIAL'):i===23?day(d,[product({receiptsMilliunits:0})]):day(d,[],'NO_ENTRY');});
const metadata={outletName:'Fixture outlet',roCode:'123456',periodLabel:'Monthly',generatedAt:'2026-11-27T09:00:00Z',generatedBy:'Fixture operator'};
async function pdfContent(bytes:Uint8Array){
  const pdf=await PDFDocument.load(bytes);let content='';
  for(const page of pdf.getPages()){
    const streams=page.node.Contents();
    if(!(streams instanceof PDFArray))throw new Error('Expected PDF content array');
    for(let i=0;i<streams.size();i++){
      const stream=pdf.context.lookup(streams.get(i));
      if(stream instanceof PDFRawStream)content+=Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
    }
  }
  return {pdf,has:(phrase:string)=>content.includes(Buffer.from(phrase,'ascii').toString('hex').toUpperCase())};
}

describe('consolidated period DSR',()=>{
  it('adds only recorded quantities, retains recorded zero and groups consecutive no-entry dates',()=>{
    const result=consolidateDsr(sparseMonth()),row=result.rows[0],total=result.rows[1];
    expect([result.totalDays,result.complete,result.partial,result.noEntry]).toEqual([27,1,1,25]);
    expect(result.dateGroups.map(g=>[g.label,g.count])).toEqual([
      ['2026-11-01',1],['2026-11-02 to 2026-11-23',22],['2026-11-24',1],['2026-11-25 to 2026-11-27',3],
    ]);
    expect(periodDateStatusCells(result.dateGroups[0])).toEqual(['2026-11-01','IN PROGRESS','CLOSED','REVIEW REQUIRED','1']);
    expect(periodDateStatusCells(result.dateGroups[2])).toEqual(['2026-11-24','COMPLETED','CLOSED','PENDING','1']);
    expect(row.measures.net).toEqual({value:100000,fullDays:1,totalDays:27,recordedEntries:1,expectedEntries:27});
    expect(periodProductCells(row)).toEqual(['MS','LITRE','Not recorded','0.000 [2/27]','110.000','10.000','100.000','1/27','Not recorded','+1.000 [1/27]']);
    expect(total.measures.net.value).toBe(100000);
    expect(result.units[0].days[0].productNet).toEqual([null]);
    expect(result.units[0].days[23].productNet).toEqual([100000]);
    expect(result.units[0].days[26].measures.receipts.value).toBeNull();
  });
  it('adds movements but takes exact first and last recorded stock balances',()=>{
    const result=consolidateDsr([day('2026-11-01',[product()]),day('2026-11-02',[product({
      openingStockMilliunits:421000,receiptsMilliunits:0,grossSalesMilliunits:51000,testingMilliunits:1000,netSalesMilliunits:50000,physicalClosingMilliunits:370000,varianceMilliunits:-1000
    })])]);
    expect(periodProductCells(result.rows[0])).toEqual(['MS','LITRE','500.000','20.000 [2/2]','161.000','11.000','150.000','2/2','370.000','0.000 [2/2]']);
  });
  it('separates units and labels partial known totals rather than claiming complete coverage',()=>{
    const kg=product({productId:'cng',productCode:'CNG',unit:'KG'}),hsd=product({productId:'hsd',productCode:'HSD',netSalesMilliunits:0,grossSalesMilliunits:0,testingMilliunits:0});
    const result=consolidateDsr([day('2026-11-01',[product(),kg,hsd]),day('2026-11-02',[product(),kg],'PARTIAL')]);
    const litres=result.units.find(u=>u.unit==='LITRE')!,kgTotal=result.rows.find(r=>r.isTotal&&r.unit==='KG')!;
    expect(result.units).toHaveLength(2);
    expect(dayUnitQuantity(litres.days[1].measures.net)).toBe('100.000 *');
    expect(kgTotal.measures.net.value).toBe(200000);
    expect(result.rows.find(r=>r.isTotal&&r.unit==='LITRE')?.physical).toBeNull();
    expect(result.rows.find(r=>r.isTotal&&r.unit==='LITRE')?.measures.net.fullDays).toBe(1);
    expect(consolidateDsr([day('2026-11-01',[product({unit:''}),product({productId:'other',productCode:'OTHER',unit:''})])]).units).toHaveLength(2);
  });
  it('rejects duplicates and invalid or overflowing quantity totals; never guesses a missing amount',()=>{
    const malformed=product({grossSalesMilliunits:NaN});
    const result=consolidateDsr([day('2026-11-01',[malformed]),day('2026-11-02',[product(),product()])]);
    expect(result.rows[0].measures.gross.value).toBeNull();
    expect(result.rows[0].measures.net.value).toBeNull();
    expect(result.rows[0].opening).toBe(500000);
    expect(result.rows[0].physical).toBeNull();
    const big=product({netSalesMilliunits:Number.MAX_SAFE_INTEGER,grossSalesMilliunits:Number.MAX_SAFE_INTEGER,testingMilliunits:0});
    expect(consolidateDsr([day('2026-11-01',[big]),day('2026-11-02',[big])]).rows[0].measures.net.value).toBeNull();
    expect(coveredPeriodQuantity(result.rows[0].measures.net)).toBe('Not recorded');
  });
  it('produces a compact period PDF with no daily detail pages, and preserves the detailed export',async()=>{
    const days=sparseMonth(),operatorRemarks={'2026-11-24':'Check stock difference.'};
    const summary=await pdfContent(await generateDsrPdf({...metadata,days,operatorRemarks,reportFormat:'CONSOLIDATED'}));
    const detailed=await pdfContent(await generateDsrPdf({...metadata,days,operatorRemarks,reportFormat:'DETAILED'}));
    expect(summary.pdf.getPageCount()).toBeLessThanOrEqual(2);
    expect(detailed.pdf.getPageCount()).toBeGreaterThan(summary.pdf.getPageCount());
    for(const phrase of ['MONTHLY CONSOLIDATED DSR','RECORDED TOTAL','2026-11-02 to 2026-11-23','100.000','0.000 [2/27]','REVIEW REQUIRED','PENDING','24 Nov 2026 | Operator remarks on stock differences (export only): Check stock difference.'])expect(summary.has(phrase),phrase).toBe(true);
    expect(summary.has('Dispenser and nozzle-wise meter statement')).toBe(false);
    expect(detailed.has('DAILY SALES REPORT (DSR)')).toBe(true);
  });
  it('reports an all-empty period without invented quantities and a one-day custom period as consolidated',async()=>{
    const days=[day('2026-11-01',[],'NO_ENTRY'),day('2026-11-02',[],'NO_ENTRY')];
    expect(consolidateDsr(days).rows).toEqual([]);
    const empty=await pdfContent(await generateDsrPdf({...metadata,days,reportFormat:'CONSOLIDATED'}));
    expect(empty.pdf.getPageCount()).toBe(1);
    expect(empty.has('2026-11-01 to 2026-11-02')).toBe(true);
    expect(empty.has('0.000')).toBe(false);
    const single=await pdfContent(await generateDsrPdf({...metadata,periodLabel:'Custom range',days:[day('2026-11-01',[product()])],reportFormat:'CONSOLIDATED'}));
    expect(single.has('CUSTOM RANGE CONSOLIDATED DSR')).toBe(true);
  });
});
