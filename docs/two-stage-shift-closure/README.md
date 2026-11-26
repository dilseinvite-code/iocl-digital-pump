# Two-stage operational and financial closure

## Operator
1. Save all tank/nozzle readings, complete or cancel receipts, and save stock reconciliation.
2. Review actual stock differences. Click **Close Operational Shift** and confirm.
3. Operations are CLOSED, readings/reconciliation become read-only, the DSR remains available, and the next shift may open. Financial reconciliation stays PENDING.

## Accounts
Use **Daily Operations → previous business date/shift → Collections & finance**, or choose the previous shift in Financial Operations. Only users with the existing scoped finance-write permissions may record or change collections; finalization also requires shifts.close and financial_reconciliation.read. On Reconciliation, verify actual collection entries, explain any non-zero variance, explicitly confirm and finalize. This preserves the original operational closing time and actor and does not touch the newer shift.

## Integrity
- Legacy CLOSED and LOCKED shifts are never reopened. Only a durable deferred-close marker allows collection entry after operational closure.
- Operational closure requires current, explicitly saved per-tank reconciliation, complete fuel/receipt/nozzle data, calibration provenance and applicable CNG data. No invented cash, no financial rows and no overwritten stock reconciliation.
- Existing OPEN/CLOSING uniqueness and closed-shift continuity stay intact. Financial finalization does not re-enter CLOSING.
- Each closure milestone and audit commits in one D1 batch. A payment edit racing financial finalization is checked against current per-type collection totals; no financial row is overwritten. An uncertain result requires refreshing and authorized review, not blind retry.
- Existing financial permission and outlet-scope checks are preserved. Legacy full-close API remains unchanged.
- Cash-custody acknowledgement and deposit verification retain their existing independent rules.
- Old Worker responses never advertise the new button. Without the additive table, the old workflow is available, and deferred closure is rejected before any writes.

## Release gate (do not apply automatically)
Keep 0001–0035 historical migrations frozen. Apply **only** the separately reviewed additive file `migrations/additive/0042_deferred_shift_finance.sql` to an isolated staging D1 first; verify existing shifts/stock/collections/financial counts unchanged and rehearse operational closure plus later financial completion. For production, confirm the exact configured D1 identity, backup/Time Travel availability, and explicit approval for this additive schema installation. Do not run the generic migration workflow or apply the historical baseline again.

Deploy the Worker and frontend using the approved release process after schema verification. No existing operational data should be edited or closed during deployment. If the additive table is absent the feature stays disabled. Once real deferred closures exist, do not remove the table or roll back to an older Worker that cannot recognize pending financial closure; use an approved forward fix.
