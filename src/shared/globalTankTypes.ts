/**
 * Global calibration library guardrails.
 * The +15% cap validates imported reference DATA; it is not a physical safe-fill
 * limit and must never replace a tank's configured safeFillCapacityLitres.
 */
export const GLOBAL_TANK_CAPACITIES_LITRES = [10000, 15000, 20000, 50000] as const;
export type GlobalTankCapacityLitres = typeof GLOBAL_TANK_CAPACITIES_LITRES[number];
export const GLOBAL_CALIBRATION_MAX_VOLUME_RATIO = 1.15;

export const globalCalibrationMaxLitres = (capacityLitres: number): number =>
  Math.round(capacityLitres * GLOBAL_CALIBRATION_MAX_VOLUME_RATIO * 1000) / 1000;

export const exceedsGlobalCalibrationLimit = (
  volumeLitres: number,
  capacityLitres: number
): boolean => volumeLitres > globalCalibrationMaxLitres(capacityLitres) + 0.000001;

export const isGlobalTankCapacity = (capacityLitres: number): capacityLitres is GlobalTankCapacityLitres =>
  GLOBAL_TANK_CAPACITIES_LITRES.some(capacity => capacity === capacityLitres);
