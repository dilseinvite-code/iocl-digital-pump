export interface ParsedSimpleCalibrationCsv{
 valid:boolean;points:Array<{dipMm:number;volumeLitres:number}>;
 normalizedCsv:string;maxDipMm:number;maxVolumeLitres:number;errors:string[];warnings:string[];
}
export function parseSimpleCalibrationCsv(text:string):ParsedSimpleCalibrationCsv{
 const result:ParsedSimpleCalibrationCsv={valid:false,points:[],normalizedCsv:'',maxDipMm:0,maxVolumeLitres:0,errors:[],warnings:[]};
 const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
 if(lines.length<2){result.errors.push('At least two calibration rows are required.');return result;}
 // Accept comma/tab/semicolon tables, with optional dip_mm,volume_litres header.
 const delimiter=lines[0].includes('\t')?'\t':lines[0].includes(';')?';':',';
 const rows=lines.map(x=>x.split(delimiter).map(t=>t.trim().replace(/^"|"$/g,'')));
 const first=rows[0];const isHeader=first.some(x=>/[a-zA-Z]/.test(x));
 if(isHeader){
  if(!/^dip\s*[_ ()-]*mm/i.test(first[0]||'')||!/volume|litres|liters/i.test(first[1]||'')){
    result.errors.push('Use columns dip_mm,volume_litres (measurements in millimetres and litres).');
    return result;
  }
  rows.shift();
 }
 if(rows.length<2){result.errors.push('At least two calibration rows are required.');return result;}
 if(rows.length>2000){result.errors.push('Maximum 2,000 calibration points per file.');return result;}
 for(let i=0;i<rows.length;i++){
   const cells=rows[i];
   if(cells.length!==2){result.errors.push('Row '+(i+1)+': expected exactly two columns.');break;}
   const dip=Number(cells[0]);const volume=Number(cells[1]);
   if(!Number.isFinite(dip)||!Number.isFinite(volume)||dip<0||volume<0){
     result.errors.push('Row '+(i+1)+': invalid or negative number.');break;
   }
   const p=result.points[result.points.length-1];
   if(p && (dip<=p.dipMm||volume<p.volumeLitres)){
     result.errors.push('Row '+(i+1)+': dip must increase and volume must not decrease.');break;
   }
   result.points.push({dipMm:dip,volumeLitres:volume});
 }
 if(result.points.length===0)return result;
 result.maxDipMm=result.points[result.points.length-1].dipMm;
 result.maxVolumeLitres=result.points[result.points.length-1].volumeLitres;
 if(result.points[0].dipMm!==0)result.warnings.push('First reading does not start at 0 mm. Check for missing rows.');
 if(result.points[0].volumeLitres!==0)result.warnings.push('First volume is not 0 L. Check the chart baseline.');
 if(result.errors.length===0){
   result.normalizedCsv='dip_mm,volume_litres\n'+result.points.map(p=>p.dipMm+','+p.volumeLitres).join('\n');
   result.valid=true;
 }
 return result;
}
