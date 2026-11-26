import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import type { DailyDispenserSummary, DailyFuelSummary, DailyProductSummary, DailyTankReadingDetail } from '../src/shared/types';
import { dsrDailyProductValues, dsrDailyUnitTotals, dsrTankPresentation, dsrDispenserSubtotals, operationalShiftClosure, savedQuantity } from '../src/frontend/utils/dsrReportLayout';
import { generateDsrPdf } from '../src/frontend/utils/dsrReportPdf';

const tank=(id:string,number:string,readingType:DailyTankReadingDetail['readingType'],volume:number):DailyTankReadingDetail=>({
  tankId:id,tankNumber:number,readingType,productDipMmMilliunits:1000000,waterDipMmMilliunits:0,netProductVolumeMilliunits:volume,
});
const product=(overrides:Partial<DailyProductSummary>={}):DailyProductSummary=>({
  productId:'ms',productCode:'MS',productName:'Motor Spirit',unit:'LITRE',status:'COMPLETE',missingFields:[],
  openingStockMilliunits:10000000,receiptsMilliunits:0,availableStockMilliunits:10000000,
  grossSalesMilliunits:2100000,testingMilliunits:5000,netSalesMilliunits:2095000,
  theoreticalClosingMilliunits:7905000,physicalClosingMilliunits:7895000,varianceMilliunits:-10000,
  tankReadings:[tank('t1','1','OPENING',10000000),tank('t1','1','CLOSING',7895000)],
  ...overrides,
} as DailyProductSummary);
const day=(overrides:Partial<DailyFuelSummary>={}):DailyFuelSummary=>({
  businessDate:'2026-11-24',dayEntryStatus:'COMPLETE',status:'COMPLETE',operationalDsrStatus:'COMPLETED',
  financialReconciliationStatus:'PENDING',shiftsCount:1,shifts:[{status:'CLOSED',shiftNumber:1,financialReconciliationStatus:'PENDING'}],
  byProduct:[product()],byDispenser:[],missingFields:[],completion:{expectedTanks:1,openingTankReadings:1,closingTankReadings:1,
    expectedNozzles:1,nozzleMeterReadings:1,completedReceipts:0,totalReceipts:0,reconciliationComplete:true},
  ...overrides,
} as DailyFuelSummary);
type Nozzle=DailyDispenserSummary['nozzles'][number];
const nozzle=(overrides:Partial<Nozzle>={}):Nozzle=>({
  shiftNumber:1,nozzleNumber:1,productId:'ms',productCode:'MS',openingTotalizerMilliunits:1000000,closingTotalizerMilliunits:1200000,
  grossSalesMilliunits:200000,testingQuantityMilliunits:5000,netSalesMilliunits:195000,hasReading:true,isUnavailable:false,
  ...overrides,
} as Nozzle);
const dispenser=(nozzles:Nozzle[])=>({dispenserNumber:1,nozzles} as DailyDispenserSummary);

describe('professional DSR PDF report integrity',()=>{
  it('adds same-unit exact daily totals, signs variance and never mixes units',()=>{
    const d=day({byProduct:[product(),product({productId:'hsd',productCode:'HSD',varianceMilliunits:12000}),
      product({productId:'cng',productCode:'CNG',unit:'KG',varianceMilliunits:0})]});
    const groups=dsrDailyUnitTotals(d);
    expect(groups).toHaveLength(2);
    expect(groups.find(x=>x.unit==='LITRE')).toEqual({
      unit:'LITRE',coverage:'COMPLETE',values:['20000.000','0.000','20000.000','4200.000','10.000','4190.000','15810.000','15790.000','+2.000'],
    });
    expect(groups.find(x=>x.unit==='KG')?.values[5]).toBe('2095.000');
    expect(groups.find(x=>x.unit==='KG')?.values[8]).toBe('0.000');
    expect(d.byProduct[0].varianceMilliunits).toBe(-10000);
  });
  it('preserves true zeros and withholds totals for missing values or unsafe milliunits',()=>{
    const missing=product({productId:'hsd',productCode:'HSD',status:'PARTIAL',missingFields:['No opening tank reading','DU 1 missing meter reading']});
    const total=dsrDailyUnitTotals(day({byProduct:[product(),missing],dayEntryStatus:'PARTIAL'}))[0];
    expect(total.coverage).toBe('PARTIAL');
    expect(total.values[0]).toBe('Not recorded');
    expect(total.values[1]).toBe('0.000');
    expect(total.values[5]).toBe('Not recorded');
    expect(total.values[8]).toBe('Not recorded');
    expect(dsrDailyProductValues(missing)[0]).toBe('Not recorded');
    expect(dsrDailyProductValues(product({varianceMilliunits:12000}))[8]).toBe('+12.000');
    expect(savedQuantity(undefined)).toBe('Not recorded');
    expect(savedQuantity(null)).toBe('Not recorded');
    expect(savedQuantity(0)).toBe('0.000');
    expect(savedQuantity(Number.MAX_SAFE_INTEGER+1)).toBe('Not recorded');
  });
  it('pairs opening and closing only for an unambiguous single shift',()=>{
    const p=product({tankReadings:[tank('t1','1','OPENING',10000000),tank('t2','2','OPENING',20000000),tank('t1','1','CLOSING',9000000)]});
    const pair=dsrTankPresentation(day({byProduct:[p]}));
    expect(pair.mode).toBe('PAIRED');
    expect(pair.rows[0].opening?.netProductVolumeMilliunits).toBe(10000000);
    expect(pair.rows[0].closing?.netProductVolumeMilliunits).toBe(9000000);
    expect(pair.rows[1].closing).toBeUndefined();
    const multi=dsrTankPresentation(day({byProduct:[p],shiftsCount:2}));
    expect(multi.mode).toBe('SAVED_READINGS');
    expect(multi.rows).toHaveLength(3);
    const duplicate=dsrTankPresentation(day({byProduct:[product({tankReadings:[...p.tankReadings,tank('t1','1','OPENING',7000000)]})]}));
    expect(duplicate.mode).toBe('SAVED_READINGS');
    expect(duplicate.rows).toHaveLength(4);
  });
  it('calculates dispenser recorded-only subtotal by unit and distinguishes unavailable / missing records',()=>{
    const d=dispenser([nozzle(),nozzle({nozzleNumber:2,hasReading:false,openingTotalizerMilliunits:null,closingTotalizerMilliunits:null,isUnavailable:true}),
      nozzle({nozzleNumber:3,productId:'cng',productCode:'CNG',grossSalesMilliunits:1000,testingQuantityMilliunits:0,netSalesMilliunits:1000})]);
    const totals=dsrDispenserSubtotals(d,new Map([['ms','LITRE'],['cng','KG']]));
    expect(totals).toEqual([{unit:'LITRE',recorded:1,expected:2,gross:'200.000',testing:'5.000',net:'195.000'},
      {unit:'KG',recorded:1,expected:1,gross:'1.000',testing:'0.000',net:'1.000'}]);
    const none=dsrDispenserSubtotals(dispenser([nozzle({hasReading:false,openingTotalizerMilliunits:null,closingTotalizerMilliunits:null})]),new Map([['ms','LITRE']]));
    expect(none[0]).toMatchObject({recorded:0,expected:1,net:'Not recorded'});
  });
  it('reports shift closure independently from DSR and finance completeness, never guesses missing metadata',()=>{
    expect(operationalShiftClosure(day())).toBe('CLOSED');
    expect(operationalShiftClosure(day({shiftsCount:0,shifts:[]}))).toBe('NOT STARTED');
    expect(operationalShiftClosure(day({shifts:[]}))).toBe('STATUS UNAVAILABLE');
    const shifts=[{status:'CLOSED'},{status:'OPEN'}] as DailyFuelSummary['shifts'];
    expect(operationalShiftClosure(day({shiftsCount:2,shifts}))).toBe('1/2 CLOSED / LOCKED');
  });
  it('keeps a representative five-product, seven-tank, twenty-nozzle DSR on two pages',async()=>{
    let tankNo=0;
    const products=['MS','HSD','XP100','XP95','XTRAGREEN'].map((code,i)=>product({productId:code,productCode:code,
      tankReadings:Array.from({length:i<2?2:1},()=>{const id=String(++tankNo);return [tank(id,id,'OPENING',10000000),tank(id,id,'CLOSING',8000000)];}).flat()}));
    const dispensers=Array.from({length:5},(_,i)=>({...dispenser(Array.from({length:4},(_,j)=>nozzle({nozzleNumber:j+1,productId:products[(i+j)%5].productId,productCode:products[(i+j)%5].productCode}))),dispenserNumber:i+1}));
    const d=day({byProduct:products,byDispenser:dispensers,completion:{...day().completion,expectedTanks:7,openingTankReadings:7,closingTankReadings:7,expectedNozzles:20,nozzleMeterReadings:20}});
    const bytes=await generateDsrPdf({outletName:'Synthetic outlet',roCode:'TEST',days:[d],generatedAt:'2026-11-26T00:00:00Z',generatedBy:'QA fixture',periodLabel:'Daily'});
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
  });
  it('generates a complete PDF with actual brand asset, long meter readings and multiple pages',async()=>{
    const d=day({byDispenser:[dispenser(Array.from({length:60},(_,i)=>nozzle({nozzleNumber:i+1,openingTotalizerMilliunits:9999999999999,closingTotalizerMilliunits:10000000000000,grossSalesMilliunits:1,netSalesMilliunits:1,testingQuantityMilliunits:0})))]});
    const bytes=await generateDsrPdf({outletName:'Synthetic outlet',roCode:'TEST',days:[d],generatedAt:'2026-11-26T00:00:00Z',generatedBy:'QA fixture',periodLabel:'Daily'});
    const loaded=await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBeGreaterThan(1);
    expect(loaded.getTitle()).toContain('2026-11-24');
    expect(bytes.byteLength).toBeGreaterThan(5000);
  });
});
