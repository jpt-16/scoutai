import { describe, expect, it } from "vitest";
import { buildDiagram, runScheme } from "./formations";
import { parseHudlCsvText, type FormationKey } from "./hudlParser";

const draw = (formation: FormationKey, call: string, dir: "right" | "left" = "right") => {
  const parsed = parseHudlCsvText(`OFF FORM,OFF PLAY\n${formation},${call}\n`).cards[0];
  return buildDiagram({ ...parsed, formationKey: formation, formationSide: dir, playDirection: dir }, "team", "offense");
};

describe("naming the run", () => {
  it.each([
    ["INSIDE ZONE", "zone"],
    ["IZ", "zone"],
    ["OUTSIDE ZONE", "outside-zone"],
    ["POWER", "power"],
    ["HAMMER", "hammer"],
    ["G ISO", "power"],
    ["ISO", "iso"],
    ["COUNTER", "counter"],
    ["Y TREY", "counter"],
    ["TOSS", "toss"],
    ["TOSS SWEEP", "toss"],
    ["JET", "jet"],
    ["JET SWEEP", "jet"],
  ])("%s is %s", (call, scheme) => {
    expect(runScheme({ playCall: call, concept: "inside-zone" })).toBe(scheme);
  });
});

describe("what the receivers do on a run", () => {
  it("block the corner", () => {
    const d = draw("spread", "POWER");
    const wide = d.players.filter((p) => p.role === "WR");
    expect(wide.length).toBeGreaterThan(0);
    for (const p of wide) expect(d.jobs[p.label]).toBe("Stalk the corner");
    expect(d.targetBlocks.filter((t) => t.target === "C")).toHaveLength(wide.length);
  });

  it("on a toss, the play side's inside receiver push-cracks the safety, the rest block the corner", () => {
    const d = draw("spread", "TOSS", "right");
    const cracks = d.targetBlocks.filter((t) => t.target === "S");
    expect(cracks).toHaveLength(1);
    const crackerLabel = Object.keys(d.jobs).find((k) => d.jobs[k].startsWith("Crack"))!;
    const cracker = d.players.find((p) => p.label === crackerLabel)!;
    expect(cracker.x).toBeGreaterThan(250); // the play side
    const playSide = d.players.filter((p) => p.role === "WR" && p.x > 250);
    expect(Math.abs(cracker.x - 250)).toBe(Math.min(...playSide.map((p) => Math.abs(p.x - 250))));
    // The block goes up the field, then inside.
    const path = cracks[0].path;
    expect(path[path.length - 1].y).toBeLessThan(path[0].y);
    expect(path[path.length - 1].x).toBeLessThan(path[0].x);
  });

  it("a toss to the left cracks from the left", () => {
    const d = draw("spread", "TOSS", "left");
    const crackerLabel = Object.keys(d.jobs).find((k) => d.jobs[k].startsWith("Crack"))!;
    expect(d.players.find((p) => p.label === crackerLabel)!.x).toBeLessThan(250);
  });

  it("on a jet, the receiver in motion carries it across the formation", () => {
    const d = draw("spread", "JET", "right");
    const carrierLabel = Object.keys(d.jobs).find((k) => d.jobs[k].startsWith("Ball carrier (jet"))!;
    const man = d.players.find((p) => p.label === carrierLabel)!;
    expect(man.role).toBe("WR");
    expect(man.x).toBeLessThan(250); // the backside receiver nearest the ball
    expect(d.carrier).not.toBeNull();
    expect(d.carrier![0]).toMatchObject({ x: man.x, y: man.y });
    expect(d.carrier![d.carrier!.length - 1].x).toBeGreaterThan(250);
  });
});

describe("route words read right to left", () => {
  it("FADE SPEED OUT HITCH FADE: the fade and speed out are on the right, the hitch and the other fade on the left", () => {
    const d = draw("spread", "FADE SPEED OUT HITCH FADE", "right");
    const wr = d.players.filter((p) => p.role === "WR").sort((a, b) => b.x - a.x); // right to left
    expect(wr).toHaveLength(4);
    const label = (i: number) => d.jobs[wr[i].label];
    expect(label(0)).toMatch(/fade/i);
    expect(label(1)).toMatch(/speed out/i);
    expect(label(2)).toMatch(/hitch/i);
    expect(label(3)).toMatch(/fade/i);
  });
});
