# W008: Independent agent integration comparison

State: independent agent setup trial complete; root evidence artifact pending save.
Both agents pass the same fourteen scenarios. Baseline: 184 application lines,
177.341 seconds. Candidate: 3 application lines, 54.271 seconds; 185 reusable SDK
lines remain maintained. These are automated agent setup measurements, not human
time. Seed preparation, SDK construction and human effort are excluded.
The canonical machine-readable artifact will be `evidence/agent-setup.json`; do
not claim an existing artifact until root saves and inspects it.
Depends on: D006 protocol; stable baseline/candidate integration entrypoints.
Real-provider configuration parity depends on W006/W007, but local protocol setup
and isolated agent tasks can proceed independently.

Use agents as explicitly requested instead of recruiting a developer. Prepare
matching starting applications and task briefs. Assign one baseline and one
candidate agent isolated source ownership with no cross-arm copying. Capture
start/end times and meaningful tool/repair steps, then run the same acceptance
checks on both completed integrations. Record common infrastructure separately.

Report elapsed automated integration time and app-specific code/configuration,
plus reusable SDK maintenance. Preserve failed attempts and setup obstacles;
do not score an incomplete arm as faster. Small-sample/agent limitations must
accompany any savings claim. The original 96.9% wrapper ratio is not a new trial.

Done when both independent arms pass the common behavior gates, artifacts and
measurements are reproducible, and a continue/simplify conclusion follows the
actual result without claiming human effort savings.
