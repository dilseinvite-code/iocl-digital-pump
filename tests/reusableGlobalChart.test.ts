import { describe, expect, it } from 'vitest';
import { reviewReusableGlobalChart } from '../src/frontend/components/pump/reusableGlobalChart';
import type {GlobalTankCalibrationTemplate, TankCalibrationChart, TankCalibrationPoint} from '../src/shared/types';

const source={
  id:'global-20', code:'STANDARD_20KL', status:'APPROVED', nominalCapacityLitres:20000,
  tankDiameterMmMilliunits:2100000, tankLengthMmMilliunits:6250000,
  maxDipMmMilliunits:2100000, points:[
    {dipMillimetresMilliunits:0,volumeMilliunits:0},
    {dipMillimetresMilliunits:2100000,volumeMilliunits:21648300},
  ],
  requiresEngineeringReview:false, requiresDimensionVerification:false, isOverCapacityCeiling:false,
} as GlobalTankCalibrationTemplate;
const chart={
  id:'chart-1',tankId:'tank-pgt-1',sourceTemplateId:'global-20',
  status:'DRAFT',tankDiameterMmMilliunits:2100000,
  tankLengthMmMilliunits:6250000,maxDipMmMilliunits:2100000,isReferenced:false,
} as TankCalibrationChart;
const points=[
  {dipMillimetresMilliunits:0,volumeMilliunits:0},
  {dipMillimetresMilliunits:2100000,volumeMilliunits:21648300},
] as TankCalibrationPoint[];

describe('reuse a global chart only once it is approved and identical',()=>{
  it('passes for an identical approved saved chart without changing the points',()=>{
    const original=JSON.stringify(points);
    const review=reviewReusableGlobalChart(chart,points,source,20000);
    expect(review.ready).toBe(true);
    expect(JSON.stringify(points)).toBe(original);
  });
  it('rejects a DRAFT source even if the attached tank revision is APPROVED',()=>{
    const result=reviewReusableGlobalChart({...chart,status:'APPROVED'},points,
      {...source,status:'DRAFT'},20000);
    expect(result.ready).toBe(false);
    expect(result.message).toContain('DRAFT');
  });
  it('rejects an alternate chart with a different 10mm stored volume',()=>{
    const altered=[...points];
    altered[1]={...altered[1],volumeMilliunits:21648200};
    const result=reviewReusableGlobalChart(chart,altered,source,20000);
    expect(result.ready).toBe(false);
    expect(result.message).toContain('differ');
  });
  it('rejects missing points, incompatible capacity, dimensions, and historical references',()=>{
    expect(reviewReusableGlobalChart(chart,points.slice(0,1),source,20000).ready).toBe(false);
    expect(reviewReusableGlobalChart(chart,points,source,15000).ready).toBe(false);
    expect(reviewReusableGlobalChart({...chart,tankLengthMmMilliunits:5500000},points,source,20000).ready).toBe(false);
    expect(reviewReusableGlobalChart({...chart,isReferenced:true},points,source,20000).ready).toBe(false);
  });
  it('rejects missing approval and unresolved +15% or source-review flags',()=>{
    expect(reviewReusableGlobalChart(chart,points,null,20000).ready).toBe(false);
    expect(reviewReusableGlobalChart(chart,points,{...source,isOverCapacityCeiling:true},20000).ready).toBe(false);
    expect(reviewReusableGlobalChart(chart,points,{...source,requiresDimensionVerification:true},20000).ready).toBe(false);
    expect(reviewReusableGlobalChart(chart,points,{...source,requiresEngineeringReview:true},20000).ready).toBe(false);
  });
});
