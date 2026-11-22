# PlatePal consumer app refinement

Goal: apply Malek's supplied design direction across the existing app, preserve features, and ship to the existing free-plan Worker.

Design: system SF/Segoe UI sans throughout. Text #18212f, secondary #536174, border #e4e7ec, white surfaces, cool gray #f5f6f8, accent #245cce. 12/14/16/20/28/32px type scale, 4/8px spacing. Cards only for actual grouped objects. Hairline feed and settings rows, unfilled icon actions, full-bleed map, restrained chat. Real locally stored Unsplash food photo on home, without implying a nutrition estimate for that photo. Retain example labels and safety/uncertainty information. No fake playback of voice: speech recognition stores text only, so waveforms identify transcribed messages and have no playback control.

Implementation sequence:
1. Capture all primary screens at 390x844 before changes, including fixture-only scan results and signed-in chat. Write per-screen audit in screenshots/devibe/README.md.
2. Update core tokens, type, controls and shared lucide icon wrapper. Replace decorative home and camera illustrations with a real food photo and functional scan framing respectively.
3. Refine feed byline, topic navigation, compact action row and order inset. Refine map chrome, list and place panel. Refine Me summary, assistant and voice bubbles, setup and groups.
4. Capture matching after screenshots, generate side-by-side comparisons, inspect all and iterate. Exercise navigation, setup, local-fixture scans, dish adjustments, feed save/sort, map sheet/filter/place tabs and settings.
5. Run both Snapmenu app typechecks, root vitest and web production build. Review diff for secrets and feature regressions. Commit and push snapmenu with required trailers.
6. Follow README: check Wrangler auth, apply pending production migrations, deploy built web assets with wrangler deploy --env production. Verify live URL and assets without paid inference.

Constraints: no secrets printed/changed/committed; no paid services, load tests or real inference. Browser fixtures remain outside production source. Keep existing app name and branding. Work directly on clean snapmenu as requested.
