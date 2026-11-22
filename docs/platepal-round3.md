# PlatePal · Round 3 release check

Production: [PlatePal](https://snapmenu.malek-hassan.workers.dev/?team=1), Worker version `797aa81b-3ff3-4a93-96f8-93c6f9e7cc41`. Six D1 migrations applied to `snapmenu-prod`; none remain pending. The nutrition corpus and existing secrets were left in place.

## 390 × 844 mobile Chromium smoke test

| Flow | Result |
| --- | --- |
| Onboarding | Instagram free-beta entry through goal, diet, restriction and taste setup. |
| Group and street requests | Three separate browsers sent simulated speech transcripts (high protein, vegetarian, €15). Production returned one pick per person at one place, an OpenFreeMap pin and a working vote. The street request returned a dish, reason and map. Both used labeled Berlin example menus. [Group](../apps/snapmenu-web/screenshots/round3/09-group-live.png) |
| Photo and menu chat | Uploaded `test-menus/imbiss.jpg` in the live UI with only the inference requests routed to a local Worker and fixture. The result took **0.29 s** from file selection; this is not a production OCR benchmark. The fixture also produced a chat reply and dish cards. The live scan and chat routes were checked for input validation only. |
| Table mode | The same photo upload path, with the local menu reader fixture, fed production table matching. Three people got individual picks without linking a restaurant. [Table](../apps/snapmenu-web/screenshots/round3/11-table-mixed.png) |
| Map, search and delivery | Geolocation, OpenFreeMap tiles, name search, restaurant details, Delivers filter and Wolt/Lieferando/Uber Eats links. The Wolt click opened a new tab and logged the hand-off; the browser intercepted the destination before loading it. |
| Favorites and Premium | Saved dish and place persisted after reload; unsaving worked. Favorites tabs now stay on one row. Premium interest signup and removal worked with a reserved test address, with no payment. [Favorites](../apps/snapmenu-web/screenshots/round3/07-favorites.png) |
| `/numbers` | API and page loaded before cleanup; public scan counts were unchanged after cleanup. The single excluded scan was already present. [Numbers](../apps/snapmenu-web/screenshots/round3/12-numbers.png) |

Wrangler tail showed no `1102` or CPU-limit outcomes in the observed production requests. This does not cover production inference. No paid API calls were made during verification. After the runs, D1 queries confirmed zero matching test events, groups, members, votes and Premium signups. Both Snapmenu apps typechecked, the web build passed, and root Vitest passed 1,286 tests (one skipped).

**Before filming:** try the actual phone's mic and camera in Safari or Chrome over HTTPS. This check used simulated browser speech and fixture-based scan/chat; it did not verify hardware or live Anthropic inference. For live nearby picks, use an area with genuinely scanned menus or make clear that the Berlin picks are examples.
