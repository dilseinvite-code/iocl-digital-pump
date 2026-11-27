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
    let shiftAttempts=0, operationsUi=false;
    const screenshotDir=process.env.QA_SCREENSHOT_DIR;
    if(screenshotDir)await fs.mkdir(screenshotDir,{recursive:true});
    const capture=async(name,locator)=>{if(screenshotDir){const options={path:screenshotDir+'/'+name+'.png',animations:'disabled'};if(locator)await locator.screenshot(options);else await page.screenshot(options);}};
    await page.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url());
      if(['blob:','data:'].includes(url.protocol))return route.continue();
      if(url.origin!==base){if(!['fonts.googleapis.com','fonts.gstatic.com'].includes(url.hostname))blocked.push(req.url());return route.abort();}
      if(!url.pathname.startsWith('/api/'))return route.continue();
      requests.push(url.pathname);
      if(req.method()!=='GET'){blocked.push(req.method()+' '+url.pathname);return route.abort();}
      const path=url.pathname;
      if(path==='/api/v1/auth/me')return route.fulfill({json:ok(auth)});
      if(path==='/api/v1/outlets')return route.fulfill({json:ok(outlets)});
      if(path==='/api/v1/users'||path==='/api/v1/hierarchy/states')return route.fulfill({json:ok([])});
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
      assert.deepEqual(errors,[],'Uncaught browser error');
      assert.deepEqual(blocked,[],'Unexpected API or external request');
      console.log('PASS: five responsive widths, mobile navigation and focus restore, outlet continuity, CNG loading/failure/retry, no historical auto-selection, DSR historical shift name, remarks validation and download, consolidated and detailed month export, responsive report coverage, dashboard and workbench independent statuses, populated operational detail panels and exact totals, closed-shift controls, no mutation or real backend requests.');
    }finally{releaseFirst();}
  }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
