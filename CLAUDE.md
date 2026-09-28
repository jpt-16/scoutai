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
    script/page.tsx        iPad reader: Scout O/D + All/7v7/Team toggles, filters, swiper, Print Grid
  components/
    ScoutCard.tsx          PlayIQ-style card: title header, white-field SVG, assignment table
    PrintGrid.tsx          Letter-size sheets, 2-up portrait / 4-up landscape, window.print()
    FilterBar.tsx          Down / formation toggle pills
    UploadDropzone.tsx     Drag-and-drop + file picker (multiple films), .csv validation
    EditPlayDialog.tsx     Edit a play (formation, strength, play, direction, hash, front, coverage, note)
    ImportNotice.tsx       Non-blocking "Loaded / Added N plays" notice with file notes
    BrandMark.tsx, ServiceWorkerRegister.tsx
    ui/                    shadcn primitives: button, card, badge, tabs, dialog
  lib/
    hudlParser.ts          CSV → HudlPlayCard[] (column mapping + normalization + classifiers)
    formations.ts          Formations, fronts, run schemes, route tree → buildDiagram()
    importFilms.ts         Parses several CSVs (one per film) into one script
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
| Play #      | `PLAY #`, `PLAY#`, `PLAY NO`, `PLAY NUMBER`, `PLAY` (if numeric) → else row index |
| Down        | `DN`, `DOWN`                                                        |
| Distance    | `DIST`, `DISTANCE`, `YDS TO GO`, `TO GO` (`G` = goal to go)         |
| Yard line   | `YARD LN`, `YARD LINE`, `YARDLINE`, `YD LN`, `BALL ON`, `FIELD POS`, `YARD`; values `Opp 45`/`+45`, `Own 35`/`-35`, `50`/`Mid` |
| Hash        | `HASH`, `HASH MARK(S)`, `H`; values `L`/`R`/`M` (also Left, Rt, Mid…)    |
| Formation   | `OFF FORM`, `OFF FORMATION`, `FORMATION`, `OFF FORM NAME`, `FORM`   |
| Play call   | `OFF PLAY`, `PLAY CALL`, `OFF PLAY CALL`, then `PLAY TYPE`; a bare `PLAY` column of names |
| Play type   | `PLAY TYPE` when a better play-call column exists (Run/Pass)        |
| Def front   | `DEF FRONT`, `FRONT`, `DEF ALIGN`, `DEF FORM`, `DEF FORMATION`      |
| Result      | `RESULT`, `PLAY RESULT`, `GN/LS`, `GAIN/LOSS` (kept on the card data) |
| Off strength| `OFF STR`, `OFF STRENGTH`, `STRENGTH`, `STR`; `L`/`R` set the formation side (`BAL` = default) |
| Play dir    | `PLAY DIR`, `PLAY DIRECTION`, `DIR`, `DIRECTION`; `L`/`R` set the arrow direction (`N` = none) |
| ODK         | `ODK`: rows tagged `K` are skipped                                  |

Parsing pipeline (`parseHudlCsvText`, never throws):

0. `detectUnsupportedFile` catches uploads that aren't text at all: Apple Numbers files,
   Excel `.xlsx` files and other binary files saved with a `.csv` name (zip archives start with
   `PK`). The dialog shows "Save this as a CSV first" with the menu path, instead of trying
   to parse binary data. This was the real cause of "1618 rows read, no columns matched".

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

Validation is relaxed. A row is a play if **any** of play #, down, formation, play call, play
type, or result is filled in. Blank fronts, play calls, hashes, and similar fields show as
"—", and the card footer notes when a formation or front wasn't tagged. Only fully blank rows
and ODK `K` (special teams) rows are skipped, with a warning.

Free-text tags are classified by keyword (`classifyFormation`, `classifyFront`,
`classifyConcept`, `parseSide`). Add new keywords there and a test case in
`hudlParser.test.ts`.

### Scout cards: two units × two periods (`src/lib/formations.ts`)

`buildDiagram(card, mode, unit)`: `mode` is `"team"` (11v11) or `"7v7"`, and `unit` is
`"offense"` or `"defense"`.

- **Scout offense** (`unit: "offense"`): offense only, for the scout offense running the
  opponent's plays.
  - `playKind` sorts a play call into `run` / `pass` / `rpo` / `pa` / `none`.
  - **Runs:** `runScheme` picks the blocking:
    - `zone`: every lineman reaches playside.
    - `outside-zone`: same, wider.
    - `power` (POWER, G ISO, READ POWER): the backside guard pulls and the frontside blocks down.
    - `counter` (COUNTER, TREY, GT): the guard and tackle both pull.
    - `iso` / lead: the center and guards climb to the backers and the fullback leads.
    - `draw` and `sneak`.

    Receivers stalk-block, and the ball carrier's path is orange.
  - **Route tree** (`ROUTE_TREE`): 0 slide, 1 speed out, 2 slant, 3 10-yd out, 4 curl,
    5 comeback, 6 shallow, 7 corner, 8 post, 9 fade. Numbers in a play call are tree calls
    (`routeCall`):
    - One number per receiver ("2960") reads **right to left** across the formation.
    - Fewer numbers than receivers ("81") mean the same on both sides, outside in
      (#1 runs 8, #2 runs 1).
    - A single number means every WR runs it.
    - "4 VERTS" is a count, not a tree call, and "24 DIVE" stays a run.

    Cards write each tree route's number at its arrow tip. Routes off the tree (GO, WHEEL,
    BUBBLE, FLAT, LEAK, HITCH, DIG, SWING) are written by name.
  - **Passes:** `routeTokens` reads route words (SLANT, BUBBLE, CORNER, WHEEL, ACROSS/CROSS,
    OUT, FADE, LEAK, GO, POST, CURL, DIG, FLAT, SWING). One word goes to every WR
    ("SLANT" = all slants). BUBBLE or SCREEN goes to the play-side slot. The other ball-side
    receivers block from the inside out: the first takes the **LB** (up, then inside) and the
    second the **S/C** (up and in). With only one blocker, he takes the **C**. Each block is
    labeled at its T-bar, and backside receivers stalk.
    Several words go left to right across the receivers ("FADE OUT OUT FADE"). LEAK goes to
    the tight end.
  - **RPO / PA:** also draw a dashed mesh fake. RPO adds zone blocking; PA adds the QB's
    drop or boot.
- **Scout defense** (`unit: "defense"`): the offensive formation (no assignments) plus
  where each defender lines up. `FRONTS` covers 4-3, 3-4, 5-2 and Bear, with labels
  E/T/N/W/M/S/B/C/FS/SS. Corners go over the widest receivers and safeties shade to the
  receiver-heavy side. An unknown front draws as 4-3, and the card footer says so. `COVERAGE`
  shows in the footer.
  Scout defense cards are **flipped 180°** (`Diagram.flipped`, `losY` = 160). The defense is at
  the bottom and the offense on top, as the scout defense sees it, so the offense's right is on
  their left. Text stays upright. The header's `HASH` stays as recorded in Hudl.
  **Adjust X's** (script page, Scout D) turns on dragging. Hudl doesn't record safety depth
  and similar details, so a coach drags each defender to where he lined up on film.
  - Positions save per play in `card.defenseOverrides`, keyed by defender id (`FS1`, `C2`).
    They're stored in the formation's own coordinates, un-flipped and before the hash shift
    (`fromCardPoint`), so they survive hash, 7v7/Team and orientation changes.
  - **Reset X's** clears a play's moves.
  - Swiping between cards is paused while adjusting.
- **7v7** drops the linemen on both sides. `inPeriod` decides which plays each period lists:
  - Scout O 7v7: every pass/RPO/PA from team, plus untagged plays as formation reps (the card
    says "no routes tagged").
  - Scout D 7v7 and Team: every look (any formation or front).
  - Scout O Team: runs and passes.

  A blank play call with `PLAY DIR` = `N` counts as a pass (`inferConcept`).
- Positions: linemen are unlabeled, and skill players are **Q, F, H, X, Y, Z** only.
- Formations: Spread, Trips, I-Form, Double Eagle, **Pro** (Q under center, F behind him, H behind
  the F) and **Split Pro** (backs side by side, used only when the tag says SPLIT).

Card look (`ScoutCard.tsx`, PlayIQ-style):

- **Header:** card #, a centered play title (formation · play call, or formation vs front),
  the hash and period, and a RUN / PASS / RPO / PLAY ACTION / DEF tag.
- **Field:** white, with light gray 5-yard lines, left/middle/right hash ticks, field numbers
  (turned 90° to face their own sideline, like a real field) and a **blue LOS bar**.
- **Symbols:** the center is a square, other linemen are unlabeled circles, and skill players
  are circles with black letters (Q/F/H/X/Y/Z; the staff's own convention, kept over a generic
  X/T/QB/RB set).
- **Lines:** routes are red, the ball carrier and fakes orange, blocks black. Every path is
  straight segments with sharp breaks and `marker-end` arrows (ids from `useId`). Route labels
  move to a clear spot when they'd land on a player.
- **Route angles:** true field angles (`YARD_X` across, `YARD_PX` up).
  - Slant: 5-yard stem, 45° inside.
  - Out: 10-yard stem, 90° to the sideline.
  - Post: 11-yard stem, 45° to the middle.
  - Corner: 10-yard stem, 45° to the pylon.
  - Go straight; fade with a slight outside release.
- **Pass pro:** on passes and play action in Team, the line takes short angle-back sets, and
  any TE or back without a route protects (T-bars).
- **Assignment table** (`buildAssignments`), with text generated from the diagram's `jobs` and
  the run scheme:
  - Runs: `Y, PST, PSG, C, BSG, BST, NOTES`.
  - Passes: `X, H, Y, Z, F, OL, NOTES` (OL in Team only).
  - Scout D: `FRONT, COVERAGE, NOTES`.

  On the iPad, tap a box and type (`onAssignmentChange`). The text is saved in
  `card.assignmentNotes` and shown in italics; NOTES is the coach note, and an empty box goes
  back to the generated text. Printed boxes wrap to two lines.
- Card aspect is 760 × 600. Print sheets use 4.3" cards at 4-up and 5.9" at 2-up.

Coordinates:

- SVG viewBox `0 0 500 300`. Center/ball at **(250, 150)**, line of scrimmage at `y = 140`.
- Hash marks at `x = 167` / `333`. **The ball sits on its hash** (`mapToHash`). Players within
  70 px of the ball shift as a unit, and wider players keep their room to the sideline, so the
  short side bunches and the wide side spreads. The hash is also a triangle on the top edge.
- Yard lines are true to the ball's spot (`Hudl YARD LN`; unknown = own 30) at `YARD_PX` = 7 px
  a yard, the same scale as route depths. **Field numbers** sit on both sides (`NUMBERS_X`,
  about 8 yards in from each sideline) so receivers can see their splits.
- Formations and fronts are drawn **strength right**. `OFF STR` (or a side tag in the
  formation) mirrors them, and `PLAY DIR` (or a tag in the play call) sets the play side.
- Unknown formations draw as Spread, and the footer says so.

To add a formation: add the key to `FormationKey` in `hudlParser.ts`, add a keyword to
`classifyFormation`, and add a shape to `FORMATIONS` (5 OL + Q + backs + skill = 11, using
only Q/F/H/X/Y/Z) and a label to `FORMATION_LABELS`. Then run `npm test`; the label and
defender-overlap tests cover new combinations.

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

**Several films:** drop or pick several CSVs at once, or use **Add film** on the script page.
Each play keeps its film (`card.source`), ids never collide across films, and a **Film**
filter appears once there's more than one.

**Editing:** **Edit play** opens `EditPlayDialog`, with a live card preview and quick-pick
buttons. It can **Duplicate** or **Delete** the play. Edits go through `updateCard`, which
re-derives the card with `deriveCard` so it draws exactly like a Hudl row. They're saved to
localStorage and marked "edited" in the play list, and coach notes show on the card.

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
