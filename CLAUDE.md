# ScoutCard AI

Web app for high school football staffs: **game film in, vector-drawn scout team cards out**, which you can
flip through on an iPad at practice or print 2 or 4 to a page. Cards come from a game file the film analyzer
(`video-service/`) writes, or from the 5-play demo. The app no longer takes a Hudl CSV from a coach (the
upload box, the playbook upload and **Add film** are gone); the CSV parser stays inside as the engine that
turns a row into a card, and a script is parsed and kept in the browser, never uploaded. Only the AI features
and the staff's shared copy (see "Saved for the staff") send anything to a server. On production the app itself
is behind sign-in (see "Access" below); preview deploys and a local checkout are open.

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
    page.tsx               Landing: open a game file, demo button
    script/page.tsx        iPad reader: Scout O/D + All/7v7/Team toggles, filters, swiper, Print Grid;
                           practice mode (?practice=<day>&period=<n>) runs a day's playsheet
    practice/page.tsx      Practice playsheet editor: days → periods (7v7/Team, our O or our D) → calls
    film/page.tsx          Game film: upload a game's clips, watch them read, open the scout cards
  components/
    ScoutCard.tsx          PlayIQ-style card: title header, white-field SVG, assignment table
    PrintGrid.tsx          Letter-size sheets, 2-up portrait / 4-up landscape, window.print()
    ExportModal.tsx        CoachPad / iPad / letter export: one card per page, a PDF or a ZIP of PNGs
    FilterBar.tsx          Down / formation toggle pills
    landing/               Landing-page-only visuals (see "Landing page" below)
    EditPlayDialog.tsx     Edit a play (formation, strength, play, direction, hash, front, coverage, note)
    ImportNotice.tsx       Non-blocking "Loaded / Added N plays" notice with file notes
    BrandMark.tsx, ServiceWorkerRegister.tsx
    ui/                    shadcn primitives: button, card, badge, tabs, dialog
  lib/
    hudlParser.ts          CSV → HudlPlayCard[] (column mapping + normalization + classifiers)
    formations.ts          Formations, fronts, run schemes, route tree → buildDiagram()
    importReview.ts        AI review of an import: rows the rules couldn't place → card hints
    demoScript.ts          MOCK_HUDL_CSV: 5-play sample used by the "Demo Script" button
    scriptStore.ts         Persists the loaded script in localStorage (offline on the field)
    practicePlan.ts        Practice playsheet: line parser, opponent looks, rep → Scout D card
    conceptMapper.ts       Named pass concepts → a route per position; RAIL / WHEEL back tags
    secondary.ts           Scout D secondary per formation: typed line / film read → DB spots
    formationFamily.ts     The staff's formation names (Pro, Twins, Aces, Duces, Trio...) as a family the defense is matched on
    defensiveAligner.ts    Scout D alignment rules: split receivers, safety roll, backers match numbers
    coverageRead.ts        Coverage from film: man or zone, how many deep, sky / cloud, quarters match (after the snap)
    generatedCard.ts       Text-to-card: Gemini prompt, answer validation, grid → card overrides
    batchMatcher.ts        Batch plan: sort clips from the sheet, match clip ↔ row, route each row
    gemini.ts              The one Gemini JSON call: model fallback, schema fallback, real error reasons
    exportUtils.ts         Export targets (CoachPad 13.3" 4:3, iPad, letter), card fit, file names
    film/                  Hosted film pipeline: jobs, service, storage, upload plan (see "Game film upload")
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
    - `counter` (COUNTER, TREY, GT): the line blocks one way and the ball goes the other. The frontside blocks down
      away from the play, the guard and tackle both pull across, and the carrier steps away first, then cuts back behind them.
    - `iso` / lead: the center and guards climb to the backers and the fullback leads.
    - `draw` and `sneak`.
    - `toss` / `jet` (`TOSS`, `PITCH`; `JET`, `FLY`): outside-zone line blocking. The toss back runs flat to the
      sideline. The jet is carried by the **motion receiver** (the backside receiver nearest the ball), across behind the line.

    **Receivers block the corner** (T-bar labeled `C`, job "Stalk the corner"); on a **toss** the play side's
    inside receiver **push-cracks the safety** instead (up, then down and inside, labeled `S`, job "Crack: push to
    the safety"), the rest stalk the corner. The ball carrier's path is orange.
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
    BUBBLE, FLAT, LEAK, HITCH, DIG, SWING, WHIP) are written by name. A **whip** is a slant (a 3-yard
    stem, then 45° inside) that breaks back outside to the flat; a lone "WHIP" call is a
    combination like the other inside routes (#1s go, #2s whip, #3s hitch).
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
    Several words go **right to left** across the receivers, like numbers ("FADE SPEED OUT HITCH FADE" in
    Deuces: the right outside receiver fades, the right slot runs the speed out, the left slot the hitch, the left
    outside receiver fades). LEAK goes to the tight end.
  - **Named concepts** (`src/lib/conceptMapper.ts`'s `CONCEPT_DICTIONARY`): MESH, FLOOD,
    SMASH, DAGGER and CROSS (CROSS only when it's the lone route word) give **each position its
    own route** instead of one route repeated across every receiver. Positions are by play side,
    outside in (`ps1`/`ps2`/`ps3`, `bs1`/`bs2`, `back`), so a template works from any formation
    and mirrors with the play; in Deuces going right that's Z/Y, X/F and H. A route is a tree
    kind (drawn with the staff's own technique, e.g. MESH's 8 post and 7 corner) or a yard
    vector for routes off the tree (`conceptPath`: MESH drags at 3 and 5 crossing over the ball,
    FLOOD's sail (16 up, leaning inside a touch via `driftIn`, then an out break finishing outside
    and back down at 14), DAGGER's dig at 15, the deep cross). **RAIL / WHEEL are separate from the
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
  **Blitzes** (`src/lib/pressure.ts`): this staff writes the blitz in the COVERAGE column, not a coverage: "6 - DOUBLE
  FIRE", "5 - LB". The number is how many rush; **FIRE** is one outside backer blitzing off the edge (either side: it doesn't
  matter to the staff; the card draws it from the strong side), **DOUBLE FIRE** both outside backers, **LB** an inside backer. `parsePressure` reads
  the tag; the Scout D card draws a rush arrow (`Diagram.rushes`, defense color) from each blitzer (the outermost backer
  on that side, or the one nearest the ball for LB) off the edge or through the A gap at the quarterback, puts "Double
  Fire: both outside backers off the edge, 6 rush" first in NOTES, and labels the table's box BLITZ. None in 7v7. There is
  no Cover 6 in this staff's calls: a "6" there is a rush count, and `coverageStyleFor` no longer reads it as a two-high
  shell.
  **Where each defender went** (`card.defenseMoves`, `Diagram.defenseArrows`): a film card draws a straight arrow from each
  defender who moved after the snap, the way a scout card shows what the defense did (the nickel flowing to the flat, a safety
  rotating down, a corner dropping). `readDefense` puts each man's `move` (his spot `MOVE_SECONDS` (1.5) after the snap less
  his spot at it, in yards; none under `MIN_MOVE_YARDS` (1.5), capped at `MAX_MOVE_YARDS` (14)) on `FilmDefender`,
  `defenseMovesFor` hands each to the card's own defender id (the same nearest-of-the-same-kind match as `defenseOverrides`) in
  card coordinates, and a blitz tag's drawn rush stands in only on a card with no film arrows. **Reset X's** clears both.
  **Who each defender had** (`card.defenseAssignments`, `Defender.assignment`): `readCoverage` also says what each defender
  was doing (`DefenderAssignment`): a man defender who ran with a receiver is "→ X" (the card's own letter for that receiver, put
  on it by where he lined up, `defenseAssignmentsFor`), a zone defender the area he ended in ("FLAT", "HOOK", "CURL", "DEEP HALF",
  "DEEP THIRD", "DEEP MIDDLE", "DEEP QUARTER", named from the coverage family and where he stood), a rusher "RUSH". The card prints
  it under the defender's label. Written only on a sure coverage read of a defense that adds up, and where the sheet's COVERAGE is
  blank or a blitz call (a coach's own coverage tag keeps the column, and the film's assignments wait). The alignment itself comes from
  `defenseOverrides` as before. **Reset X's** clears it with the arrows. Tested on drawn plays (Cover 1, 2, 3).
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
  next man inside), Cover 2/4/quarters/Tampa `DEEP_SHELL` (there is no Cover 6 in this staff's calls) (both safeties stay deep, backers
  apex). What it did shows in the NOTES box ("SS apex Y · S apex H · FS middle") until a coach
  writes a note. Formations with at most one split receiver a side (Pro, I, Double Eagle) are
  unchanged.
  **Safeties / Slots strip** (`SafetyDepthControl.tsx`, under the toolbar while Adjust X's is on):
  per play, the safety depth (Press 4 / Normal 9 / Deep shell 13, or a 2-18 yard slider) and the
  slot style, saved in `card.defenseAlignment` (`safetyDepthY` in yards, `coverageStyle`).
  FS and SS keep their spot across and only change depth; a safety a coach already dragged moves
  to the new depth too. Two number boxes, **FREE** (FS) and **ROVER** (SS), take an exact depth for
  each safety (`freeDepthY` / `roverDepthY`, half-yard steps, 2-18), so they needn't match; a preset
  or the slider sets both and clears those numbers, and `safetyDepthFor` picks his own number, then
  the shared one, else the rules. **Auto** clears it. Order of precedence: the rules, then the staff's
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

  **Formation families** (`src/lib/formationFamily.ts`): `FormationKey` is the shape the app *draws* (Twins draws as Pro,
  Aces and Duces both as Spread, Bunch as Trips), but a defense lines up differently against each, so everything that asks
  "what did they do against this formation?" keys on the family the staff names (`formationFamily(text, key)`: pro, twins,
  aces, duces, trio, empty, bunch, i-form, double-eagle, split-pro, spread; `fam:<family>` in tables) and falls back to the
  shape only where there's no film of that exact formation. The practice script, the opponent's breakdown and the film
  analyzer's own name for what it saw (`staff_name`: "deuces gun", "trio gun right", "aces", "twins right") all land on the
  same family. The film analyzer now writes that name in the formation column (`clipjob.formation_line`), so a film card keeps
  "Twins" instead of just "Pro". `secondaryFromFilm` writes a table per family (with a `plays` count) *and* one per shape
  (the pooled fallback); `dbAlignmentFor(alignments, formationText, key)` picks one: a table the coach set (family, else
  shape) beats film, then family beats shape. The Secondary dialog still sets shape tables only.
- **One play, two cards** (the **Both** lens, script header: SCOUT OFFENSE / SCOUT DEFENSE / **BOTH**): a play read from film is
  one card holding one read (routes, run scheme and carrier from the offense's tracks; front, coverage, blitz, each
  defender's spot and arrow from the defense's), and every lens draws the part it needs: Scout O the play the offense ran,
  Scout D what the defense did. Both shows the two side by side for each play (every play is listed, as on Scout D), and
  the play's tools (Draw, Adjust, Secondary) are off while it is on. **Print Grid / CoachPad export** follow it: each play
  comes out as its Scout O card then its Scout D card (`exportUtils.ts`'s `cardViews`, so a 2-up sheet holds the pair; export
  files are named `…-scout-o-d-…` and `01-play-14-trips-right-o.png` / `-d.png`). Practice playsheet periods keep their one lens.
- **Pre-snap motion** (`card.motionFrom`, `Diagram.motions`, Scout O): a receiver or back who moves before the ball is snapped is
  drawn with a **squiggly line** (`squiggle.ts`'s `squigglePath`, black, an arrowhead short of his circle) from where he was set
  to where he ended up; his circle and his route are at the spot he ended in, which is what the defense saw. From film:
  `trackedPlay.ts`'s `motionFromTrack` reads the whole track (the file starts a few seconds before the snap): his mean position
  over his first points against his mean at the snap, 2.5+ yards apart (`MOTION_MIN_YARDS`), needs 0.5 s of film before the
  snap, and a track that ran over 14 yd/s in 0.3 s (slid onto another man) isn't motion. The snap is still found from the fourth
  man to move, so a man in motion doesn't move it. `DetectedPlayer.motionFrom` → `detectionMotions` → the letter's spot, kept with
  `offenseSpots` (dropped with them by **Use standard spots** or a new formation). Motion shorter than about 3 yards isn't drawn.
  Not on the sheet: no Hudl column carries it. Drawn tracks only.
- **The team being scouted** (`card.scoutSide`, `eval/scoutteam.py`): the scout cards are for one team, "the red team" (the opponent
  whose film it is). Film shows both teams, so the tracker is told its **jersey color** (`--scout-color red` on `eval.tracks` /
  `eval.game`, `SCOUT_COLOR` for the worker, `scoutColor` in a shard's options) and writes, per play, `scout: {color, side}`: the group
  behind the ball wearing the color (the median share of torsos in that hue range, `COLORS` in HSV) means the team had the ball. Real
  pixels on the new recordings: red offense men 0.19-0.53 red, the gold defense 0. `tracks-to-cards` puts it on the card as
  `scoutSide`, and `inPeriod` then lists a play of the team as **Scout O only if it was on offense, Scout D only if it was on defense**
  (the other side of that film is the other team); **Both** and Print / export give such a play only its own side's card
  (`cardViews`); the practice looks (`opponentLooks`) come only from the plays it was on defense. No color given, or the groups wear
  it about equally (`MIN_GAP`): unset, everything behaves as before. A per-game color field on `/film` isn't built (set it in the worker's environment).
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
- **Everyone has a job** (end of `buildDiagram`, tested by `assignments.test.ts` across every
  formation, call, period and direction): on a called play every receiver and back either runs a
  route or blocks. Anyone the call, the AI or a template left without a drawn path gets the default
  for his spot: a wide receiver **stalks**, a tight end or back **pass-pros** (**blocks** on an RPO)
  in 7v7 as well as Team (no line to set there), and on a run the back who isn't carrying it
  **fakes** (dashed). A play with no call is a formation rep and stays bare, and a coach's explicit
  "No route" is respected.
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
  The blue LOS bar is drawn just in front of it (y 136-141, offense view) and every on-ball
  player's front edge sits exactly on its back edge: skill players (r 9, `SKILL_R`) at y 150, linemen
  (r 7, `LINE_R`, the center a 14 px square) at y 148. Off-ball receivers (y 160) sit 1-2 yards behind it; the
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

## The Hudl CSV reader (internal)

No screen takes a CSV any more, but the reader above is still how a row becomes a card: the demo script
(`MOCK_HUDL_CSV`), the film analyzer's `game.json` cards, the practice playsheet and the review scorecard all go
through `parseHudlCsvText` / `deriveCard`. On the field: swipe or use **PREVIOUS CARD / NEXT CARD** (arrow keys
on a keyboard), filter by down or formation, and switch to **Print Grid** for 2 or 4 cards per page and
**Print / Save PDF**. No game file handy? Use **Load demo script · 5 plays**.

**AI review of an import** (`src/lib/importReview.ts`, `/api/review-import`): after a fresh import
(`/script?loaded=1`, after a game file is opened), the plays the rules couldn't place (a formation name or front
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

**Editing:** **Edit play** opens `EditPlayDialog`, with a live card preview and quick-pick
buttons. It takes the play's **situation** too (DOWN, TO GO, YARD LINE: `CardEdits`' `down` / `distance` / `isGoalToGo` /
`yardLine`), because film can't supply them (see "Game film upload"). It can **Duplicate** or **Delete** the play. Edits go through `updateCard`, which
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

**Adjust arrows:** **Adjust arrows** (Scout O, field view) puts a draggable handle on every break
point of every route, not only film and AI routes (`ScoutCard`'s `adjustRoutes`, `Diagram.routeLetters`
and `routeKinds`). Dragging one saves the whole route as the coach's own shape (`routeOverrides[letter]`
with a `path` and `source: "coach"`), keeping its number when the label names a route kind. **Reset
arrows** puts the play call's arrows back (a typed tag stays). Blocks and the ball carrier's path aren't
draggable yet.

**Pencil drawing:** **Draw** (field view) turns the card into a drawing surface for Apple
Pencil or a finger. There are four colors, plus **Undo** and **Clear** (tap twice). Strokes are
stored in SVG viewBox coordinates in `card.drawings.offense` / `.defense`, so Scout O and
Scout D each have their own layer. They print and survive reloads. Swiping and Adjust X's are
off while drawing. `ScoutCard`'s `ink` prop enables the overlay.

## Our own playbook (removed)

The staff's-own-plays upload (the landing page's **Study your playbook**, `/script?playbook=1`, the playsheet's
**Add from your playbook** picker) is gone with the CSV upload it depended on. The `playbook` storage and sync slot
(`scriptStore.ts`'s `ScriptSlot`, `syncMeta.ts`) is still defined and nothing writes it.

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
  - **A script with a personnel column** (Number | Personnel | Formation | Play: "1 Boston Pro rt Duo
    rt"): the personnel package ("Boston", "Miami") is kept apart from the call (`PlaysheetRep.personnel`,
    read from a header row naming Personnel, or a lone unknown word ahead of a known formation), header
    and title rows ("Offensive Practice Scripts", "Number Play") are skipped, and a script pasted with
    **every cell on its own line** is put back one rep a line on paste (`normalizePlaysheetPaste`, run by
    the textarea's `onPaste`, so `rep.line` stays one line a rep for `setLineLook`). Each rep row shows
    run / pass and the personnel; the card's notes carry "Personnel: Boston." `classifyConcept` knows DUO
    and CROSSBUCK. A collapsible **Film** panel lists what the opponent played against each formation.
  - **Looks** (`opponentLooks`): the opponent's front + coverage pairs, from ODK `D` rows when the
    breakdown tags ODK, else every row with a front/coverage (like normal Scout D cards).
  - `assignLooks` matches each rep to what they showed against that same formation **and kind of play**
    (`repKind`: run or pass; used once there are `MIN_KIND_REPS` (3) snaps of it, since a defense calls
    runs and passes differently), else that formation, else the shape it draws as (Aces with no Aces film uses their
    Spread looks), else their overall mix (the `basis` it returns says which; `ScoutLook.vs` / `vsKind` are keyed by both
    shape and `fam:` family). It spreads reps in proportion (smooth weighted round-robin, deterministic), so
    a 60/40 defense gets 6 and 4 of 10 reps, mixed in. A look written on the line always wins.
    The editor's per-rep dropdown rewrites the line's `vs …` (`setLineLook`), so the pasted text
    stays the single source of truth.
  - The staff's own formation names ("REX") that the classifier doesn't know get a one-time
    "draw it as" pick, stored in `formationAliases` by the call's first word.
  - **Their defense vs your formations** (`defenseVsScript`, the panel at the top of `/practice`, replacing the old film
    list): for each formation in the day's script, the reps, their front and coverage (with %), where their corners and
    safeties line up (`describeAlignment`), and what each is based on: "from 6 snaps against Twins", "no Aces film: using their
    Spread looks", "set by your staff in Secondary", or "no film: a 4-3". Rep cards carry `formationName` (the formation part
    of the call) so the secondary is looked up by the right family. Drawn data only so far; not run on real film.
- **Our D → Scout O.** The defensive coach calls his own defense, so there's no list: Scout O
  runs the opponent's plays for that period type as usual (`periodScoutOCards`, which also drops
  ODK `D` snaps).

`/script?practice=<dayId>&period=<n>` runs it: the period chips replace the filters, unit and
mode come from the period, the cards keep playsheet order, and PREVIOUS/NEXT roll over into the
adjacent period. Rep cards (`id` starts `rep-`, `isRepCard`) aren't in the saved script, so Edit
play / Draw / Adjust X's are off for them and they show no tendency badges. Print Grid prints the
current period.

## Saved for the staff (`/api/sync`, `src/lib/cloudSync.ts`)

Signed in, the **scout script and the practice playsheet** (the live `SyncSlot`s in
`syncMeta.ts`, the same localStorage keys as always) are also saved to a private Vercel Blob per team
(`syncStore.ts`: `sync/<sha256 of the team id>/<slot>`, the team being the Clerk organization, or
`user-<id>` for a coach without one: the same `teamId` `requireEntitlement()` returns). Every coach on
the team reads and writes the same copy, so a second coach or a new iPad sees the same thing. The
device copy stays the one the app reads and writes (it works with no signal); sync only moves it.

- **Wire:** `GET /api/sync?slot=&etag=` (200 body + `x-sync-etag`, 204 none, 304 unchanged) and
  `PUT /api/sync?slot=&base=` (200 `{etag}`, 409 someone saved since, 413 over 4 MB). The body is the
  slot's JSON gzipped in the browser (`CompressionStream`), stored as sent. The blob's own ETag is the
  version: a write is `put(..., { ifMatch: base })`, so the store itself refuses a stale write (no
  read-then-write race), and the first write refuses to overwrite another coach's first write. The
  route is off (403) wherever the AI gate is bypassed (open preview / local), since that would be one
  shared copy for anyone holding the URL, and 501 with no `BLOB_READ_WRITE_TOKEN`.
- **When it moves** (`CloudSync` in the root layout, only while `useAuth()` says signed in; engine
  `cloudSync`): on sign-in, when the tab comes back, on `online`, every 60 s while visible, and 2.5 s
  after any save. `storeScript` and `savePlan` call `notifyLocalChange(slot)` (marks the slot dirty in
  `scoutcard:sync:v1` and fires an event), so every save path is covered without each caller knowing.
- **The rule** (`decideSync`, tested): it never overwrites work it hasn't seen. Nothing saved yet +
  something here → push. Nothing here → pull. Same version as last time → push only if edited here.
  The staff's copy moved and this device has no edits → pull. **The staff's copy moved and this device
  has edits, or this device has its own copy and has never synced** → a dialog (`CloudSync.tsx`) asks
  "Use my staff's version" or "Keep this device's and replace theirs"; nothing changes until a coach
  picks. A downloaded copy lands in localStorage without marking it dirty and fires
  `scoutcard:remote-applied`, which `useRemoteApplied` pages use to reload (script, practice, landing
  playbook count, `/practice`). The public demo script and an empty playsheet are never pushed.
- **Different team or coach on the device** (`scoutcard:sync-owner:v1`) starts the device's sync history
  fresh, so the first-sign-in conflict rule applies again. `SyncBadge` in the reader and playsheet
  headers shows Saved / Saving / Offline / Choose a version. Deleting a staff's copy isn't built (ask
  by email); clearing the browser removes the device copy only.
- Not covered yet: two coaches editing the same slot at the same moment still get the choose-a-version
  dialog rather than a merge; per-coach names on a save; a size over 4 MB gzipped stays on the device.
- The privacy policy, terms and FAQ say all of this; keep them in step with it.

## Review mode: check Hudl Assist's tags (`src/lib/review.ts`, `ReviewBar.tsx`)

A staff re-checks Hudl Assist's tags every Sunday because many are wrong. **Review** on the script
reader (not in practice mode, not the demo) turns that into one tap a play: the strip under the toolbar
shows the tags the file came with (formation, strength, play call, direction, hash, front, coverage), **Looks
right** checks the play and moves to the next unchecked one, **Fix** opens Edit play (saving counts as
checking it), **Undo** un-checks, **Unchecked only** filters the list, and **Scorecard** opens the tally.

- **Data:** every card keeps `tagged` (`TagSnapshot`: the tags as first derived, set once in `deriveCard`,
  never changed by edits, so a script saved before this feature starts from its values at first load) and
  `reviewedAt` (when it was checked). Both live on the card, so they save with the script and are shared
  with the team like everything else. A play is "fixed" when a tag differs from `tagged`, **judged by meaning**
  (`changedFields`): "TRIO RT" to "Trips Rt" and "4-3" to "4-3 OVER" are not fixes; Pro to Trips, a different
  side, call, direction, hash, front or coverage is. The play list shows ✓ or "fixed".
- **Scorecard** (`summarize`): checked / total, % right as tagged, wrong counts per tag, and the most common
  formation fixes. It only counts plays that were checked. **As tagged (hudl.csv)** and **Corrected
  (corrected.csv)** download the checked plays in Hudl's own column names (`taggedCsv`, `correctedCsv`), the
  same pair `video-service/eval/score.py` reads, so a coach's Sunday pass produces the evaluation data with no
  separate export from Hudl.

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
  default there.

## Offline / iPad install

- Safari → Share → **Add to Home Screen**. The manifest launches `/script` standalone.
- `public/sw.js` registers only in production builds (`npm run build && npm start` or on
  Vercel). Open the app once while online and it keeps working offline.
- The loaded script lives in `localStorage` (`scoutcard:script:v1`), so it survives
  restarts, and signed in it is also saved for the staff (next section). Bump `CACHE_VERSION` in `sw.js` when changing caching behavior.

## Deploying to Vercel

The CSV/scout-card core needs no server code; without Clerk keys the app is open (local, preview
with the bypass). The sign-in gate and AI features need: `GEMINI_API_KEY`, `BLOB_READ_WRITE_TOKEN`,
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`, and for game film upload `FILM_WORKER_URL`, `FILM_WORKER_SECRET`,
`CRON_SECRET` (and `FILM_CALLBACK_ORIGIN` if the worker can't reach the request's own address) — set in Vercel project settings and mirrored in
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

## Film is the source

The product is moving from "upload Hudl Assist's CSV" to "upload the film and get the scout cards",
because Assist's tags are often wrong and it can't read routes. The real analyzer is the Python
pipeline in `video-service/` (formation, tracker, route reader), run on a Mac for now, which writes a
`game.json`; the landing page's **`#upload`** section is an **Upload a game** button (`/film`, below), a button to open a
game file (`parseScriptFile`) and the 5-play demo. The hosted **Gemini film uploader is gone** (the
single-clip card, the one-click game zip import and `/api/parse-video`, `/api/parse-video-batch`,
removed on the staff's call): film no longer goes to Gemini to draw cards. Still in the repo, on
purpose: the CSV parser and everything built on it (review mode's tags, practice playsheets), the secondary read
from a pre-snap clip (`/api/read-secondary`, `/api/blob-upload`), and the libraries the tracker's
output goes through (`videoImport.ts`, `coordinateMapper.ts`, `batchMatcher.ts`). The landing page copy tells the film-first story (see "Landing page").

**Parked idea: measure the Secondary from a pre-snap frame, no GPU and no server.** Instead of
Gemini guessing safety depth by eye, the coach pauses the clip on the pre-snap frame, clicks 4 yard-line /
hash intersections once (a 4-point homography is a few dozen lines of math, no OpenCV needed), then taps each
corner and safety; the app converts the taps to yards for the existing Secondary table
(`SecondaryDialog.tsx`), set once per formation. Runs entirely in the browser, so the film never leaves the
device. A light in-browser detector (ONNX Runtime Web; check the model license, since Ultralytics YOLO is
AGPL) could later pre-fill the taps. Not started; the staff said to hold off. Whole-play tracking
(`video-service/`, OpenCV + `supervision` / `trackers`) stays parked: it needs a GPU host and per-frame
camera-pan compensation.

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

**Formation check against Hudl Assist (`video-service/eval/`, runs on a Mac).** The goal is to beat
Hudl Assist's tags, which a coach re-checks every Sunday, so the first thing built is a score sheet:
`python -m eval.score --hudl hudl.csv --corrected corrected.csv --ours ours.csv` (the app's Review
mode **Scorecard** downloads that pair) compares Hudl's formation
tags and ours against the coach's corrected sheet, through the app's own vocabulary (`eval/vocab.py`, a
port of `classifyFormation`; `test_eval.py` fails if the two drift). Ours comes from `eval/presnap.py`:
one pre-snap frame per clip (picked, with four yard-line / hash clicks and the ball, by `eval/calibrate.py`),
people found by RT-DETRv2 (tiled, since players are small in a wide shot), put on the field in yards through
`geometry.py`'s homography, split into offense and defense by jersey color (`eval/teams.py`: the group
lined up behind the other is the offense), then named by plain rules in `eval/formation.py` (thresholds at
the top, so a wrong answer can be traced). `devices.py` picks cuda, then the Mac's `mps`, then cpu, and
`main.py` uses it. `test_presnap.py` runs it end to end on a drawn field with a stand-in detector;
the detector itself hasn't been run on real film yet. Clips (minors) stay on the machine:
`video-service/clips/` and `debug/` are gitignored. Setup and commands: `video-service/eval/README.md`.

**Route reader (`src/lib/routeReader.ts`): the scout-offense priority.** Hudl Assist can't read routes,
so the core is a path-in-yards → route-tree label step that doesn't depend on where the path came from
(a tracker on film, an AI read, a coach's drawn arrow). `readRoute(track, outside)` puts the path on his
own spot with his sideline as +x, then compares it to every route shape the app itself draws
(`formations.ts`'s `routeTemplateYards`, the same shapes the cards use) over the same stretch of path:
the shape is carried straight on past its end (the run after the catch), allowed 0.8-1.25x depth and width,
scored by the average gap plus the worst gap (so a go isn't taken for a comeback) with a small
benefit of the doubt for the simpler route (`SIMPLICITY`). It answers `block` for a player who stays at
his spot, `unknown` when nothing fits, else the route with a `confidence` (the margin over the runner-up) and
the full ranking, so only unsure plays need a coach. Tested on simulated played routes (jittered stems and
breaks, rounded corners, tracker noise, run-on past the catch): about 91% right on the route tree and 92% off
it; GO and FADE are **the same route to this staff**: the reader tries both shapes (a straight go and a drifting fade) and reports
the better as `fade` (the tree's 9), the scorer keys a call's GO as fade, and `READABLE_ROUTES` has no `go`; a path seen only part way (11 yards of a deep
route) is the real ambiguity, and shows as low confidence. **Tolerant of sloppy routes** (a receiver who runs a stem short or long, releases off the ball
differently, or breaks a few yards off): the path is lined up with each shape *after the release* (`RELEASE_YARDS` 2, a small
`RELEASE_COST` for how far apart they began), the depth and width scale over 0.7-1.4x with a `STRETCH_COST` so a route that fits as
drawn beats one that needs stretching, and it always names the closest route (`UNKNOWN_DISTANCE` 6.5 mean yards: past that it is not a
route at all), with a low `confidence` flagging it for a coach; a path under `MIN_ROUTE_YARDS` (4) still reads unknown. Simulated
sloppy routes (scaled 0.72-1.3, vertices 1+ yard off, a sideways release): about 67% right with no "unknown" (66% before, with 49 unknown
of 2850); mild variation 89% as before; the real confusions are the ones a person has: fade vs go, speed out vs out vs slide, leak
vs shallow. **Not yet run on real film.** The tracker that produces the paths is
`video-service/eval/tracks.py`: each frame is matched to the one before on the background (ORB features with
the people masked out, RANSAC homography, falling back to a pan-and-zoom similarity, holding the camera when
nothing matches), the matrices are chained back to the snap frame so every frame lands on the calibrated
snap frame (`camera_to_snap`), people are put on the field in yards in the offense's own view (`to_yards`)
and paired frame to frame by nearest-to-predicted (`follow`, 1.6 yd a frame, survives missed frames). It
writes `tracks/<clip>.json` and `scripts/read-routes.ts` (run with `npx jiti`) names each offensive
player's route with `readRoute`. `test_tracks.py` runs the whole chain on a drawn clip with a panning,
zooming camera (median error about 0.15 yd, routes named right, and a control with the camera motion ignored
that fails as it should); real grass has less texture, motion blur and rolling shutter, so expect to tune on
real clips. **Tracks → cards** (`src/lib/trackedPlay.ts`, `scripts/tracks-to-cards.ts`; guards against the tracker's mistakes: `dropSameMan` keeps one track where two ids start on the same spot, `trimAtJump` cuts a track at a move faster than 14 yd/s, where it was handed to another man, a path under 5 yards is `unknown` not a guessed route, and the QB is the man directly behind the center, found against the line's own depth so a center a yard off the ball isn't taken for him; a man on the line who ran 7+ yards was a receiver): `detectionFromTracks` turns a
tracks file into the same `DetectedPlay` (in yards) the film AI makes: linemen (on the line, inside the box)
are dropped, the man nearest the ball behind the center is `Q` with no route, and every other offensive
player gets `readRoute`'s name as his `routeType`, so `applyDetectionToCard` / `buildCardFromDetection` draw
it exactly like a film card (`matchDetectedLetters` puts each man on the letter nearest where he stood, the
spots are kept in `offenseSpots`, arrows are draggable, `source: "video"`). A read that is `unknown` or under
`SURE_CONFIDENCE` (0.25 margin) is **marked on the card's notes** ("Check routes: H (curl or hitch)") instead
of drawn confidently wrong. `npx jiti scripts/tracks-to-cards.ts tracks/ --sheet hudl.csv --out game.json` runs a whole
game: files are lined up with the sheet's rows by `planBatch` (the number in the file name), the sheet stays
ground truth for down / formation / call, and the script lists the plays to check. Without a sheet each play
is its own card, its formation from `--formations ours.csv` (`eval.presnap`). `game.json` is a normal stored
script: the landing page's upload box opens it (`allowGameFile`, `parseScriptFile`). **Not run on real film
yet**.

**No-click calibration (`video-service/eval/field.py`, `autocalib.py`, `game.py`).** `eval.calibrate`'s four
clicks per clip are replaced by `python -m eval.autocalib clips/` (it writes the same `<clip>.json`, plus an
`auto` block and `debug/<clip>_auto.jpg`: the yard lines it believes in drawn back over the frame). Snap:
`find_snap`, the frame before the biggest sustained jump in frame-to-frame motion. Field: `calibrate_field`
finds the white paint (brighter than local grass, unsaturated, inside the grass hull), splits the segments
into the yard-line fan and the rows by vanishing-point consensus (so it doesn't care which way up the camera
is or how wide the fan opens), numbers the lines in 5-yard steps by fitting a 1D projective ruler (a lost
line costs a penalty), finds the sidelines / hash rows (long lines, or RANSAC through tick blobs), tries every
assignment of rows to the four NFHS positions (0, 17.78, 35.55, 53.33), keeps the best least-squares
homography whose determinant keeps handedness, and refuses (returns a `FieldFailure` with a reason) when it
has under three rows, a fit over 0.8 yd off, or two row assignments that fit nearly equally. The yard
number is never known and isn't needed: the field frame is a rotated copy of the real one, and
everything downstream is yards from the ball in the offense's view. Ball and direction: `locate_scene` splits
people by jersey color, puts the line of scrimmage where the two groups meet, calls the group that stays
close to it the offense (linemen and a couple of backs; the defense is spread deeper), sets the direction
so the offense is behind the ball, and the ball's across-the-field spot is the middle of the offensive
line. A clip it can't do is listed with the reason and left for `eval.calibrate`; a hand `.json` is never
overwritten. `python -m eval.game clips/ --sheet hudl.csv --out game.json` runs the lot (autocalib →
presnap → tracks → `scripts/tracks-to-cards.ts`) and lists the clips that need a hand. Tested end to end on
drawn fields from two camera angles and both offense directions (`test_field.py`, `test_autocalib.py`,
`synthfield.py`); **not run on real footage**, where glare, worn paint, cropped sidelines, a zoomed
camera and invisible hash ticks are the likely failures (they show as `needs a hand`, not a wrong answer).
`test_tracks.py` needs OpenCV 5 (the Mac install); it fails under OpenCV 4.10.
**First real footage (four screen recordings of Hudl's player, from behind the bench, 1470 x 956):** the
auto-calibration did **not** work on them yet (0 of 4 trustworthy), which is what the first real clips are for.
What the footage showed: (1) the recordings carry Hudl's chrome (the tag bar on top, controls along the bottom),
so `python -m eval.prep recordings/ --out clips/ --top 84 --bottom 56` crops it off first (the tag bar is also
the answer key for each play); (2) white jerseys, the bench and the crowd are as bright as paint, so
`paint_mask` now only keeps bright pixels that sit in a field of grass (this took the mask from mostly people to
mostly lines); (3) the camera is low and oblique, only a few worn yard lines show, and the camera zooms and
pans between plays, so a clip often has too few lines for the ruler; (4) four evenly spaced lines (sideline,
hash, hash, sideline) are indistinguishable from four yard lines, so `field_candidates` returns every reading
(both ways round, outliers dropped) and the pick has to come from something the paint can't say (planned: the
men on the line stand about a yard apart). **First real read (play 5, a Hudl-tagged DUCES, from a hand calibration):** the detector (RT-DETRv2 on the Mac's
GPU) finds nearly everyone, and what broke were the rules around it. Lessons now in the code: (a) the
dash row on that field was the *near* hash, not the far one (checked by predicting the 1-yard tick spacing and
the other yard lines); (b) jersey color can't split the teams (white jerseys in shade read as dark as navy), so
`teams.split_teams` splits by which side of the line of scrimmage a man stands, the line being the widest gap
between two lines of at least three men (`line_boundary`), with color only as a fallback; (c) the film is the
*opponent's* offense, so the direction isn't "the home team's"; (d) referees are found by their stripes
(`eval/officials.py`, thresholds tuned on two referees, so expect to retune) and dropped from both teams, also in
`tracks.team_by_jersey` ("official"); (e) the bench and sideline are dropped by `EDGE_YARDS` (3 yd from a
sideline) and by box height: a box much shorter than a standing man at that spot (`SHORT_BOX_RATIO`) is someone
hidden behind the people in front of him, and his feet are taken from his head instead (`feet_on_field`); (f) one
man seen twice counts once (`drop_duplicates`); (g) the formation line says when it was made from other than 11
men. **The staff's own formation names** (`formation.py`'s `staff_name`, printed and written as `STAFF FORM`, e.g.
"deuces gun", "trio gun left"): DUCES 2x2 with one back; TRIO (SLOT TRIPS is the same formation) three receivers to one side; EMPTY five receivers and no back (also reached by motion out of Trio or Deuces);
ACES three wide receivers, a tight end and one back (ACES OFF with the tight end off the line); PRO under center,
two backs one behind the other, a tight end and a receiver each side; TWINS the same people with both receivers on
one side; BUNCH three receivers within three yards, one on the line and two off it. The line is found as a row
(`find_line`) and everything is measured from it, so a ball spot a yard off doesn't matter. "gun" means shotgun and is only said when the QB is in it (under center is the default and
unwritten). Hudl's BACKFIELD code GNF isn't mapped yet. Helmet color was measured and does not separate teams at this camera distance. **First real tracks (plays 5 and 6, 5 s each):** the camera pans about 430 px in five seconds, and the first tracker
(frame-to-frame ORB matching, a radius that grew the longer a man was missed) both drifted (the QB and a back slid ~7 yd
sideways) and jumped (a receiver on the right grabbed a bench player 30 yd away and a third of the "followed" men were
the sideline). Now: the camera is held against the field's painted lines directly, every frame registered to the snap frame
(`camera_to_snap_paint`, ECC homography, then `smooth_cameras` over ~3 frames, since each frame's error is independent;
measured on the real clips it beats the ORB chain, 0.60 vs 0.33 paint correlation at 5 s on play 5), detections are filtered
exactly like the formation read (`people_on_the_field`: officials, the edge margin, short boxes whose feet are hidden, duplicates),
the radius a missed man may jump is capped (`MISSED_GROWTH_CAP`) and a track remembers his jersey color so two men who cross
keep their own tracks (`COLOR_YARDS_PER_UNIT`). Shared geometry lives in `eval/people.py`. **From the snap, not from the calibrated frame** (`trackedPlay.ts`'s `snapTime` / `fromTheSnap`): a calibrated frame can be
seconds before the ball moves (play 6's was 3 s early), so the snap is found as the time the fourth offensive man moves
more than 1.5 yd (a man or two in motion don't count), minus 0.35 s, and every route is read from there. Run the tracker with
`--seconds 8` so there is a full play after it. **First route read on real film:** play 5's left slot receiver reads as a HITCH
(Hudl's tag: HITCH, pass left), at low confidence so it is flagged; the other receivers' tracks were lost mid-play (the detector
misses blurred men; `MAX_MISSED` is now 20 frames and `--tiles 2` finds more); play 6's three receivers on the run side read as
blockers and the back's path runs right, as READ POWER right should. The model weights (Hugging Face) can't be reached from the cloud
sandbox, so the detector, the tracker and the route reader have still only run on drawn clips. The answer key for routes is free: the coach's corrected play call, expanded by `buildDiagram`
into a route per letter, against the same call as Assist tagged it.

**Seeing the tracker's mistakes (`video-service/eval/trackdebug.py`).** Tracking on real film still hands a
receiver's track to another man after the snap, and the numbers alone don't say to whom. `python -m eval.tracks
clips/ --out tracks --seconds 8 --tiles 2 --debug debug/` also writes, per clip, a picture each second
(`debug/<clip>_trk_<n>s.jpg`) and a contact sheet (`<clip>_trk_sheet.jpg`): every kept person in his track's own color
and number (thick = offense, thin = defense, dashed grey = nobody follows him), 1.5 s of trail behind each, and a red
ring where a track moved faster than 14 yd/s (a hand-off to another man). The printed report lists those and any offensive
track lost early. Send the sheet with the report to see whether the swaps are to defenders, the bench or a pile-up, and fix
that cause. Trails are drawn with the camera's own motion taken out (`to_snap`), so a trail is where he went on the field.
**First real pictures (plays 5 and 6):** the boxes land on the right men and the formation read is right, but (1) tracks slid
along the near sideline from one standing bench player to the next (the bench's heads, cut off by the men in front, look like
short boxes that land on the field, and a loose matching radius let a lost track grab the nearest of them), and in play 6 a
receiver's track ended on a referee by the bench; (2) the near-sideline receiver's whole fade, and the far-sideline
receiver's, were followed cleanly, so routes can be read when the tracker holds; (3) the Hudl recording freezes on its last
frame, so the clip's tail is a still picture. Now: a short box counts only 8 yd inside a sideline (`SHORT_EDGE_YARDS`), a
track may only be `MAX_STEP_YARDS` (0.8) plus `MISSED_GROWTH_YARDS` (0.2) a missed frame, up to `MAX_RADIUS_YARDS` (6), from where
its velocity puts him (`Track.predicted(ahead)`, speed read over the last 6 matches and capped at 0.45 yd a frame, a man is dropped after
`MAX_MISSED` = 45 frames), the frozen tail is cut (`unfrozen`), and `trackedPlay.ts` cuts a track only at a move over 24 yd/s
(a real sprint reads ~15 over a short window; sliding onto the bench reads 60+). **Second real run:** a half-yard step with a two-frame velocity was too strict (the detector's boxes jitter a yard on a far player and
blur drops fast men for half a second), so real receivers were lost within a second (the fade receiver kept 9 frames of ~150). Replaying the
first run's real detections (gaps and all) with standing distractors, the settings above keep ~60% of real frames on play 5 and ~75% on
play 6, against 5% and 44% for the strict rule, and steal none; the replay only holds detections the first tracker matched, so it can't
prove bench hops are gone. **Third run:** the far-sideline receivers are now followed with real paths and the first-second losses are gone, but (a) long lines still ran along the bench row at 2-4 s (bench men half hidden by the row in front have boxes 0.5-0.8 of a standing man's height: too tall for the short-box rule, and their box bottom is a waist, not a foot), and (b) a lost receiver's track was handed to the midfield referee (at 2, 3 and 5 s). Now within `SIDELINE_ZONE_YARDS` (10) of a sideline a box has to be at least `FULL_BOX_RATIO` (0.8) of a standing man's height to count (`feet_locator(...).height_ratio`). The referee hand-offs are not fixed yet (the stripe test misses a blurred referee in some frames; a per-track vote or a color gate on matching are the options). Pile-ups (play 6, 4-6 s) are tangles no tracker holds. **Fourth run (sideline rule, gap cut):** no impossible jumps, most offensive tracks followed 4-8 s, bench lines mostly gone, but the receivers still read wrong against the coach's call for play 5 (fade, speed out, hitch, fade; read curl, unclear, flat, out), and **the detector is the limit**: the outside-left receiver was found in 43 of ~160 frames, so no tracker or route reader can recover him. A route-hypothesis test (try every tree route at plausible speeds against the pool of detections) scored the wrong routes because the pool lacks the receivers. The detector in use is the smallest (`rtdetr_v2_r18vd`); `MODEL_CHECKPOINT` and `DETECT_CONFIDENCE` (default 0.4) change it, `--tiles 3` looks at more pieces, and the `--debug` report prints each offensive man's found-in-% of frames. Tracks also hide hand-offs in gaps (a man missed 0.7 s and re-matched 7-9 yd away), now cut by `trimAtJump` (1.5 yd plus 9 yd/s across a gap). **Fifth run (r50vd, 3 tiles):** found-in % jumped (most offensive men 54-99%; the far-side men 6-29%). The full-size pictures showed the remaining receiver-route failure directly: a lost track was re-matched to a navy-jersey defender (box 9 held a man in a navy "50" at 2 s), because re-acquisition only checked distance. Now `COLOR_GATE` (40 Lab units) refuses a re-acquisition after a gap whose jersey is that far from the track's remembered color (white offense vs navy defense is ~50; shade is ~20; never applied to a track followed frame to frame). The freeze test was also too strict for a compressed frozen picture (`FROZEN_FRAME_DIFF` 0.4, and only a stillness lasting to the end of the clip is cut). Referees are still tracked as defenders. **Not yet re-run with the color gate.** **Sixth run (raw dump, replayed offline):** the dump now holds every raw detector box, jersey color, referee flag and the camera, and `python -m eval.replay <file>` re-runs the filters and tracker without the film. Replaying it showed the *sideline height rule was dropping the fade receiver*: only 6 of 22 points on his sprint (known from the first run) had a detection with the 0.8 rule, 17 of 22 with it off, because a blurred, leaning sprinter's box is not a whole man. Now a near-sideline box between `WEAK_BOX_RATIO` (0.4) and `FULL_BOX_RATIO` (0.8) is kept only if it **moves** (`drop_standing_weak`: the nearest person 6 frames earlier or later is at least `MOVING_YARDS` away), because the bench stands still: 16 of 22 fade points recovered with no more standing wide men than before (15 on play 5, 37 on play 6). The moving test looks 6, 12 and 18 frames either side (`MOVING_OFFSETS`), because the outside-left fade man barely moves in the first 0.2 s and was dropped at the snap frame, where tracks start; with that he is seeded and followed cleanly to 21 yards, and the reader calls him a comeback at 0.50 with fade next (the tail after his catch drifts back 3 yards). Starting new tracks later for anyone unmatched was tried and removed: it added ~40 tracks of crowd, bench and referees. **Seventh run (r50vd, 3 tiles, 61 / 44 people followed):** both outside receivers now have real paths. The outside-right man's clean fade (to 22 yards, drifting 15 out) was being thrown away by `dropSameMan`, which kept the *longer* of two ids that start within 2 yards, and the longer one was a track that had slid 12 yards along the line after a bystander; it now keeps the one that got furthest upfield. Reads on play 5: outside left GO 0.04 with fade next (GO vs FADE is the known ambiguity), outside right WHEEL 0.15 with corner next (it drifts a long way out), left slot SPEED OUT 0.09 (key: hitch; that track ends where another man's does, so it was probably handed over), right slot not found (its track lasts 0.7 s). **Eighth run (Colab T4, r101vd, 4 tiles):** no better (key route the runner-up on three of four), and about 10 minutes a clip. The contact sheet showed why: on play 3 the camera **zooms out 1.6x** in the first three seconds (`to_snap`'s scale), and measured from the dump the people found fell from 94 a frame at the snap's zoom to 61 at 1.5x and up, while play 4 (zoom under 1.16) held at ~90. So `--region` (`eval/regiondetect.py`): the camera is held first, then the detector runs only on the field the tracker keeps people from, in rows of square windows sized so the farthest man in each row is `TARGET_MAN_PX` (90) tall in the model's 640 input, shrinking as the camera zooms out (`MIN_SIDE` 256), batched (`Detector.people_in_windows`); about 10-13 windows a frame against 17 for 4 tiles. Every run prints a `time:` line (read, camera, detect, track); `python -m eval.compare` puts two dumps side by side by zoom band. **Ninth run (Colab T4, r50vd, tiles 3 vs `--region`, plays 3 and 4), measured:** time per clip, tiles: read ~2 s, camera 55-64 s, detect 141-188 s, track 5-10 s; region: camera 52-75 s, detect 54-67 s (3.5 windows a frame, so 2.6-2.8x faster), track 3-4 s; camera alignment (`camera_to_snap_paint`, CPU) is now the biggest step. **The tiles were making ghosts**: 11-12 of the ~29 people a frame the tracker kept were half-boxes cut at a tile's edge (box bottom exactly on the cut line, so the feet, and the spot on the field, were wrong); `presnap.cut_by_tile` now drops a box touching a tile's inside edge (the tiles overlap, so the man is whole in the next one). Counting whole people only, region found 19 a frame against 17. Route reads on play 3 were still wrong both ways: the outside receivers run stride for stride with the corners covering them and are found intermittently, and a one-frame box jitter gave a track a false 0.8 yd/frame speed that it projected through a gap onto another man; `Track.predicted` now holds a man still until `VELOCITY_MIN_POINTS` (4) matches and projects at most `MAX_AHEAD_FRAMES` (10). A whole-clip best-path linker (Viterbi per receiver, jersey color, speed limit) was tried offline and was pulled onto a man standing near the line; not adopted. The notebook now runs `--region` only. **The scorer (`src/lib/routeScore.ts`, `scripts/score-routes.ts`):** the goal is 90%+ of routes right (Hudl Assist reads none), so every change is measured with `npx jiti scripts/score-routes.ts tracks/ --key corrected.csv`: each clip is lined up with its row (`planBatch`), the row's call is drawn by `buildDiagram` into a route per letter as the key (`keyRoutes`: a receiver with no route, a stalk or a protect, is keyed `block`; the ball carrier and a route drawn by shape alone, a mesh drag, are left out), and the reads `cardFromTracks` matched to each letter are scored (`scorePlay`, `summarize`): routes right (GO and FADE are one route), how many it committed to (not unknown, confidence at least `SURE_CONFIDENCE`) and how many of those were right, blocks, per-route tallies and the most common mistakes. Baseline on the two test recordings (plays 3 and 4): **0 of 4 routes, 0 of 5 blocks**, with tiles and with `--region`. The real test needs press-box film with a corrected breakdown, 50-100 plays. **Scout D from film (`src/lib/defenseRead.ts`):** the defense's picture at the snap, from the tracks file (every defender's spot at `snapTime`, the nearest point within 0.4 s; eleven at most, people out past the widest receiver dropped first): each man is a down lineman (within 2 yd of the line, 7 of the ball), a safety (8+ deep), a corner (per side, nearest the widest receiver, outside the box), a nickel (`nb`: walked out over a slot, more than 6 yd from the ball, counted with the DBs) or a box backer. That gives the staff's name for the front (`label`: "4-2-5", "3-3-5", "Bear" when five or more are down with the center and both guards covered), a `FrontKey` (3 down 3-4, 4 down 4-3, 5 down 5-2), the safety shell (`1-high` / `2-high`, 10+ deep) and `plausible` (3-6 down, 1-4 backers, 4-6 DBs). `applyDefenseRead` writes the film's front on a card whose sheet left it blank (the coach's tag wins) and moves every card defender to where his man stood (`defenseOverridesFor`: nearest card id of the same kind, a down lineman only ever on a line id, coordinates like a coach's drag), with "Film D: 4-2-5, 2-high." in the notes; a read that isn't plausible changes nothing but a "Check D" note. **Per formation:** `dbSpots` reads each play's corners and safeties as Secondary-table spots (depth, over #1-#3 / the ball / the hash, shade, side; strong = the side with more receivers) and `secondaryFromFilm` rolls them up by the offense's formation into `dbAlignments` with `source: "film"` (a table the coach set keeps the coach's), so the practice playsheet's Scout D rep cards line up the way this defense did against that formation; `frontsByFormation` prints the front and shell it showed against each. `scripts/tracks-to-cards.ts` does all of it and writes the tables into `game.json`; `scripts/score-routes.ts` also scores fronts against the key's DEF FRONT (by `FrontKey`). On the two test recordings the read is not plausible ("3-1-7", "1-1-8": from the low sideline camera the defensive line hides behind the offense's and sideline people creep in), so both are marked Check D; press-box film is the real test. **Run plays from film (`src/lib/runRead.ts`):** `readRun` says run or pass, the carrier, the direction and the scheme from the tracks, by plain rules (thresholds at the top): roles from each man's stance (his track's start, before the snap: the five linemen nearest the ball on the line's row, the backfield, the receivers) and every movement measured from the snap (`snapTime`, else the first man to move a yard, less 0.35 s, since a run can have too few fast movers for `snapTime`); the line's average step in the first 0.8 s (forward = run, back 0.4+ = pass set) and receivers 7+ yards deep by 2.5 s say pass; the carrier is the first from the backfield (or a receiver who came across behind the line: jet) over the line within 4 s, and where he crosses is the direction; a lineman 2+ yards along the line in the first second without getting upfield is pulling: one toward the play power, two counter; a back 7+ wide within 1.3 s toss; else draw (line showed pass), outside zone (crossed 4.5+ wide), zone (the line stepped one way together) or iso; a quarterback straight ahead from under center is a sneak. Drawn tests cover each. On the two real recordings (region tracks) it reads play 5 as a pass and play 6 as **POWER right** (the key: READ POWER right), the first film read to match the key; the tile tracks called play 6 a counter (their ghost boxes looked like a third puller). A film card with no call takes `runCall` ("POWER RT", Run, the direction) and drops the receivers' film routes (`applyRunRead`); a sheet's call stays. `score-routes` scores run or pass, scheme and direction, and on a play the film reads as a run the receivers count as blocking (3 of 4 on play 6; the fourth wasn't tracked). **One run for a game:** `python -m eval.game clips/ --sheet hudl.csv --key corrected.csv --out game.json --detections` (now `--region`, 8 s, 3 tiles for the old path, the detections saved, the score printed); `eval/colab_game.ipynb` runs it on Colab from a zip of the whole project (Node installs there for the cards and the score). **Faster camera:** `camera_to_snap_paint` lines the paint up at a quarter of the frame's size (`PAINT_PYRAMID` 1, `PAINT_ITERATIONS` 40): 3.6x faster on the drawn clip (1.4 s against 4.9 s) for 0.6 px more error; a half-size refinement cost as much as not shrinking. Route words now read right to left like numbers (`FADE SPEED OUT HITCH FADE` in Deuces: right outside fade, right slot speed out, left slot hitch, left outside fade). The route reader
is unchanged: on the clean sprint it still reads wheel (fade next) at low confidence, and smoothing the jittery 30 fps path
before reading changed the answer in odd ways (it made a straight sprint read as a comeback because of the frozen tail),
so it was left alone until there are more real tracks to tune on.

**Blitz from film (`src/lib/pressureRead.ts`):** `readPressure` counts who rushed in the first 1.5 s after `snapTime`
(a down lineman who stayed at the line rushed, one who ran 4+ yards back dropped into coverage; a backer, nickel or DB who
reached the line blitzed) and where each blitzer crossed the line (4.5+ yards from the ball is off the edge: an outside
backer's FIRE, either side; inside it, LB), and writes the staff's tag (`pressureTag`:
"6 - DOUBLE FIRE", "5 - FIRE", "5 - LB"; a straight four-man rush is none). Sure only when the defense at the snap adds up;
`applyPressureRead` writes it in a blank COVERAGE (the coach's tag wins) before the coverage read, and notes it either way.
`score-routes` scores the call and the rush count against a key whose COVERAGE is a blitz. Tested on drawn plays
(`pressure.test.ts`); unsure on the two real recordings.

**Coverage from film (`src/lib/coverageRead.ts`):** the pre-snap shell only narrows it (2-high is Cover 2, 4, 6 or Tampa 2;
1-high Cover 1 or 3), so `readCoverage` reads what the corners, safeties and backers *do* in the first `READ_SECONDS` (2) after
`snapTime`, by plain rules with thresholds at the top: (1) **man or zone** by votes, one per coverage defender a route that broke
across the field (3.5+ yards) came near: he `mirrors` the receiver when, from the second half of the read on (an off-man corner
closes his cushion first), his steps match the receiver's step for step and he's on him; a zone defender lets the route run
through (a vertical gives no vote, since a Cover 3 corner bailing with a go runs with him just like a man corner); rushers (ending
at the line) don't vote; 60%+ man is man. (2) **How many deep** at the end (11+ yards, not counting a man defender running with
his receiver): man gives Cover 0 / Cover 1 / 2 Man; zone gives Cover 2 (two deep, corners in the flats), Tampa 2 (the middle backer
ran the deep middle), Cover 3 (three deep; unsure when two of them are on one side, since there is no Cover 6 in this staff's
calls), Cover 4 (four).
(3) **The details:** who took each flat (`cloud` corner, `sky` safety or nickel, `buzz` backer), Cover 4 **match** (a safety
carried a vertical #2) or spot drop, and whether the defense rotated out of its pre-snap shell. The label is the COVERAGE column's
own words ("COVER 3 SKY", "COVER 4 MATCH", "2 MAN", "TAMPA 2"), so `coverageStyleFor` and the card footer use it as is. A read has
`evidence` lines and a `confidence`; it is never sure with no breaking route near a defender, a split vote, the defense at the snap
not adding up (`readDefense` not plausible) or five deep. `applyCoverageRead` writes a sure read only where the sheet left COVERAGE
blank (the coach's tag wins) and notes either way ("Film coverage: COVER 1." / "Check coverage: film says …, unsure.");
`tracks-to-cards` applies it and `score-routes` scores it against the key's COVERAGE by family (`coverageFamilyOf`: "C3", "Cover 3
Sky", "Quarters", "Tampa"; a number the staff doesn't use as a coverage, like the "6" in "6 - DOUBLE FIRE", names none). Tested on drawn plays (Duces against a 4-2-5, a tracker's jitter and a tenth of
the points missing): Cover 0, 1, 2 Man, 2, Tampa 2, 3 sky out of a two-high rotation, 3 cloud, 4 match and 4 spot drop all
read right across 12 noise patterns; three deep with two on one side reads Cover 3, unsure; four verticals with no break is unsure. On the two real recordings every read is unsure (the
defense at the snap reads "3-1-7" / "1-1-8"), so nothing is written: the real test is press-box film with the coverage tagged.

**Tenth pass (offline, on the real dumps and recordings, plays 5 and 6):** measured against the truth for the first time.
Receiver positions on play 5 were marked by hand from the film (`video-service/eval/truth/play_05.json`, scored by
`python -m eval.truth tracks/play_05.json eval/truth/play_05.json`): the first tracker had **5 of 13** marks on the right
man's track. What the film showed: the detector *does* find most receivers in most frames (the region run kept their boxes
with a clear jersey read); the losses were (a) a receiver's track handed to the defender covering him or to a referee, frame
to frame, where the color gate never applies, (b) men the detector missed on the snap frame never followed at all, and (c) the
far-side fade receiver, a blurred sprinter in front of his own white bench, not found by RT-DETR from 1.3 s on (YOLOX on a
2x window finds him at 0.26-0.50, so a lower threshold or another detector is the lever there). New: **`eval/tracklets.py`**
(`--tracker tracklets`, or `TRACKER=tracklets` for the worker; the default is still `greedy`): teams by a per-play jersey
signature (`jersey_signature`, learned from the snap frame, so any two uniforms; real film: offense +0.3 to +0.8, defense
-0.1 to -0.6), short clean tracklets that never take the other team's jersey, then stitching each man seen at the snap (or in
the half second after) to the piece he could have run to. Play 5: **8 of 13** marks; play 6: all four receivers followed
(three before). Route names did *not* improve on these two plays (the far slot is still lost in his first half second beside
the outside receiver, and the near fade drifting 2 yards out reads as a corner), and play 6's scheme reads outside zone
instead of power, so it stays a choice until more film is scored. Two downstream bugs found on the way and fixed for every
tracker: **letters were swapped** (`matchDetectedLetters` matched each man to the nearest card spot on a ball-in-the-middle
card; real splits differ, the wide side's receivers stood 16 and 18 yards out against the card's 18 and 30, so the slot took
the outside man's letter; it now uses the card's own hash and keeps the order outside in per side, `alignInOrder`, backs by
nearness), and **the run after the catch was read as the route** (a hitch run 6 yards upfield and out read as an OUT; reads
now stop `ROUTE_SECONDS` (3) after the snap, a ceiling rather than the catch, which the tracks don't show). With those, the
first tracker's play 5 reads the hitch right: **1 of 4** routes (was 0), play 6 run / power / right still right. Dumps now
carry each raw box's `jersey` signature, so `python -m eval.replay <dump> tracklets` replays the new tracker without the film.

**Eleventh pass (three whole-play recordings, red Knights on offense, plays 8 / 34 / 43; the first with a clear sideline view of the
paint).** These recordings are *whole plays*: 8-10 s of pre-snap, then the snap, then the camera zooms out 1.5-2.7x and follows the play. So
(1) `autocalib.find_snap` picked the wrong frame on all three (it takes the biggest motion jump: here the camera zoom or the recording's
end screen; the real snap is where the line moves, ~frame 240-300), and the auto field fit gave a different row assignment on different
frames (three hash / sideline rows 17.78 yd apart look alike) and then failed to split the teams (the red bench counted as red players), so all three
were calibrated by hand (`scratchpad` helpers: field fit with hand-given row pixels, far sideline = 0, the bench-side hash row = 35.55, then moved to the
frame just before the snap through the paint registration). Start a clip a second or two before the snap, not at the start of a recording.
(2) The camera registration (`camera_to_snap_paint`) holds through the zoom: the standing bench, as anchors, stayed within 0.1-0.8 yd for the whole play.
(3) What failed was the people near the sidelines: tracks slid onto the bench / coaches / officials, and the bench read as offensive players in the
formation. Now `people.sideline_crowd` (a person within 4.5 yd of a sideline with 4+ others within 3.5 yd is the crowd; used by the tracker's per-frame filter and
`presnap.read_clip`), `tracks.drop_standing_sideline` (within 7 yd of a sideline and standing the whole play), `tracks.trim_at_sideline` (a track is cut where it runs
into the 4 yd beside a sideline from further in); with the tracklet tracker, run or pass on the three plays went from 1 of 3 to 3 of 3. **Routes: 0 of 8 scoreable** against the call's
key (two of the plays are MESH, whose key is the concept's template, and the actual routes of a mesh are not the template; 34's SLANT SLANT OUT is the fair test and
it read bubble / flat / hitch at low confidence with the near-side receivers, 2-5 yd from the near sideline in front of the bench, only partly tracked).
**Formation:** the film's own read needs the offense found; the linemen locked into the defense come out as one blob (7 of 11 men on play 8, 8-9 on 34 with the
bench removed), so `formation._classify` takes a standard line on the ball when no row of three is found and all six skill men are (`ASSUMED_SKILL`), else says unknown, and
the notes say so. On these three: 34 reads Trips right (the staff's name read "aces", the sheet says Trio), 8 and 43 are unknown unless the sheet gives the formation.
**Blitz:** `pressureRead` no longer counts a man already at the line at the snap (a pressed corner was called "4 - BLITZ" on play 8) and a corner or safety rushing from
under 4 yd is a tracking slip, not a call.

**Twelfth pass (the same three recordings, with the coach's own route truth; plays 8, 34, 43).** Two of the three plays (8 and 43) were a **Bunch with a
man zapped across (pre-snap motion) into Deuces gun**, which is what the Hudl tag (DUCES) calls them: the tag is the formation the ball was snapped from. So a
clip has to start *before* the motion (a second or two into the set; the earlier runs started 0.4 s before the snap, where the motion was already over).
Now: `eval.tracks.formation_reads` (written into the tracks file as `formations: {set, snap, snapSeconds}`) names the offense's formation twice from its tracks, as the clip first
shows it and at the snap; `trackedPlay.ts`'s `cardFromTracks` uses the snap formation when the film is the only source, and adds "Motion: set in Bunch Gun,
snapped from Deuces Gun." to the notes when they differ (the sheet's formation still wins). **Real result:** the set reads **Bunch gun** on both plays ✓; the
snap formation does not read Deuces yet (8 reads Double Eagle, 43 Trips with 8 men): the linemen locked in the pile are mostly missing and a defender or two is
labeled offense, so a wide-vs-attached count is wrong (`formation._classify` assumes a standard line when fewer than three linemen are found and six skill men are,
else says unknown). **Snap time:** the old rule (the fourth man to move 1.5 yd) fired 0.85 s early on play 8 because the formation was still shifting; `snapTime` now also
reads an **onset** (three men who were standing all start within half a second: `onsetSnap`) and uses it when it is more than 0.3 s later than the old rule (a clean play has
both within a tenth of a second, which keeps the drawn-play tests' windows unchanged); play 8's snap is now 3.67 s into the clip, which matches the film.
**Scoring against what the coach says each man ran** (`scripts/score-truth.ts tracks/ --sheet hudl.csv --truth truth.json`, `{play: {letter: "post|dig"}}`): the call's template
is not the truth (a MESH is not its template), so this is the real measure. First numbers: **2 of 13 routes right** (3 counting the runner-up): 8's back rail → wheel ✓, 43's X
stick → hitch ✓. The pictures of the tracks on the film (`trackdebug.draw_frame` from a replayed dump) say why: tracking, not the reader, is the limit; after the snap the
camera zooms out 1.5-2.7x and the receivers on the near side, in front of the bench, are lost within a second or two (play 8's two right-side receivers kept 39 and 14 points of ~300),
and the tracks that do last cross into the pile. Pre-snap motion is found on play 8 (F, from the right bunch to the left slot).

**Film routes are not drawn over the sheet's call until proven (`FILM_ROUTES_PROVEN = false` in `trackedPlay.ts`).** 2 of 13 routes right on the first real plays means a drawn film route
can't be told from a wrong one (confidence didn't separate them: right reads at 0.27-0.37, wrong ones at 0.38-0.39). So `cardFromTracks` with a sheet row keeps the sheet's call
as the routes and only lists the film's reads in the notes ("Film's route reads (unchecked, not drawn): Z corner, ..."); with no sheet the read is drawn and the notes say every route is unchecked;
`--trust-film-routes` (or `trustFilmRoutes`) turns the old behaviour back on, for scoring and once `scripts/score-truth.ts` shows it right on a real set. The reads themselves are unchanged and still scored.
**The app's MESH is not this staff's MESH** (coach's own read of plays 8 and 43, a MESH RAIL): Z corner, X a stick at 10 yd, the two inside receivers shallow (the mesh), the back the rail; the
app's template draws Z post / X corner (Duces going left), so a sheet call of MESH draws two outside routes wrong for this staff until `CONCEPT_DICTIONARY.MESH` is changed to theirs (waiting on whether it
is by letter or by play side).

## Game film upload (the hosted pipeline: `/film`, `src/lib/film/`, `video-service/eval/worker*.py`)

A coach uploads a game's clips on **`/film`** (`FilmLibrary.tsx`), a hosted worker reads them, and the finished game
file lands in their library to **Open** (it goes through `parseScriptFile` / `storeScript`, like opening a game file).
Nothing here runs on a Mac or a Colab notebook; those stay for measuring accuracy.

**The flow.** (1) `POST /api/film/jobs` checks the picked files (`checkNewJob`: names, sizes, the tier's `film` limits in
`usageLimits.ts`: games at once, plays a game, games a week) and writes a job. (2) The browser uploads each clip straight
to the private Blob store, three at a time, retried (`uploadPlan.ts`), through `/api/film/upload`, which signs only the exact
paths step 1 handed out, for this staff, at the declared size. (3) `POST .../start` checks every clip landed whole, marks the
job `processing` and POSTs the clips to the worker in **shards** of 6 (`FILM_WORKER_URL`, `Authorization: Bearer
FILM_WORKER_SECRET`). (4) The worker reads each clip and reports it (`POST /api/film/worker/<team>/<job>`); the report that
completes the set sends one **assemble** dispatch (an exclusive `assembling` marker makes it once; polling the status also
nudges it, so two reports landing together can't strand a game). (5) The worker builds `game.json` with
`scripts/tracks-to-cards.ts` and sends it back; the job turns `ready`. The coach's screen polls `GET /api/film/jobs`.

**Where things live** (private Blob): `filmjobs/<team>/<job>.json` (the record, a separate prefix so listing a staff's games
never pages through clips), `film/<team>/<job>/clips/<n>/<name>`, `.../status/<n>-<kind>.json` (one report per clip, the
outcome in the name so progress is a listing), `.../tracks/<n>.json`, `.../assembling`, `.../game.json`. `<team>` is a hash
of the Clerk org (or `user-<id>`), so a path never names a team.

**The worker never holds a storage key.** It gets, per job, a token (`workerToken`: HMAC of team + job under
`FILM_WORKER_SECRET`, so a leaked token reaches one game) and every clip download, tracks upload and result upload goes
through the app's own `/api/film/worker/...` routes (`workerGate`), gzipped on the way up (functions take 4.5 MB). The app
is the only thing that touches the store. Coach routes are off wherever the AI gate is bypassed (one library for anyone
holding the URL) and need `BLOB_READ_WRITE_TOKEN`.

**Deleting the film.** A daily cron (`vercel.json` → `/api/film/cleanup`, `Bearer CRON_SECRET`) deletes the clips, tracks
and reports `CLIP_RETENTION_DAYS` (14) after upload (the game file stays, the card shows "Film deleted"), removes an upload
nobody finished after 2 days, and marks a game the worker never finished (6 h) failed so it frees its slot. A coach can
**Delete game** at once. The worker also deletes each clip as soon as it has been read and its whole folder at the end of a
shard. The privacy page says all of this: keep it in step.

**The worker** (`eval/worker.py`, `eval/worker_server.py`, `eval/clipjob.py`, `video-service/Dockerfile.worker`): a FastAPI
service, `POST /jobs` answers 202 and works on background threads (so the host must keep running after it replies: a GPU box,
or a serverless GPU set to keep its CPU on). A **shard** downloads its clips, runs `process_clip` on a thread each (camera
alignment and tracking overlap on the CPU; `SharedDetector` serializes the GPU) and reports each clip (`done` /
`needs_hand` / `failed`, never raising for one bad clip). `eval.game` loops over the same `process_clip`. An **assemble**
downloads the tracks, runs the card builder and uploads `game.json`. One box queues the shards; a host that scales out per
request works on them at once, which is how a game gets toward 30 minutes (one T4 reads a clip in roughly a minute or two).
`pytest test_worker.py` runs it end to end on the drawn game clip with a stand-in detector, the real card builder and a real
local HTTP server; `src/lib/film/*.test.ts` run the whole job flow on an in-memory store (`memoryStorage.ts`).

**A whole game's video, not one clip a play** (`eval/split.py`; `kind: "video"` jobs). Film that doesn't come from Hudl is one
long recording, so the coach picks **Whole game video** on `/film` (up to 4 files, 6 GB each: a game in halves) and the worker
finds the plays. `split.py` reads the video once at 5 samples a second (decoding is the cost; a few minutes for a game) and
keeps three numbers a sample: how much the picture moved, how much of it is grass, whether there was a hard cut. A **snap** is a
quiet set (about a second) followed by a sustained burst (1.5 s), on field footage (grass fraction), with no cut at the snap;
the thresholds are relative to the film's own motion (its 95th percentile on field footage) so a zoomed-out press box and a
close sideline camera both work without tuning. Each play is cut from 3 s before the snap to where the motion dies (5-9 s after,
never into the next play's set). Things it cannot know: a replay is another burst on the same field (cut as a second play), a
no-huddle snap with no set is missed, a fast pan between plays can read as a burst. Every play has a `score`; `python -m
eval.split game.mp4 --out clips/ --plot energy.png` draws the motion series with each snap marked, which is what to look at when
real film behaves differently. **Tested only on drawn film** (a field, players standing then running, slow pans, crowd cutaways
with hard cuts: all 4 snaps found within 0.9 s and the cutaways ignored); the thresholds are at the top of the file and have not
met a real game yet. In the app: `POST /api/film/jobs` with `kind: "video"` uploads to `.../videos/<n>/<name>`; `start` sends a
**split** dispatch per video (its address is the app's own `/video/<n>?t=<token>` route, which honors HTTP Range, OpenCV can't send
a header); each video's plan comes back as `{type: "split", plays}` (checked by `cleanSplit`); when every video has reported,
`tryPlan` numbers the plays across them (`play_001.mp4` …, `planClips`, capped by the plan's `maxPlays`) and sends the usual shards,
each clip now `source: {url, start, end}` instead of a download. The worker cuts it out by range (`resolve_source`: OpenCV opens
the URL and seeks, else the whole video is downloaded once); nothing is uploaded back. A split that finds no plays, or more than
the plan allows, fails the game with a reason the coach can act on. A video game's stages are uploading, **splitting**, reading,
building, ready.

**Two angles of one game** (a press-box view and an end-zone view): the **press-box video is the only one read**; the other angle
exists so each play isn't counted twice and so a play the press box missed can still be found. The coach picks the videos together
and marks which is the press box (`JobVideo.read`, guessed from the file name: "end zone" is not, "press"/"box" is, else the first).
The splitter reports each video's snap times and `pairing.ts` finds the shift that lines two videos' snaps up (every pair of snaps votes
for an offset, the strongest are scored, the best refined by the median residual; 2 s tolerance) and calls them one game when at least
3 plays and half the shorter video's plays match (`alignSnaps`: under 1% false matches across 300 pairs of unrelated drawn games; halves
of a game share nothing, so stay apart). `groupVideos` makes groups with the marked video as each group's primary (the others' times are
put on its clock, `toPrimary`) and `planGame` turns them into the plays to read: every play the press box found, from the press-box
video; a play **only the other angle caught** is cut from the press-box recording at the matching moment if that recording covers it
(`recovered`; else `skipped`, not read). A video marked "other angle" that matched no press box is read on its own (`readAlone`),
so a mislabel or a halves upload isn't dropped silently. The job's `plan` summary shows on the game's card. Nothing from the other
angle is ever read, merged or drawn. Groups come out in upload order, so pick halves in game order. **Drawn film only**: the real test
is a game filmed from two places; the 2 s tolerance was set on drawn snap times.

**What film can and can't read.** From the film alone the cards get the formation (and its strength), run or pass, the routes,
the run scheme and direction, the hash side (from where the ball is across the field), and the defense (front, shell, where the
corners and safeties stood, and the coverage they played after the snap: `coverageRead.ts`, drawn plays only so far). **Down, distance, yard line and result are not on press-box film** (there is no scoreboard), so a
film-only card shows "—" for them until the coach types them in Edit play; with Hudl's sheet they come from the sheet. Reading
them from a scorebug (OCR) on broadcast-style film is possible and not built; the yard line number can't be read at all from the
paint (it is unknown which yard line a calibrated field is), so a coach enters it.

**Not verified against the real thing:** the long-video route (a ranged `get` from Blob through a Next function: the SDK passes a
`Range` header and returns the part, but it hasn't run against a live store), the Blob store (the storage class is a thin wrapper over the `get` / `put` / `list` /
`del` calls the sync route already uses, but this flow hasn't run against a live store), the container image build, the real
detector inside it, and a GPU host. **Not built:** the in-browser four-click calibration for a clip that `needs_hand` (the screen
lists them and says to send them to us), an email when a game is ready (the screen polls), billing per game, a screen to add a
play the splitter missed or drop one it invented (the plan's timestamps are only in the video's plot), and scorebug OCR.

## Shared film libraries and rate limiting

The hosted Gemini film-to-card path (single clip, zip batch) was removed, but its libraries stay because the
Python tracker's output uses them. `src/lib/videoImport.ts`'s `buildCardFromDetection` /
`applyDetectionToCard` turn a validated detection into a real `HudlPlayCard` (the formation in its
canonical shape, each letter's route a `routeOverrides` entry with `source: "video"` and a raw `path`, so
it has draggable break points). `matchDetectedLetters` puts each detected player on the card's own player
who lined up nearest, `FILM_ROUTES` / `namedRouteDeltas` snap a named route to the staff's route tree,
and `coordinateMapper.ts`'s `yardRouteToPathDeltas` maps yards to the card. `videoDetection.ts` still
holds the film prompt rules (`QB_ANCHOR_RULES`, `FOOTBALL_CONCEPT_RULES`) the secondary read and text
cards use.

**Rate limiting:** the AI routes call `checkRateLimit` from `@vercel/firewall`, which only enforces
anything once a matching Vercel Firewall rule exists — creating one returned a 404 ("Seawall Config not
found"), consistent with custom WAF rules being a paid-plan feature. The actual cap is
`src/lib/rateLimit.ts`'s `checkBlobRateLimit`: a counter (keyed by the entitled **team id**, not IP) kept as
tiny marker blobs in the same private Blob store (`ratelimit/<bucket>/<hashed team id>/<window>/`, counted
with `list()`). The limits are **per access tier** (`src/lib/usageLimits.ts`'s `TIER_LIMITS`;
`requireEntitlement()` returns the tier):

| Limit | Demo (allow-listed / test bypass) | Paid (subscribed staff) |
| ----- | --------------------------------- | ----------------------- |
| AI text cards (`/api/generate-scout-card`) | 20 / minute | 120 / minute |
| Clip uploads (`/api/blob-upload`, the secondary read) | 60 / 5 min | 350 / 5 min |
| Import reviews (`/api/review-import`) | 10 / 5 min | 60 / 5 min |

`TIER_LIMITS` and `rateLimit.ts` still carry the single-clip and batch-job counters (`decideBatchChunk`,
`checkBatchJob`), now unused. Not perfectly atomic under concurrent hits from one team, which is fine for a
small coaching staff, and it's defense-in-depth on top of the auth/billing gate below.

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
  coverage alignment rules (Cover 0/1/2/3/4), 100% receiver coverage (a safety or nickel over /
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
O/D, print and draw work; AI card, the playsheet and Edit play are hidden), so nothing
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
`useClerk().openSignIn()`/`openCreateOrganization()` in the gate components).
Billing state (`subscriptionStatus`, Stripe ids) lives directly on the Clerk **Organization's
metadata** — `publicMetadata` for what the client needs to read (drives the entitlement check and
the UI), `privateMetadata` for what only the server needs (Stripe customer/subscription ids) — so
there's still no separate database for this either.

- Every Clerk-touching module checks `isClerkConfigured()` (`src/lib/clerkConfig.ts`, just
  `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` presence) **before** rendering `<ClerkProvider>`
  (`src/app/layout.tsx`) or calling a Clerk hook — `<ClerkProvider>` throws synchronously without a
  key, and Clerk hooks throw without a `<ClerkProvider>` in the tree, either of which would take
  down the whole app (the free CSV path included) if not guarded. `AccountMenu` renders a plain, hook-free fallback (nothing) when unconfigured, and only mounts its real, hook-using inner
  component once configured.
- `src/middleware.ts` (it must live in `src/`: with a `src/app` directory Next.js ignores a root `middleware.ts`, which left every gated route throwing "clerkMiddleware() was not run") is a bare `clerkMiddleware()` (also config-guarded) — just enough for
  `auth()`/`clerkClient()` to have request context in the routes that call them. It does **not**
  gate anything itself (Clerk's own path-matcher-based `createRouteMatcher` + `auth.protect()`
  pattern is deprecated in favor of per-route checks); its `matcher` only covers
  `/api/generate-scout-card`, `/api/ai-access`,
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
- **Theme:** `src/lib/clerkAppearance.ts` dresses every Clerk screen (sign-in modal, user menu, organization switcher) in the app's dark palette and Barlow fonts, passed to `<ClerkProvider appearance>` in `layout.tsx`. The "Sign in to My Application" title is the application name in Clerk's dashboard, and the "Development mode" badge goes away on a production instance.
- `src/lib/useTeamAccount.ts`: a thin client hook over `useAuth()`/`useOrganization()` (Clerk keeps
  them reactive on its own — no manual refetch/refresh needed, unlike the Supabase version this
  replaced). Only call it from a component that's guaranteed to render inside `<ClerkProvider>`.
- **Testing the AI routes before Clerk/Stripe are trusted:** `NEXT_PUBLIC_SKIP_AI_GATE=true`
  in `.env.local` (`src/lib/featureFlags.ts`'s `isAiGateDisabled()`) bypasses the whole sign-in +
  team + subscription gate on both the client (`AppGate` and `useTeamAccount` skip Clerk) and the server (`requireEntitlement()` short-circuits to an always-entitled
  result keyed `"test-bypass"`, which the rate limiter still buckets by). Only ever set this in
  `.env.local` — `isAiGateDisabled()` also checks `NEXT_PUBLIC_VERCEL_ENV !== "production"`, so
  even if the var leaks into a real deployment's env vars it's a no-op on Vercel's production
  environment. Remove the env var once you trust the feature and want the real gate back.

## Landing page (`src/app/page.tsx`)

The message is **opponent film in, scout cards out**: hero ("Turn opponent film into scout cards."), `#upload`
("Film in. Scout cards out.": open a game file the analyzer wrote, or the demo; in the pilot, film analysis is set up
with each staff directly), `#accuracy` ("The bar: 90%+ of routes right": every read scored against the coach's call,
unsure reads flagged, the coach has the last word; **a goal, not a claim**: the page says it is being measured during the
pilot and the number is published when proven, so don't state an accuracy figure until `scripts/score-routes.ts` has
one on real film), problem/solution, on-the-field, `#how-it-works` (Upload. Read. Review. Practice.), `#features`,
`#about`, `#faq` (includes "How accurate is it?" and "What film does it need?": the press-box angle reads best), final
CTA. The breakdown-row showcase (`TransformShowcase`, `HudlCsvMockup`) is no longer on the page; the components stay
in `src/components/landing/`. Visuals live in `src/components/landing/`:

- Every card shown is a real `ScoutCard` built by the real parser from demo rows
  (`MOCK_HUDL_CSV`), never a static image.
- `ScriptScreenMockup` is a static, scaled-down copy of the `/script` reader chrome (unit
  toggle, period tabs, Previous / Next) inside `DeviceFrame`. The hero (`HeroDevice`) cycles
  it through the script; `PracticeShowcase` shows Scout D with a Print Grid sheet behind it.
- `FilmToCardVisual` pairs an SVG film-frame illustration (not footage) with a live card whose
  `source: "video"` routes can be dragged, exactly as in the app.
- `primitives.tsx`: `Reveal` (fade-up on first scroll into view), `SectionHeading`, and `TryCta`,
  the single "Try ScoutCard AI" button used in the header, hero, and final CTA.
- Motion keyframes (`sc-float`, `sc-draw`, `sc-flow`, `sc-row-pulse`, `sc-ping`) are in
  `globals.css` and all switch off under `prefers-reduced-motion`. Reveal content is hidden only
  once `layout.tsx`'s inline script has added `html.js`, so it never stays invisible without JS.
- The FAQ (`FAQS`, grouped: getting started, how it reads your plays, working with the cards,
  printing and the field, privacy) describes what the app does today: route names, the
  AI's limits, the secondary, the playsheet, access. When a feature changes, update the answer.
- Don't add testimonials, usage numbers, or customer logos that aren't real.

## Privacy and terms (`/privacy`, `/terms`)

Both pages (`src/app/privacy/page.tsx`, `src/app/terms/page.tsx`, shell in `LegalLayout.tsx`)
describe what the product does today, so **update them whenever data handling changes**: what stays in
`localStorage` (script, playsheet, sunlight, the 14-day access cache), what's also saved for the
team (script, playsheet in private Blob, shared by everyone on the team, kept until replaced or
deleted on request), what each AI feature
sends to Gemini (import review rows as text, typed AI-card calls, the secondary-read clip), that
secondary-read clips sit in private Blob storage with no deletion schedule while game film uploaded for scout cards is deleted after 14 days, the usage counters, the
Clerk / Stripe / Google / Vercel processors, and the private-pilot sign-in. The AI game-film import is
off, and the pages say so. The support email is `jake@jtbuildsco.com` (for now). Still a placeholder to fill in by hand: the governing
law (state / country). They're a draft, not legal advice.

## Logo and icons (`public/brand/`, `public/icons/`)

The mark is an orange play card with an **O**, a route breaking to an arrow, and an **X** (the old O and X, now a
play). Lockups set `SCOUTCARD AI` in Barlow Condensed 800, chalk on the dark ground with `AI` in the accent (a
darker orange on cream, for contrast). `public/brand/` holds the PNGs (dark, light and stacked lockups, the mark
at 512 and 1024) and `scoutcard-mark.svg`. The favicon is a simpler cut (heavier strokes, no X, so it holds at
16 px): `public/favicon.ico` (16/32/48), `public/icons/icon.svg`, `icon-192/512.png`, a full-bleed maskable icon
and the Apple touch icon, all wired in `layout.tsx`. The design canvas is https://claude.ai/artifact/1UeWVzz1WzU5fU2eb5UNDs.
`BrandMark.tsx` draws the same mark inline. Changing an icon: bump `CACHE_VERSION` in `sw.js`, since installed
iPads cache them.

## Conventions

- Keep `src/lib/*` framework-free (relative imports, no React) so Vitest runs it directly.
- UI is dark-only and high contrast for sunlight. Touch targets are ≥ 44px. Print output is
  black on white.
- shadcn components were written by hand from the new-york source (the registry was not
  reachable when scaffolding). `components.json` is set up, so
  `npx shadcn@latest add <component>` works where the registry is reachable.
- UI design reference (Claude Design canvas): https://claude.ai/artifact/To8beVQabngaeLeJynuvpY
