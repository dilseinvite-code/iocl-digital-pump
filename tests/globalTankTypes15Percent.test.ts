import { describe, expect, it } from 'vitest';
import {
  GLOBAL_TANK_CAPACITIES_LITRES,
  globalCalibrationMaxLitres,
  exceedsGlobalCalibrationLimit,
  isGlobalTankCapacity,
} from '../src/shared/globalTankTypes';

describe('Global reusable tank types and strict calibration chart ceiling', () => {
  it('offers only the four requested standard tank capacities', () => {
    expect([...GLOBAL_TANK_CAPACITIES_LITRES]).toEqual([10000, 15000, 20000, 50000]);
    expect(isGlobalTankCapacity(10000)).toBe(true);
    expect(isGlobalTankCapacity(25000)).toBe(false);
  });
  it.each([
    [10000, 11500],
    [15000, 17250],
    [20000, 23000],
    [50000, 57500],
  ])('limits %i L global chart to %i L', (nominal, ceiling) => {
    expect(globalCalibrationMaxLitres(nominal)).toBe(ceiling);
    expect(exceedsGlobalCalibrationLimit(ceiling, nominal)).toBe(false);
    expect(exceedsGlobalCalibrationLimit(ceiling + 1, nominal)).toBe(true);
  });
});
