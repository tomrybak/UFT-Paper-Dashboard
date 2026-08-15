# Recovery Procedure

1. Read `data/dashboard-state.json`.
2. Use `selectedIssueIds` as Tom's chosen next-round queue.
3. Use `issues[*].rank`, `issues[*].severity`, and `issues[*].resolutionApproach` to plan the next pass.
4. Append any completed investigation or manuscript change to `history`.
5. Add a new `scoreHistory` entry when a change materially improves or weakens publication readiness.
6. Keep source facts tied to `sources` and `issues[*].sourceRefs`.
7. Preserve `issueViewPreferences` as Tom's preferred issue queue view.

## Recheck Cycle

Use `recheckCycle` in `data/dashboard-state.json` as the canonical process definition. It combines the recovery notes, Tom's review/select/submit-next-round workflow, and the standing dashboard memory:

1. Recover state from `dashboard-state.json`, memory notes, selected issues, history, score history, and source paths.
2. Intake new evidence by adding papers, observations, SQL rows, notes, insights, supporting data, and history before drawing conclusions.
3. Rank and scope all open issues while treating `selectedIssueIds` as Tom's approved next-round queue.
4. Resolve selected work in the manuscript, research artifacts, SQL data, notes, or dashboard.
5. Verify with available builds/checks and update score history only when readiness materially changes.
6. Log the cycle and hand Tom a recoverable next review state.

Important source paths:

- Paper bundle: `/mnt/c/Users/Tom/Downloads/UFT_v112_bundle.zip`
- Active research workspace: `/home/tom/.openclaw/workspace/uft_research`
- Parameter ledger: `/home/tom/.openclaw/workspace/UFT_PARAMETER_LEDGER.csv`
- Research segmentation: `/home/tom/.openclaw/workspace/UFT_RESEARCH_SEGMENTATION.md`
