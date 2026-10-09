import { describe, expect, it } from "vitest";
import { buildDiagram } from "./formations";
import { parseHudlCsvText } from "./hudlParser";

/**
 * On a called play (Scout O) every receiver and back either runs a route or blocks:
 * a drawn path starts at his spot (a route, a block, a pull, a fake or the carrier's
 * path), whatever the formation, the call, the period or the direction.
 */
const FORMATIONS = ["spread", "trips", "i-form", "double-eagle", "pro", "split-pro"] as const;
const CALLS = [
  // Runs
  "IZ", "G ISO", "POWER", "COUNTER", "DRAW", "QB SNEAK", "OUTSIDE ZONE", "SWEEP", "DIVE",
  // Passes: route words, combinations, tree numbers, concepts, back tags, screens
  "QUICK SLANT", "CURL", "POST", "FLAT", "SHALLOW", "GO", "4 VERTS", "81", "837", "2960", "FADE OUT OUT FADE",
  "MESH", "MESH RAIL", "FLOOD", "SMASH", "DAGGER", "CROSS", "RAIL", "WHEEL", "BUBBLE", "SCREEN",
  "LEAK", "WHIP", "SWING", "HITCH", "DIG", "OUT",
  // RPOs and play action
  "RPO BUBBLE", "RPO SLIDE", "WING SLIDE", "RPO IZ", "PA BOOT", "PLAY ACTION GO", "WAGGLE",
];

const startsAt = (path: { x: number; y: number }[], p: { x: number; y: number }) =>
  path.length > 0 && Math.hypot(path[0].x - p.x, path[0].y - p.y) < 1.5;

describe("every receiver and back runs a route or blocks", () => {
  it("on every formation, call, period and direction", () => {
    const gaps: string[] = [];
    for (const key of FORMATIONS) {
      for (const call of CALLS) {
        for (const mode of ["team", "7v7"] as const) {
          for (const dir of ["right", "left"] as const) {
            const parsed = parseHudlCsvText(`OFF FORM,OFF PLAY\n${key},${call}\n`).cards[0];
            const d = buildDiagram({ ...parsed, formationKey: key, formationSide: dir, playDirection: dir }, mode, "offense");
            const drawn = [...d.routes, ...d.blocks, ...d.targetBlocks.map((t) => t.path), ...d.pulls, ...d.fakes, ...(d.carrier ? [d.carrier] : [])];
            for (const p of d.players) {
              if (!p.label || p.label === "Q" || p.role === "OL") continue;
              if (!drawn.some((path) => startsAt(path, p))) gaps.push(`${key} ${mode} ${dir} "${call}": ${p.label} (${p.role})`);
            }
          }
        }
      }
    }
    expect(gaps).toEqual([]);
  });

  it("gives each default a job in the table, and leaves an untagged formation rep and a coach's No route alone", () => {
    // A wide receiver on a play action with no routes named stalks.
    const pa = buildDiagram({ ...parseHudlCsvText("OFF FORM,OFF PLAY\nspread,PA BOOT\n").cards[0], formationKey: "spread" });
    expect(pa.jobs.X).toBe("Stalk");
    // The back on a run who isn't carrying it fakes, drawn dashed.
    const run = buildDiagram({ ...parseHudlCsvText("OFF FORM,OFF PLAY\ni-form,COUNTER\n").cards[0], formationKey: "i-form" });
    expect(run.fakes.length).toBeGreaterThan(0);
    // No call at all is a formation rep: nothing to assign.
    const rep = buildDiagram({ ...parseHudlCsvText("OFF FORM,OFF PLAY\nspread,\n").cards[0], formationKey: "spread" });
    expect(rep.kind).toBe("none");
    expect(rep.routes).toHaveLength(0);
    expect(rep.blocks).toHaveLength(0);
    // A coach who set "No route" on a letter meant it.
    const none = buildDiagram({
      ...parseHudlCsvText("OFF FORM,OFF PLAY\nspread,QUICK SLANT\n").cards[0],
      formationKey: "spread",
      routeOverrides: { X: { route: "none" } },
    });
    expect(none.jobs.X).toBe("—");
  });
});

describe("adjusting an arrow", () => {
  const base = () => parseHudlCsvText(`OFF FORM,OFF PLAY\ntrips,QUICK SLANT\n`).cards[0];

  it("names the player and the route kind behind every called route", () => {
    const d = buildDiagram(base(), "team", "offense");
    expect(d.routeLetters).toHaveLength(d.routes.length);
    expect(d.routeLetters.every(Boolean)).toBe(true);
    // Slant is tree route 2, so an adjusted slant keeps its number.
    expect(d.routeKinds).toContain("slant");
  });

  it("a dragged break point becomes the coach's own shape and moves only that point", () => {
    const card = base();
    const before = buildDiagram(card, "team", "offense");
    const i = before.routeKinds.indexOf("slant");
    const letter = before.routeLetters[i]!;
    const player = before.players.find((p) => p.label === letter)!;
    const deltas = before.routes[i].slice(1).map((pt) => [pt.x - player.x, pt.y - player.y] as [number, number]);
    const last = deltas.length - 1;
    deltas[last] = [deltas[last][0] + 30, deltas[last][1] - 20];
    const after = buildDiagram(
      { ...card, routeOverrides: { [letter]: { route: "slant", path: deltas, source: "coach" } } },
      "team",
      "offense",
    );
    const route = after.routes.find((_, k) => after.routeLetters[k] === letter)!;
    const old = before.routes[i];
    expect(route).toHaveLength(old.length);
    expect(route[route.length - 1].x).toBeCloseTo(old[old.length - 1].x + 30, 0);
    expect(route[route.length - 1].y).toBeCloseTo(old[old.length - 1].y - 20, 0);
    // The stem is where it was, and the arrow keeps its number.
    expect(route[1].x).toBeCloseTo(old[1].x, 0);
    expect(after.routeLabels[after.routeLetters.indexOf(letter)]).toBe("2");
    // Nobody else's route moved.
    after.routes.forEach((r, k) => {
      if (after.routeLetters[k] === letter) return;
      const j = before.routeLetters.indexOf(after.routeLetters[k]);
      expect(r).toEqual(before.routes[j]);
    });
  });
});
