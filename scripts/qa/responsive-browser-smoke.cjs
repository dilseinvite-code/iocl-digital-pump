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
const ok=data=>({success:true,data,error:null});
const fail=message=>({success:false,data:null,error:{code:'FIXTURE_FAILURE',message}});
async function main(){
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}});
    const errors=[],blocked=[],requests=[];
    page.on('pageerror',error=>errors.push(String(error)));
    let releaseFirst;
    const firstResponse=new Promise(resolve=>{releaseFirst=resolve;});
    let shiftAttempts=0;
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
      if(path==='/api/v1/outlets/fixture-b/fuel/daily-summary'){
        const date=url.searchParams.get('businessDate');
        if(date===dsrShift.businessDate)return route.fulfill({json:ok(dsrDay)});
        if(/^2000-01-\d{2}$/.test(date||''))return route.fulfill({json:ok({...dsrDay,businessDate:date,
          status:'NOT_STARTED',dayEntryStatus:'NO_ENTRY',operationalDsrStatus:'NOT_STARTED',financialReconciliationStatus:'NOT_STARTED',
          shiftsCount:0,shifts:[],byProduct:[],byDispenser:[],completion:{...dsrDay.completion,expectedNozzles:0,nozzleMeterReadings:0,reconciliationComplete:false}})});
      }
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
      await checkViewport(390,844);
      assert.deepEqual(errors,[],'Uncaught browser error');
      assert.deepEqual(blocked,[],'Unexpected API or external request');
      console.log('PASS: five responsive widths, mobile navigation and focus restore, outlet continuity, CNG loading/failure/retry, no historical auto-selection, DSR historical shift name, remarks validation and download, consolidated and detailed month export, no mutation or real backend requests.');
    }finally{releaseFirst();}
  }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
