import {describe,expect,it} from 'vitest';
import {commandAttention, commandWorkflow, dashboardTanks, latestDashboardShift, outletHierarchy, scopeLabel} from '../src/frontend/utils/commandCentre';
import type {DailyFuelSummary,OperationalShiftTankSnapshot,TankStockReading,RetailOutlet} from '../src/shared/types';

const date='2026-11-24', outletId='A';
const summary = (overrides:Partial<DailyFuelSummary>={}):DailyFuelSummary => ({
  outletId,businessDate:date,status:'COMPLETE',operationalDsrStatus:'COMPLETED',financialReconciliationStatus:'PENDING',
  shiftsCount:1,shifts:[{id:'shift-1',shiftNumber:1,businessDate:date,status:'CLOSED'}],
  completion:{expectedTanks:7,openingTankReadings:7,closingTankReadings:7,expectedNozzles:20,nozzleMeterReadings:19,unavailableNozzles:1,totalReceipts:0,completedReceipts:0,pendingReceipts:0,reconciliationComplete:true},
  missingFields:[],...overrides,
} as DailyFuelSummary);
const snapshot = (overrides:Partial<OperationalShiftTankSnapshot>={}):OperationalShiftTankSnapshot => ({
  tankId:'t1',outletId,operationalShiftId:'shift-1',tankNumber:1,productId:'ms',productCode:'MS',productUnit:'LITRE',capacityMilliunits:50000000,...overrides,
} as OperationalShiftTankSnapshot);
const reading = (overrides:Partial<TankStockReading>={}):TankStockReading => ({
  tankId:'t1',outletId,operationalShiftId:'shift-1',productId:'ms',recordedAt:date+'T11:00:00Z',netProductVolumeMilliunits:25000000,readingType:'CLOSING',...overrides,
} as TankStockReading);

describe('hierarchical command centre',()=>{
  it('shows the existing five-level organization path using only the selected accessible outlet',()=>{
    const path=outletHierarchy({name:'COCO 79',roCode:'369460',stateName:'Punjab',divisionName:'Division A',salesAreaName:'Area A'} as RetailOutlet);
    expect(path.map(x=>x.label)).toEqual(['Global','State','Division','Sales area','Retail outlet']);
    expect(path.map(x=>x.name)).toEqual(['India','Punjab','Division A','Area A','COCO 79']);
    expect(path[4].code).toBe('369460');
    expect(outletHierarchy({name:'RO',roCode:'123'} as RetailOutlet)[1].name).toBe('Name unavailable');
    expect(['GLOBAL','STATE','DIVISION','SALES_AREA','OUTLET'].map(scopeLabel)).toEqual(['Global','State','Division','Sales area','Retail outlet']);
  });
  it('shows completed operations and closed shift while finance remains independently pending',()=>{
    expect(commandAttention(summary())).toMatchObject({title:'Finance pending',action:'financials'});
    const workflow=commandWorkflow(summary());
    expect(workflow.every(x=>x.state==='complete')).toBe(true);
    expect(workflow.find(x=>x.label==='Nozzle meters')?.detail).toBe('20 / 20');
    expect(workflow.find(x=>x.label==='Tank readings')?.detail).toBe('Open 7 / 7 · Close 7 / 7');
    expect(commandAttention(summary({financialReconciliationStatus:'UNKNOWN'})).title).toBe('Status unavailable');
  });
  it('does not treat no shifts, zero receipts or unread data as completed or blocked',()=>{
    const empty=summary({shiftsCount:0,shifts:[],status:'NOT_STARTED',operationalDsrStatus:'NOT_STARTED',financialReconciliationStatus:'NOT_STARTED',completion:{...summary().completion,expectedTanks:0,openingTankReadings:0,closingTankReadings:0,expectedNozzles:0,nozzleMeterReadings:0,unavailableNozzles:0,reconciliationComplete:false}});
    expect(commandAttention(empty).title).toBe('No shift recorded');
    expect(commandWorkflow(empty).every(x=>x.state==='unrecorded')).toBe(true);
    expect(latestDashboardShift(empty)).toBeNull();
  });
  it('chooses only a uniquely identified latest shift from the same date',()=>{
    const s=summary();
    const next={...s.shifts[0],id:'shift-2',shiftNumber:2,status:'OPEN' as const};
    expect(latestDashboardShift(summary({shiftsCount:2,shifts:[next,s.shifts[0]]}))?.id).toBe('shift-2');
    expect(latestDashboardShift(summary({shiftsCount:2,shifts:[s.shifts[0]]}))).toBeNull();
    expect(latestDashboardShift(summary({shiftsCount:2,shifts:[next,{...s.shifts[0],shiftNumber:2}]}))).toBeNull();
    expect(latestDashboardShift(summary({shifts:[{...next,businessDate:'2026-11-23'}]}))).toBeNull();
  });
  it('uses newest actual saved reading and matching shift capacity, not a fabricated zero',()=>{
    const earlier=reading({recordedAt:date+'T06:00:00Z',netProductVolumeMilliunits:30000000,readingType:'OPENING'});
    const second=snapshot({tankId:'t2',tankNumber:2});
    const cards=dashboardTanks([second,snapshot()],[reading(),earlier],outletId,'shift-1');
    expect(cards[0].percentage).toBe(50);
    expect(cards[0].reading?.readingType).toBe('CLOSING');
    expect(cards[1].reading).toBeNull();
    expect(cards[1].percentage).toBeNull();
    expect(dashboardTanks([snapshot()],[reading({netProductVolumeMilliunits:0})],outletId,'shift-1')[0].percentage).toBe(0);
    expect(dashboardTanks([snapshot()],[reading({netProductVolumeMilliunits:60000000})],outletId,'shift-1')[0].percentage).toBe(120);
    expect(dashboardTanks([snapshot({capacityMilliunits:0})],[reading()],outletId,'shift-1')[0].percentage).toBeNull();
  });
  it('refuses foreign, ambiguous, invalid or mismatched shift evidence',()=>{
    expect(()=>dashboardTanks([snapshot({outletId:'B'})],[reading()],outletId,'shift-1')).toThrow();
    expect(()=>dashboardTanks([snapshot()],[reading({operationalShiftId:'old'})],outletId,'shift-1')).toThrow();
    expect(()=>dashboardTanks([snapshot(),snapshot()],[reading()],outletId,'shift-1')).toThrow();
    for(const rows of [[reading({productId:'hsd'})],[reading(),reading({netProductVolumeMilliunits:10000000})],[reading({recordedAt:'invalid'})],[reading({netProductVolumeMilliunits:-1})]])expect(dashboardTanks([snapshot()],rows,outletId,'shift-1')[0].reading).toBeNull();
  });
});
