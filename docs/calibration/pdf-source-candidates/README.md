# Calibration Chart.pdf — manual PDF transcription candidates

## Sources
The operator uploaded the two-page HP-scanned Calibration Chart.pdf in the current conversation, dated 23 November 2026.
Page 1: 10 KL (diameter 194 cm; length 375 cm), 195 dip points from 0 to 1940 mm; maximum 11073.41 L.
Page 2: 20 KL (diameter 210 cm; length 625 cm), 211 dip points from 0 to 2100 mm; maximum 21628.93 L.

The two CSVs in this directory contain visually/manual-transcribed dip and volume pairs. No interpolated, algorithm-generated, or automatically substituted volumes were used. Their two-column schema is compatible with the existing simple calibration CSV parser.

## Review warning
These are candidate transcriptions pending independent proofreading against the printed PDF, not a signed engineering certificate and not live operational calibration. Do not auto-activate any existing tank or overwrite stored calibration history from these files.

The 20 KL row at 2020 mm is especially ambiguous: the scanned page appears to read 21369.52 L but the steps between 2010 mm (21307.88 L) and 2030 mm (21408.13 L) are inconsistent with adjacent increments. An alternative reading of 21359.52 L would be smoother, but that is a mathematical inference; it MUST NOT silently replace the printed source. Confirm this original-paper digit before operational use.

## How to compare
Run: bun test tests/scannedPdfTranscriptionReview.test.ts
The test reads the existing legacy 10/15/20 KL Excel fixture, compares every dip and volume to these PDF-based candidate CSVs and logs discrepancy counts, largest absolute discrepancy, and initial rows.

The +15% nominal-volume thresholds (11500 L / 23000 L) are separate from physical tank safe-fill capacities.
Existing tanks, tank stock history, audit logs, chart revision histories, D1 data and production deployments are unaffected.
No manual Vercel production deployment, Cloudflare migration, live Tank #2 activation, or GitHub main merge is authorized by this commit.
