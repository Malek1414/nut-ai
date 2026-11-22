# PlatePal map at 390 × 844

Headless Chrome captured Berlin Mitte with MapLibre, live OpenFreeMap tiles and the local Worker's OSM restaurant cache. The baseline is the consumer redesign at `778c0e7`. The dish labeled “Example” comes from the existing sample menu.

| View | Before | After |
| --- | --- | --- |
| Nearby restaurants | [Nearby](before-nearby.png) | [Nearby](after-nearby.png) |
| Kebab Kitchen | [Place card](before-place.png) | [Place card](after-place.png) |
| Cuisine search | | [Vietnamese restaurants](after-search.png) |
| Places service offline after reload | | [Saved restaurants](after-cached.png) |

The browser checks covered name and cuisine search, cluster expansion, goal-fit sorting, a pointer drag on the sheet, eight-row pagination, delivery links, directions and the Classic switch in Me. With no device cache and an unavailable places service, the streets remained visible and Retry recovered the list. A separate browser fixture supplied one 24/7 tag and an unparseable tag to check the Open now filter.
