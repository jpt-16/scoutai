/**
 * The playbook types in one place. Each is defined next to the code that
 * builds it (the parser, the aligner, the secondary table); this file only
 * re-exports them under playbook names, so there's never a second copy to
 * keep in sync.
 *
 * - `PlayCard`: one play, as parsed from a Hudl row and edited in the app.
 *   `defenseAlignment` holds the play's safety depth (`safetyDepthY`, yards
 *   off the line) and slot style (`coverageStyle`), set from the Scout D
 *   toolbar or the AI card.
 * - `DefensiveAlignment` / `CoverageStyle`: that per-play call
 *   (`MAN_OVER` | `ZONE_APEX` | `DEEP_SHELL`).
 * - `SecondaryAlignment`: the staff's corners and safeties per formation.
 */

export type {
  HudlPlayCard as PlayCard,
  RouteOverride,
  InkStroke,
  AiHints,
  FormationKey,
  FrontKey,
  PlayConcept,
  Hash,
  Side,
} from "@/lib/hudlParser";
export type { DefensiveAlignment, CoverageStyle } from "@/lib/defensiveAligner";
export type { DbAlignment as SecondaryAlignment, DbAlignments, DbSpot } from "@/lib/secondary";
export type { Diagram, Defender, DiagramMode, ScoutUnit, PlayKind } from "@/lib/formations";
