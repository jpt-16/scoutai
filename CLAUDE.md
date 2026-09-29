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
    script/page.tsx        iPad reader: Scout O/D + All/7v7/Team toggles, filters, swiper, Print Grid;
                           practice mode (?practice=<day>&period=<n>) runs a day's playsheet
    practice/page.tsx      Practice playsheet editor: days → periods (7v7/Team, our O or our D) → calls
  components/
    ScoutCard.tsx          PlayIQ-style card: title header, white-field SVG, assignment table
    PrintGrid.tsx          Letter-size sheets, 2-up portrait / 4-up landscape, window.print()
    FilterBar.tsx          Down / formation toggle pills
    UploadDropzone.tsx     Drag-and-drop + file picker (multiple films, .csv/.xlsx) + paste-to-import
    BatchUploader.tsx      Batch video import: CSV + zip of clips, matched by play number
    landing/               Landing-page-only visuals (see "Landing page" below)
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
    practicePlan.ts        Practice playsheet: line parser, opponent looks, rep → Scout D card
    conceptMapper.ts       Named pass concepts → a route per position; RAIL / WHEEL back tags
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
    - One number per receiver ("837") reads **right to left** across the formation. In practice a
      numbered call never runs past three digits — a coach tags a fourth (or later) receiver's
      route by name instead of a fourth digit ("837 CURL", or "837 X CURL" to note which receiver
      gets it — the parser reads the extra word the same either way, since `routeCall` treats a
      trailing route word exactly like another number in the sequence; a bare, unmatched letter
      like the "X" is simply skipped).
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
  - **Named concepts** (`src/lib/conceptMapper.ts`'s `CONCEPT_DICTIONARY`): MESH, FLOOD,
    SMASH, DAGGER and CROSS (CROSS only when it's the lone route word) give **each position its
    own route** instead of one route repeated across every receiver. Positions are by play side,
    outside in (`ps1`/`ps2`/`ps3`, `bs1`/`bs2`, `back`), so a template works from any formation
    and mirrors with the play; in Deuces going right that's Z/Y, X/F and H. A route is a tree
    kind (drawn with the staff's own technique, e.g. MESH's 8 post and 7 corner) or a yard
    vector for routes off the tree (`conceptPath`: MESH drags at 2 and 3 crossing over the ball,
    FLOOD's sail, DAGGER's dig at 15, the deep cross). **RAIL / WHEEL are separate from the
    concept**: a back tag (`BACK_TAGS`) that rides on any of them ("MESH RAIL", "SMASH RAIL")
    and sends the back out to the backside flat and up the sideline, stepping up in front of
    the Q first. Alone, RAIL / WHEEL is just the back's route, to his own side. Another route
    word in a concept call ("MESH GO") goes to the #1s; anyone a template doesn't name clears
    on a go. Tree numbers always read as numbers, never as a concept. A card with video routes
    keeps them per letter and falls back to this template for any letter the AI missed.
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
- **Tendency badges** (field variant only, never on print): a row under the header showing this
  card's own slice of the whole script's tendencies (`src/lib/tendencies.ts`'s
  `computeTendencies`, computed once by `script/page.tsx` and passed to every card as the
  `tendencies` prop) — this formation's share of all plays, this down/distance situation's
  run/pass split (hidden below `MIN_SITUATION_REPS` reps so a one-off play doesn't look like a
  100% tendency), and the script's preferred play direction. These are read-only scouting
  numbers, not something a coach edits on the card.
- **Field:** white, with light gray 5-yard lines, left/middle/right hash ticks, field numbers
  (turned 90° to face their own sideline, like a real field) and a **blue LOS bar**.
- **Symbols:** the center is a square, other linemen are unlabeled circles, and skill players
  are circles with black letters (Q/F/H/X/Y/Z; the staff's own convention, kept over a generic
  X/T/QB/RB set).
- **Lines:** routes are red, the ball carrier and fakes orange, blocks black. Every path is
  straight segments with sharp breaks and `marker-end` arrows (ids from `useId`, drawn as a
  narrow inset triangle rather than a full-height one). Route labels move to a clear spot when
  they'd land on a player.
- **Route angles:** true field angles (`YARD_X` across, `YARD_PX` up), depths per the staff's own
  route-tree technique, not just a generic stem length:
  - Slide (0): release, build up to 5 and settle.
  - Speed out (1): cut out at 5.
  - Slant (2): three hard steps and plant — a quick 3-yard stem, 45° inside.
  - Out (3): 10-yard stem, 90° to the sideline.
  - Curl (4): stem to 12, back down to 10.
  - Comeback (5): stem to 16, back down to 14.
  - Shallow (6): build up to 5 and cross the field underneath.
  - Corner (7): 10-yard stem, 45° to the pylon.
  - Post (8): 10-yard stem, 45° to the middle.
  - Fade (9): go straight, with a slight outside release — self-explanatory.
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

**Excel and pasted breakdowns:** the upload box also takes a real `.xlsx` workbook — `src/lib/
hudlParser.ts`'s `parseExcelFile` reads the first sheet with `exceljs` (dynamically imported, so
CSV-only users never load it) and hands it to `Papa.unparse` → `parseHudlCsvText`, so it's the
exact same column-mapping/classifier pipeline as a CSV, not a second parser to keep in sync. A
`.csv`-named file that's actually an Excel workbook (a common Hudl-export mixup) is now
auto-detected by its zip signature and parsed correctly instead of just explaining how to
re-export it. **Paste breakdown** takes clipboard text — a breakdown copied straight out of
Excel or Google Sheets pastes as tab-separated text, which `parseHudlCsvText` already reads
(PapaParse auto-detects the delimiter), so no separate paste-parsing logic exists either.

**Several films:** drop or pick several CSVs at once, or use **Add film** on the script page.
Each play keeps its film (`card.source`), ids never collide across films, and a **Film**
filter appears once there's more than one.

**Editing:** **Edit play** opens `EditPlayDialog`, with a live card preview and quick-pick
buttons. It can **Duplicate** or **Delete** the play. Edits go through `updateCard`, which
re-derives the card with `deriveCard` so it draws exactly like a Hudl row. They're saved to
localStorage and marked "edited" in the play list, and coach notes show on the card.

**Routes per letter:** the Edit play dialog's **Routes** section (Scout O) sets each of X, H, Y,
Z and F to a route (tree 0–9, GO, WHEEL, BUBBLE, …), **Stalk**, **Protect** or **None**, and adds
an optional short tag (e.g. `BANG`). These go in `card.routeOverrides` (keyed by letter).
`buildDiagram` applies them after the play call's routes, so "Auto" keeps the play call. A tag
replaces the arrow label and appends to the table box. A play with only overrides draws as a
pass (`hasCoachRoutes`) and is listed in 7v7 and Team. Choices live in `ROUTE_CHOICES`.
Picking a route kind from the dropdown (including "Auto") clears any AI-detected `path` on that
letter first — see the video-to-card section below for why.

**Pencil drawing:** **Draw** (field view) turns the card into a drawing surface for Apple
Pencil or a finger. There are four colors, plus **Undo** and **Clear** (tap twice). Strokes are
stored in SVG viewBox coordinates in `card.drawings.offense` / `.defense`, so Scout O and
Scout D each have their own layer. They print and survive reloads. Swiping and Adjust X's are
off while drawing. `ScoutCard`'s `ink` prop enables the overlay.

## Practice playsheet (`/practice`, `src/lib/practicePlan.ts`)

Staffs already run practice off a playsheet: each period (7v7 or team) lists the plays they'll
run, in order. The app follows that sheet instead of asking them to change it. **Playsheet** on
`/script` opens the editor; a plan is days (Mon, Tue… or just today) → periods, saved in
localStorage (`scoutcard:practice:v1`), never uploaded.

Each period says which side is ours, and the scout team is the converse:

- **Our O → Scout D.** The offensive coach reads calls off his playsheet, so the coach pastes
  that period's calls, one per line, exactly as the sheet has them (`parsePlaysheetLine`). Rows
  copied from Excel/Sheets are tab-separated: a leading rep-number cell is dropped and a cell
  that's only `L`/`M`/`R` is the hash. Typed lines take `1.` / `3)` rep numbers, `LH`/`RH`/`(M)`/
  `left hash`, and `vs 3-4 C1` to call a look. A bare leading number with no punctuation stays
  in the call ("24 DIVE"). Every call becomes a Scout D card (`periodRepCards`): our call is the
  formation and play call, drawn against a look from the opponent's film.
  - **Looks** (`opponentLooks`): the opponent's front + coverage pairs, from ODK `D` rows when the
    breakdown tags ODK, else every row with a front/coverage (like normal Scout D cards).
  - `assignLooks` matches each rep to what they showed against that same formation (else their
    overall mix) and spreads reps in proportion (smooth weighted round-robin, deterministic), so
    a 60/40 defense gets 6 and 4 of 10 reps, mixed in. A look written on the line always wins.
    The editor's per-rep dropdown rewrites the line's `vs …` (`setLineLook`), so the pasted text
    stays the single source of truth.
  - The staff's own formation names ("REX") that the classifier doesn't know get a one-time
    "draw it as" pick, stored in `formationAliases` by the call's first word.
- **Our D → Scout O.** The defensive coach calls his own defense, so there's no list: Scout O
  runs the opponent's plays for that period type as usual (`periodScoutOCards`, which also drops
  ODK `D` snaps).

`/script?practice=<dayId>&period=<n>` runs it: the period chips replace the filters, unit and
mode come from the period, the cards keep playsheet order, and PREVIOUS/NEXT roll over into the
adjacent period. Rep cards (`id` starts `rep-`, `isRepCard`) aren't in the saved script, so Edit
play / Draw / Adjust X's are off for them and they show no tendency badges. Print Grid prints the
current period.

## Offline / iPad install

- Safari → Share → **Add to Home Screen**. The manifest launches `/script` standalone.
- `public/sw.js` registers only in production builds (`npm run build && npm start` or on
  Vercel). Open the app once while online and it keeps working offline.
- The loaded script lives in `localStorage` (`scoutcard:script:v1`), so it survives
  restarts. Bump `CACHE_VERSION` in `sw.js` when changing caching behavior.

## Deploying to Vercel

The free CSV/scout-card core needs no environment variables or server code at all. The paid
video-analysis feature (below) does: `GEMINI_API_KEY`, `BLOB_READ_WRITE_TOKEN`,
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID` — set in Vercel project settings and mirrored in
`.env.local` for dev (`.env*` is gitignored). The app still builds and the CSV path still works
with none of these set; only the video feature's routes need them.

- **Git:** push to GitHub, then at vercel.com/new import the repo. Vercel detects
  Next.js (build `next build`, output `.next`). Every push to the default branch deploys.
- **CLI:** `npx vercel` for a preview, `npx vercel --prod` for production.

`next.config.ts` sends `Cache-Control: no-cache` for `/sw.js` so iPads pick up new versions.

## Video analytics service (`video-service/`)

A separate Python/FastAPI microservice, groundwork for an upcoming AI feature: upload a game
clip and 4 calibration points, get every player's path back in true field-yardage coordinates
(via an `cv2.getPerspectiveTransform` homography), for a later stage to turn into scout cards.

This is a deliberate exception to "everything runs client-side" above — video leaves the device
for this feature. It's also **not** part of the Next.js/Vercel deploy: `next build` only touches
`src/`, so Vercel never builds or serves this directory, and it couldn't anyway (it needs
sustained GPU access and a long-running process, which Vercel's serverless functions don't
provide). It's meant to be deployed separately, to its own GPU-capable host. See
`video-service/README.md` for setup, licensing notes (RT-DETRv2 via `transformers`, ByteTrack via
`supervision` — deliberately not the AGPL-licensed `ultralytics` package), and the API contract.

## Video-to-card via a hosted vision model (`/api/parse-video`)

A second, serverless-friendly path to the same goal as `video-service/` above, and the one
that's actually wired into the app: **Upload game film (beta)** on the landing page uploads a
clip straight to a **private** Vercel Blob store (`/api/blob-upload` authorizes the client
upload; private, not public — opposing-team film shouldn't sit at a plain fetchable URL), then
`/api/parse-video` fetches it back with `BLOB_READ_WRITE_TOKEN` (auto-added once a Blob store is
connected to the project) and sends it to Gemini 2.5 Flash (`@google/genai`, structured JSON
output) to detect each skill player's route. Also needs a `GEMINI_API_KEY` env var (Vercel
project settings + `.env.local`).

This is **not a calibrated top-down transform** — there's no homography or clicked calibration
points here, unlike `video-service/`. It's the vision model's own spatial guess from an oblique
camera angle, linearly stretched onto the card's field canvas by `src/lib/coordinateMapper.ts`
(which also simplifies the model's noisy waypoints down to the app's usual straight-stem-with-
sharp-break shape, `RDP`-style, instead of a literal curve). Treat it as a rough starting point,
not a measurement.

`src/lib/videoImport.ts`'s `buildCardFromDetection` turns a validated detection into a real
`HudlPlayCard`: the formation is drawn in its normal, canonical shape (via `classifyFormation`,
same as a CSV row) — only each letter's route is video-derived, stored as a `routeOverrides`
entry with `source: "video"` and a raw `path` (waypoint deltas from the player's own position;
see `RouteOverride.path` in `hudlParser.ts`). This reuses the exact override mechanism
`EditPlayDialog`'s route picker already writes to, so a video-derived card flows through Print
Grid, filters, swipe, and storage like any other card, with no separate rendering path.

On the card itself, a route with `source: "video"` gets draggable circle handles at each break
point (`ScoutCard`'s `onEditDetectedRoute` prop) — the same pointer-capture/`svgPoint` drag
pattern as moving a Scout D defender or the Pencil overlay — so a coach corrects the AI's guess
by dragging, which is the whole point given the mapping above is approximate.

**Rate limiting:** both routes call `checkRateLimit` from `@vercel/firewall`, which only enforces
anything once a matching Vercel Firewall rule exists (a `rate_limit_api_id` condition on
`"parse-video"` / `"blob-upload"`) — creating one for this project returned a 404 ("Seawall
Config not found") on every attempt, consistent with custom WAF rules being a paid-plan feature.
The actual cap right now is `src/lib/rateLimit.ts`'s `checkBlobRateLimit`: a counter (keyed by the
entitled **team id**, not IP — see below) kept as tiny marker blobs in the same private Blob store
(`ratelimit/<bucket>/<hashed team id>/<window>/`, counted with `list()`), 3 clips / 10 min on
`/api/parse-video`, 1 batch / 10 min on `/api/parse-video-batch` (see below), and 10 uploads /
10 min on `/api/blob-upload` (raised from 5 so a full batch's uploads don't trip it partway
through). Not perfectly atomic under concurrent hits from one team — fine for a small coaching
staff's traffic, and it's defense-in-depth layered on top of the auth/billing gate below, not the
primary defense against strangers anymore. If this project ever moves to a plan with Firewall
rate limiting, add the matching rules (dashboard or `vercel firewall rules add`) and
`checkRateLimit` starts enforcing immediately, no code change.

## Batch video import (`/api/parse-video-batch`)

For a coach with a full game script rather than one play: Hudl exports a game's clips as a zip
alongside the breakdown CSV. **Batch upload** (below the single-clip uploader) takes both files
at once.

`src/components/BatchUploader.tsx` parses the CSV with the normal `parseHudlCsv` (real
down/distance/formation/play-call data — ground truth, never touched by AI) and extracts the zip
client-side with `JSZip`. `src/lib/clipMatching.ts`'s `matchClipsToCards` matches each clip
filename to a CSV row by the number embedded in it (`"Clip_4.mp4"` → `PLAY #` 4; the extension is
stripped first, since `.mp4` itself contains a digit) — a clip whose number doesn't match a row,
or has no number, is skipped and counted in the script's warnings rather than guessed at.

Matched clips are processed in chunks of `MAX_BATCH_CLIPS` (`src/lib/batchConfig.ts`, currently
10) — a deliberate cost cap, not just a technical one: an uncapped batch could fire dozens of
Gemini calls at once with no ceiling, so a 50-play script takes ~5 batches instead of one
unpredictable bill. Each chunk's clips upload to private Blob storage client-side (same
`@vercel/blob/client` path the single-clip flow uses), then one call to
`/api/parse-video-batch` processes the chunk with `src/lib/concurrency.ts`'s `mapWithConcurrency`
capping it at 4 Gemini calls in flight at once. One clip failing never sinks the batch — each
comes back with either a `detection` or an `error`, matched back to its clip by array position.

`src/lib/videoImport.ts`'s `applyDetectionToCard` (as opposed to `buildCardFromDetection`, used
by the single-clip flow with no CSV row behind it) merges a detection's routes onto an *existing*
CSV-derived card via `updateCard` — the formation, down/distance, and play call all stay exactly
what the CSV said; only the matched letters' routes come from AI. Both share
`detectionToRouteOverrides` so the actual `routeOverrides` shape (`source: "video"`, draggable
handles on the card) is identical either way.

The Gemini call itself (prompt, response schema, per-step error handling) lives in
`src/lib/videoDetection.ts`'s `detectPlayFromClip`, shared by `/api/parse-video` (one clip) and
`/api/parse-video-batch` (several) so there's exactly one place that logic can drift. The prompt
(`buildDetectionPrompt`) carries `FOOTBALL_CONCEPT_RULES`, route geometry for MESH (drags at 3-5
yards), RAIL / WHEEL (flat, then up the sideline) and CORNER / OUT (10-yard stem, 45° / 90°),
matching the route tree above. Batch import also sends each clip's play call from its matched CSV
row, so a called concept is drawn with that geometry; the call is flattened to one quote-free line
and capped at 80 characters before it goes in the prompt.

## Auth, teams, and billing (Clerk + Stripe)

The video-analysis feature is paid, per coaching staff — everything else in this app (CSV import,
`/script`, printing) stays free and zero-auth, exactly as described everywhere else in this file.
Only `/api/parse-video`, `/api/blob-upload`, and `/api/stripe/*` touch any of what's below;
`src/lib/scriptStore.ts` and the CSV import path have no account concept and never will.

Originally built on Supabase (auth + a hand-rolled Postgres `teams`/`team_members` layer, since
Supabase has no native "organizations" concept). Switched to **Clerk** after hitting Supabase's
free-project limit — Clerk's built-in **Organizations** are exactly "a coaching staff," so there's
no custom teams schema, no RLS policies, and no database at all: sign-in, org creation, org
switching, and member invites are all Clerk's own prebuilt UI
(`<SignInButton>`, `<OrganizationSwitcher>`, `<UserButton>` in `src/components/AccountMenu.tsx`;
`useClerk().openSignIn()`/`openCreateOrganization()` in `src/components/VideoUploadCard.tsx`).
Billing state (`subscriptionStatus`, Stripe ids) lives directly on the Clerk **Organization's
metadata** — `publicMetadata` for what the client needs to read (drives the entitlement check and
the UI), `privateMetadata` for what only the server needs (Stripe customer/subscription ids) — so
there's still no separate database for this either.

- Every Clerk-touching module checks `isClerkConfigured()` (`src/lib/clerkConfig.ts`, just
  `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` presence) **before** rendering `<ClerkProvider>`
  (`src/app/layout.tsx`) or calling a Clerk hook — `<ClerkProvider>` throws synchronously without a
  key, and Clerk hooks throw without a `<ClerkProvider>` in the tree, either of which would take
  down the whole app (the free CSV path included) if not guarded. `AccountMenu` and
  `VideoUploadCard` each render a plain, hook-free fallback (nothing, and a disabled "coming soon"
  card, respectively) when unconfigured, and only mount their real, hook-using inner component once
  configured.
- `middleware.ts` is a bare `clerkMiddleware()` (also config-guarded) — just enough for
  `auth()`/`clerkClient()` to have request context in the routes that call them. It does **not**
  gate anything itself (Clerk's own path-matcher-based `createRouteMatcher` + `auth.protect()`
  pattern is deprecated in favor of per-route checks); its `matcher` only covers
  `/api/parse-video`, `/api/blob-upload`, `/api/stripe/checkout`, `/api/stripe/portal`, and
  `/account/*`, so it never runs on `/` or `/script`.
- `src/lib/entitlement.ts`: `evaluateEntitlement()` is the pure decision (unit-tested) —
  signed-in? `orgId` present (an active org = "on a team")? org's `publicMetadata.subscriptionStatus`
  `active`/`trialing`? — and `requireEntitlement()` is the I/O wrapper both gated routes call
  **first**, before rate limiting, returning a specific 401/403/402 the client renders as sign-in /
  create-a-team / subscribe.
- **Stripe**: `/api/stripe/checkout` starts a Checkout session for the caller's active org (price
  comes from `STRIPE_PRICE_ID`, an env var, not hardcoded — pricing can change later in the Stripe
  dashboard with no code change, per the "decide pricing later" call); `/api/stripe/portal` opens
  the Billing Portal for managing/canceling; `/api/stripe/webhook` (raw body, signature-verified)
  keeps the org's metadata in sync on `checkout.session.completed` / `customer.subscription.updated`
  / `customer.subscription.deleted`, via `clerkClient().organizations.updateOrganizationMetadata()`
  (deep-merges, so it never clobbers other metadata keys). The event→patch mapping is a pure
  function (`src/lib/stripeWebhook.ts`, `mapStripeEventToOrgPatch`) separate from the
  signature-verification/write plumbing, so it's unit-tested without a live webhook secret. It
  always matches by `org_id` in Stripe metadata (set on both the Checkout session and the
  subscription at `/api/stripe/checkout` time) — never by `stripe_customer_id`, since that isn't
  known yet on the very first `checkout.session.completed` event. No idempotency ledger: every
  patch sets "current known state," so replaying an event twice is harmless.
- `src/lib/useTeamAccount.ts`: a thin client hook over `useAuth()`/`useOrganization()` (Clerk keeps
  them reactive on its own — no manual refetch/refresh needed, unlike the Supabase version this
  replaced). Only call it from a component that's guaranteed to render inside `<ClerkProvider>`.
- **Testing the video pipeline before Clerk/Stripe are trusted:** `NEXT_PUBLIC_SKIP_AI_GATE=true`
  in `.env.local` (`src/lib/featureFlags.ts`'s `isAiGateDisabled()`) bypasses the whole sign-in +
  team + subscription gate on both the client (`VideoUploadCard`'s testing-mode variant, no Clerk
  hooks called) and the server (`requireEntitlement()` short-circuits to an always-entitled
  result keyed `"test-bypass"`, which the rate limiter still buckets by). Only ever set this in
  `.env.local` — `isAiGateDisabled()` also checks `NEXT_PUBLIC_VERCEL_ENV !== "production"`, so
  even if the var leaks into a real deployment's env vars it's a no-op on Vercel's production
  environment. Remove the env var once you trust the feature and want the real gate back.

## Landing page (`src/app/page.tsx`)

Sections, in order: hero, `#upload`, `#ai-film`, `#showcase`, problem/solution, on-the-field,
`#how-it-works`, `#features`, `#about`, `#faq`, final CTA. Visuals live in
`src/components/landing/`:

- Every card shown is a real `ScoutCard` built by the real parser from demo rows
  (`MOCK_HUDL_CSV`), never a static image. `TransformShowcase` highlights demo row 2 in
  `HudlCsvMockup` and renders the card parsed from that same row, so "this row became this
  card" is literally true. Keep them in sync if the demo data changes.
- `ScriptScreenMockup` is a static, scaled-down copy of the `/script` reader chrome (unit
  toggle, period tabs, Previous / Next) inside `DeviceFrame`. The hero (`HeroDevice`) cycles
  it through the script; `PracticeShowcase` shows Scout D with a Print Grid sheet behind it.
- `FilmToCardVisual` pairs an SVG film-frame illustration (not footage) with a live card whose
  `source: "video"` routes can be dragged, exactly as in the app.
- `HudlExportGuide` is the "how to get your file out of Hudl" guide: the data grid's **⋯** menu
  → **Export Data to Excel** (`.xlsx` imports as-is). The menu is an HTML recreation rather than
  a screenshot, so it stays crisp and keeps real game footage (minors) and school names off the
  page. Hudl's wording varies by version, and the figure caption says so.
- `primitives.tsx`: `Reveal` (fade-up on first scroll into view), `SectionHeading`, and `TryCta`,
  the single "Try ScoutCard AI" button used in the header, hero, and final CTA.
- Motion keyframes (`sc-float`, `sc-draw`, `sc-flow`, `sc-row-pulse`, `sc-ping`) are in
  `globals.css` and all switch off under `prefers-reduced-motion`. Reveal content is hidden only
  once `layout.tsx`'s inline script has added `html.js`, so it never stays invisible without JS.
- Don't add testimonials, usage numbers, or customer logos that aren't real.

## Conventions

- Keep `src/lib/*` framework-free (relative imports, no React) so Vitest runs it directly.
- UI is dark-only and high contrast for sunlight. Touch targets are ≥ 44px. Print output is
  black on white.
- shadcn components were written by hand from the new-york source (the registry was not
  reachable when scaffolding). `components.json` is set up, so
  `npx shadcn@latest add <component>` works where the registry is reachable.
- UI design reference (Claude Design canvas): https://claude.ai/artifact/To8beVQabngaeLeJynuvpY
