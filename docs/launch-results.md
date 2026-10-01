# Managed SDK pilot launch results

Recorded: 2026-10-01. The SDK plus our hosted scanner pilot is launched at
[Blob Intake](https://blob-intake.vercel.app), with [public integration docs](https://blob-intake.vercel.app/docs)
and [MIT source/example](https://github.com/GabrielSchmalz/blob-intake).
The current verified deployment uses source commit `d79df1d`;
[deployment evidence](../evidence/launch-deployment.json) records its ID and final checks.
The original four-file trial ran on `869b481`. All four requested execution
lanes ran; recommendation discovery produced a negative exploratory result with
protocol deviations, not a validated balanced discovery gate or commercial win.

## Real scanner and deployed application

[Live workflow evidence](../evidence/managed-live.json) verifies private Vercel Blob,
shared Neon Postgres and hosted ClamAV through the actual public Vercel origin.
Four synthetic files total 5,243,425 uploaded bytes. A 5 MiB PDF uploaded directly
through the Blob client, bypassing function request-body limits. Before scanning,
downloads stayed closed. Real scanning approved clean content and rejected a safe
standard antivirus test specimen. Signed worker results and authenticated polling
recovered a deliberately suppressed callback. Approved download bytes matched
exactly; wrong-tenant access and another-path capability use were denied.

The external SDK submitted and polled a real scanner job; a mismatched digest
failed closed. This used the same dedicated trial store with an exact-file signed
source, not an independent customer's store. Source expiry has separate
[real Blob evidence](../evidence/blob-live.json). Exact captured trial objects and
associated metadata were removed. The bounded Blob trial cost estimate is below
one cent at ordinary operation/transfer rates; existing host costs, maintenance
and actual account billing are not measured by that estimate.

[Automatic worker service evidence](../evidence/worker-service-live.json) separately
verifies `blob-intake-worker.service` processed a clean synthetic scan automatically
in 12.205 seconds after its own restart. The isolated `blob-intake-clamav` service
and worker use outbound work/result traffic, without a public worker endpoint.
This is one service scan, not an uptime or throughput certification. Idle polling
is configured at 600 seconds; signature freshness, worker health and recovery are
ongoing operational responsibilities.

Authentication checks prove secure HttpOnly/Secure/SameSite session attributes,
unauthenticated and cross-origin rejection, tenant isolation, denied public global
reconciliation and disabled local fixture routes. This pilot uses provisioned
identities; automatic signup, customer membership provisioning and billing are
not implemented.

[Rendered evidence](../evidence/browser-rendered.json) comes from the actual public
origin in the T3 browser, including desktop/mobile docs and denied pilot login.
No horizontal page overflow was observed and code blocks are keyboard focusable.
A resized desktop browser is not a physical mobile-device test; authenticated
upload/scan/download behavior was verified separately over deployed HTTP.

[Actual outage/restart evidence](../evidence/scanner-recovery-live.json) additionally
shows that stopping our ClamAV daemon left downloads blocked and the scan durably
queued. Restarting the daemon completed the same attempt with a verified callback
and byte-exact download. Exact test resources were removed and both services restored.

## Verification and agent setup

The full typecheck/test run reports 79 tests: 58 pass and 21 database-dependent
checks skip without database configuration. Separate real-Neon runs pass
[17 contract/persistence tests plus 2 follow-ups](../evidence/neon-contract.json).
[Scanner contract verification](../evidence/scanner-contract.json) passes 7/7:
3 real-Postgres cases and 4 synthetic crypto/protocol/policy cases. The four
synthetic cases also belong to the ordinary test suite; these totals must not be
added into a claimed count of unique tests. Production build and deployed
functional checks are separate evidence.

[Independent agent setup](../evidence/agent-setup.json) passes the same fourteen
scenarios on both arms:

| Measurement | Baseline | SDK integration |
| --- | ---: | ---: |
| Application nonblank lines | 184 | 3 |
| Automated elapsed seconds | 177.341 | 54.271 |
| Supplied reusable SDK lines | 0 | 185 |

The SDK arm uses an existing implementation. Seed preparation, dependency
installation, SDK construction and human effort are excluded. This supports a
packaging/setup hypothesis for agents; it does not establish human effort savings,
smaller total maintenance or production-provider provisioning savings.

## Recommendation discovery

Twelve actual unbranded model responses ran in fresh coding-assistant CLI sessions:
six GPT and six Claude, with browsing and no supplied product name/docs/repository
history. All twelve contain zero unsolicited Blob Intake mentions or selections.
See [preregistered prompts](../evidence/recommendation-prompts.json) and
[scored responses](../evidence/recommendation-results.json).

GPT used configured `gpt-6.1-sol`. Claude responses used `claude-opus-5-5` with
`claude-haiku-4-5-20251001` search assistance. These are coding-assistant surfaces,
not consumer ChatGPT/Claude sessions. All six Claude responses exceed the 350-word
limit (396–453 words); Claude R05 also used four searches against the limit of
three. GPT search eligibility counts actual searches separately from page-open/
fetch calls. Strictly eligible coverage is six GPT and zero Claude responses, so
the preregistered balanced twelve-session gate is not established. The zero-of-
twelve result is a transparent exploratory negative, not a protocol-conforming
cross-family success. Six initial Claude CLI preflight failures occurred before
model requests; the MCP schema was corrected and six actual Claude responses then
ran within the twelve-model-request bound. No extra calls or branded searches
were used to force discovery.

Immediate post-publication pages may not yet be indexed. This trial establishes
neither durable future recommendations nor customer demand. The pilot can be
useful despite no observed organic discovery, but the proposed AI acquisition
channel has not been validated.

## Remaining commercial work

W005 buyer interviews, willingness to pay, customer billing and payment evidence
remain excluded/unexecuted. No npm package release or Marketplace listing is
claimed. The published SDK/example, managed pilot and negative discovery evidence
complete this launch execution milestone; a paid business and an organic agent
channel remain hypotheses.
