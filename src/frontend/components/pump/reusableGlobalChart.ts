import type { GlobalTankCalibrationTemplate, TankCalibrationChart, TankCalibrationPoint } from '../../../shared/types';
import {isOperatorSuppliedReference} from '../../../shared/operatorSuppliedCalibration';

/**
 * Checks whether an existing quick-registered tank can reuse an authorised
 * global calibration in a single operator-driven activation flow.
 *
 * Only exact stored source-point equality permits the shortcut: no synthetic
 * readings, silent curve replacement, or approval of a DRAFT source.
 */
export function reviewReusableGlobalChart(
  chart: TankCalibrationChart | null,
  storedPoints: readonly TankCalibrationPoint[],
  source: GlobalTankCalibrationTemplate | null,
  tankCapacityLitres: number
): { ready: boolean; message: string } {
  if (!chart || !chart.sourceTemplateId) {
    return {ready:false,message:'This tank has no linked global calibration. Open Calibration Charts to assign one.'};
  }
  if (!source || source.id !== chart.sourceTemplateId) {
    return {ready:false,message:'The linked global chart could not be loaded. Refresh and review its source.'};
  }
  const operatorProvided=isOperatorSuppliedReference(source,source.points||[]);
  if (!operatorProvided&&source.status !== 'APPROVED' && source.status !== 'ACTIVE') {
    return {ready:false,message:'The source global chart is still '+source.status+'. Review and approve it once in Calibration Charts; there is no need to upload tank readings again.'};
  }
  if (!operatorProvided&&(source.requiresEngineeringReview || source.requiresDimensionVerification || source.isOverCapacityCeiling)) {
    return {ready:false,message:'The global chart has an unresolved calibration or dimensional warning that prevents operational activation. Review the source once.'};
  }
  if (source.nominalCapacityLitres !== tankCapacityLitres) {
    return {ready:false,message:'The source global chart capacity differs from this tank. Select a compatible chart before activation.'};
  }
  if (chart.isReferenced && chart.status !== 'ACTIVE') {
    return {ready:false,message:'This revision has historical readings. Use the governed revision workflow rather than changing its status automatically.'};
  }
  if ((chart.tankDiameterMmMilliunits || 0) <= 0 || (chart.tankLengthMmMilliunits || 0) <= 0 ||
      (chart.maxDipMmMilliunits || 0) <= 0 ||
      chart.tankDiameterMmMilliunits !== source.tankDiameterMmMilliunits ||
      chart.tankLengthMmMilliunits !== source.tankLengthMmMilliunits ||
      chart.maxDipMmMilliunits !== source.maxDipMmMilliunits) {
    return {ready:false,message:'Tank chart dimensions do not match the selected global source. Review the physical tank and chart dimensions.'};
  }
  const approvedPoints = source.points || [];
  if (approvedPoints.length < 2 || approvedPoints.length !== storedPoints.length) {
    return {ready:false,message:'The tank chart does not contain the same number of readings as the approved global source. Do not reuse it automatically.'};
  }
  const a=[...approvedPoints].sort((x,y)=>x.dipMillimetresMilliunits-y.dipMillimetresMilliunits);
  const b=[...storedPoints].sort((x,y)=>x.dipMillimetresMilliunits-y.dipMillimetresMilliunits);
  for(let i=0;i<a.length;i++){
    if (a[i].dipMillimetresMilliunits !== b[i].dipMillimetresMilliunits ||
        a[i].volumeMilliunits !== b[i].volumeMilliunits) {
      return {ready:false,message:'The attached readings differ from the approved global chart. No automatic reapproval or data replacement will occur.'};
    }
  }
  return {ready:true,message:operatorProvided?'Your provided chart is linked with identical readings; no repeat approval needed.':'This chart matches its approved global source.'};
}
