import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/frontend/pages/PumpInfrastructurePage.tsx', 'utf8');
const modal = source.slice(source.indexOf('{/* Tank Calibration Chart Modal */}'));

describe('Linked Chart production UI', () => {
  it('defaults advanced settings to collapsed on every modal open', () => {
    expect(source).toContain('const [calShowAdvanced, setCalShowAdvanced] = useState(false)');
    expect(source.slice(source.indexOf('const openCalibrationModal = async'), source.indexOf('const openCalibrationModal = async') + 1000)).toContain('setCalShowAdvanced(false)');
    expect(modal).toContain('!calSelectedChart?.sourceTemplateId && calShowAdvanced && (');
    expect(modal).toContain('aria-expanded={calShowAdvanced}');
  });

  it('retains the PDF action outside advanced tools and removes the dummy preset', () => {
    const advanced = modal.indexOf('data-testid="advanced-calibration-tools"');
    expect(modal.indexOf('data-testid="apply-pdf-calibration-existing-tank"')).toBeGreaterThanOrEqual(0);
    expect(advanced).toBeGreaterThan(modal.indexOf('data-testid="apply-pdf-calibration-existing-tank"'));
    expect(modal.indexOf('CSV / Bulk Import Chart')).toBeGreaterThan(advanced);
    expect(modal.indexOf('Dry-Run vs Printed Chart')).toBeGreaterThan(advanced);
    expect(modal).not.toContain('Load 5-Point UAT Preset');
    expect(source).not.toContain('handleLoadDummyCalibrationPreset');
  });

  it('preserves linked global read-only view and visible missing/error warnings', () => {
    expect(modal).toContain('data-testid="global-calibration-linked-summary"');
    expect(modal).toContain('data-testid="linked-global-readings"');
    expect(modal.indexOf('{modalError && (')).toBeLessThan(modal.indexOf('data-testid="advanced-calibration-tools"'));
    expect(modal.indexOf('{!linkedSuppliedReady && !calStatus.isConfigured && (')).toBeLessThan(modal.indexOf('data-testid="advanced-calibration-tools"'));
  });
});
