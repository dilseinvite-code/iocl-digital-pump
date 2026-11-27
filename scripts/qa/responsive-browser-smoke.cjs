// Browser-only QA against an isolated local Vite build.
// All API calls are intercepted; no deployed backend, credentials or writes.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { PDFDocument, PDFRawStream, decodePDFRawStream } = require('pdf-lib');
const { chromium } = require('playwright');
const base = 'http://127.0.0.1:4173';
const fixtureOutlet = (id, name, roCode) => ({
  id, name, roCode, status:'ACTIVE', outletType:'COCO', stateId:'fixture-state',
  divisionId:'fixture-division', salesAreaId:'fixture-area', stateName:'Fixture State',
  divisionName:'Fixture Division', salesAreaName:'Fixture Area', address:'Fixture address',
  city:'Fixture City', district:'Fixture District', pincode:'000000', assignedUsersCount:0,
});
const outlets=[fixtureOutlet('fixture-a','Fixture Outlet A','100001'),fixtureOutlet('fixture-b','Fixture Outlet B with a deliberately long registered name','100002')];
const auth={user:{id:'fixture-reader',name:'Fixture Reader',empCode:'QA-01',email:'fixture@example.invalid'},roles:['FIELD_OFFICER'],permissions:['outlets.read','shifts.read','cng_operations.read','reports.read','reports.generate'],primaryScope:'SALES_AREA',isGlobalAdmin:false,isGlobalScope:false,scopes:[]};
const historical={id:'fixture-old-shift',outletId:'fixture-b',businessDate:'2000-01-01',shiftTemplateId:'fixture-shift-template',shiftTemplateName:'Morning',status:'OPEN'};
const dsrShift={id:'fixture-dsr-shift',outletId:'fixture-b',businessDate:'2000-01-02',shiftTemplateId:'fixture-general',shiftTemplateName:'General Shift',status:'CLOSED'};
const dsrProduct={productId:'ms',productCode:'MS',productName:'Motor Spirit',unit:'LITRE',status:'COMPLETE',missingFields:[],
  openingStockMilliunits:1000000,receiptsMilliunits:0,availableStockMilliunits:1000000,grossSalesMilliunits:200000,testingMilliunits:5000,netSalesMilliunits:195000,
  theoreticalClosingMilliunits:805000,physicalClosingMilliunits:795000,varianceMilliunits:-10000,tankReadings:[]};
const dsrDay={outletId:'fixture-b',outletName:outlets[1].name,businessDate:dsrShift.businessDate,status:'COMPLETE',dayEntryStatus:'COMPLETE',
  operationalDsrStatus:'COMPLETED',financialReconciliationStatus:'PENDING',shiftsCount:1,shifts:[{...dsrShift,shiftNumber:1,financialReconciliationStatus:'PENDING'}],
  byProduct:[dsrProduct],byDispenser:[{dispenserNumber:1,nozzles:[{shiftNumber:1,nozzleNumber:1,productId:'ms',productCode:'MS',openingTotalizerMilliunits:1000000,closingTotalizerMilliunits:1200000,grossSalesMilliunits:200000,testingQuantityMilliunits:5000,netSalesMilliunits:195000,hasReading:true,isUnavailable:false}]}],
  missingFields:[],completion:{expectedTanks:0,openingTankReadings:0,closingTankReadings:0,expectedNozzles:1,nozzleMeterReadings:1,totalReceipts:0,completedReceipts:0,reconciliationComplete:true}};
// Populated, internally consistent saved data for the three operational detail sections.
const detailNozzles=[
  {nozzleId:'fixture-n1',nozzleNumber:1,dispenserId:'disp-1',dispenserNumber:1,dispenserName:'DU 1',productId:'ms',productCode:'MS',productName:'Motor Spirit',tankId:'t-ms',tankNumber:1,openingTotalizerMilliunits:1000000,closingTotalizerMilliunits:1105000,testingQuantityMilliunits:5000,grossSalesMilliunits:105000,netSalesMilliunits:100000},
  {nozzleId:'fixture-n2',nozzleNumber:2,dispenserId:'disp-1',dispenserNumber:1,dispenserName:'DU 1',productId:'ms',productCode:'MS',productName:'Motor Spirit',tankId:'t-ms',tankNumber:1,openingTotalizerMilliunits:2000000,closingTotalizerMilliunits:2095000,testingQuantityMilliunits:0,grossSalesMilliunits:95000,netSalesMilliunits:95000},
  {nozzleId:'fixture-n3',nozzleNumber:1,dispenserId:'disp-2',dispenserNumber:2,dispenserName:'DU 2',productId:'hsd',productCode:'HSD',productName:'High Speed Diesel',tankId:'t-hsd',tankNumber:2,openingTotalizerMilliunits:3000000,closingTotalizerMilliunits:3155000,testingQuantityMilliunits:5000,grossSalesMilliunits:155000,netSalesMilliunits:150000}
].map(n=>({...n,operationalShiftId:dsrShift.id,shiftNumber:1,hasReading:true,isUnavailable:false}));
const detailHsd={...dsrProduct,productId:'hsd',productCode:'HSD',productName:'High Speed Diesel',
  openingStockMilliunits:1000000,availableStockMilliunits:1000000,grossSalesMilliunits:155000,testingMilliunits:5000,netSalesMilliunits:150000,
  theoreticalClosingMilliunits:850000,physicalClosingMilliunits:853000,varianceMilliunits:3000};
const detailTotals=Object.fromEntries(Object.entries(dsrProduct).filter(([key])=>key.endsWith('Milliunits')).map(([key,val])=>[key,val+detailHsd[key]]));
const detailDispensers=[1,2].map(dispenserNumber=>{
  const nozzles=detailNozzles.filter(n=>n.dispenserNumber===dispenserNumber),n=nozzles[0];
  const subtotal={productId:n.productId,productCode:n.productCode,productName:n.productName,netSalesMilliunits:nozzles.reduce((sum,item)=>sum+item.netSalesMilliunits,0)};
  return {dispenserId:n.dispenserId,dispenserNumber,dispenserName:n.dispenserName,netSalesMilliunits:subtotal.netSalesMilliunits,byProduct:[subtotal],nozzles};
});
const metricStr=milli=>(milli/1000).toFixed(3);
const detailEntries=detailNozzles.map((n,index)=>({...n,productUnit:'LITRE',snapshotStatus:'ACTIVE',unavailability:null,
  suggestedOpeningTotalizerMilliunits:n.openingTotalizerMilliunits+(index===0?5000:0),
  suggestedOpeningTotalizer:metricStr(n.openingTotalizerMilliunits+(index===0?5000:0)),
  reading:{...n,openingTotalizerStr:metricStr(n.openingTotalizerMilliunits),closingTotalizerStr:metricStr(n.closingTotalizerMilliunits),
    testingQuantityStr:metricStr(n.testingQuantityMilliunits),grossSalesQuantityStr:metricStr(n.grossSalesMilliunits),netSalesQuantityStr:metricStr(n.netSalesMilliunits),
    grossSalesQuantityMilliunits:n.grossSalesMilliunits,netSalesQuantityMilliunits:n.netSalesMilliunits,
    varianceReason:index===0?'Fixture continuity review':null}}));
const workbenchDay=date=>({...dsrDay,businessDate:date,shifts:[{...dsrDay.shifts[0],businessDate:date,reconciliationComplete:true}],
  deferredShiftClosureAvailable:true,totals:detailTotals,byProduct:[dsrProduct,detailHsd],byDispenser:detailDispensers,
  completion:{...dsrDay.completion,expectedTanks:1,openingTankReadings:1,closingTankReadings:1,expectedNozzles:3,nozzleMeterReadings:3,unavailableNozzles:0,pendingReceipts:0}});
const workbenchBootstrap=date=>({outletId:'fixture-b',outletName:outlets[1].name,businessDate:date,
  shiftTemplates:[{id:dsrShift.shiftTemplateId,code:'GENERAL',name:'General Shift',startTime:'06:00',endTime:'06:00'}],
  shifts:[{shift:{...dsrShift,businessDate:date},shiftTemplateName:'General Shift',shiftTemplateCode:'GENERAL',tanks:[],nozzles:detailEntries,receipts:[],reconciliations:[]}],
  dailySummary:workbenchDay(date)});
const emptyWorkbenchDay=date=>({...workbenchDay(date),outletId:'fixture-a',outletName:outlets[0].name,status:'NOT_STARTED',
  dayEntryStatus:'NO_ENTRY',operationalDsrStatus:'NOT_STARTED',financialReconciliationStatus:'NOT_STARTED',shiftsCount:0,shifts:[],byProduct:[],byDispenser:[],
  completion:{...workbenchDay(date).completion,expectedTanks:0,openingTankReadings:0,closingTankReadings:0,expectedNozzles:0,nozzleMeterReadings:0,unavailableNozzles:0,reconciliationComplete:false}});
const emptyWorkbenchBootstrap=date=>({...workbenchBootstrap(date),outletId:'fixture-a',outletName:outlets[0].name,shifts:[],dailySummary:emptyWorkbenchDay(date)});
// Exact stock/receipt fixtures used only by the isolated stock workspace checks.
const stockTanks=shift=>[dsrProduct,detailHsd].map((p,i)=>({id:'snap-'+p.productId,operationalShiftId:shift.id,outletId:shift.outletId,tankId:'t-'+p.productId,tankNumber:i+1,tankName:p.productCode+' Tank',productId:p.productId,productCode:p.productCode,productName:p.productName,productUnit:'LITRE',capacityMilliunits:5000000,safeFillCapacityMilliunits:4500000}));
const stockReadings=shift=> stockTanks(shift).flatMap((tank,i)=>['OPENING','CLOSING'].map((readingType,j)=>{
  const p=[dsrProduct,detailHsd][i],net=j?p.physicalClosingMilliunits:p.openingStockMilliunits;
  return {...tank,id:'reading-'+tank.tankId+'-'+readingType,readingType,source:'MANUAL',productDipMmStr:j?'795.000':'1000.000',waterDipMmStr:'0.000',grossObservedVolumeStr:metricStr(net),waterVolumeStr:'0.000',netProductVolumeStr:metricStr(net),netProductVolumeMilliunits:net,recordedAt:shift.businessDate+'T'+(j?'16:00:00Z':'06:00:00Z')};
}));
const stockReport=shift=>{
  const rows=stockTanks(shift).map((tank,i)=>{const p=[dsrProduct,detailHsd][i];return {...tank,hasOpeningReading:true,hasClosingReading:true,receiptsCount:0,openingStockStr:metricStr(p.openingStockMilliunits),receiptQuantityStr:'0.000',salesQuantityStr:metricStr(p.netSalesMilliunits),theoreticalClosingStockStr:metricStr(p.theoreticalClosingMilliunits),physicalClosingStockStr:metricStr(p.physicalClosingMilliunits),varianceStr:metricStr(p.varianceMilliunits),varianceStatus:p.varianceMilliunits<0?'LOSS':'GAIN'}});
  return {operationalShiftId:shift.id,outletId:shift.outletId,businessDate:shift.businessDate,byTank:rows,byProduct:rows};
};
const pendingStockReceipt={id:'fixture-receipt',operationalShiftId:historical.id,outletId:historical.outletId,ttNumber:'FIXTURE-TT',invoiceNumber:'FIXTURE-INV',invoiceDate:historical.businessDate,arrivalAt:historical.businessDate+'T07:00:00Z',sealVerified:true,status:'ARRIVED',lines:[]};
const financeClosed={...dsrShift,deferredFinancialStatus:'PENDING'};
const financeCompleted={...dsrShift,id:'fixture-finance-completed',businessDate:'2000-01-03',deferredFinancialStatus:'COMPLETED'};
const financeSummary=shift=>{
  const provisional=shift.status==='OPEN', completed=shift.deferredFinancialStatus==='COMPLETED';
  return {operationalShiftId:shift.id,outletId:shift.outletId,
    salesRevenue:{byProduct:[{productId:'ms',productName:'Motor Spirit',quantityStr:'100.000',unit:'LITRE',pricePerUnitStr:'100.00',revenuePaise:1000000,revenueStr:'10000.00'}],fuelTotalPaise:1000000,fuelTotalStr:'10000.00',
      readingCoverage:{status:provisional?'INCOMPLETE':'COMPLETE',expectedNozzles:2,recordedNozzles:provisional?1:2,unavailableNozzles:0,missingNozzleIds:provisional?['fixture-n2']:[]},cngApplicable:false,cngComplete:false,cngTotalPaise:null,cngTotalStr:null,lubeTotalPaise:0,lubeTotalStr:'0.00',lubeBySku:[],includedComponents:['FUEL','LUBE'],pendingComponents:[],authoritativeTotalPaise:1000000,authoritativeTotalStr:'10000.00'},
    collections:{cashPaise:300000,cashStr:'3000.00',posCardPaise:completed?700000:650000,posCardStr:completed?'7000.00':'6500.00',upiPaise:0,upiStr:'0.00',fleetCardPaise:0,fleetCardStr:'0.00',creditSalesPaise:0,creditSalesStr:'0.00',directBankDropPaise:0,directBankDropStr:'0.00',totalPaise:completed?1000000:950000,totalStr:completed?'10000.00':'9500.00'},
    creditSalesByParty:[],cashHandoverSummary:{totalPendingPaise:200000,totalPendingStr:'2000.00',totalAcknowledgedPaise:0,totalAcknowledgedStr:'0.00'},
    bankDepositSummary:{totalSubmittedPaise:0,totalSubmittedStr:'0.00',totalVerifiedPaise:0,totalVerifiedStr:'0.00',totalRejectedPaise:0,totalRejectedStr:'0.00'},
    cashDepositControl:{cashCollectedPaise:300000,cashCollectedStr:'3000.00',verifiedCashDepositedPaise:0,verifiedCashDepositedStr:'0.00',pendingCashDepositPaise:300000,pendingCashDepositStr:'3000.00'},
    variancePaise:completed?0:50000,varianceStr:completed?'0.00':'500.00',varianceStatus:completed?'BALANCED':'SHORTAGE',varianceReason:null};
};
const ok=data=>({success:true,data,error:null});
const fail=message=>({success:false,data:null,error:{code:'FIXTURE_FAILURE',message}});
async function main(){
  const browser=await chromium.launch({headless:true,...(process.env.QA_CHROMIUM_EXECUTABLE?{executablePath:process.env.QA_CHROMIUM_EXECUTABLE}: {})});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}});
    const errors=[],blocked=[],requests=[];
    page.on('pageerror',error=>errors.push(String(error)));
    let releaseFirst;
    const firstResponse=new Promise(resolve=>{releaseFirst=resolve;});
    let shiftAttempts=0, operationsUi=false, stockUi=false, cngUi=false, lubeUi=false, financeUi=false, performanceUi=false, remainingUi=false, signedOut=false, hierarchyEditUi=false;
    const editedUnits={states:[{id:"fixture-state",code:"ST-01",name:"Fixture State",status:"ACTIVE",createdAt:"2000-01-01T00:00:00Z",updatedAt:"2000-01-01T00:00:00Z"},{id:"fixture-other-state",code:"ST-02",name:"Other State",status:"ACTIVE",createdAt:"2000-01-01T00:00:00Z",updatedAt:"2000-01-01T00:00:00Z"}],divisions:[{id:"fixture-division",stateId:"fixture-state",stateName:"Fixture State",code:"DIV-01",name:"Fixture Division",status:"ACTIVE",createdAt:"2000-01-01T00:00:00Z",updatedAt:"2000-01-01T00:00:00Z"}],"sales-areas":[{id:"fixture-area",divisionId:"fixture-division",divisionName:"Fixture Division",stateId:"fixture-state",code:"SA-01",name:"Fixture Area",status:"ACTIVE",createdAt:"2000-01-01T00:00:00Z",updatedAt:"2000-01-01T00:00:00Z"}]};
    const hierarchyPatches=[];
    const screenshotDir=process.env.QA_SCREENSHOT_DIR;
    if(screenshotDir)await fs.mkdir(screenshotDir,{recursive:true});
    const capture=async(name,locator)=>{if(screenshotDir){const options={path:screenshotDir+'/'+name+'.png',animations:'disabled'};if(locator)await locator.screenshot(options);else await page.screenshot(options);}};
    await page.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url());
      if(['blob:','data:'].includes(url.protocol))return route.continue();
      if(url.origin!==base){if(!['fonts.googleapis.com','fonts.gstatic.com'].includes(url.hostname))blocked.push(req.url());return route.abort();}
      if(!url.pathname.startsWith('/api/'))return route.continue();
      requests.push(url.pathname);
      // Only the explicit hierarchy fixture edit test may perform an intercepted PATCH.
      // All other mutations remain blocked and nothing is sent to a real API.
      if(hierarchyEditUi && url.pathname.startsWith('/api/v1/hierarchy/')){
        const [kind,id]=url.pathname.slice('/api/v1/hierarchy/'.length).split('/');
        const units=editedUnits[kind];
        if(units && !id && req.method()==='GET')return route.fulfill({json:ok(units)});
        if(units && id && req.method()==='PATCH'){
          const current=units.find(x=>x.id===id),body=req.postDataJSON();
          assert(current,'Unknown hierarchy fixture');
          assert.deepEqual(Object.keys(body).sort(),['code','expectedUpdatedAt','name']);
          assert.equal(body.expectedUpdatedAt,current.updatedAt);
          if(body.name==='Fixture rejected change')return route.fulfill({status:409,json:{success:false,data:null,error:{code:'DUPLICATE_CODE',message:'Another unit of this type already uses that code.'}}});
          hierarchyPatches.push({kind,id,body});
          Object.assign(current,{name:body.name,code:body.code,updatedAt:'2000-01-02T00:00:00Z'});
          if(kind==='states')for(const div of editedUnits.divisions)if(div.stateId===id)div.stateName=current.name;
          if(kind==='divisions')for(const area of editedUnits['sales-areas'])if(area.divisionId===id)area.divisionName=current.name;
          return route.fulfill({json:ok(current)});
        }
      }
      if(req.method()!=='GET'){blocked.push(req.method()+' '+url.pathname);return route.abort();}
      const path=url.pathname;
      if(path==='/api/v1/auth/me')return signedOut?route.fulfill({status:401,json:fail('Signed out fixture')}):route.fulfill({json:ok(auth)});
      if(path==='/api/v1/outlets')return route.fulfill({json:ok(outlets)});
      if(path==='/api/v1/users'||path==='/api/v1/hierarchy/states')return route.fulfill({json:ok([])});
      // Additional workspaces use explicit empty list fixtures where applicable;
      // unknown record/summary endpoints return a controlled unavailable response.
      if(remainingUi){
        if(['/api/v1/products','/api/v1/scopes','/api/v1/hierarchy/divisions','/api/v1/hierarchy/sales-areas','/api/v1/org/departments','/api/v1/org/officers','/api/v1/org/service-providers','/api/v1/roles','/api/v1/roles/permissions','/api/v1/audit-logs'].includes(path))return route.fulfill({json:ok([])});
        return route.fulfill({status:503,json:fail('Fixture module records unavailable')});
      }
      if(performanceUi && path.includes('/reports/monthly-operations')){
        const isPdf=path.endsWith('/pdf'), id=path.split('/')[4];
        const requestedOutlet=outlets.find(o=>o.id===id);
        const month=url.searchParams.get('month'), cutoffMode=url.searchParams.get('cutoffMode');
        if(!requestedOutlet||!month||!cutoffMode)return route.fulfill({json:fail('Missing report selection')});
        if(isPdf){
          const pdf=await PDFDocument.create();pdf.addPage().drawText('Fixture monthly performance report');
          return route.fulfill({status:200,contentType:'application/pdf',body:Buffer.from(await pdf.save()),headers:{'Content-Disposition':'attachment; filename="fixture-monthly-performance.pdf"'}});
        }
        if(month==='2000-03')return route.fulfill({json:fail('Fixture performance report unavailable')});
        const empty=month==='2000-02'&&cutoffMode==='LATEST_DATA';
        const cutoffDate=empty?'':cutoffMode==='SELECTED_DATE'?url.searchParams.get('cutoffDate'):cutoffMode==='LATEST_DATA'?month+'-02':month+'-28';
        const latestDataDate=empty?null:month+'-02';
        if(month==='2000-04')await new Promise(resolve=>setTimeout(resolve,500));
        return route.fulfill({json:ok({outletId:id,outletName:requestedOutlet.name,month,cutoffMode,cutoffDate,latestDataDate,
          productSections:[],dgSection:{rows:[],totals:{totalRunningMinutes:150,totalRunningHoursStr:'2:30',totalHsdConsumedMilliunits:12345,totalHsdConsumedStr:'12.345',totalAmountPaise:0,totalAmountStr:'0.00'}},
          dgSummary:{totalLogs:2,totalRunHours:2.5,totalDieselConsumedLitres:12.345,averageDailyRunHours:1.25,totalGridFailureMinutes:0,totalRunningHoursStr:'2:30'},
          fuelSummary:{totalShiftsCount:id==='fixture-b'?7:2,totalSalesPaise:id==='fixture-b'?12345678:200000},
          breakdownSummary:{totalTickets:3,openTickets:1,resolvedTickets:2},hrSummary:{totalStaff:11,presentDaysCount:62}})});
      }
      if(financeUi){
        const outlet='/api/v1/outlets/fixture-b';
        if(path===outlet+'/shifts')return route.fulfill({json:ok([financeClosed,financeCompleted,historical])});
        if([outlet+'/product-prices',outlet+'/credit-parties',outlet+'/products'].includes(path))return route.fulfill({json:ok([])});
        for(const shift of [financeClosed,financeCompleted,historical]){
          const prefix='/api/v1/shifts/'+shift.id;
          if(path===prefix)return route.fulfill({json:ok(shift)});
          if(path===prefix+'/financial-summary')return route.fulfill({json:ok(financeSummary(shift))});
          if([prefix+'/collections',prefix+'/cash-handovers',prefix+'/bank-deposits'].includes(path))return route.fulfill({json:ok([])});
        }
      }
      if(lubeUi){
        const sku={id:'fixture-lube-sku',outletId:'fixture-b',skuCode:'LUBE-001',name:'Fixture Engine Oil',category:'Lubricant',stockUnit:'LITRE',reorderThreshold:'5.000',reorderThresholdSubunits:5000,status:'ACTIVE'};
        const stock={lubeSkuId:sku.id,skuCode:sku.skuCode,skuName:sku.name,category:sku.category,stockUnit:sku.stockUnit,currentStock:'3.500',currentStockSubunits:3500,reorderThreshold:'5.000',reorderThresholdSubunits:5000,isLowStock:true,status:'ACTIVE'};
        const item={lubeSkuId:sku.id,skuCode:sku.skuCode,skuName:sku.name,category:sku.category,stockUnit:sku.stockUnit,quantitySubunits:2500,quantity:'2.500',saleCount:1,revenuePaise:87500,revenueStr:'875.00'};
        const totals={bySku:[item],totalRevenuePaise:87500,totalRevenueStr:'875.00',quantitiesByUnit:{litre:'2.500',pack:'0'}};
        const outlet='/api/v1/outlets/fixture-b';
        if(path===outlet+'/shifts')return route.fulfill({json:ok([dsrShift,historical])});
        if(path===outlet+'/lube/skus')return route.fulfill({json:ok([sku])});
        if(path===outlet+'/lube/prices')return route.fulfill({json:ok([{id:'fixture-price',outletId:'fixture-b',lubeSkuId:sku.id,pricePaisePerUnit:35000,pricePerUnitStr:'350.00',effectiveFrom:'2000-01-01',effectiveTo:null,status:'ACTIVE'}])});
        if(path===outlet+'/lube/stock-summary'||path===outlet+'/lube/low-stock')return route.fulfill({json:ok([stock])});
        if(path===outlet+'/lube/stock-transactions')return route.fulfill({json:ok([{id:'fixture-transaction',outletId:'fixture-b',lubeSkuId:sku.id,transactionType:'RECEIPT',quantity:'6.000',quantitySubunits:6000,occurredAt:'2000-01-02T08:00:00Z',referenceNumber:'FIXTURE-RECEIPT'}])});
        if(path===outlet+'/lube/daily-summary')return route.fulfill({json:ok({...totals,outletId:'fixture-b',businessDate:url.searchParams.get('businessDate'),shiftCountWithLubeSales:1,saleLineCount:1})});
        for(const shift of [dsrShift,historical]){
          const prefix='/api/v1/shifts/'+shift.id;
          if(path===prefix)return route.fulfill({json:ok(shift)});
          if(path===prefix+'/lube-sales')return route.fulfill({json:ok(shift.status==='CLOSED'?[{...item,id:'fixture-lube-sale',operationalShiftId:shift.id,outletId:'fixture-b',unitPricePaise:35000,unitPriceStr:'350.00',soldAt:'2000-01-02T09:00:00Z'}]:[])});
          if(path===prefix+'/lube-summary')return route.fulfill({json:ok({...totals,operationalShiftId:shift.id,outletId:'fixture-b',businessDate:shift.businessDate,...(shift.status==='OPEN'?{bySku:[],totalRevenuePaise:0,totalRevenueStr:'0.00',quantitiesByUnit:{litre:'0.000',pack:'0'}}:{})})});
          if(path===prefix+'/financial-summary')return route.fulfill({json:ok(null)});
        }
      }
      if(cngUi){
        if(path==='/api/v1/outlets/fixture-b/shifts')return route.fulfill({json:ok([dsrShift,historical])});
        for(const shift of [dsrShift,historical]){
          const prefix='/api/v1/shifts/'+shift.id, closed=shift.status==='CLOSED';
          if(path===prefix)return route.fulfill({json:ok(shift)});
          if(path===prefix+'/cng-log')return route.fulfill({json:ok(closed?{
            id:'fixture-cng-log',operationalShiftId:shift.id,outletId:shift.outletId,
            mfmOpeningKg:'10500.000',mfmClosingKg:'11250.500',netSalesKg:'750.500',
            gridIntakeKg:'755.500',gridSalesVarianceKg:'5.000',notes:'Fixture MFM remarks'
          }:null)});
          if(path===prefix+'/cng-pressure-readings')return route.fulfill({json:ok(closed?[{
            id:'fixture-pressure',operationalShiftId:shift.id,outletId:shift.outletId,
            recordedAt:shift.businessDate+'T08:30:00Z',pressureUnit:'bar',suctionPressure:'5.000',
            dischargePressure:'250.000',cascadePressure:null,notes:'Fixture pressure remarks'
          }]:[])});
        }
        if(path==='/api/v1/outlets/fixture-b/cng/daily-summary'){
          const date=url.searchParams.get('businessDate'), closed=date===dsrShift.businessDate;
          return route.fulfill({json:ok({outletId:'fixture-b',businessDate:date,shiftCount:closed?1:0,
            totalMfmSalesKg:closed?'750.500':'0.000',gridIntakeKg:closed?'755.500':null,
            gridSalesVarianceKg:closed?'5.000':null,gridDataComplete:closed})});
        }
      }
      if(stockUi){
        if(path==='/api/v1/outlets/fixture-a/shifts')return route.fulfill({json:ok([])});
        if(path==='/api/v1/outlets/fixture-b/shifts')return route.fulfill({json:ok([dsrShift,historical])});
        for(const shift of [dsrShift,historical]){
          const prefix='/api/v1/shifts/'+shift.id;
          if(path===prefix+'/tank-snapshots')return route.fulfill({json:ok(stockTanks(shift))});
          if(path===prefix+'/tank-readings')return route.fulfill({json:ok(stockReadings(shift))});
          if(path===prefix+'/fuel-receipts')return route.fulfill({json:ok(shift.status==='OPEN'?[pendingStockReceipt]:[])});
          if(path===prefix+'/stock-reconciliation')return route.fulfill({json:ok(stockReport(shift))});
        }
      }
      if(path==='/api/v1/outlets/fixture-b/shifts'){
        shiftAttempts++;
        if(shiftAttempts===1){await firstResponse;return route.fulfill({status:503,json:fail('Fixture shift list unavailable')});}
        return route.fulfill({json:ok([historical])});
      }
      if(path==='/api/v1/outlets/fixture-a/daily-operations'&&operationsUi)return route.fulfill({json:ok(emptyWorkbenchBootstrap(url.searchParams.get('businessDate')))});
      if(path==='/api/v1/outlets/fixture-b/daily-operations'&&operationsUi)return route.fulfill({json:ok(workbenchBootstrap(url.searchParams.get('businessDate')))});
      if(path==='/api/v1/outlets/fixture-b/fuel/daily-summary'){
        const date=url.searchParams.get('businessDate');
        if(operationsUi)return route.fulfill({json:ok(workbenchDay(date))});
        if(date===dsrShift.businessDate)return route.fulfill({json:ok(dsrDay)});
        if(/^2000-01-\d{2}$/.test(date||''))return route.fulfill({json:ok({...dsrDay,businessDate:date,
          status:'NOT_STARTED',dayEntryStatus:'NO_ENTRY',operationalDsrStatus:'NOT_STARTED',financialReconciliationStatus:'NOT_STARTED',
          shiftsCount:0,shifts:[],byProduct:[],byDispenser:[],completion:{...dsrDay.completion,expectedNozzles:0,nozzleMeterReadings:0,reconciliationComplete:false}})});
      }
      if(path==='/api/v1/outlets/fixture-a/fuel/daily-summary'&&operationsUi){
        const date=url.searchParams.get('businessDate');
        return route.fulfill({json:ok(emptyWorkbenchDay(date))});
      }
      if(path==='/api/v1/shifts/'+dsrShift.id+'/tank-snapshots')return route.fulfill({json:ok([
        {outletId:'fixture-b',operationalShiftId:dsrShift.id,tankId:'t-ms',tankNumber:1,tankName:'MS Tank',productId:'ms',productCode:'MS',productUnit:'LITRE',capacityMilliunits:50000000},
        {outletId:'fixture-b',operationalShiftId:dsrShift.id,tankId:'t-hsd',tankNumber:2,tankName:'HSD Tank',productId:'hsd',productCode:'HSD',productUnit:'LITRE',capacityMilliunits:30000000},
      ])});
      if(path==='/api/v1/shifts/'+dsrShift.id+'/tank-readings')return route.fulfill({json:ok([
        {outletId:'fixture-b',operationalShiftId:dsrShift.id,tankId:'t-ms',productId:'ms',netProductVolumeMilliunits:25000000,recordedAt:new Date().toISOString(),readingType:'CLOSING'},
      ])});
      if(path==='/api/v1/shifts/'+dsrShift.id)return route.fulfill({json:ok(dsrShift)});
      if(path.includes('/fuel/daily-summary'))return route.fulfill({status:503,json:fail('Fixture deliberately has no daily summary')});
      blocked.push(path);return route.fulfill({status:404,json:fail('Unexpected QA request')});
    });
    try{
      await page.goto(base+'/outlets');
      await page.getByRole('heading',{name:'Retail Outlets',exact:true}).waitFor();
      const outlet=page.getByRole('combobox',{name:'Active retail outlet'});
      await outlet.waitFor();
      await outlet.selectOption('fixture-b');
      assert.equal(await outlet.inputValue(),'fixture-b');
      async function checkViewport(width,height){
        await page.setViewportSize({width,height});
        const bounds=await outlet.boundingBox();
        assert(bounds&&bounds.x>=0&&bounds.x+bounds.width<=width+1,'Outlet selector clipped at '+width);
        const docWidth=await page.evaluate(()=>document.documentElement.scrollWidth);
        assert(docWidth<=width+1,'Document has horizontal overflow at '+width);
      }
      for(const [w,h] of [[320,640],[390,844],[768,1024],[1024,768],[1440,900],[390,844]])await checkViewport(w,h);
      const menu=page.locator('#mobile-navigation-toggle');
      await menu.click();
      let drawer=page.getByRole('dialog',{name:'Navigation menu'});
      await drawer.waitFor();
      assert.equal(await menu.getAttribute('aria-expanded'),'true');
      await page.keyboard.press('Escape');
      await drawer.waitFor({state:'hidden'});
      await page.waitForFunction(()=>document.activeElement?.id==='mobile-navigation-toggle');
      await menu.click();
      drawer=page.getByRole('dialog',{name:'Navigation menu'});
      await drawer.getByRole('searchbox',{name:'Find a page'}).fill('CNG');
      await drawer.getByRole('button',{name:'CNG Operations',exact:true}).click();
      await drawer.waitFor({state:'hidden'});
      await page.getByRole('heading',{name:'CNG Operations',exact:true}).waitFor();
      await page.getByText('Loading saved CNG records…',{exact:true}).waitFor();
      assert.equal(await page.getByRole('combobox',{name:'CNG retail outlet'}).inputValue(),'fixture-b');
      releaseFirst();
      await page.getByText('Fixture shift list unavailable',{exact:true}).waitFor();
      await page.getByRole('button',{name:'Retry',exact:true}).click();
      await page.getByRole('heading',{name:'Select a Shift',exact:true}).waitFor();
      assert.equal(await page.getByRole('combobox',{name:'CNG operational shift'}).inputValue(),'');
      assert(shiftAttempts>=2,'Retry did not issue a fresh read');
      const childTags=await page.getByRole('combobox',{name:'CNG retail outlet'}).evaluate(el=>Array.from(el.children,child=>child.tagName));
      assert(childTags.every(tag=>tag==='OPTION'||tag==='OPTGROUP'),'Invalid select child');
      assert.equal(await page.getByRole('heading',{name:'CNG MFM & Grid Reconciliation'}).count(),0,'Unselected historical shift rendered entry form');
      assert.equal(await outlet.inputValue(),'fixture-b');
      assert(!requests.some(path=>path.includes('/shifts/fixture-old-shift')),'Historical shift was loaded without explicit selection');
      // DSR: historical shift lookup, optional remarks, actual PDF download and refresh isolation.
      await page.goto(base+'/dsr-reports');
      await page.getByRole('heading',{name:'Daily Sales Reports (DSR)',exact:true}).waitFor();
      await page.getByLabel('Business date',{exact:true}).fill(dsrShift.businessDate);
      assert(await page.getByRole('button',{name:'Download PDF',exact:true}).isDisabled(),'Report must be retrieved before export');
      await page.getByRole('button',{name:'Retrieve DSR',exact:true}).click();
      await page.getByText('Shift: General Shift',{exact:false}).waitFor();
      const remark=page.getByRole('textbox',{name:'Operator remarks for '+dsrShift.businessDate});
      await remark.fill('QA: verify dip before sign-off.');
      await page.getByRole('button',{name:'Preview PDF',exact:true}).click();
      await page.getByTitle('DSR PDF preview').waitFor();
      await remark.fill('\u091f\u093f\u092a\u094d\u092a\u0923\u0940');
      assert(await page.getByRole('button',{name:'Download PDF',exact:true}).isDisabled(),'Unsupported remark must not export silently');
      await page.getByTitle('DSR PDF preview').waitFor({state:'hidden'});
      await remark.fill('QA: verify dip before sign-off.');
      const downloadPromise=page.waitForEvent('download');
      await page.getByRole('button',{name:'Download PDF',exact:true}).click();
      const download=await downloadPromise;
      async function readPdf(file){
        const pdf=await PDFDocument.load(await fs.readFile(await file.path()));
        let content='';
        for(const pdfPage of pdf.getPages()){
          const streams=pdfPage.node.Contents();
          for(let i=0;i<streams.size();i++){
            const stream=pdf.context.lookup(streams.get(i));
            assert(stream instanceof PDFRawStream);
            content+=Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
          }
        }
        return {pdf,content,has:phrase=>content.includes(Buffer.from(phrase,'ascii').toString('hex').toUpperCase())};
      }
      const {content}=await readPdf(download);
      for(const phrase of ['Shift: General Shift',' IST','GRAND TOTAL LITRE','195.000','QA: verify dip before sign-off.']){
        assert(content.includes(Buffer.from(phrase,'ascii').toString('hex').toUpperCase()),'Downloaded DSR missing '+phrase);
      }
      await page.getByRole('button',{name:'Refresh report',exact:true}).click();
      await remark.waitFor();assert.equal(await remark.inputValue(),'','Refresh must clear export-only remarks');
      assert(requests.includes('/api/v1/shifts/'+dsrShift.id),'Exact historic shift-name lookup missing');
      // Period report defaults to consolidated, with explicit detailed audit export.
      await page.getByRole('button',{name:'Monthly',exact:true}).click();
      await page.getByLabel('Month',{exact:true}).fill('2000-01');
      const consolidatedButton=page.getByRole('button',{name:'Consolidated DSR',exact:true});
      assert.equal(await consolidatedButton.getAttribute('aria-pressed'),'true');
      await page.getByRole('button',{name:'Retrieve DSR',exact:true}).click();
      await page.getByRole('heading',{name:'Product-wise consolidated quantities',exact:true}).waitFor();
      await page.getByRole('img',{name:'1 complete, 0 partial, 30 no-entry business dates'}).waitFor();
      assert.equal(await page.locator('.ops-record[data-empty="true"]').count(),2,'No-entry dates must be grouped into two exact ranges');
      await page.getByRole('region',{name:'Recorded quantities LITRE'}).getByText('195.000',{exact:true}).waitFor();
      for(const [w,h] of [[320,640],[390,844],[768,1024],[1440,900]])await checkViewport(w,h);
      await page.evaluate(()=>window.scrollTo(0,0));
      await capture('dsr-selection-desktop');
      await capture('dsr-coverage-desktop',page.getByRole('region',{name:'Report coverage'}));
      await capture('dsr-quantities-desktop',page.getByRole('region',{name:'Recorded quantities LITRE'}));
      await capture('dsr-table-desktop',page.getByRole('region',{name:'Consolidated product quantities'}));
      await checkViewport(390,844);
      await page.evaluate(()=>window.scrollTo(0,0));
      await capture('dsr-selection-mobile');
      await capture('dsr-coverage-mobile',page.getByRole('region',{name:'Report coverage'}));
      async function downloadReport(){
        const pending=page.waitForEvent('download');
        await page.getByRole('button',{name:'Download PDF',exact:true}).click();
        return await pending;
      }
      const monthFile=await downloadReport();
      assert(monthFile.suggestedFilename().endsWith('-consolidated.pdf'));
      const month=await readPdf(monthFile);
      for(const phrase of ['MONTHLY CONSOLIDATED DSR','RECORDED TOTAL','2000-01-03 to 2000-01-31','195.000','0.000 [1/31]','PENDING'])assert(month.has(phrase),'Consolidated PDF missing '+phrase);
      assert(!month.has('Dispenser and nozzle-wise meter statement'),'Consolidated PDF includes unnecessary daily meters');
      await page.getByRole('button',{name:'Detailed DSR',exact:true}).click();
      await page.getByRole('heading',{name:'Product-wise net sales',exact:true}).waitFor();
      const detailFile=await downloadReport();
      assert(detailFile.suggestedFilename().endsWith('-detailed.pdf'));
      const detail=await readPdf(detailFile);
      assert(detail.pdf.getPageCount()>month.pdf.getPageCount(),'Detailed monthly PDF should include the day-level evidence');
      assert(detail.has('GRAND TOTAL LITRE'),'Detailed export lost meter totals');
      // Test the actual dashboard and daily workspace UI with isolated saved statuses.
      operationsUi=true;
      await page.goto(base+'/dashboard');
      await page.getByRole('heading',{name:'Outlet command centre',exact:true}).waitFor();
      const todayPanel=page.getByRole('region',{name:"Today's operational status"}).locator('.cc-status-grid');
      await todayPanel.getByText('COMPLETED',{exact:true}).waitFor();
      await todayPanel.getByText('CLOSED',{exact:true}).waitFor();
      await todayPanel.getByText('PENDING',{exact:true}).waitFor();
      let hierarchy=page.getByRole('region',{name:'Organization hierarchy'});
      await hierarchy.getByText('Fixture State',{exact:true}).waitFor();
      await hierarchy.getByText('Fixture Division',{exact:true}).waitFor();
      await hierarchy.getByText('Fixture Area',{exact:true}).waitFor();
      await hierarchy.getByText('2 accessible active outlets',{exact:false}).waitFor();
      assert.equal(await page.getByTestId('workspace-task-finder').count(),1,'Dashboard must retain exactly one task finder');
      await page.getByTestId('workspace-task-finder').getByRole('button',{name:'Find a task'}).click();
      const taskQuery=page.locator('#iocl-workspace-task-query');
      await taskQuery.fill('bank deposit');
      await page.getByTestId('workspace-task-finder').getByText('No accessible tasks found.',{exact:false}).waitFor();
      await taskQuery.press('Escape');
      await taskQuery.waitFor({state:'hidden'});
      assert((await hierarchy.textContent()).includes('Primary access: Sales area'));
      const quick=page.getByRole('region',{name:'Quick actions'});
      assert.equal(await quick.locator('[data-module="financials"]').count(),0,'Restricted finance tile visible');
      assert.equal(await quick.locator('[data-module="pump-infra"]').count(),0,'Restricted tank setup tile visible');
      assert.equal(await page.getByRole('region',{name:'Saved tank stock overview'}).count(),0,'Unassigned tank stock view visible');
      assert(!requests.some(p=>p.includes('/tank-snapshots')||p.includes('/tank-readings')),'Restricted tank resource requested');
      await page.getByRole('region',{name:'Attention centre'}).getByText('Finance pending',{exact:true}).waitFor();
      assert.equal(await page.getByRole('region',{name:'Attention centre'}).getByRole('button',{name:'Collections & Finance'}).count(),0,'Restricted finance CTA visible');
      // Authorized scope stays the same; exercise a fully assigned user, then switch outlets.
      auth.permissions.push('shifts.open','tank_stock.read','financial_reconciliation.read','tanks.read','documents.read','equipment.read','lube_operations.read');
      await page.goto(base+'/dashboard');
      await page.getByRole('heading',{name:'Outlet command centre',exact:true}).waitFor();
      const savedStock=page.getByRole('region',{name:'Saved tank stock overview'});
      await savedStock.getByText('25,000 L',{exact:true}).waitFor();
      await savedStock.getByText('50.0% of nominal capacity',{exact:true}).waitFor();
      await savedStock.getByText('Not recorded',{exact:true}).waitFor();
      await page.getByRole('region',{name:'Attention centre'}).getByText('Finance pending',{exact:true}).waitFor();
      const activeHierarchy=page.getByRole('region',{name:'Organization hierarchy'});
      await activeHierarchy.getByText(outlets[1].name+' · '+outlets[1].roCode,{exact:true}).waitFor();
      for(const [w,h] of [[320,640],[390,844],[768,1024],[1440,900]])await checkViewport(w,h);
      await page.evaluate(()=>window.scrollTo(0,0));await capture('dashboard-desktop');
      await capture('dashboard-quick-access',page.getByRole('region',{name:'Quick actions'}));
      await capture('dashboard-stock',savedStock);
      await checkViewport(390,844);await page.evaluate(()=>window.scrollTo(0,0));await capture('dashboard-mobile');
      await outlet.selectOption('fixture-a');
      await activeHierarchy.getByText(outlets[0].name+' · '+outlets[0].roCode,{exact:true}).waitFor();
      await page.getByRole('region',{name:'Attention centre'}).getByText('No shift recorded',{exact:true}).waitFor();
      assert.equal(await savedStock.getByText('25,000 L',{exact:true}).count(),0,'Stale previous-outlet stock leaked');
      await savedStock.getByText('No shift recorded today',{exact:true}).waitFor();
      await checkViewport(1440,900);await page.evaluate(()=>window.scrollTo(0,0));await capture('dashboard-no-shift');
      await outlet.selectOption('fixture-b');
      await savedStock.getByText('25,000 L',{exact:true}).waitFor();
      auth.permissions.splice(5);
      await page.goto(base+'/daily-operations');
      await page.getByRole('heading',{name:'Three independent statuses',exact:true}).waitFor();
      assert.equal((await page.getByTestId('operational-dsr-status').textContent()).trim(),'COMPLETED');
      assert.equal((await page.getByTestId('financial-reconciliation-status').textContent()).trim(),'PENDING');
      await page.getByRole('heading',{name:'Shift workbench',exact:true}).waitFor();
      assert(await page.getByRole('button',{name:'Compute Stock Reconciliation',exact:true}).isDisabled(),'Closed shift must remain read-only');
      assert.equal(await page.getByTestId('close-operational-shift').count(),0,'Closed shift must not offer close again');
      const opsProgress=page.getByRole('region',{name:'Daily operations progress'});
      await opsProgress.getByText('None recorded',{exact:true}).waitFor();
      assert((await opsProgress.textContent()).includes('no entries / not expected'),'No receipts must be distinguished from pending work');
      for(const [w,h] of [[320,640],[390,844],[768,1024],[1440,900]])await checkViewport(w,h);
      await page.evaluate(()=>window.scrollTo(0,0));await capture('daily-desktop');
      await capture('daily-status-desktop',page.getByRole('region',{name:'Independent DSR and financial reconciliation'}));
      await checkViewport(390,844);await page.evaluate(()=>window.scrollTo(0,0));await capture('daily-mobile');
      // Daily page shares the approved dashboard language while keeping the same authorized outlet.
      const dailyPath=page.getByRole('list',{name:'Selected outlet hierarchy'});
      await dailyPath.getByText(outlets[1].name+' · '+outlets[1].roCode,{exact:true}).waitFor();
      assert.equal(await page.getByTestId('workspace-task-finder').count(),1,'Daily workspace has duplicate task finders');
      assert.equal(await page.getByRole('button',{name:'Open Shift',exact:true}).count(),0,'Read-only role offered shift opening');
      assert.equal(await page.getByRole('button',{name:'Collections & finance',exact:false}).count(),0,'Restricted finance shortcut visible');
      assert.equal(await page.locator('.dc-admin-tools').count(),0,'Non-global admin has reset tools');
      await checkViewport(1440,900);
      await capture('daily-workbench',page.getByRole('navigation',{name:'Jump to daily entry task'}));
      // Populated meter grid, dispenser subtotal cards and stock summary retain exact values.
      const meters=page.locator('#daily-nozzle-readings');
      const dispensers=page.locator('.dc-dispensers');
      const stock=page.locator('.dc-stock-summary');
      await meters.getByRole('heading',{name:'2. Nozzle Meter Entry Grid (3 Configured Nozzles)',exact:true}).waitFor();
      assert.equal(await meters.locator('tbody tr').count(),3);
      assert.equal(await meters.getByText('Saved',{exact:true}).count(),3);
      assert.equal(await meters.locator('tr[data-dispenser-start="true"]').count(),1);
      assert.equal(await meters.locator('input:not(:disabled)').count(),0,'Closed meter readings became editable');
      assert.equal(await meters.getByRole('button',{name:'Save',exact:true}).count(),0);
      await meters.getByText('Prev: 1005.000 | Curr: 1000.000 | Diff: -5.000',{exact:true}).waitFor();
      await dispensers.locator('.dc-dispenser-total').getByText('195.000 L',{exact:true}).waitFor();
      await dispensers.locator('.dc-dispenser-total').getByText('150.000 L',{exact:true}).waitFor();
      assert.equal((await stock.locator('.dc-variance-value[data-tone="negative"]').textContent()).trim(),'-10.000');
      assert.equal((await stock.locator('.dc-variance-value[data-tone="positive"]').textContent()).trim(),'+3.000');
      await stock.locator('tfoot').getByText('345.000',{exact:true}).waitFor();
      await stock.locator('tfoot').getByText('-7.000',{exact:true}).waitFor();
      for(const [w,h] of [[320,640],[390,844],[768,1024],[1024,768],[1440,900]]){
        await checkViewport(w,h);
        for(const panel of [meters,dispensers,stock]){
          const bounds=await panel.boundingBox();
          assert(bounds&&bounds.x>=0&&bounds.x+bounds.width<=w+1,'Operational detail panel clipped at '+w);
        }
        if(w===390||w===1440){
          await capture('daily-meter-grid-'+w,meters);
          await capture('daily-dispenser-sales-'+w,dispensers);
          await capture('daily-stock-summary-'+w,stock);
        }
      }
      await stock.getByRole('button',{name:'Open Full DSR',exact:false}).click();
      await page.getByTestId('dsr-summary-view').waitFor();
      await page.getByRole('button',{name:'Daily Entry',exact:true}).click();
      await stock.waitFor();

      await page.locator('#daily-outlet').selectOption('fixture-a');
      await dailyPath.getByText(outlets[0].name+' · '+outlets[0].roCode,{exact:true}).waitFor();
      await page.getByRole('heading',{name:'Start daily operations',exact:true}).waitFor();
      await page.getByRole('region',{name:'Daily operations progress'}).getByText('Not opened',{exact:true}).waitFor();
      assert.equal((await page.getByTestId('operational-dsr-status').textContent()).trim(),'NOT STARTED');
      assert.equal((await page.getByTestId('financial-reconciliation-status').textContent()).trim(),'NOT STARTED');
      assert.equal(await page.getByRole('region',{name:'Daily operations progress'}).getByText('0 / 0',{exact:true}).count(),0,'No expected readings should not show 0/0');
      assert.equal(await page.getByRole('heading',{name:'Shift workbench',exact:true}).count(),0,'Stale outlet workbench displayed');
      auth.permissions.push('shifts.open','tank_stock.read','financial_reconciliation.read');
      auth.roles=['ADMIN'];auth.primaryScope='GLOBAL';auth.isGlobalScope=true;auth.isGlobalAdmin=true;
      await page.goto(base+'/daily-operations');
      await page.getByRole('button',{name:'Open Shift',exact:true}).waitFor();
      await dailyPath.getByText(outlets[0].name+' · '+outlets[0].roCode,{exact:true}).waitFor();
      const notes=page.locator('#shift-opening-notes');
      assert.equal(await notes.isVisible(),false,'Optional notes should start compact');
      await page.locator('.dc-shift-notes>summary').click();
      await notes.fill('Fixture note not saved');
      await page.locator('.dc-shift-notes>summary').click();
      await page.locator('.dc-shift-notes>summary').click();
      assert.equal(await notes.inputValue(),'Fixture note not saved','Collapsing notes lost unsaved text');
      await notes.fill('');
      await page.locator('.dc-shift-notes>summary').click();
      const admin=page.locator('.dc-admin-tools');
      const reset=page.getByTestId('daily-ops-test-data-reset-panel');
      assert.equal(await reset.isVisible(),false,'Reset form must not dominate daily operations');
      await admin.locator(':scope>summary').click();await reset.waitFor();
      await admin.locator(':scope>summary').click();await reset.waitFor({state:'hidden'});
      for(const [w,h] of [[320,640],[390,844],[768,1024],[1024,768],[1440,900]]){
        await checkViewport(w,h);
        for(const selector of ['.dc-context','.dc-hero','.dc-attention','.dc-progress','.dc-primary-action']){
          const b=await page.locator(selector).boundingBox();assert(b&&b.x>=0&&b.x+b.width<=w+1,selector+' clipped at '+w);
        }
      }
      const attentionPanel=page.getByRole('region',{name:'Attention centre'});
      await attentionPanel.getByText('No shift recorded',{exact:true}).waitFor();
      for(const selector of ['.dc-attention-top','.dc-attention-footer']){
        const background=await attentionPanel.locator(selector).evaluate(el=>getComputedStyle(el).backgroundColor);
        assert.equal(background,'rgba(0, 0, 0, 0)','Sidebar theme leaked into attention panel');
      }
      await page.evaluate(()=>window.scrollTo(0,0));await capture('daily-no-shift-desktop');
      await capture('daily-no-shift-progress',page.getByRole('region',{name:'Daily operations progress'}));
      await capture('daily-admin-collapsed',admin);
      await checkViewport(390,844);await page.evaluate(()=>window.scrollTo(0,0));await capture('daily-no-shift-mobile');
      // Stock command centre: all four tasks, saved quantities and shift guards.
      stockUi=true;
      auth.permissions.push('tank_stock.write','fuel_receipts.read','fuel_receipts.write','stock_reconciliation.read');
      await page.goto(base+'/stock');
      await page.getByRole('heading',{name:'Stock & Decantation Operations',exact:true}).waitFor();
      await page.locator('#stock-outlet').selectOption('fixture-b');
      const stockShift=page.locator('#stock-shift');
      await stockShift.selectOption(dsrShift.id);
      const stockScope=page.getByRole('list',{name:'Selected outlet hierarchy'});
      await stockScope.getByText(outlets[1].name+' · '+outlets[1].roCode,{exact:true}).waitFor();
      const stockHero=page.getByRole('region',{name:'Current stock shift'});
      await stockHero.getByText('CLOSED',{exact:true}).waitFor();
      await stockHero.getByRole('heading',{name:'General Shift',exact:true}).waitFor();
      const stockTasks=page.getByRole('region',{name:'Stock operations sections'});
      const stockOverview=page.getByRole('region',{name:'Shift stock snapshot'});
      assert.equal(await stockOverview.locator('.stock-metric').count(),4);
      const openingTask=stockTasks.getByRole('button',{name:/Opening Stock/});
      await openingTask.click();
      await page.getByRole('heading',{name:'Opening Tank Stock Dips',exact:true}).waitFor();
      const table=page.locator('.stock-data-panel');
      assert.equal(await table.getByText('Recorded',{exact:true}).count(),2);
      assert.equal(await page.getByRole('button',{name:/Record opening dip/}).count(),0,'Closed shift offered stock entry');
      assert.equal(await openingTask.getAttribute('aria-current'),'step');
      for(const [w,h] of [[320,640],[390,844],[768,1024],[1024,768],[1440,900]]){
        await checkViewport(w,h);
        for(const panel of [stockHero,stockTasks,stockOverview,table]){
          const b=await panel.boundingBox();assert(b&&b.x>=0&&b.x+b.width<=w+1,'Stock section clipped at '+w);
        }
        if(w===390||w===1440){await page.evaluate(()=>window.scrollTo(0,0));await capture('stock-command-'+w);await capture('stock-opening-'+w,table);}
      }
      await page.getByRole('button',{name:'Next: Fuel Receipts',exact:true}).click();
      await page.getByRole('heading',{name:'Tanker Fuel Deliveries',exact:true}).waitFor();
      await page.getByText('No fuel receipts recorded for this shift.',{exact:true}).waitFor();
      assert.equal(await page.getByRole('button',{name:'New Fuel Receipt',exact:true}).count(),0,'Closed shift offered receipt creation');
      await capture('stock-receipts-1440',page.locator('.stock-task-content').first());
      await page.getByRole('button',{name:'Next: Closing Stock',exact:true}).click();
      await page.getByRole('heading',{name:'Closing Tank Stock Dips',exact:true}).waitFor();
      assert((await page.locator('.stock-net').allTextContents()).some(v=>v.trim()==='795.000 L'));
      await capture('stock-closing-1440',table);
      await page.getByRole('button',{name:'Next: Reconciliation',exact:true}).click();
      await page.getByRole('heading',{name:'Tank-Level Reconciliation',exact:true}).waitFor();
      await page.getByRole('heading',{name:'Product-Level Reconciliation Summary',exact:true}).waitFor();
      assert.equal(await page.locator('.stock-variance[data-tone="error"]').count(),2);
      assert.equal(await page.locator('.stock-variance[data-tone="success"]').count(),2);
      assert.equal(await page.getByRole('button',{name:'Compute Reconciliation',exact:true}).count(),0,'Closed shift offered reconcile mutation');
      await capture('stock-reconciliation-1440',page.locator('.stock-task-content').first());
      await checkViewport(390,844);
      await capture('stock-reconciliation-390',page.locator('.stock-data-panel').first());
      // A verified open shift continues to expose existing entry and receipt controls.
      await stockShift.selectOption(historical.id);
      await stockHero.getByText('OPEN',{exact:true}).waitFor();
      await page.getByRole('region',{name:'Stock attention centre'}).getByRole('heading',{name:'1 pending fuel receipt',exact:true}).waitFor();
      await stockTasks.getByRole('button',{name:/Fuel Receipts/}).click();
      await page.getByRole('button',{name:'New Fuel Receipt',exact:true}).waitFor();
      await page.getByRole('button',{name:'Continue Receipt',exact:true}).waitFor();
      await page.getByRole('textbox',{name:'Search tanker receipts'}).fill('no matching receipt');
      await page.getByText('No receipts match this search.',{exact:true}).waitFor();
      await page.getByRole('textbox',{name:'Search tanker receipts'}).fill('');
      await page.getByRole('button',{name:'Continue Receipt',exact:true}).waitFor();
      await stockTasks.getByRole('button',{name:/Opening Stock/}).click();
      await page.getByRole('button',{name:/Record opening dip/}).click();
      await page.getByRole('button',{name:'Save OPENING Reading',exact:true}).waitFor();
      await page.getByRole('button',{name:'Cancel',exact:true}).click();
      await checkViewport(1440,900);
      // CNG command centre: verified saved readings, read-only historical shift and editable open shift.
      cngUi=true;
      auth.permissions.push('cng_operations.write');
      await page.goto(base+'/cng');
      await page.getByRole('heading',{name:'CNG Operations',exact:true}).waitFor();
      const cngShift=page.getByRole('combobox',{name:'CNG operational shift'});
      await cngShift.selectOption(dsrShift.id);
      const cngHero=page.getByRole('region',{name:'Current CNG shift'});
      await cngHero.getByText('CLOSED',{exact:true}).waitFor();
      await page.getByRole('list',{name:'Selected outlet hierarchy'}).getByText(outlets[1].name+' · '+outlets[1].roCode,{exact:true}).waitFor();
      const cngPanels=page.locator('.cng-panel');
      const mfm=cngPanels.nth(0), pressure=cngPanels.nth(1), summary=cngPanels.nth(2);
      await mfm.getByText('750.500 kg',{exact:true}).waitFor();
      await mfm.getByText('755.500 kg',{exact:true}).waitFor();
      await mfm.getByText('5.000 kg',{exact:true}).waitFor();
      await summary.getByText('750.500 kg',{exact:true}).waitFor();
      assert.equal(await mfm.locator('#cng-mfm-opening').inputValue(),'10500.000');
      assert(await mfm.locator('#cng-mfm-opening').isDisabled());
      assert(await mfm.locator('#cng-mfm-closing').isDisabled());
      assert(await mfm.locator('#cng-grid-intake').isDisabled());
      assert(await mfm.locator('#cng-notes').isDisabled());
      assert.equal(await page.getByRole('button',{name:/Save CNG Log|Update CNG Log|Add Pressure Reading|Edit Reading|Delete Reading/}).count(),0,'Closed CNG shift offered mutations');
      for(const [w,h] of [[320,640],[390,844],[768,1024],[1024,768],[1440,900]]){
        await checkViewport(w,h);
        for(const panel of [cngHero,mfm,pressure,summary]){
          const b=await panel.boundingBox();assert(b&&b.x>=0&&b.x+b.width<=w+1,'CNG panel clipped at '+w);
        }
        await pressure.locator(w<768?'.cng-pressure-card':'.cng-pressure-table').getByText('250.000',{exact:true}).waitFor();
        if(w===390||w===1440){
          await page.evaluate(()=>window.scrollTo(0,0));await capture('cng-command-'+w);
          await capture('cng-mfm-'+w,mfm);await capture('cng-pressure-'+w,pressure);await capture('cng-summary-'+w,summary);
        }
      }
      await cngShift.selectOption(historical.id);
      await cngHero.getByText('OPEN',{exact:true}).waitFor();
      await page.getByRole('region',{name:'CNG attention centre'}).getByRole('heading',{name:'MFM log not recorded',exact:true}).waitFor();
      assert.equal(await mfm.getByText('Not recorded',{exact:true}).count(),2);
      assert(!(await mfm.locator('#cng-mfm-opening').isDisabled()));
      await pressure.getByText('No compressor pressure readings have been recorded.',{exact:true}).waitFor();
      await page.getByRole('button',{name:'Save CNG Log',exact:true}).waitFor();
      await page.getByRole('button',{name:'Add Pressure Reading',exact:true}).click();
      await page.getByRole('dialog').waitFor();
      await page.getByRole('button',{name:'Cancel',exact:true}).click();
      await page.getByRole('dialog').waitFor({state:'hidden'});
      await capture('cng-open-missing-1440',mfm);
      // Lubricant command centre: no shift, inventory without shift, all tasks and shift lock guards.
      lubeUi=true;
      auth.permissions.push('lube_operations.read','lube_sales.write','lube_inventory.write','lube_prices.write');
      await page.goto(base+'/lube');
      await page.getByRole('heading',{name:'Lube & Auxiliary Inventory',exact:true}).waitFor();
      const lubeShift=page.getByRole('combobox',{name:'Lube operational shift'});
      await lubeShift.selectOption('');
      const lubeHero=page.getByRole('region',{name:'Current lubricant shift'});
      const lubeNav=page.getByRole('navigation',{name:'Lube workspace navigation'});
      const lubeContent=page.locator('.lube-content');
      await lubeHero.getByText('NO SHIFT SELECTED',{exact:true}).waitFor();
      await lubeContent.getByRole('heading',{name:'No Shift Selected',exact:true}).waitFor();
      await page.getByRole('list',{name:'Selected outlet hierarchy'}).getByText(outlets[1].name+' · '+outlets[1].roCode,{exact:true}).waitFor();
      await capture('lube-no-shift-desktop');
      await lubeNav.getByRole('button',{name:'Inventory & Stock',exact:true}).click();
      await lubeContent.getByRole('heading',{name:'Current Inventory',exact:true}).waitFor();
      await lubeContent.getByRole('heading',{name:'Low Stock Alert (1)',exact:true}).waitFor();
      assert.equal(await lubeContent.locator('.lube-stock-card').count(),1);
      assert.equal(await lubeContent.locator('.lube-stock-card').getAttribute('data-color'),'orange');
      await lubeContent.locator('.lube-stock-card').getByText('3.500',{exact:false}).waitFor();
      for(const [w,h] of [[320,640],[390,844],[768,1024],[1024,768],[1440,900]]){
        await checkViewport(w,h);
        for(const panel of [lubeHero,lubeNav,lubeContent]){
          const b=await panel.boundingBox();assert(b&&b.x>=0&&b.x+b.width<=w+1,'Lube panel clipped at '+w);
        }
        if(w===390||w===1440){await page.evaluate(()=>window.scrollTo(0,0));await capture('lube-command-'+w);await capture('lube-inventory-'+w,lubeContent);}
      }
      await lubeNav.getByRole('button',{name:'Transaction Ledger',exact:true}).click();
      await lubeContent.getByRole('heading',{name:'Stock Transactions Ledger',exact:true}).waitFor();
      await lubeContent.getByText('6.000',{exact:false}).waitFor();
      await lubeNav.getByRole('button',{name:'Product Setup',exact:true}).click();
      await lubeContent.getByRole('heading',{name:'SKU Catalog',exact:true}).waitFor();
      await lubeContent.getByText('LUBE-001',{exact:true}).waitFor();
      await lubeNav.getByRole('button',{name:'Selling Prices',exact:true}).click();
      await lubeContent.getByRole('heading',{name:'Selling Prices',exact:true}).waitFor();
      await lubeContent.getByText('₹350.00',{exact:true}).waitFor();
      await lubeShift.selectOption(dsrShift.id);
      await lubeHero.getByText('CLOSED',{exact:true}).waitFor();
      await lubeNav.getByRole('button',{name:'Daily Sales',exact:true}).click();
      await lubeContent.getByRole('heading',{name:'Shift Sales Records',exact:true}).waitFor();
      await lubeContent.getByText('₹875.00',{exact:true}).waitFor();
      assert.equal(await lubeContent.getByRole('button',{name:/Record Sale|Edit Sale|Delete Sale/}).count(),0,'Closed lube shift offered sales mutation');
      await capture('lube-closed-sales',lubeContent);
      await lubeNav.getByRole('button',{name:'Shift Summary',exact:true}).click();
      await lubeContent.getByRole('heading',{name:'Shift Summary',exact:true}).waitFor();
      await lubeContent.locator('.lube-metric').getByText('₹875.00',{exact:true}).waitFor();
      await capture('lube-shift-summary',lubeContent);
      await lubeNav.getByRole('button',{name:'Daily Summary',exact:true}).click();
      await lubeContent.getByRole('heading',{name:'Daily Summary',exact:true}).waitFor();
      await lubeContent.locator('.lube-revenue').getByText('₹875.00',{exact:true}).waitFor();
      await capture('lube-daily-summary',lubeContent);
      await lubeShift.selectOption(historical.id);
      await lubeHero.getByText('OPEN',{exact:true}).waitFor();
      await lubeNav.getByRole('button',{name:'Shift Sales Log',exact:true}).click();
      await lubeContent.getByRole('heading',{name:'No Sales Logged',exact:true}).waitFor();
      await lubeContent.getByRole('button',{name:'Record Sale',exact:true}).click();
      await page.getByRole('dialog',{name:'Lubricant sale'}).waitFor();
      await page.getByRole('button',{name:'Cancel',exact:true}).click();
      await page.getByRole('dialog',{name:'Lubricant sale'}).waitFor({state:'hidden'});
      await checkViewport(390,844);
      await capture('lube-open-sales-mobile',lubeContent);
      // Finance command centre: exact saved totals, independent operational/financial states, and finalization guards.
      financeUi=true;
      auth.permissions.push('financial_reconciliation.read','collections.read','collections.write','cash_handover.read','cash_handover.write','bank_deposits.read','bank_deposits.write','bank_deposits.verify','credit_parties.read','product_prices.read','shifts.close');
      await page.goto(base+'/financials');
      await page.getByRole('heading',{name:'Financial Operations',exact:true}).waitFor();
      const financeShift=page.getByRole('combobox',{name:'Finance operational shift'});
      const financeHero=page.getByRole('region',{name:'Current financial shift'});
      const financeAttention=page.getByRole('region',{name:'Financial attention centre'});
      const financeTasks=page.getByRole('region',{name:'Financial workflow'});
      const financeOverview=page.getByRole('region',{name:'Financial shift overview'});
      const financeTask=i=>financeTasks.locator('.finance-task').nth(i);
      await financeShift.selectOption(financeClosed.id);
      await financeHero.getByText('OPERATIONS CLOSED',{exact:true}).waitFor();
      await financeHero.getByText('FINANCE PENDING',{exact:true}).waitFor();
      await financeAttention.getByRole('heading',{name:'Financial reconciliation pending',exact:true}).waitFor();
      await page.getByRole('list',{name:'Selected outlet hierarchy'}).getByText(outlets[1].name+' · '+outlets[1].roCode,{exact:true}).waitFor();
      await financeOverview.locator('.finance-metric').nth(0).getByText('₹ 10000.00',{exact:true}).waitFor();
      await financeOverview.locator('.finance-metric').nth(1).getByText('₹ 9500.00',{exact:true}).waitFor();
      await financeOverview.locator('.finance-metric').nth(2).getByText('₹ 500.00',{exact:true}).waitFor();
      await financeTask(0).click();
      await page.getByRole('heading',{name:'Authoritative Sales Revenue',exact:true}).waitFor();
      for(const [w,h] of [[320,640],[390,844],[768,1024],[1024,768],[1440,900]]){
        await checkViewport(w,h);
        for(const panel of [financeHero,financeTasks,financeOverview,page.locator('.finance-detail-panel').first()]){
          const b=await panel.boundingBox();assert(b&&b.x>=0&&b.x+b.width<=w+1,'Finance panel clipped at '+w);
        }
        if(w===390||w===1440){await page.evaluate(()=>window.scrollTo(0,0));await capture('finance-command-'+w);}
      }
      await capture('finance-sales-desktop',page.locator('.finance-detail-panel').first());
      await financeTask(1).click();
      await page.getByRole('heading',{name:'Shift Collections',exact:true}).waitFor();
      assert.equal(await page.getByRole('button',{name:'Add Collection',exact:true}).count(),1);
      await capture('finance-collections-desktop',page.locator('.finance-detail-panel').first());
      await financeTask(4).click();
      const finalize=page.getByTestId('finalize-deferred-finance');
      await finalize.waitFor();
      assert(await finalize.isDisabled(),'Finance finalization missing confirmation guard');
      const confirmed=page.getByRole('checkbox',{name:/I have reviewed the actual recorded collections/});
      await confirmed.check();
      assert(await finalize.isDisabled(),'Finance finalization missing variance explanation guard');
      await page.getByLabel('Verified variance reason').fill('Fixture shortage review');
      assert(!(await finalize.isDisabled()),'Verified finance finalization control unexpectedly locked');
      await confirmed.uncheck();
      assert(await finalize.isDisabled());
      await checkViewport(390,844);
      await capture('finance-reconciliation-mobile',page.locator('.finance-finalization'));
      await checkViewport(1440,900);
      await capture('finance-reconciliation-desktop',page.locator('.finance-finalization'));
      await financeShift.selectOption(financeCompleted.id);
      await financeHero.getByText('FINANCE COMPLETED',{exact:true}).waitFor();
      await financeAttention.getByRole('heading',{name:'Financial reconciliation completed',exact:true}).waitFor();
      assert.equal(await finalize.count(),0);
      await financeTask(1).click();
      assert.equal(await page.getByRole('button',{name:'Add Collection',exact:true}).count(),0);
      await financeShift.selectOption(historical.id);
      await financeHero.getByText('OPERATIONS OPEN',{exact:true}).waitFor();
      await financeAttention.getByRole('heading',{name:'Sales evidence incomplete',exact:true}).waitFor();
      await page.getByRole('status',{name:'Incomplete sales evidence'}).waitFor();
      await financeTask(0).click();
      await page.getByRole('heading',{name:'Sales revenue (provisional)',exact:true}).waitFor();
      await capture('finance-provisional-desktop');
      // Monthly outlet performance is distinct from DSR. Check saved figures, filter identity, PDF and empty/error states.
      performanceUi=true;
      await page.goto(base+'/reports');
      await page.getByRole('heading',{name:'Outlet Performance Reports',exact:true}).waitFor();
      const performanceMonth=page.getByLabel('Reporting month',{exact:true});
      const performanceCutoff=page.getByLabel('Report cutoff',{exact:true});
      const performanceDate=page.getByLabel('Cutoff date',{exact:true});
      const performanceOutlet=page.getByLabel('Retail outlet',{exact:true});
      const performanceHero=page.getByRole('region',{name:'Report selection summary'});
      const performanceStatus=page.getByRole('region',{name:'Performance report status'});
      const performanceOverview=page.getByRole('region',{name:'Outlet performance overview'});
      const performanceCards=performanceOverview.locator('.performance-card');
      await performanceMonth.fill('2000-01');
      await performanceHero.getByRole('heading',{name:'January 2000',exact:true}).waitFor();
      await performanceStatus.getByRole('heading',{name:'Latest record precedes cutoff',exact:true}).waitFor();
      await performanceHero.getByText('2000-01-02',{exact:true}).waitFor();
      await page.getByRole('list',{name:'Selected outlet hierarchy'}).getByText(outlets[1].name+' · '+outlets[1].roCode,{exact:true}).waitFor();
      await performanceCards.nth(0).getByText('₹1,23,456.78',{exact:true}).waitFor();
      await performanceCards.nth(1).getByText('2:30',{exact:true}).waitFor();
      await performanceCards.nth(3).getByText('62 man-days',{exact:true}).waitFor();
      assert.equal(await performanceCards.count(),4);
      for(const [w,h] of [[320,640],[390,844],[768,1024],[1024,768],[1440,900]]){
        await checkViewport(w,h);
        for(const panel of [performanceHero,performanceStatus,performanceOverview]){
          const b=await panel.boundingBox();assert(b&&b.x>=0&&b.x+b.width<=w+1,'Performance panel clipped at '+w);
        }
        if(w===390||w===1440){await page.evaluate(()=>window.scrollTo(0,0));await capture('performance-command-'+w);await capture('performance-indicators-'+w,performanceOverview);}
      }
      const pdf=await downloadReport();
      assert.equal(pdf.suggestedFilename(),'fixture-monthly-performance.pdf');
      await PDFDocument.load(await fs.readFile(await pdf.path()));
      await performanceCutoff.selectOption('SELECTED_DATE');
      assert(await page.getByRole('button',{name:'Download PDF',exact:true}).isDisabled(),'Missing cutoff date allowed export');
      await performanceDate.fill('2000-01-04');
      await performanceHero.getByText('Selected Date · 2000-01-04',{exact:true}).waitFor();
      await performanceCards.nth(0).getByText('₹1,23,456.78',{exact:true}).waitFor();
      await performanceCutoff.selectOption('LATEST_DATA');
      await performanceStatus.getByRole('heading',{name:'Saved performance report available',exact:true}).waitFor();
      await performanceMonth.fill('2000-02');
      await performanceStatus.getByRole('heading',{name:'No fuel or DG records found',exact:true}).waitFor();
      assert.equal(await performanceCards.count(),0,'Empty latest-data cutoff rendered zero performance metrics');
      await performanceMonth.fill('2000-03');
      await page.getByRole('alert').getByText('Fixture performance report unavailable',{exact:true}).waitFor();
      assert.equal(await performanceCards.count(),0,'Failed request retained stale metrics');
      await performanceMonth.fill('2000-04');
      await performanceMonth.fill('2000-01');
      await performanceOutlet.selectOption('fixture-a');
      await performanceCards.nth(0).getByText('₹2,000.00',{exact:true}).waitFor();
      await performanceHero.getByText(outlets[0].name+' · '+outlets[0].roCode,{exact:true}).waitFor();
      await page.getByRole('list',{name:'Selected outlet hierarchy'}).getByText(outlets[0].name+' · '+outlets[0].roCode,{exact:true}).waitFor();
      assert.equal(await performanceCards.nth(0).getByText('₹1,23,456.78',{exact:true}).count(),0);
      // Restrict report generation without restricting read access.
      auth.isGlobalAdmin=false;auth.permissions=auth.permissions.filter(p=>p!=='reports.generate');
      await page.goto(base+'/reports');
      await performanceOverview.waitFor();
      assert.equal(await page.getByRole('button',{name:'Preview PDF',exact:true}).count(),0);
      assert.equal(await page.getByRole('button',{name:'Download PDF',exact:true}).count(),0);
      // Check all remaining reachable workspaces in a controlled API-empty/error state.
      remainingUi=true; auth.isGlobalAdmin=true;auth.isGlobalScope=true;auth.primaryScope='GLOBAL';auth.roles=['ADMIN'];
      const remaining=[
        ['equipment',true],['utilities',true],['municipal-taxes',true],['nfr',true],['workforce',true],['documents',true],['pump-infrastructure',true],
        ['outlets',false],['products',false],['users',false],['scopes',false],['hierarchy',false],['organization',false],['rbac',false],['audit',false],
      ];
      for(const [routePath,outletScoped] of remaining){
        await page.goto(base+'/'+routePath);
        const workspace=page.locator('.workspace-command');
        await workspace.waitFor();await outlet.waitFor();
        await outlet.selectOption('fixture-b');
        const hierarchy=workspace.getByRole('region',{name:'Workspace organization hierarchy'});
        const hero=workspace.getByRole('region',{name:'Workspace context'});
        const guidance=workspace.getByRole('region',{name:'Workspace guidance'});
        await guidance.waitFor();
        if(outletScoped){
          await hierarchy.getByRole('list',{name:'Selected outlet hierarchy'}).getByText(outlets[1].name+' · '+outlets[1].roCode,{exact:true}).waitFor();
          await hero.getByRole('heading',{name:outlets[1].name,exact:true}).waitFor();
        }else{
          await hierarchy.getByRole('list',{name:'Organizational scope levels'}).waitFor();
          await hero.getByRole('heading',{name:'Global access',exact:true}).waitFor();
          assert.equal(await hierarchy.getByRole('list',{name:'Selected outlet hierarchy'}).count(),0);
        }
        for(const [w,h] of [[320,640],[390,844],[768,1024],[1440,900]]){
          await checkViewport(w,h);
          for(const panel of [hierarchy,hero,guidance]){
            const b=await panel.boundingBox();assert(b&&b.x>=0&&b.x+b.width<=w+1,routePath+' hierarchy panel clipped at '+w);
          }
          if(w===390||w===1440){await page.evaluate(()=>window.scrollTo(0,0));await capture('workspace-'+routePath+'-'+w);}
        }
        console.log('PASS remaining workspace: '+routePath);
      }
      // Hierarchy edits: fixture-only, present on each card, prefilled fields,
      // read-only ancestry, cancellation, error, save and permissions.
      hierarchyEditUi=true;
      await page.goto(base+'/hierarchy');
      const stateEdit=page.getByRole('button',{name:'Edit Fixture State',exact:true});
      await stateEdit.waitFor();
      await page.getByRole('button',{name:'Add Hierarchy Unit'}).click();
      await page.getByRole('dialog',{name:'Add State Office'}).getByRole('button',{name:'Cancel',exact:true}).click();
      await stateEdit.click();
      let hierarchyDialog=page.getByRole('dialog',{name:'Edit State Office'});
      await hierarchyDialog.waitFor();
      assert.equal(await hierarchyDialog.getByLabel('Code',{exact:true}).inputValue(),'ST-01');
      assert.equal(await hierarchyDialog.getByLabel('Name',{exact:true}).inputValue(),'Fixture State');
      await hierarchyDialog.getByLabel('Name',{exact:true}).fill('Canceled change');
      await hierarchyDialog.getByRole('button',{name:'Cancel',exact:true}).click();
      await hierarchyDialog.waitFor({state:'hidden'});
      assert.equal(hierarchyPatches.length,0);
      await stateEdit.click();
      await hierarchyDialog.getByLabel('Name',{exact:true}).fill('Fixture rejected change');
      await hierarchyDialog.getByRole('button',{name:'Save Changes',exact:true}).click();
      await hierarchyDialog.getByRole('alert').getByText('Another unit of this type already uses that code.').waitFor();
      assert.equal(hierarchyPatches.length,0);
      await hierarchyDialog.getByLabel('Name',{exact:true}).fill('Updated State');
      await hierarchyDialog.getByLabel('Code',{exact:true}).fill('st-11');
      for(const [w,h] of [[320,640],[390,844],[1440,900]]){
        await page.setViewportSize({width:w,height:h});
        const b=await hierarchyDialog.boundingBox();
        assert(b&&b.x>=0&&b.x+b.width<=w+1&&b.y>=0&&b.y+b.height<=h+1,'Hierarchy edit dialog clipped at '+w);
        if(w===390||w===1440)await capture('hierarchy-edit-dialog-'+w);
      }
      await hierarchyDialog.getByRole('button',{name:'Save Changes',exact:true}).click();
      await page.getByRole('button',{name:'Edit Updated State',exact:true}).waitFor();
      await page.getByText('State Office updated successfully.',{exact:true}).waitFor();
      await page.getByRole('button',{name:/Divisional Offices/}).click();
      await page.getByRole('button',{name:'Edit Fixture Division',exact:true}).click();
      hierarchyDialog=page.getByRole('dialog',{name:'Edit Divisional Office'});
      assert((await hierarchyDialog.locator('#hierarchy-parent').innerText()).includes('Updated State'));
      assert.equal(await hierarchyDialog.locator('select').count(),0);
      await hierarchyDialog.getByLabel('Name',{exact:true}).fill('Updated Division');
      await hierarchyDialog.getByRole('button',{name:'Save Changes',exact:true}).click();
      await page.getByRole('button',{name:'Edit Updated Division',exact:true}).waitFor();
      await page.getByRole('button',{name:/Sales Areas/}).click();
      await page.getByRole('button',{name:'Edit Fixture Area',exact:true}).click();
      hierarchyDialog=page.getByRole('dialog',{name:'Edit Sales Area'});
      assert((await hierarchyDialog.locator('#hierarchy-parent').innerText()).includes('Updated Division'));
      assert.equal(await hierarchyDialog.locator('select').count(),0);
      await hierarchyDialog.getByLabel('Name',{exact:true}).fill('Updated Area');
      await hierarchyDialog.getByRole('button',{name:'Save Changes',exact:true}).click();
      await page.getByRole('button',{name:'Edit Updated Area',exact:true}).waitFor();
      assert.equal(hierarchyPatches.length,3);
      assert.equal(hierarchyPatches[0].body.code,'ST-11');
      // Strict scope gating in addition to the role permission.
      auth.isGlobalAdmin=false;auth.isGlobalScope=false;auth.primaryScope='STATE';auth.roles=['STATE_OFFICE'];auth.permissions=['hierarchy.read','hierarchy.write','outlets.read'];auth.accessibleStateIds=['fixture-state'];auth.accessibleDivisionIds=[];auth.accessibleSalesAreaIds=[];
      await page.goto(base+'/hierarchy');
      await page.getByRole('button',{name:'Edit Updated State',exact:true}).waitFor();
      assert.equal(await page.getByRole('button',{name:'Edit Other State',exact:true}).count(),0);
      auth.permissions=['hierarchy.read','outlets.read'];
      await page.goto(base+'/hierarchy');
      await page.getByRole('heading',{name:'Updated State',exact:true}).waitFor();
      assert.equal(await page.getByRole('button',{name:/^Edit /}).count(),0);
      console.log('PASS hierarchy editing: prefill, validation/error, cancel, scoped edit permissions, save all three levels and responsive dialog.');
      // Production login is a separate public surface; do not attempt to sign in.
      signedOut=true;
      await page.goto(base+'/');
      await page.getByRole('heading',{name:'Sign In to Enterprise Portal'}).waitFor();
      await page.getByRole('textbox',{name:'Official Email Address'}).waitFor();
      await page.getByLabel('Password',{exact:true}).waitFor();
      assert.equal(await page.getByText('1-Click Phase 1A Role Testing (Development Mode)',{exact:true}).count(),0);
      for(const [w,h] of [[320,640],[390,844],[768,1024],[1440,900]]){
        await page.setViewportSize({width:w,height:h});
        assert(await page.evaluate(()=>document.documentElement.scrollWidth)<=w+1,'Login overflow at '+w);
        if(w===390||w===1440)await capture('workspace-login-'+w);
      }
      assert.deepEqual(errors,[],'Uncaught browser error');
      assert.deepEqual(blocked,[],'Unexpected API or external request');
      console.log('PASS: five responsive widths, mobile navigation and focus restore, outlet continuity, CNG loading/failure/retry, no historical auto-selection, DSR historical shift name, remarks validation and download, consolidated and detailed month export, responsive report coverage, dashboard and workbench independent statuses, populated operational detail panels and exact totals, closed-shift controls, no mutation or real backend requests.');
    }finally{releaseFirst();}
  }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
