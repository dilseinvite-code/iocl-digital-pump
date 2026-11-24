import type {GlobalTankCalibrationTemplate} from '../../../shared/types';
import {isOperatorSuppliedReference,isOperatorSuppliedSourceMetadata} from '../../../shared/operatorSuppliedCalibration';
import {isOperatorPdfSourceCode} from '../../../shared/operatorPdfSourceData';
import {scannedReferenceSpec,reviewScannedCalibrationCandidate} from '../../../shared/scannedCalibrationReference';

export function reviewLoadedGlobalCalibration(chosen: GlobalTankCalibrationTemplate | undefined, detail: GlobalTankCalibrationTemplate | null) {
  const detailReady = Boolean(chosen && detail?.id === chosen.id && detail.updatedAt === chosen.updatedAt && Array.isArray(detail.points));
  const exactPdf = Boolean(chosen && isOperatorPdfSourceCode(chosen.code,chosen.nominalCapacityLitres));
  const suppliedSource = Boolean(chosen && (exactPdf || isOperatorSuppliedSourceMetadata(chosen)));
  const suppliedReady = Boolean(detailReady && chosen && detail && isOperatorSuppliedReference(chosen,detail.points));
  const scannedSpec = chosen ? scannedReferenceSpec(chosen.nominalCapacityLitres) : null;
  const alternateToScannedReference = Boolean(chosen && scannedSpec && chosen.code !== scannedSpec.code && !exactPdf);
  // An absent response is not an empty chart. Exact PDF sources use the full
  // digital reference comparison, not the old Excel sample-only review.
  const scannedReview = detailReady && chosen && detail && scannedSpec && !alternateToScannedReference && !exactPdf
    ? reviewScannedCalibrationCandidate({
        code:chosen.code,nominalCapacityLitres:chosen.nominalCapacityLitres,
        tankDiameterMm:detail.tankDiameterMm,tankLengthMm:detail.tankLengthMm,maxDipMm:detail.maxDipMm,
        points:(detail.points || []).map(p=>({dipMm:p.dipMillimetresMilliunits/1000,volumeLitres:p.volumeMilliunits/1000})),
      }) : null;
  return {detailReady,exactPdf,suppliedSource,suppliedReady,scannedSpec,alternateToScannedReference,scannedReview};
}
