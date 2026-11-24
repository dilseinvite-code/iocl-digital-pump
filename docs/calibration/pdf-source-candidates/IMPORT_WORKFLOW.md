# Importing corrected PDF calibration as a separate source

The shared source module `src/shared/operatorPdfSourceData.ts` contains the literal manual PDF-transcribed values from both CSVs in this folder. The explicitly operator-confirmed 20 KL / 202 cm reading is **21,359.52 L**.

In **Tank Calibration** the authorized user can click **Use supplied 10 / 20 KL PDF charts** once. The application checks that every submitted dip/volume row exactly matches the versioned source and creates separate `PDF_10KL_OPERATOR_2026_11` and `PDF_20KL_OPERATOR_2026_11` entries. It never overwrites the old `EXCEL_*` source or a tank-linked revision.

The UI does not ask for a second engineering approval checkbox. Internally, the new template has the existing ready/approved status and the actor is recorded in the audit log; this is not an engineering certificate. The operation is user-initiated, not a startup migration.

For **new tanks**, quick registration prefers the new PDF source over legacy Excel when it exists and passes full numeric consistency checks. Existing tanks are deliberately **not** auto-remapped. Their historic dip-to-litre mappings and stock events must remain intact, and any explicit remap should create a new chart revision with traceable effective date.

No production database has been modified by this PR. Do not merge without reviewing the remaining scanned-PDF transcription notes and operational test plan. Chart +15% nominal volume validation is not safe-fill authorization.
