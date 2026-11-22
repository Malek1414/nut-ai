# PlatePal visual checks

Each numbered PNG shows a 390 × 844 browser viewport. Filenames match across [before](before), [after](after) and [dark](dark). The baseline is the production build of `e63d2d5`. Screen 15 shows the default map for a fresh installation. Screens 16–20 show the two selectable maps and their restaurant details.

The [hero frame strip](hero-frames.png) runs left to right, then top to bottom. The four samples come from the eight-second CSS loop. The numbered screenshots use the device’s reduced-motion setting and show the resting frame.

The local browser walkthrough used a recorded menu response, OpenStreetMap place data and fictional accounts, QR codes and conversations. Example nutrition in the hero is artwork. The assistant, scan and meal-plan screens required no paid inference.

## Verification

- Compared the same screen states in light and dark with axe-core’s WCAG text contrast check. Primary button text measures 6.91∶1 in light and 10.32∶1 in dark. Muted text on the secondary surface measures 5.33∶1 and 6.49∶1.
- Checked the legacy Explore preference, both choices in Me, and persistence after reload. Opened Classic restaurant details, checked the OSM verification mark and followed the Order control to the three provider links.
- Held the hero JavaScript request open. The heading and scan entry rendered, and tapping Scan opened setup before the artwork loaded. The preview and finished scene both measured 213.5 CSS pixels tall.
- Tested pause, resume and the static reduced-motion frame in Chromium. The illustration ships as 7,426 bytes of deferred JavaScript and CSS, about 2.8 kB gzipped.

Visual references included MenuFit’s nutrition presentation and Genius Scan’s document capture sequence. PlatePal’s artwork is original SVG. [MenuFit](https://menufit.com/) · [Genius Scan](https://thegrizzlylabs.com/genius-scan/)
