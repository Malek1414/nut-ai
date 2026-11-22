# PlatePal visual audit — 22 November 2026

All captures use a 390 × 844 CSS-pixel viewport. `before/` records the original branch; `after/` records the refinement. `compare/` places each matching pair side by side, before on the left. Browser-created accounts/chat content are review fixtures, not real user activity. Scan results come from the existing local mock AI service and the actual nutrition engine. No paid inference is used.

## Before: tells found per screen

| Screen | Observed problem | Design correction |
| --- | --- | --- |
| 01 Home | Fake floating menu illustration, green/saffron/violet accents, heavy type, floating pill buttons and shadows | Real locally stored food photography; compact heading; three useful navigation rows; one blue action color |
| 02 Community | Name and handle stacked, topic/example badges competing with identity, pastel topic chips, filled bubbles around every action | One-line avatar/name/handle/time, quiet topic metadata, text topic navigation, unfilled compact actions, hairline feed dividers |
| 03 Map | Repeated green icon tiles, heavy labels, score rings and warm pin borders compete with roads | Floating search and filter controls retained; neutral place icons, cleaner typography, blue active controls |
| 04 Me | Large rounded account and calorie cards, three pastel macro cards, oversized calorie number, heavy green action buttons | Flat daily summary with aligned macros; list settings; compact neutral account panel |
| 05 Goal | Colored icon tiles, separate rounded options, heavy heading and filled surfaces | Standard radio list with clear selection; one accent; 16px option labels |
| 06 Preferences | Too many pill-shaped controls; sections lack separation from decorative options | Compact segmented control, restrained checkbox choices, familiar native language select |
| 07 Capture | Large fake menu illustration with colored brackets, decorative dark panel | Plain camera entry surface, simple scan icon and actionable instructions |
| 08 Account | Heavy identity styling, large pill controls | Neutral form sheet; consistent input, segmented and button styling |
| 09 Nearby | Large heading over sparse space; request suggestion looks like a badge | Smaller heading, conversational request bubble, text-style suggestion |
| 10 Groups | Oversized two-line slogan, colored option tiles, surplus space | Compact single-line heading and standard action rows |
| 11 Assistant | Sparkle hero, centered welcome, tiled suggestions, extra pills in toolbar | Left-aligned welcome, plain suggestion list, compact toolbar and composer |
| 12 Chat | Voice message is only an icon label; green-tinted bubble | Neutral voice bubble with waveform identifier and readable transcript; no fake audio playback (audio is not stored) |
| 13 Results | Oversized numbers inside rounded containers, pills/badges and multiple elevations | One primary recommendation with restrained blue rule; calmer number scale, flat secondary rows |
| 14 Dish | Rounded macro tiles and repeated chip containers compete with food/component data | Consistent typography, neutral metadata and controls; uncertainty and allergy warnings retained |
| 15 Post | Topic badges and a two-line byline compete with title; large pill action row | Compact shared byline and icon actions, consistent thread typography |

## Design and scope

One system sans family (SF on Apple platforms, Segoe UI on Windows), white surfaces, cool gray secondary surfaces, blue #245cce for actions, neutral ink. Nutrition uncertainty and allergy signals remain distinct. Spacing follows a 4/8px rhythm. Elevation belongs to map overlays and sheets. Real food imagery is illustrative, never passed off as a scanned dish or a restaurant photo. Source and Unsplash license are recorded in `../../public/photos/CREDITS.md`.

Implementation plan: `../../../../docs/superpowers/plans/2026-11-22-platepal-devibe.md`.

## Iteration and verification

The second screenshot pass removed remaining amber example pin borders, boxed dashboard tool rows and sparkle icons, added practical nearby request ideas, and corrected a wrapped calorie range and a group heading spacing issue. `index.html` is an openable comparison gallery; `overview.jpg` is the contact sheet. After-only captures 16–23 cover the expanded map, place panel, menu tab, composer and dashboard tools.

Verified locally:
- API typecheck: `npm run typecheck -w @snapmenu/api` passed.
- Web typecheck and production build: `npm run build -w @snapmenu/web` passed. Vite still reports a large-chunk advisory for app/map bundles.
- Root `npx vitest run`: 70 files passed; 1,321 tests passed, 1 skipped.
- Real Chromium at 390×844: setup and skip setup; camera file input → fixture-backed scan → results → dish; portion correction changes engine totals and resets; map search chrome, filter toggles, pointer drag expansion, place overview/menu/posts and save/unsave; community sorting, save/unsave, thread and composer; account sheet; assistant/new chat/dashboard; targets, favorites and meal builder.
- Home and dish detail: no horizontal overflow at 320px. Focus rings and reduced motion remain supported.
- Real paid inference, microphone hardware, passkey enrollment and external ordering were not invoked. Chat/account render captures use browser-local fixtures; voice waveform is a transcription identifier, not a recording or player.
- Wrangler OAuth authenticated. README's production migration step reports no migrations to apply. No secret values or production configuration changed.

Photo license: [Unsplash License](https://unsplash.com/license). Photographer/source and local asset details: [credits](../../public/photos/CREDITS.md).
