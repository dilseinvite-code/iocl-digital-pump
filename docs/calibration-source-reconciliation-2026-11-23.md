# Calibration source reconciliation — 23 November 2026

This note compares the operator-provided **Calibration Chart.pdf** (2 scanned pages) with the previously stored Excel-reference chart data. The original PDF is private and was not copied into this repository.

| Reference | PDF page | Dip range | Chart maximum | Digital points | Nominal +15% ceiling |
| --- | --- | --- | ---: | ---: | ---: |
| 10 KL | 1 | 0–1,940 mm | 11,073.41 L | 195 | 11,500 L |
| 20 KL | 2 | 0–2,100 mm | 21,628.93 L | 211 | 23,000 L |

## Confirmed printed-vs-digital differences

| Dip | Scanned PDF | Existing workbook | Difference (workbook – PDF) |
| ---: | ---: | ---: | ---: |
| 10 mm (10 KL) | 6.90 L | 6.95 L | +0.05 L |
| 810 mm (10 KL) | 4,378.94 L | 4,379.19 L | +0.25 L |

These figures come from visually checked PDF rows and the existing workbook fixture test. **Do not represent sampled checks or identical endpoints as a full 195/211-row scan transcription.** Do not silently adjust old stock history, replace a linked ACTIVE chart, or substitute Standard 20 KL for Excel Reference 20 KL.

The +15% figure is a chart-volume warning threshold and is **not** the tank's physical safe-fill limit. The latter remains separately configured per tank.

## Setup and regression path

- Tank Calibration is the reusable chart library; older alternatives are available but not the default screen.
- Underground Tanks handles create, fuel mapping, activate/deactivate, reversible removal, and restore.
- Full 20 KL workbook records are copied to a new tank unchanged at stored milliunit precision, with the physical tank initially INACTIVE; its activation is tested separately under existing limits.
- Daily Operations, Stock, Finance, Reports, Documents and Admin are discoverable through task search, retaining existing permissions.
- PR #111 stays a **draft** until its checks pass. No production merge, Cloudflare Worker/database migration, or manual Vercel production release is part of this change.

**Remaining release gate:** a full machine-readable, row-by-row PDF transcription has not been established. Any remapping of a tank that has stock history must preserve the original revision and audit trail. A successful fixture test is not a live D1 Tank #2 activation test.

## Automated integration test scope

The end-to-end registration test uses the stored 20 KL workbook as its starting numerical source, then substitutes the **five verified printed checkpoints in an isolated, test-only database**. This tests that a completely populated, checkpoint-consistent curve can be copied and activated without repeating chart approval. **It is not a production remap or a verified full transcription of every scanned row.** Any differences found in the legacy workbook are reported by the test runner; the original fixture and live database remain unchanged.

## 20 KL 202 cm reading — operator confirmation

On 23 November 2026, the operator explicitly confirmed that the scanned 20 KL source at **2020 mm (202 cm)** reads **21,359.52 L**, replacing the provisional visual transcription 21,369.52 L. The draft CSV and scan-checkpoint tests were updated accordingly. The previous recorded Excel and all live tank/stock histories remain unchanged. Other scanned rows still require an independent proofreading pass before operational source remapping.
