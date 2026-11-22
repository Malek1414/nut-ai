# PlatePal provider switch and beta recheck · 22 November 2026

The three supplied reviews were rechecked against branch `snapmenu`, starting at `43ea556`. Their baseline was `07da9f3`; later changes were preserved. This release uses OpenAI by default, keeps Anthropic selectable, and keeps Nut AI / Mann Bellani credit and AGPL licensing.

## Provider and spending controls

`AI_PROVIDER=openai` selects `OPENAI_API_KEY` and `OPENAI_MODEL=gpt-5.4-mini`. The key listed this model with `GET /v1/models`; [OpenAI documents image input and structured outputs](https://developers.openai.com/api/docs/models/gpt-5.4-mini). `AI_PROVIDER=anthropic` selects the retained Anthropic key and `MODEL_READ` / `MODEL_VOICE`. Photo reads, friendly ordering prose, menu chat, group needs, typed meals, link imports and the signed-in meal assistant all use the selected provider. OpenAI has no automatic retries or cross-provider fallback. A normal solo scan makes a menu read and an optional wording call; table scans omit the wording call. Menu chat makes one call. No speech-service API is used.

Scan attempts, including failed provider calls, reserve all three limits atomically: 12/device/hour, 30/daily-hashed IP/hour, 100/app/UTC day (`SCAN_DAILY_CAP`). Denied attempts consume no shared allowance. Chat, typed meals, imports and group needs retain their existing independent limits. No subscription, paid Cloudflare plan, Google API, Workers AI, account or service was added.

Successful scans save compact engine output without their photo. Public map attachments and order posts copy nutrition from these records, ignoring browser-supplied numbers. Older scans without a server record must be scanned again before attaching/posting. Restaurant identity is still client-supplied; full verification against trusted OSM records is deferred.

## UX findings

| Original # | Recheck and disposition |
|---|---|
| 1 | Reproduced. Fixed: restore stored results on reload; returning profiles without a result open capture. |
| 2 | Reproduced. Fixed: keep Results mounted behind dish details; restore scroll and open lists on Back. Verified at 390×844. |
| 3 | Reproduced. Fixed: replace the fixed share bar with an inline share control. Current link sharing already uses PlatePal URLs/previews. |
| 4 | Reproduced. Fixed: collapsed Add to the map row; restaurant lookup only after expansion and granted location. |
| 5 | Already improved by later work: waiting text describes the wait, without claiming timed translation/weighing stages. Streaming remains off in production to limit Worker CPU. |
| 6 | Partial: fixed the misleading number-of-allergies badge to count dishes with hints. Repeated per-dish warnings remain accurate and are retained. |
| 7 | Reproduced. Fixed: two-line names, remove repeated Top tags, use an allergy icon, suppress case/punctuation-only duplicate translations. |
| 8 | Partial: removed the unscaled bar on the best dish. Feed decoration and existing confidence chips remain; aesthetic cleanup deferred. |
| 9 | Partial: scan/order/location/map controls now have 44px minimum targets. Existing community compact controls and hit-area extensions remain for a separate layout pass. |
| 10 | Still present in the score-map variant. Metric/cluster/ring redesign deferred; it is separate from provider availability and the table/voice filming flows. |
| 11 | Later onboarding now collects diet and ingredient restrictions together. Retained explicit language choice; renamed Translate to to Language here and in Me. |
| 12 | Reproduced. Fixed: goal-only acknowledgement expires after four seconds. Minor capture wording retained. |
| 13 | Still partial: generated answers and API copy follow the selected language; much of the web UI remains English. Full UI translation is deferred. |
| 14 | Later feed work already removed duplicate delivery filtering and hides Saved filters. Repeated generated titles/example-comment tags remain cosmetic follow-ups. |
| 15 | Partial: short landing footer preserves full credit/source; Me says location Off; duplicate sheet warning removed. Long score-map lists retained. |

## QA findings

| Original # | Recheck and disposition |
|---|---|
| 1 | Reproduced with vegan burger, seitan döner, phở chay and tofu curry. Fixed explicit none/components handling and plant-ingredient diet detection; actual animal ingredients still contradict vegan claims. |
| 2 | Reproduced. Fixed mandatory valid device and atomic scan-attempt limits before inference. |
| 3 | Reproduced. Fixed public map/order nutrition provenance through stored engine scan records; tampered numbers are ignored in tests. Restaurant metadata verification/moderation remains a follow-up. |
| 4 | Reproduced with mocked lettuce and chocolate-powder hits. Fixed USDA-first drinks, product-name overlap and liquid calorie plausibility checks. |
| 5 | Reproduced by request counting. Fixed schema batching/migration ordering and grouped feed lookups; current cold numbers 40 calls and forty-restaurant feed 4 calls. |
| 6 | Reproduced. Fixed event allowlist, valid device, rate cap and storage limited to consumed metrics. Client scan events are rejected; social/install/landing metrics remain supported. |
| 7 | Still present: guest voting/reporting uses replaceable device IDs. Stronger identity/IP moderation is deferred; do not treat guest votes as verified people. |
| 8 | Reproduced. Fixed first language in bilingual labels and preservation of a distinct translation; new regression checks German/English waiter speech. |
| 9 | Reproduced. Fixed result restore and unavailable-history-state fallbacks. |
| 10 | Partially fixed previously (failed location reset); now refresh saved granted position on launch/foreground only with an existing browser grant. No automatic permission prompt. |
| 11 | Reproduced. Fixed negative own delivery vote. Outside Berlin, links now open the provider home so it can locate the guest, instead of searching Berlin. |
| 12 | Already fixed in 9fc150f: original numbers on untouched detail, original uncertainty for portion guesses, disabled uncounted steppers. |
| 13 | Reproduced. Fixed common French/Italian/Turkish/mushroom false positives and nutrition/price phone-number false positives. Restaurant names resembling domains can still hit the general link rule. |
| 14 | Reproduced. Fixed cafe-only ranking fallback, excludes alcohol, and gives an accurate empty-food explanation. |
| 15 | Earlier work fixed hidden-parent reply acceptance and visible counts. Now author deletion erases content/photo/identity/votes/saves; photo responses are private/no-store. Hidden-parent conversations remain hidden consistently. |

## Free-plan findings

| Original # | Recheck and disposition |
|---|---|
| 1 | Unbounded scans fixed. OpenAI is the sole newly authorized paid inference provider; exactly one live scan and one live chat are planned for release verification. |
| 2 | Branch already has bundled pinned recipe-food lookup. This release deploys it; no corpus import/reseed is run. Setup-script/index work is deferred. |
| 3 | Yesterday’s usage balance is no longer applicable. No corpus import; fewer client events are stored. Bulk import size remains a setup concern. |
| 4 | Historical CPU timings cannot certify the current build. Reduced image cap (1.4m base64 characters; Content-Length guard 1.5m), disabled production streaming, and bounded OFF calls. No load test or paid-plan change. |
| 5 | Prior outage not assumed current. Limit foreground map wait to four seconds; continue cache filling with waitUntil, give each Overpass server six seconds, retain fresh lists seven days / cached lists sixty days. No city-wide preload. |
| 6 | Reproduced. Fixed five-minute server cache and one-minute polling. Cached numbers request makes zero D1 calls in the regression check. |
| 7 | Old Opus-default speed/cost claim superseded by the configurable OpenAI default. Actual one-scan/chat timings are recorded after deployment. No comparison benchmark. |
| 8 | Reproduced by source. Fixed eight OFF lookups per scan, same-query sharing, 1.5-second scan lookup timeout and five-minute failure cooldown. |
| 9 | Reproduced. Fixed batched schema/seeding with compatible column migration before seeds. Upgrade from a pre-via schema is tested. |
| 10 | Fixed feed N+1 kind queries and metadata-first parsed-cache reuse, bounded to forty cached areas. Map requests still read their cache body; further optimization needs a measured problem. |
| 11 | Historical bundle/token/CPU numbers not reused as current evidence. Build and live result evidence are recorded separately. |

Cloudflare documents that a [D1 batch counts as one invocation query](https://developers.cloudflare.com/d1/platform/limits/). The budget test counts binding calls, including a batch once; it does not claim to measure CPU or rows read.

## Verification

- API typecheck and web production build (including web typecheck): passed.
- Root `npx vitest run`: 70 files passed; 1,321 tests passed, one skipped.
- Mock responses cover both providers, vision transport, every model job, errors/refusals, number gating, scan limits, provenance and review regressions.
- Independent code review caught shared-limit depletion and pre-via migration ordering; both were fixed and verified before release.
- Browser at 390×844: stored result reload, whole-menu expansion, dish/back retaining expansion and scroll, no horizontal overflow, no fixed share overlay. Screenshots live outside versioned source under `output/playwright/`.

## Live verification

Deployed commit `56a31be` to https://snapmenu.malek-hassan.workers.dev with Worker version `590829b3-bec6-44ef-ae55-64772ae4897a`. Migration `0150_beta_limits.sql` applied. `OPENAI_API_KEY` was piped from the existing local env file into the Worker secret; its value was never displayed or committed. Production health confirms OpenAI and `gpt-5.4-mini`. Upload: 2,538.96 KiB / 510.85 KiB gzip; Worker startup: 44 ms.

Exactly one real POST `/api/menu` used `apps/snapmenu-web/test-menus/imbiss.jpg`, a browser user agent and a unique team device. HTTP 200 in **5.90 seconds**: 13 dishes, three ordering tips. Server timings: read 4,659 ms, engine including database waits 101 ms, wording 865 ms, total 5,625 ms. These are wall times, not CPU measurements.

Exactly one real POST `/api/chat` reused that scan. HTTP 200 in **1.05 seconds**, returning a readable recommendation with two valid dish IDs and no invented nutrition numbers. No latency comparison or load test was run. The captured chat tail outcome was ok with zero exceptions; scan success is established by its complete HTTP 200 response.

Cleanup was verified with a fresh remote query: **zero test events, scan records, device scan limits and device chat limits remain**. Shared scan/IP/chat counters were decremented only by this test's reservations. No corpus or existing user data was removed. The local browser rendered the saved live response at 390×844 without another inference call (`output/playwright/platepal-live-result.png`).
