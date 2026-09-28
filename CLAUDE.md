# ScoutCard AI

Web app for high school football staffs: upload the weekly **Hudl breakdown CSV** and get
vector-drawn **scout team cards**, which you can flip through on an iPad at practice or print
2 or 4 to a page. Everything runs client-side. The CSV is parsed in the browser and never
uploaded.

## Stack

- Next.js 15 (App Router), React 19, TypeScript (strict)
- Tailwind CSS v4 (CSS-first config in `src/app/globals.css`, no `tailwind.config`)
- shadcn/ui primitives in `src/components/ui` (new-york style, Radix based)
- PapaParse for CSV, lucide-react for icons
- Barlow / Barlow Condensed via `@fontsource` (self-hosted so the PWA works offline)
- Vitest for unit tests

## Commands

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # production build (also type-checks and lints)
npm start          # serve the production build (service worker only registers here)
npm run lint
npm run typecheck
npm test           # vitest: parser, classifiers, diagram geometry
```

## Project structure

```
public/
  manifest.json            PWA manifest (start_url /script, standalone, dark theme)
  sw.js                    Offline service worker (network-first pages, cache-first static)
  icons/                   PWA + apple-touch icons
src/
  app/
    layout.tsx             Fonts, metadata (manifest, apple web app), SW registration
    globals.css            Theme tokens (dark field palette) + print rules
    page.tsx               Upload landing: dropzone, demo button, parse-report dialog
    script/page.tsx        iPad Practice Reader: filters, Field View swiper, Print Grid tab
  components/
    ScoutCard.tsx          SVG scout card (variant "field" = dark iPad, "print" = black on white)
    PrintGrid.tsx          Letter-size sheets, 2-up portrait / 4-up landscape, window.print()
    FilterBar.tsx          Down / formation toggle pills
    UploadDropzone.tsx     Drag-and-drop + file picker, .csv validation
    BrandMark.tsx, ServiceWorkerRegister.tsx
    ui/                    shadcn primitives: button, card, badge, tabs, dialog
  lib/
    hudlParser.ts          CSV → HudlPlayCard[] (column mapping + normalization + classifiers)
    formations.ts          Coordinate dictionaries + buildDiagram() (players, routes)
    demoScript.ts          MOCK_HUDL_CSV: 5-play sample used by the "Demo Script" button
    scriptStore.ts         Persists the loaded script in localStorage (offline on the field)
    hudlParser.test.ts     Vitest suite
```

## How the pieces fit

1. `parseHudlCsv(file)` / `parseHudlCsvText(text)` in `src/lib/hudlParser.ts` returns
   `{ cards, columns, missingColumns, warnings, rowCount }`.
2. If there's at least one card, the landing page saves it with `saveScript()` and routes to
   `/script?loaded=1`, where `ImportNotice` shows the warnings. With zero cards it shows
   the "No plays found" dialog instead.
3. `/script` reads it back with `loadScript()`, filters it, and renders `<ScoutCard>`.
4. `<ScoutCard>` calls `buildDiagram(card)` from `src/lib/formations.ts` and draws the SVG.

### Hudl column mapping

Headers are normalized (uppercased, BOM stripped, `.`/`_` → space, whitespace collapsed),
then matched against `COLUMN_ALIASES` in priority order. Headers still unmatched fall back to
`HEADER_PATTERNS`, which handles spelled-out names like `Offensive Formation`, `Offensive Play`,
`Defensive Front` and `Yards To Go`. `DEF FORMATION` is never taken as the offensive formation.

| Field       | Accepted headers                                                   |
| ----------- | ------------------------------------------------------------------ |
| Play #      | `PLAY #`, `PLAY#`, `PLAY NO`, `PLAY NUMBER`, `PLAY` → else row index |
| Down        | `DN`, `DOWN`                                                        |
| Distance    | `DIST`, `DISTANCE`, `YDS TO GO`, `TO GO` (`G` = goal to go)         |
| Yard line   | `YARD LN`, `YARD LINE`, `YARDLINE`, `YD LN`, `BALL ON`, `FIELD POS`; values `Opp 45`/`+45`, `Own 35`/`-35`, `50`/`Mid` |
| Hash        | `HASH`, `HASH MARK(S)`; values `L`/`R`/`M` (also Left, Rt, Mid…)    |
| Formation   | `OFF FORM`, `OFF FORMATION`, `FORMATION`, `OFF FORM NAME`           |
| Play call   | `OFF PLAY`, `PLAY CALL`, `OFF PLAY CALL`, then `PLAY TYPE`          |
| Play type   | `PLAY TYPE` when a better play-call column exists (Run/Pass)        |
| Def front   | `DEF FRONT`, `FRONT`, `DEF ALIGN`, `DEF FORM`, `DEF FORMATION`      |
| ODK         | `ODK`: rows tagged `K` are skipped                                  |

Parsing pipeline (`parseHudlCsvText`, never throws):

1. `sanitizeCsvInput` normalizes newlines to `\n`, straightens curly quotes, turns
   non-breaking spaces into spaces, and strips BOM/zero-width/control characters.
2. PapaParse with `header: false` parses the text into raw rows. It auto-detects the
   delimiter (comma, tab, `;`, `|`) and uses `skipEmptyLines: "greedy"`. If it reports
   quote errors, `repairCsvLine` re-quotes each line leniently and the file is parsed again.
   Straightened quotes like `"Hot" Slant Rt` would otherwise swallow the rest of the file.
3. `findHeaderRow` looks at the top 25 rows and picks the one with the most Hudl-looking
   headers (at least 2; earliest wins a tie). Title, metadata, `sep=,` and blank lines above
   it are skipped, and a notes line that mentions "formation" can't beat the real header.
4. `rowToRecord` maps each later row by column index. Short rows read as blanks and extra
   cells are ignored. Keys and values are trimmed.
5. Parse problems become `warnings`. Valid rows always load.

Rows are dropped as blank or special teams when `PLAY #`, `DN`, `OFF FORM`, and `OFF PLAY` are
all empty, when there's no formation, play call, or front to draw, or when ODK is `K`. The
result carries a warning when that happens.

Free-text tags are classified by keyword (`classifyFormation`, `classifyFront`,
`classifyConcept`, `parseSide`). Add new keywords there and a test case in
`hudlParser.test.ts`.

### Diagram coordinate system (`src/lib/formations.ts`)

- SVG viewBox `0 0 500 300`. Center/ball at **(250, 150)**, line of scrimmage at `y = 140`.
- Offense below the LOS (circles, center filled), defense above (X's).
- Hash marks at `x = 167` / `333` (HS hashes split the field in thirds). The ball's hash is
  marked with a triangle on the top edge.
- `FORMATIONS` (spread, trips, i-form, double-eagle, pro) and `FRONTS` (4-3, 3-4, 5-2, bear)
  are drawn **strength right**. `buildDiagram` mirrors them for left formations.
  Corners align on the widest receiver each side, and safeties shade to the
  receiver-heavy side.
- Unknown formations draw as Spread and unknown fronts as 4-3. The card footer says so.
- Routes come from the play concept (`inside-zone`, `power`, `sweep`, `verticals`, `slant`,
  `screen`, `boot`, `dropback`…) and go toward `playDirection`.

To add a formation: add the key to `FormationKey` in `hudlParser.ts`, add a
keyword to `classifyFormation`, add a shape (11 players total incl. 5 OL) to `FORMATIONS`
and a label to `FORMATION_LABELS`, then run `npm test`. The overlap test covers new combos.

## Importing a Hudl CSV

1. In Hudl, open the opponent game or playlist you broke down and export the
   **breakdown data as CSV** (the menu is usually Export → Breakdown / Data → CSV; the
   exact wording varies by Hudl version).
2. Open ScoutCard AI, drop the `.csv` on the upload box (or tap **Choose CSV file**).
3. If at least one play parses, the app opens the cards directly. Any notes about the file
   (skipped title lines, fixed quotes, skipped rows) sit behind a dismissible notice. The
   blocking dialog only appears when no plays could be read. It lists which Hudl columns
   matched.
4. On the field: swipe or use **PREVIOUS CARD / NEXT CARD** (arrow keys on a keyboard).
   Filter by down or formation. Switch to **Print Grid** for 2 or 4 cards per page and
   **Print / Save PDF**.

No Hudl file handy? Use **Load demo script · 5 plays**.

## Offline / iPad install

- Safari → Share → **Add to Home Screen**. The manifest launches `/script` standalone.
- `public/sw.js` registers only in production builds (`npm run build && npm start` or on
  Vercel). Open the app once while online and it keeps working offline.
- The loaded script lives in `localStorage` (`scoutcard:script:v1`), so it survives
  restarts. Bump `CACHE_VERSION` in `sw.js` when changing caching behavior.

## Deploying to Vercel

No environment variables or server code are needed.

- **Git:** push to GitHub, then at vercel.com/new import the repo. Vercel detects
  Next.js (build `next build`, output `.next`). Every push to the default branch deploys.
- **CLI:** `npx vercel` for a preview, `npx vercel --prod` for production.

`next.config.ts` sends `Cache-Control: no-cache` for `/sw.js` so iPads pick up new versions.

## Conventions

- Keep `src/lib/*` framework-free (relative imports, no React) so Vitest runs it directly.
- UI is dark-only and high contrast for sunlight. Touch targets are ≥ 44px. Print output is
  black on white.
- shadcn components were written by hand from the new-york source (the registry was not
  reachable when scaffolding). `components.json` is set up, so
  `npx shadcn@latest add <component>` works where the registry is reachable.
- UI design reference (Claude Design canvas): https://claude.ai/artifact/To8beVQabngaeLeJynuvpY
