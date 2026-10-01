# ScoutCard AI

Web app for high school football staffs: upload the weekly **Hudl breakdown CSV** and get
vector-drawn **scout team cards**, which you can flip through on an iPad at practice or print
2 or 4 to a page. The CSV is parsed in the browser and never uploaded; only the AI features send
anything to a server. On production the app itself is behind sign-in (see "Access" below); preview
deploys and a local checkout are open.

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
    ExportModal.tsx        CoachPad / iPad / letter export: one card per page, a PDF or a ZIP of PNGs
    FilterBar.tsx          Down / formation toggle pills
    UploadDropzone.tsx     Drag-and-drop + file picker (multiple films, .csv/.xlsx) + paste-to-import
    BatchUploader.tsx      One-click game import: a Hudl video-with-data zip (or loose clips + sheet) → script
    landing/               Landing-page-only visuals (see "Landing page" below)
    EditPlayDialog.tsx     Edit a play (formation, strength, play, direction, hash, front, coverage, note)
    ImportNotice.tsx       Non-blocking "Loaded / Added N plays" notice with file notes
    BrandMark.tsx, ServiceWorkerRegister.tsx
    ui/                    shadcn primitives: button, card, badge, tabs, dialog
  lib/
    hudlParser.ts          CSV → HudlPlayCard[] (column mapping + normalization + classifiers)
    formations.ts          Formations, fronts, run schemes, route tree → buildDiagram()
    importFilms.ts         Parses several CSVs (one per film) into one script
    importReview.ts        AI review of an import: rows the rules couldn't place → card hints
    demoScript.ts          MOCK_HUDL_CSV: 5-play sample used by the "Demo Script" button
    scriptStore.ts         Persists the loaded script in localStorage (offline on the field)
    practicePlan.ts        Practice playsheet: line parser, opponent looks, rep → Scout D card
    conceptMapper.ts       Named pass concepts → a route per position; RAIL / WHEEL back tags
    secondary.ts           Scout D secondary per formation: typed line / film read → DB spots
    defensiveAligner.ts    Scout D alignment rules: split receivers, safety roll, backers match numbers
    generatedCard.ts       Text-to-card: Gemini prompt, answer validation, grid → card overrides
    batchMatcher.ts        Batch plan: sort clips from the sheet, match clip ↔ row, route each row
    gemini.ts              The one Gemini JSON call: model fallback, schema fallback, real error reasons
    exportUtils.ts         Export targets (CoachPad 13.3" 4:3, iPad, letter), card fit, file names
  types/
    playbook.ts            Re-exports the playbook types under one roof (PlayCard = HudlPlayCard, …)
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
6. Hand-typed sheets get two repairs. `findRunPassColumn`: with no PLAY TYPE column, a column that's
   mostly Run / Pass under any other header (a staff typing it under `G/L` or `TYPE`) becomes the
   play type. `realignRow`: a play call typed across several cells (`POST,SEAM,UNDER,WHEEL,RAIL`)
   is joined back until OFF STR / PLAY DIR read as a strength and a direction, and an extra blank
   cell that pushed the front under COVERAGE is dropped (never a filled cell). Both add a warning.

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
    OUT, FADE, LEAK, GO, POST, CURL, DIG, FLAT, SWING). One route word is a **combination**, not
    that route for everyone (`ROUTE_COMBOS`): each side, outside in, the wide receivers #1 / #2 /
    #3 run e.g. slant / flat / hitch for "QUICK SLANT", curl / flat / go for CURL, post / dig /
    flat for POST; an inside route (FLAT, SHALLOW) goes to the #2s while the #1s clear. Tight ends
    stay in to protect. Verticals (GO, VERTS, "4 VERTS") really are everyone, and a lone tree
    number ("2") still means every WR runs it. BUBBLE or SCREEN goes to the play-side slot, as a
    smooth arc (`Diagram.routeCurves`, drawn by `ScoutCard`'s `curvePath`): back and out toward the
    sideline, never back toward the Q, settling 2.5 yards behind the line so it passes behind
    its blockers (a receiver already split wide gets a shorter arc that stays on the field). The other ball-side
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
    vector for routes off the tree (`conceptPath`: MESH drags at 3 and 5 crossing over the ball,
    FLOOD's sail, DAGGER's dig at 15, the deep cross). **RAIL / WHEEL are separate from the
    concept**: a back tag (`BACK_TAGS`) that rides on any of them ("MESH RAIL", "SMASH RAIL")
    and sends the back out to the backside flat and up the sideline, stepping up in front of
    the Q first. Alone, RAIL / WHEEL is just the back's route, to his own side. Another route
    word in a concept call ("MESH GO") goes to the #1s; anyone a template doesn't name clears
    on a go. Tree numbers always read as numbers, never as a concept. A card with video routes
    keeps them per letter and falls back to this template for any letter the AI missed.
  - **Wing slide RPO** (`conceptMapper.ts`'s `isWingSlideCall`: "RPO SLIDE", "WING SLIDE", "WING
    FLAT"; a plain SLIDE is still tree 0): an RPO (zone blocking, mesh fake) whose pass is the play
    side's inside receiver sliding to the flat. **Alignment check** (`insideAlignment`): walking the
    play side inside out from the tackle, a player within `WING_MAX_SPLIT_YARDS` (3, the same
    "attached" distance as the Scout D rules) of the box edge is on the box, a tight end on the
    line or a **WING** off it; wider is a slot. The wing slides if there is one, else the
    innermost receiver (trips #3 at 4½ yards reads as a slot; Double Eagle's Z is a wing). His
    letter stays (Q/F/H/X/Y/Z); the table says "WING: slide to the flat". A **WING tag** puts one
    there (`alignOffense`): in the formation ("ACE WING", "PRO WING RT", strength side) or the
    call ("WING SLIDE", play side), the inside receiver on that side moves in to two yards
    outside the box edge, just off the line (Pro Wing's Z comes in off the TE), on Scout O and
    Scout D alike. **Film spots** win over both (below). The **slide**
    (`SLIDE_PATH`) is an immediate flat release 2-3 yards behind the LOS toward his sideline,
    caught in the flat inside the next receiver out (never drawn through him). **Perimeter
    blocks** (`SLIDE_BLOCKS`), from the receivers outside him, inside out: the first cracks the
    **ALLEY** defender (down and in), the next stalks the **C**, angled inside; a lone one cracks
    the alley. The backside stalks, and a tight end who slides isn't in the zone blocking.
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

  **Alignment rules** (`src/lib/defensiveAligner.ts`, run by `buildDefense` on every Scout D card):
  every split receiver gets a defender leveraged over him. Split receivers are counted per side
  (not backs, not a TE or wing within 3 yards of the box) and numbered outside in. Corners take the
  #1s. On a side with **2+ split receivers** the safety on that side rolls down over the #2 (the
  strong side first; only one safety rolls, the other goes to the middle), and any receiver still
  alone (the other #2 in 2x2, #3 in trips) gets the nearest backer walked out to him, as long as
  one backer stays in the box (a lone one bumps over the ball). How the slots are played
  (`CoverageStyle`) comes from the COVERAGE tag (`coverageStyleFor`): Cover 0/1/man is
  `MAN_OVER` (head up, a yard inside), Cover 3 or blank `ZONE_APEX` (halfway between #2 and the
  next man inside), Cover 2/4/6/quarters/Tampa `DEEP_SHELL` (both safeties stay deep, backers
  apex). What it did shows in the NOTES box ("SS apex Y · S apex H · FS middle") until a coach
  writes a note. Formations with at most one split receiver a side (Pro, I, Double Eagle) are
  unchanged.
  **Safeties / Slots strip** (`SafetyDepthControl.tsx`, under the toolbar while Adjust X's is on):
  per play, the safety depth (Press 4 / Normal 9 / Deep shell 13, or a 2-18 yard slider) and the
  slot style, saved in `card.defenseAlignment` (`safetyDepthY` in yards, `coverageStyle`).
  FS and SS keep their spot across and only change depth; a safety a coach already dragged moves
  to the new depth too. **Auto** clears it. Order of precedence: the rules, then the staff's
  secondary table (DBs stay where it says; backers still match what's left uncovered), then the
  play's safety depth, then Adjust X's drags.

  **Secondary** (script page, Scout D; `src/lib/secondary.ts`, `SecondaryDialog.tsx`): where the
  opponent's corners and safeties line up **per formation**, set once and drawn on every Scout D
  card in that formation (practice playsheet cards included). A table of strong / weak corner,
  FS and SS, each with a depth in yards off the line, who he's over (#1-#3 on his side, the
  ball, the hash), a shade, and a side for safeties, so one table covers Trips Right and Left.
  Two ways in: **type it** ("FS 12 middle, SS 8 #3 inside, corners 7 outside",
  `parseSecondaryText`, which reports what it couldn't read), or **read it from film**: a
  pre-snap clip goes through `/api/blob-upload` to `/api/read-secondary`, where Gemini reads each
  DB's depth from the yard lines, alignment and shade (`alignmentFromFilm` validates it). Either
  way the coach can fine-tune the table against a live preview card before saving. Saved on the
  script (`StoredScript.dbAlignments`), attached to cards for display only (`card.secondary`,
  stripped before saving cards), applied in `buildDefense` via `placeDb`; a per-play Adjust X's
  drag still wins. The film read is gated and rate limited like single clips.
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
  the hash and period, and a RUN / PASS / RPO / PLAY ACTION / DEF tag. The title reflects the
  **whole play**: when the call doesn't describe what's drawn (a one-route call drawn as a
  combination, or AI / coach routes), it names the routes by position instead
  (`Diagram.routeSummary`: "TRIPS RIGHT · SLANT / FLAT / HITCH", not "· QUICK SLANT").
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
  - Scout D: `FRONT, COVERAGE, NOTES` (NOTES defaults to what the alignment rules did).

  On the iPad, tap a box and type (`onAssignmentChange`). The text is saved in
  `card.assignmentNotes` and shown in italics; NOTES is the coach note, and an empty box goes
  back to the generated text. Printed boxes wrap to two lines.
- Card aspect is 760 × 600. Print sheets use 4.3" cards at 4-up and 5.9" at 2-up.

Coordinates:

- SVG viewBox `0 0 500 300`. Center/ball at **(250, 150)**, line of scrimmage at `y = 140`.
  The blue LOS bar is drawn just in front of it (y 134-139, offense view) and every on-ball
  player's front edge sits exactly on its back edge: skill players (r 11) at y 150, linemen (r 9,
  the center an 18 px square) at y 148. Off-ball receivers (y 160) sit 1-2 yards behind it; the
  backs keep their real depth (shotgun Q about 5-6 yards). Defensive linemen at y 127 clear the
  bar on the other side.
- Hash marks at `x = 167` / `333`. **The ball sits on its hash** (`mapToHash`). Players within
  70 px of the ball shift as a unit, and wider players keep their room to the sideline, so the
  short side bunches and the wide side spreads. The hash is also a triangle on the top edge.
- Yard lines are true to the ball's spot (`Hudl YARD LN`; unknown = own 30) at `YARD_PX` = 7 px
  a yard, the same scale as route depths. **Field numbers** sit on both sides (`NUMBERS_X`,
  about 8 yards in from each sideline) so receivers can see their splits.
- Formations and fronts are drawn **strength right**. `OFF STR` (or a side tag in the
  formation) mirrors them, and `PLAY DIR` (or a tag in the play call) sets the play side.
- Unknown formations draw as Spread, and the footer says so.
- **Real alignment from film** (`card.offenseSpots`): a clip read in field yards keeps where each
  matched letter stood (`videoImport.ts`'s `detectionSpots`: yards from the ball, at least three
  players, on the field and not past the line), on single-clip cards and on batch-import CSV cards
  alike, and `alignOffense` draws them there instead of the formation's standard spots. A
  receiver within half a yard of the line is on it, else off the ball at his own depth; nobody
  lands on a lineman. True splits then drive the wing check, Scout D's alignment rules and route
  starts. Retyping the formation or strength drops them; Edit play's **Use standard spots**
  clears them by hand.

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

**AI review of an import** (`src/lib/importReview.ts`, `/api/review-import`): after a fresh import
(`/script?loaded=1`) or **Add film**, the plays the rules couldn't place (a formation name or front
the classifiers don't know, or a play call that reads as neither run nor pass) are sent once, text
only, to Gemini, which maps them onto the app's own shapes (formation key + side, front key,
run/pass). The answers go in `card.aiHints`, which `deriveCard` uses **only where the rules came
up empty**, so anything the file says plainly wins; `updateCard` drops a hint when a coach retypes
that field, and `aiReviewed` keeps a play from being sent twice. For a pass the rules could only
read one route word from (not a named concept, no tree numbers), the AI also **builds the
concept**: a route per position (`routeSlots`: play-side / backside #1-#3 and the back → letters)
from the route tree plus the named routes, stored as per-letter `routeOverrides` with
`source: "ai"` (so **Edit play** can change any of them) and `aiHints.routes`; one route for
everyone is rejected, and a new play call drops the AI's routes. Filled plays show "· AI" in the
play list, with a notice to check them. Silent when the AI isn't available (no access, offline):
the plays load exactly as the file reads. One call per import, up to `MAX_REVIEW_ROWS` (150) rows,
rate limited per tier (`reviews`). The route splits the rows into chunks of `REVIEW_CHUNK` (40) run
side by side, with Gemini's thinking off (it's lookup, and a full game has to finish inside the
function's time). The response schema is kept flat on purpose: routes come back as one string per
row ("ps1 slant, ps2 flat, back protect", `parseRouteList`), because a route enum per position
nested in each result made the schema "too big to serve" and every review failed. If Gemini still
refuses the schema, the chunk is asked again as plain JSON and checked by `validateReview`. A
failure shows Gemini's own reason in the notice; a chunk that failed isn't marked reviewed.

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

## Sideline screens: sunlight mode and CoachPad export

- **Sunlight** (script header toggle, remembered per device in `scoutcard:sunlight:v1`):
  `ScoutCard`'s `contrast="high"` draws everything pure black on white with lines half again as
  thick (`SUNLIGHT` palette, `w()`), and the ball carrier as a long dash, since color no longer
  tells it from a route. For a field screen in direct sun.
- **CoachPad / tablet** (Print Grid): `ExportModal` exports every card in the current view, one
  per page, as one PDF or a ZIP of numbered PNGs (`01-play-14-duces.png`), for The CoachPad (13.3″
  4:3, 1600 × 1200, 10.64″ × 7.98″ pages), an iPad (4:3, 2048 × 1536) or letter paper
  (`EXPORT_TARGETS`). Each card is drawn off screen at the target's own pixel size, fitted
  without cropping (`fitCard`), captured with `html-to-image` (fonts embedded once) and packed
  with `jsPDF` or JSZip, all dynamically imported, all in the browser. Sunlight mode is on by
  default there. Old Excel `.xls` isn't read (the only browser reader, SheetJS, is either an old
  npm build with open security advisories or a CDN build this environment can't install); the
  upload box says to save it as `.xlsx` or CSV.

## Offline / iPad install

- Safari → Share → **Add to Home Screen**. The manifest launches `/script` standalone.
- `public/sw.js` registers only in production builds (`npm run build && npm start` or on
  Vercel). Open the app once while online and it keeps working offline.
- The loaded script lives in `localStorage` (`scoutcard:script:v1`), so it survives
  restarts. Bump `CACHE_VERSION` in `sw.js` when changing caching behavior.

## Deploying to Vercel

The CSV/scout-card core needs no server code; without Clerk keys the app is open (local, preview
with the bypass). The sign-in gate and AI features need: `GEMINI_API_KEY`, `BLOB_READ_WRITE_TOKEN`,
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID` — set in Vercel project settings and mirrored in
`.env.local` for dev (`.env*` is gitignored). The app still builds and the CSV path still works
with none of these set; only the video feature's routes need them.

- **Git:** push to GitHub, then at vercel.com/new import the repo. Vercel detects
  Next.js (build `next build`, output `.next`). Every push to the default branch deploys.
- **CLI:** `npx vercel` for a preview, `npx vercel --prod` for production.

`next.config.ts` sends `Cache-Control: no-cache` for `/sw.js` so iPads pick up new versions.

## Which Gemini model (`src/lib/gemini.ts`)

Every AI route (text cards, import review, single / batch clips, the secondary read) calls Gemini
through `generateJson`, never `generateContent` directly. It tries `GEMINI_MODEL` (optional Vercel
env var: pin or swap a model with no code change), then `gemini-2.5-flash` (the default: the
cheaper model, which the staff chose over 3.x), then `gemini-flash-latest` (Google's alias for the
current Flash) only if 2.5 Flash is retired; a model Google no longer serves (404 / NOT_FOUND)
falls through to the next, so one retired model never takes every AI feature down at once. Per model it tries the
response schema (plus thinking turned down for `fast` lookup calls), then without the thinking
setting, then plain JSON, on a 400; a bad key, used-up quota or outage stops at once. Failures
come back as Gemini's own reason ("RESOURCE_EXHAUSTED: …"), which every route puts in its error
so the coach's notice says what actually went wrong. Callers still validate the JSON themselves.
The model that answered is shown where a coach can check it: an AI card's source reads "AI
generated · <model>" (play list and Edit play), and the review notice ends "Read by <model>." —
so a `GEMINI_MODEL` Google doesn't serve (it falls back silently) is visible. Leave
`GEMINI_MODEL` unset (or `gemini-2.5-flash`) to run on 2.5 Flash; production and preview had it
set to `gemini-3.6-flash`, which overrides the code default until it's removed in Vercel.
Film calls send the clip at `FILM_FPS` (8) frames a second, not Gemini's default 1, so a release
or break isn't lost between frames: about 10-25k input tokens for a 5-12 second clip.

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
points here, unlike `video-service/`. The model reports every point in **field yards from the ball
at the snap** (x = yards to the offense's right / left, y = yards past the line / into the
backfield), measured off the yard lines, hashes and numbers, never the screen. It used to answer
in percent of the frame, stretched straight onto the card, which only works for an end zone
camera: from the sideline (the usual high school angle) upfield runs across the screen, so every
route came out turned 90°, and a panning camera or a screen recording of Hudl (playback controls,
a desktop) threw it further. `coordinateMapper.ts`'s `yardRouteToPathDeltas` maps yards to scale
(`YARD_X` across, `YARD_PX` downfield) and simplifies the path (`RDP`-style) into the app's
straight stems and sharp breaks; `detectPlayFromClip` stamps answers `units: "yards"`, and an old
frame-percent answer still maps the old way. `matchDetectedLetters` puts each detected player on
the card's own player who lined up nearest where he stood (Q stays Q), so the route lands on the
right man even when the model's letter doesn't fit this staff's formation. If Hudl's **data bar**
is on screen the model copies it (`hudl`: PLAY #, OFF FORM, OFF PLAY, PLAY TYPE, HASH, OFF STR,
PLAY DIR), and a single-clip card takes the formation, call, hash, strength and direction from it
(`hudlBarFields`) over the model's own guess. Still a rough starting point, not a measurement.

**Route names, the catch, and repeatability.** Each player's `routeType` must be one of the
staff's names (`videoImport.ts`'s `FILM_ROUTES`, the schema's enum, explained to the model in
`FILM_ROUTE_GUIDE`: the tree 0-9 by name, GO, HITCH, DIG, DRAG, FLAT, SWING, BUBBLE (only if he
loses ground first; a flat release is a SLIDE), WHEEL, RAIL, LEAK, plus BLOCK, FAKE, CARRY, NONE).
A named route is **snapped**: redrawn exactly like the route tree from that player's spot on the
card (`formations.ts`'s `namedRouteDeltas`), stored as a `path` plus `route` so it keeps its number,
its table text ("Slide · BALL") and its drag handles. BLOCK becomes a stalk, FAKE is left to the
card's own mesh, and DRAG / RAIL / CARRY keep the film's own shape. A route ends at the catch (the
prompt says never to follow the run after it), and the ball note names the card's letter, not the
model's. Film calls (routes and the secondary read) run with `generateJson`'s `deterministic`
(temperature 0, a fixed seed), so the same clip reads the same way; if the model answers without
the schema, `filmRouteName` still finds the route name in its free text. The prompt tells the
model the data bar and play call are tags, not evidence ("RPO BUBBLE" on screen doesn't make the
route a bubble). Two staff rules are applied in code on top: a **wing** (`wingLetters`, the
alignment check on the film's spots) who the model says ran a BUBBLE ran the SLIDE (route 0), and
only the widest receiver the film put on the line on each side stays on it (seven on the line).

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
(`ratelimit/<bucket>/<hashed team id>/<window>/`, counted with `list()`). The limits are **per
access tier** (`src/lib/usageLimits.ts`'s `TIER_LIMITS`; `requireEntitlement()` returns the tier):

| Limit | Demo (allow-listed / test bypass) | Paid (subscribed staff) |
| ----- | --------------------------------- | ----------------------- |
| AI text cards (`/api/generate-scout-card`) | 20 / minute | 120 / minute |
| Single clips (`/api/parse-video`) | 10 / 5 min | 50 / 5 min |
| Batch jobs (`/api/parse-video-batch`) | 1 running, max 50 plays | 3 running, max 100 plays |
| Clip uploads (`/api/blob-upload`) | 60 / 5 min | 350 / 5 min |
| Import reviews (`/api/review-import`) | 10 / 5 min | 60 / 5 min |

Uploads are sized to the clip limit plus every running job's full game, so a batch never stalls on
uploads. Each tier has its own bucket name (`parse-video-demo` / `-paid`), so a staff that
upgrades starts on the paid counts right away. At these rates the counter itself costs Blob
operations (one `list` + one `put` per request), which count against the Blob plan's advanced
operations. Not perfectly atomic under concurrent hits from one team — fine for a small coaching
staff's traffic, and it's defense-in-depth layered on top of the auth/billing gate below, not the
primary defense against strangers anymore. If this project ever moves to a plan with Firewall
rate limiting, add the matching rules (dashboard or `vercel firewall rules add`) and
`checkRateLimit` starts enforcing immediately, no code change.

## Batch video import (`/api/parse-video-batch`)

**Full game film: one click** (landing page, under the single-clip uploader;
`src/components/BatchUploader.tsx`). A coach drops Hudl's "video with data" **.zip** (every clip
plus the breakdown sheet), or, if they already unzipped it, the clips and the `.csv` / `.xlsx`
together; more files can be added in later drops. **How it works** opens the 3-step "How to
Import Full Game Film in 30 Seconds" guide.

1. The zip is unpacked in the browser (`JSZip`, dynamically imported); `sortBatchFiles`
   (`src/lib/batchMatcher.ts`) splits clips (`.mp4/.mov/.m4v`) from the sheet and skips `__MACOSX`
   and dot files. The sheet goes through the normal `parseHudlCsv` (CSV or `.xlsx`): real
   down/distance/formation/play call, ground truth, never touched by AI.
2. `planBatch` lines clips up with rows by the number in the file name (`clip_01.mp4`,
   `Play 4.mp4`; `clipMatching.ts`'s `extractPlayNumberFromFileName`), read both against the
   sheet's PLAY # and against row order (clip 1 = first row); whichever matches more clips wins,
   PLAY # on a tie, and no row gets two clips. Every row is routed: **Film** (a clip matched),
   **AI** (no clip, and the rules can't draw it: an unknown formation or a call that's neither run
   nor pass, `needsTextAi`), or **Sheet** (no clip, and the sheet already draws it). A checklist
   ("✓ Play 1: clip_01.mp4 ↔ TRIO · SLOT RPO BUBBLE", unmatched clips in amber) shows before
   anything is spent.
3. **Generate Scout Cards** runs two queues side by side with one progress bar ("Processing play
   4 of 30…"): Film rows through `/api/parse-video-batch` (below), AI rows through
   `/api/generate-scout-card` two at a time (`textAiRequest`: the call, formation and the row's
   front + coverage; the AI's routes and defenders go onto the sheet's own card, marked
   `aiReviewed` so the import review doesn't send it again). A row whose AI call fails keeps its
   sheet card, counted in the warnings. Sheet rows aren't sent anywhere: sending every clip-less
   row to the text AI would redraw cards the rules already draw and run into the tier's cards per
   minute on a full game.

One game is one **job**. Its matched clips go up in chunks of `MAX_BATCH_CLIPS`
(`src/lib/batchConfig.ts`, 10: a serverless call has to finish in time), every chunk tagged with
the same client-made `jobId`, the game's `totalPlays`, and `final: true` on the last one.
`checkBatchJob` (`src/lib/rateLimit.ts`, pure logic in `usageLimits.ts`'s `decideBatchChunk`)
keeps a marker per chunk (`ratelimit/batch-jobs/<team>/<hour>/<jobId>/<time>-<clips>[-done]`)
and enforces the tier's running-jobs and plays-per-batch limits; a finished job frees its slot at
once, and one that goes quiet for `BATCH_JOB_IDLE_MS` (15 min) stops counting. Before uploading
anything the uploader asks `/api/ai-access` for the tier's limits and refuses a game over its
plays-per-batch, so no clips are uploaded for a batch that would be refused. Each chunk's clips upload to private Blob storage client-side (same
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
matching the route tree above, plus the wing slide: detect a flexed wing as the innermost
receiver and, if he runs flat across the formation or into the flat under outside blocking
receivers, tag `playName` "RPO SLIDE / WING FLAT" (which the card reads as the wing slide).
Every film prompt (route detection and the secondary read) opens
with `QB_ANCHOR_RULES`: find the quarterback first (the player taking the snap under center or 4-5
yards deep); his jersey is the offense and the way he faces is upfield; everyone across the line
facing him is defense; left / right are the offense's, never the camera's; then follow the ball
from the snap to whoever takes it from the QB. The detection answers `playType`, `ballCarrier`
and `ballDirection` from that (`ballFromDetection`): on a single-clip card the carrier's arrow is
tagged BALL, `PLAY DIR` is set from the direction, a pass is typed Pass (a run stays drawn from the
film's own paths) and NOTES reads "Ball: H, left (from film)"; in batch import the film only fills a
PLAY DIR or note the CSV row left blank. Batch import also sends each clip's play call from its matched CSV
row, so a called concept is drawn with that geometry; the call is flattened to one quote-free line
and capped at 80 characters before it goes in the prompt.

## Text-to-card (`/api/generate-scout-card`)

**AI card** on `/script` (and **Draw a play with AI** on its empty state) opens
`src/components/GenerateCardDialog.tsx`: type a play call ("DEUCES MESH RAIL"), a formation, and
an optional defensive call ("COVER 3", or "3-4 COVER 1" to set the front too). The route asks
Gemini 2.5 Flash, under a strict `responseSchema`, for 0-100 grid coordinates of all 22 players,
and returns a finished card that's appended to the script and shown. Gated and rate limited like
the film AI (`requireEntitlement()` first, then the tier's cards per minute), since every call
costs money.

The pure half is `src/lib/generatedCard.ts`, and it keeps the AI inside the app's own drawing
instead of a second renderer:

- `shellCard` builds the card from the text exactly like a CSV row (formation shape, front from
  `splitLook`, coverage in the footer).
- `generationContext` + `buildGenerationPrompt` hand the model the card's **own** spots for all
  11 offensive players (Q/F/H/X/Y/Z + OL, grid units) and the exact defender labels for the front,
  plus the rules: `FOOTBALL_CONCEPT_RULES` (MESH, RAIL, CORNER/OUT),
  coverage alignment rules (Cover 0/1/2/3/4/6), 100% receiver coverage (a safety or nickel over /
  apexed on the #2 of any side with 2+ split receivers, backers walked out on the rest), and the
  defense's starting spots from the app's own alignment rules. An optional **safety depth**
  (`safetyDepth`, the dialog's Auto / Press / Normal / Deep shell) is written into the prompt and
  then enforced: FS and SS land at that depth whatever the model says (`card.defenseAlignment`). The grid: x 0-100 sideline to sideline, y 0-100
  downfield to behind the offense, the card's own 500 × 300 canvas, LOS at y ≈ 46.7. User text
  goes through `oneLine` (one quote-free line, 80 characters).
- `applyGeneratedPlay` turns each receiver's route into a `routeOverrides` path with
  `source: "ai"` (deltas from the start, simplified like video routes) and moves each defender onto
  the card's own id (nearest within its label) in `defenseOverrides`, never past the ball.

So an AI card is a normal card: its routes have draggable break points (`onEditDetectedRoute`, now
wired on `/script` for both `video` and `ai` routes, saved per letter, so dragging one never moves
another), its defenders move with **Adjust X's**, and it prints, filters and saves like the rest.
The deterministic cards above (concept dictionary, route tree) stay the default and work offline;
this is for a call the dictionary doesn't know or a quick one-off look.

## Auth, teams, and billing (Clerk + Stripe)

**Access.** On production the whole app is for signed-in coaches who are on the allow-list or on a
subscribed staff: `src/components/AppGate.tsx` wraps `/script`, `/practice` and the landing page's
upload / AI film sections, and shows a sign-in or "private pilot" screen otherwise. The landing
page itself and its live demo cards stay public, and so does the **5-play demo script**: "Try the
5-play demo" on the locked screens loads it, and `/script` shows it in `demoMode` (swipe, Scout
O/D, print and draw work; Add film, AI card, the playsheet and Edit play are hidden), so nothing
new can come in without access. The gate only applies where Clerk is configured
and the testing bypass is off (production); preview deploys (`NEXT_PUBLIC_SKIP_AI_GATE`) and a
local checkout without Clerk keys are open. Once an iPad is verified it's trusted offline for 14
days (`scoutcard:access:v1`), since Clerk can't load on a field with no signal. The CSV reader runs
in the browser, so this hides the app rather than hard-locking it; the AI routes are the hard lock
(`requireEntitlement()` on every call). `src/lib/scriptStore.ts` and the CSV parser themselves
have no account concept.

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
- `src/middleware.ts` (it must live in `src/`: with a `src/app` directory Next.js ignores a root `middleware.ts`, which left every gated route throwing "clerkMiddleware() was not run") is a bare `clerkMiddleware()` (also config-guarded) — just enough for
  `auth()`/`clerkClient()` to have request context in the routes that call them. It does **not**
  gate anything itself (Clerk's own path-matcher-based `createRouteMatcher` + `auth.protect()`
  pattern is deprecated in favor of per-route checks); its `matcher` only covers
  `/api/parse-video`, `/api/parse-video-batch`, `/api/generate-scout-card`, `/api/ai-access`,
  `/api/review-import`, `/api/read-secondary`, `/api/blob-upload`,
  `/api/stripe/checkout`, `/api/stripe/portal`, and
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
- **Free allow-list (temporary, until the staff pitch / billing is live):** `AI_ALLOWED_EMAILS`, a
  comma-separated server-only env var of coaches' emails. `requireEntitlement()` checks the
  signed-in user's **verified** Clerk emails against it (`isAllowListed`, unit-tested) before the
  team/subscription checks, so an allow-listed coach needs neither a team nor a subscription;
  they get the **demo** tier's limits, bucketed by their team, or `user-<id>` without one. A
  subscribed staff gets the **paid** tier even if a coach is also on the list. Delete the env var and the
  paywall applies to everyone again, no code change. The client can't see the list, so
  `useTeamAccount` also asks `GET /api/ai-access` (the same `requireEntitlement()`, costs
  nothing) once per user + team, and the upload buttons go straight to uploading when either the
  subscription or the server says yes.
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
