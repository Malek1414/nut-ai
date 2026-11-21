# CIQUAL 2025: source and licence

`table.generated.ts` in this folder is derived from:

> Anses. 2025. Ciqual French food composition table. https://doi.org/10.5281/zenodo.17550133

- Publisher: Anses (French Agency for Food, Environmental and Occupational Health & Safety), Ciqual unit.
- Licence of the data: Creative Commons Attribution 4.0 International (CC BY 4.0), as stated on the Zenodo record. https://creativecommons.org/licenses/by/4.0/
- Release used: files dated 2025-11-03, published 2025-11-19 (3,484 foods, 74 components).

Changes made by Snapmenu (format only, no value was edited):

- 11 of the 74 components are kept: energy (kcal, Regulation EU No 1169/2011), protein, carbohydrate, fat, fibres, sugars, salt, sodium, alcohol, with the two fallbacks the table itself offers (energy with Jones' factor, crude protein).
- Rows without energy, protein, carbohydrate or fat are left out (159), and so is baby food (39). 3,286 rows remain.
- "traces" is stored as 0; "< x" as x / 2; sodium is taken from salt (salt g x 400) where the sodium cell is empty.
- One reliability letter per row: the weakest of CIQUAL's own confidence codes for protein, carbohydrate and fat.
- Search keys and flags are added per row (lowercase words of the French and English names).

Anses does not endorse Snapmenu or this use of the table. Show `CIQUAL_ATTRIBUTION` (exported by `index.ts`) wherever one of these numbers is shown.

The code in this folder is part of Snapmenu, AGPL-3.0-or-later, like the rest of the repository.
