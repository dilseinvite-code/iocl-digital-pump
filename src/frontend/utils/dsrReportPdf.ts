import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont, type RGB } from 'pdf-lib';
import type { DailyFuelSummary } from '../../shared/types';
import { dsrStatusLabel, getDsrWorkflowStatus } from '../../shared/dsrWorkflowStatus';
import { formatMilliunits } from '../../shared/precision';
import { dsrPeriodProducts, dsrProductColumns } from './dsrReport';
import { DSR_LOGO_PNG_BASE64 } from './dsrLogoPng';
import { dsrDailyProductValues, dsrDailyUnitTotals, dsrTankPresentation, dsrDispenserSubtotals, nozzleHasSavedMeters,
  operationalShiftClosure, savedQuantity, signedVariance } from './dsrReportLayout';

export interface DsrExport {
  outletName: string; roCode: string; days: DailyFuelSummary[];
  generatedAt: string; generatedBy: string; periodLabel: string;
}

const W = 841.89, H = 595.28, M = 26, TW = W - 2*M, FOOT = 44;
const navy = rgb(.01,.13,.28), orange = rgb(.95,.39,.10), muted = rgb(.30,.35,.41);
const line = rgb(.81,.85,.89), pale = rgb(.94,.96,.98), ink = rgb(.10,.16,.23), white = rgb(1,1,1);
const green = rgb(.04,.39,.25), greenPale = rgb(.90,.97,.94), red = rgb(.67,.13,.14), redPale = rgb(1,.93,.93);
const amber = rgb(.55,.32,.04), amberPale = rgb(1,.96,.88);
const ascii = (s: unknown) => String(s ?? '').replace(/[–—]/g,'-').replace(/₹/g,'INR ').replace(/[^\x20-\x7e]/g,'?');
const humanDate = (s:string) => {
  const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return match ? match[3]+' '+(['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(match[2])-1]??match[2])+' '+match[1] : s;
};
function fit(text: unknown, font: PDFFont, size: number, width: number): string {
  const s = ascii(text);
  if (font.widthOfTextAtSize(s,size) <= width) return s;
  let clipped = s;
  while (clipped.length && font.widthOfTextAtSize(clipped+'...',size)>width) clipped = clipped.slice(0,-1);
  return clipped+'...';
}
function wrap(text: unknown, font: PDFFont, size: number, width: number): string[] {
  const words = ascii(text).split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (font.widthOfTextAtSize((current ? current+' ' : '')+word,size) <= width) current = (current ? current+' ' : '')+word;
    else { if (current) lines.push(current); current=fit(word,font,size,width); }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}
const operationalStatus = (d: DailyFuelSummary) => dsrStatusLabel(getDsrWorkflowStatus(d).operational);
const financialStatus = (d: DailyFuelSummary) => dsrStatusLabel(getDsrWorkflowStatus(d).financial);
const stamp = (s: string) => s.replace(/T/,' ').replace(/\.\d+Z$/,' UTC').replace(/Z$/,' UTC');
const statusTone=(s:string) => {
  if(['COMPLETED','COMPLETE','CLOSED','LOCKED','ALL CLOSED / LOCKED'].includes(s))return {fg:green,bg:greenPale};
  if(s==='BLOCKED'||s==='REVIEW REQUIRED')return {fg:red,bg:redPale};
  return {fg:amber,bg:amberPale};
};
type TableRow={cells:string[];kind?:'total'|'subtotal';varianceIndex?:number};
type TableSpec={title:string;headers:string[];rows:TableRow[];weights:number[];heading:string;numeric?:number[];rowHeight?:number;empty?:string;reserveAfter?:number};

export async function generateDsrPdf(report: DsrExport): Promise<Uint8Array> {
  if (!report.days.length) throw new Error('Retrieve a report before exporting.');
  const pdf = await PDFDocument.create();
  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await pdf.embedPng(Uint8Array.from(atob(DSR_LOGO_PNG_BASE64),c=>c.charCodeAt(0)));
  const first = report.days[0].businessDate, last = report.days[report.days.length-1].businessDate;
  const dates=humanDate(first)+(first===last?'':' - '+humanDate(last));
  pdf.setTitle('IOCL Daily Sales Report - '+first+' to '+last);
  pdf.setSubject('Operational fuel stock and sales report; financial reconciliation status is independent.');
  let page: PDFPage;
  let y=0;
  const draw = (t: unknown,x: number,at: number,size=9,font=normal,color=ink,max=TW,align:'left'|'right'|'center'='left') => {
    const text = fit(t,font,size,max);
    const width=font.widthOfTextAtSize(text,size);
    page.drawText(text,{x:align==='right'?x+max-width:align==='center'?x+(max-width)/2:x,y:at,size,font,color});
  };
  // Numeric values must never be visually abbreviated. Reduce the type size for
  // exceptionally long values rather than truncating a saved quantity.
  const drawNumber = (t:string,x:number,at:number,width:number,font:PDFFont,color:RGB) => {
    const text=ascii(t);
    const measured=font.widthOfTextAtSize(text,8.6);
    const size=measured>width ? 8.6*width/measured : 8.6;
    page.drawText(text,{x:x+width-font.widthOfTextAtSize(text,size),y:at,size,font,color});
  };
  const start=(heading:string)=>{
    page=pdf.addPage([W,H]);
    page.drawRectangle({x:M,y:H-23,width:TW,height:4,color:orange});
    page.drawRectangle({x:M,y:H-78,width:TW,height:55,color:navy});
    page.drawImage(logo,{x:M+12,y:H-69,width:37,height:37});
    draw('INDIAN OIL CORPORATION LIMITED',M+59,H-40,9.5,bold,white,TW-255);
    draw('DAILY SALES REPORT (DSR)',M+59,H-61,17,bold,white,TW-255);
    draw(report.outletName+'  |  RO '+report.roCode,W-M-211,H-41,10,bold,white,199,'right');
    draw(dates,W-M-211,H-60,10,normal,white,199,'right');
    draw(heading,M,H-94,11,bold,navy,TW*.55);
    draw(report.periodLabel,M+TW*.56,H-94,8,normal,muted,TW*.44,'right');
    y=H-109;
  };
  const ensure=(height:number,heading:string)=>{if(y-height<FOOT)start(heading+' (continued)');};
  const note=(t:string,heading:string,color=muted)=>{
    for(const l of wrap(t,normal,8.3,TW-8)){ensure(12,heading);draw(l,M+2,y-1,8.3,normal,color,TW-8);y-=12;}
    y-=3;
  };
  const band=(title:string)=>{
    page.drawRectangle({x:M,y:y-13,width:3,height:14,color:orange});
    draw(title,M+9,y-10,10.4,bold,navy,TW-12); y-=20;
  };
  const statusCards=(day:DailyFuelSummary,heading:string)=>{
    ensure(55,heading);
    const labels=['Operational DSR','Shift closure','Financial reconciliation'];
    const values=[operationalStatus(day),operationalShiftClosure(day),financialStatus(day)];
    const gap=7, w=(TW-gap*2)/3;
    values.forEach((s,i)=>{
      const x=M+i*(w+gap), tone=statusTone(s);
      page.drawRectangle({x,y:y-40,width:w,height:40,color:tone.bg,borderColor:line,borderWidth:.55});
      draw(labels[i].toUpperCase(),x+9,y-13,8,bold,muted,w-18);
      draw(s,x+9,y-30,12,bold,tone.fg,w-18);
    });
    y-=49;
  };
  const table=(spec:TableSpec)=>{
    const {title,headers,rows,weights,heading}=spec;
    if(!rows.length){note(title+': '+(spec.empty||'No recorded entries.'),heading);return;}
    const sum=weights.reduce((a,b)=>a+b,0), widths=weights.map(w=>TW*w/sum);
    const numeric=new Set(spec.numeric??[]);
    const rh=spec.rowHeight??16, hh=25;
    const header=()=>{
      ensure(20+hh+rh,heading);band(title);
      page.drawRectangle({x:M,y:y-hh,width:TW,height:hh,color:navy});
      let x=M;
      headers.forEach((h,i)=>{
        const ls=wrap(h,bold,8,widths[i]-8);
        const firstY=y-(ls.length>1?10:15);
        ls.slice(0,2).forEach((l,j)=>draw(l,x+4,firstY-j*10,8,bold,white,widths[i]-8,numeric.has(i)?'right':'left'));
        x+=widths[i];
      });
      y-=hh;
    };
    header();
    rows.forEach((row,index)=>{
      if(y-rh<FOOT || (rows[index+1]?.kind==='subtotal' && y-rh*2<FOOT) ||
        (spec.reserveAfter && index===Math.max(0,rows.length-3) && y-Math.min(3,rows.length)*rh-13-spec.reserveAfter<FOOT)){start(heading+' (continued)');header();}
      const isTotal=row.kind==='total'||row.kind==='subtotal';
      const font=isTotal?bold:normal;
      page.drawRectangle({x:M,y:y-rh,width:TW,height:rh,color:isTotal?pale:index%2?rgb(.975,.982,.99):white,borderColor:line,borderWidth:.35});
      if(isTotal)page.drawLine({start:{x:M,y},end:{x:W-M,y},color:navy,thickness:.65});
      let x=M;
      row.cells.forEach((v,i)=>{
        const variance=row.varianceIndex===i;
        const text=variance?signedVariance(v):v;
        const fg=variance&&text.startsWith('-')?red:variance&&text.startsWith('+')?green:
          text==='Not recorded'||text==='Missing'?amber:ink;
        if(variance&&(text.startsWith('-')||text.startsWith('+'))){
          page.drawRectangle({x:x+.6,y:y-rh+.5,width:widths[i]-1.2,height:rh-1,color:text.startsWith('-')?redPale:greenPale});
        }
        const at=y-rh/2-3;
        if(numeric.has(i)) drawNumber(text,x+4,at,widths[i]-8,font,fg);
        else draw(text,x+4,at,isTotal?8.4:8.5,font,fg,widths[i]-8);
        x+=widths[i];
      });
      y-=rh;
    });
    y-=13;
  };
  const signoff=(heading:string)=>{
    ensure(52,heading);
    band('Manual verification and sign-off');
    const w=TW/3;
    ['Prepared by','Checked by','Verified by'].forEach((label,i)=>{
      const x=M+i*w+5;
      page.drawLine({start:{x,y:y-16},end:{x:x+w-16,y:y-16},color:line,thickness:.8});
      draw(label+'  |  Signature / date',x,y-27,8.1,bold,muted,w-18);
    });
    y-=30;
  };
  if(report.days.length>1){
    start('Period overview');
    const complete=report.days.filter(d=>d.dayEntryStatus==='COMPLETE').length;
    const none=report.days.filter(d=>d.dayEntryStatus==='NO_ENTRY').length;
    note('Business dates: '+report.days.length+'  |  Complete: '+complete+'  |  Partial: '+(report.days.length-complete-none)+'  |  No entry: '+none,'Period overview');
    table({title:'Product-wise net sales (recorded dates only)',headers:['Product','Unit','Recorded days','Complete days','Recorded net sales','Coverage'],
      rows:dsrPeriodProducts(report.days).map(p=>({cells:[p.productCode+' - '+p.productName,p.unit,p.recordedDays+'/'+p.totalDays,p.completeDays+'/'+p.totalDays,
        p.recordedNetMilliunits===null?'Not recorded':formatMilliunits(p.recordedNetMilliunits),p.fullyRecorded?'Complete':'Incomplete subtotal']})),
      weights:[2.3,.7,1,1,1.4,1.5],numeric:[4],heading:'Period overview'});
    note('Incomplete subtotals exclude missing readings or dates. Units are not combined. Opening and closing stocks are daily balances, not additive.','Period overview');
    table({title:'Day-wise status',headers:['Business date','Operational DSR','Shift closure','Financial reconciliation','Shifts'],
      rows:report.days.map(d=>({cells:[d.businessDate,operationalStatus(d),operationalShiftClosure(d),financialStatus(d),String(d.shiftsCount)]})),
      weights:[1.2,1.7,2,2.1,.75],heading:'Period overview'});
  }
  for(const day of report.days){
    if(report.days.length>1&&day.dayEntryStatus==='NO_ENTRY')continue;
    const heading=humanDate(day.businessDate);
    start(heading+' | Operational summary');
    statusCards(day,heading);
    if(day.dayEntryStatus==='NO_ENTRY'){note('No shift or DSR entry recorded for this business date. No figures are inferred.',heading);continue;}
    const c=day.completion;
    const count=(a:unknown,b:unknown)=>Number.isInteger(a)&&Number.isInteger(b)?a+'/'+b:'Not available';
    note('Shifts: '+day.shiftsCount+'  |  Tank opening: '+count(c.openingTankReadings,c.expectedTanks)+
      '  |  Tank closing: '+count(c.closingTankReadings,c.expectedTanks)+'  |  Nozzle meters: '+count(c.nozzleMeterReadings,c.expectedNozzles)+
      '  |  Completed receipts: '+count(c.completedReceipts,c.totalReceipts)+'  |  Stock reconciliation: '+(c.reconciliationComplete===true?'COMPLETE':c.reconciliationComplete===false?'PENDING':'Not available'),heading);
    if(day.shiftsCount>1){
      table({title:'Shift-wise closure and reconciliation',headers:['Shift','Closure','Financial reconciliation','Stock reconciliation','Opening tanks','Closing tanks','Meter readings'],
        rows:(day.shifts??[]).map(s=>({cells:[String(s.shiftNumber),s.status,s.financialReconciliationStatus?dsrStatusLabel(s.financialReconciliationStatus):'STATUS UNAVAILABLE',
          s.reconciliationComplete?'COMPLETE':'PENDING',count(s.openingTankReadings,s.expectedTanks),count(s.closingTankReadings,s.expectedTanks),count(s.nozzleMeterReadings,s.expectedNozzles)]})),
        weights:[.6,1.2,2,1.4,1,1,1],heading});
    }
    table({title:'01  Product-wise daily stock and sales',headers:['Product','Unit','Status',...dsrProductColumns],
      rows:[...day.byProduct.map(p=>({cells:[p.productCode,p.unit,p.status.replaceAll('_',' '),...dsrDailyProductValues(p)],varianceIndex:11})),
        ...dsrDailyUnitTotals(day).map(t=>({cells:['TOTAL',t.unit,t.coverage,...t.values],kind:'total' as const,varianceIndex:11}))],
      weights:[1.08,.72,.9,1,1,1,1,.77,1,1,1,1], numeric:[3,4,5,6,7,8,9,10,11],rowHeight:17,heading});
    note('Variance = physical closing minus book closing. Positive (+) is stock excess; negative (-) is stock shortage. These are observed differences, not confirmed financial gains or losses.',heading);
    note('Not recorded means a required reading is missing, not zero. Receipts may use invoiced quantities where measured receipt is unavailable. Totals never combine unlike units.',heading);
    for(const p of day.byProduct)if(p.missingFields.length)note(p.productCode+': '+p.missingFields.join('; '),heading,amber);
    const tanks=dsrTankPresentation(day);
    if(tanks.mode==='PAIRED'){
      table({title:'02  Tank-wise opening and closing stock',headers:['Tank','Product','Unit','Opening dip (mm)','Opening water (mm)','Opening net stock','Closing dip (mm)','Closing water (mm)','Closing net stock'],
        rows:tanks.rows.map(t=>({cells:[t.tankNumber,t.productCode,t.unit,savedQuantity(t.opening?.productDipMmMilliunits),savedQuantity(t.opening?.waterDipMmMilliunits),
          savedQuantity(t.opening?.netProductVolumeMilliunits),savedQuantity(t.closing?.productDipMmMilliunits),savedQuantity(t.closing?.waterDipMmMilliunits),savedQuantity(t.closing?.netProductVolumeMilliunits)]})),
        weights:[.6,1.05,.7,1.1,1.1,1.3,1.1,1.1,1.3],numeric:[3,4,5,6,7,8],heading:'Tank stock | '+heading,rowHeight:16,
        empty:'No saved individual tank readings in this report.'});
      note('Tank detail shows saved measurements; stock balances are not derived from or substituted for missing readings.',heading);
    }else{
      table({title:'02  Individual saved tank readings',headers:['Tank','Product','Unit','Reading type','Product dip (mm)','Water dip (mm)','Net physical stock'],
        rows:tanks.rows.map(t=>({cells:[t.tankNumber,t.productCode,t.unit,t.reading.readingType,savedQuantity(t.reading.productDipMmMilliunits),
          savedQuantity(t.reading.waterDipMmMilliunits),savedQuantity(t.reading.netProductVolumeMilliunits)]})),
        weights:[.6,1.05,.7,1.3,1.4,1.4,1.5],numeric:[4,5,6],heading:'Tank stock | '+heading,rowHeight:16,
        empty:'No saved individual tank readings in this report.'});
      note('Individual readings are listed without pairing: the current daily-summary response does not identify the shift of each tank reading. Do not sum opening/closing readings across shifts.',heading);
    }
    if(day.missingFields.length)note('Day completeness: '+day.missingFields.join('; '),heading,amber);
    // Meter evidence receives its own readable page when the available space is
    // insufficient for a meaningful group of nozzles plus its subtotal.
    if(day.byDispenser.length && y<220)start(heading+' | Meter statement');
    const units=new Map(day.byProduct.map(p=>[p.productId,p.unit]));
    const rows:TableRow[]=day.byDispenser.flatMap(d=>[
      ...d.nozzles.map(n=>{
        const recorded=nozzleHasSavedMeters(n);
        const unit=units.get(n.productId)||'Unknown';
        const value=(v:unknown)=>recorded?savedQuantity(v):'Not recorded';
        return {cells:[String(n.shiftNumber),String(d.dispenserNumber),String(n.nozzleNumber),n.productCode+' / '+unit,
          savedQuantity(n.openingTotalizerMilliunits),savedQuantity(n.closingTotalizerMilliunits),value(n.grossSalesMilliunits),value(n.testingQuantityMilliunits),value(n.netSalesMilliunits),
          recorded?'Recorded':n.isUnavailable?'Unavailable':'Missing']};
      }),
      ...dsrDispenserSubtotals(d,units).map(s=>({kind:'subtotal' as const,cells:['All',String(d.dispenserNumber),'-','TOTAL '+s.unit,'-','-',s.gross,s.testing,s.net,s.recorded+'/'+s.expected+' recorded']})),
    ]);
    table({title:'03  Dispenser and nozzle-wise meter statement',headers:['Shift','DU / MPD','Nozzle','Product / unit','Opening totalizer','Closing totalizer','Gross','Testing','Net sales','Coverage'],
      rows,weights:[.65,.75,.6,1.6,1.45,1.45,1,1,1,1.3],numeric:[4,5,6,7,8],heading:'Meter statement | '+heading,rowHeight:12.5,reserveAfter:67});
    note('Dispenser subtotals include recorded nozzle meters only, by unit. Coverage identifies missing or unavailable meters; no missing amount is replaced with zero.',heading);
    signoff(heading+' | Sign-off');
  }
  const pages=pdf.getPages();
  pages.forEach((p,i)=>{
    p.drawLine({start:{x:M,y:35},end:{x:W-M,y:35},thickness:.6,color:line});
    p.drawText(fit('Generated by '+report.generatedBy+' | '+stamp(report.generatedAt),normal,7.7,TW-75),{x:M,y:23,size:7.7,font:normal,color:muted});
    p.drawText('Current saved data; not an immutable signed snapshot. Operational completeness does not certify payment collections.',{x:M,y:12,size:7.2,font:normal,color:muted});
    p.drawText('Page '+(i+1)+' / '+pages.length,{x:W-M-57,y:23,size:7.7,font:normal,color:navy});
  });
  return pdf.save();
}
