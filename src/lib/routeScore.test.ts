import { describe, expect, it } from "vitest";
import { parseHudlCsvText } from "./hudlParser";
import { keyRoutes, report, scorePlay, summarize } from "./routeScore";
import type { TrackedRead } from "./trackedPlay";

const CSV = "PLAY #,OFF FORM,OFF PLAY,PLAY TYPE,OFF STR,PLAY DIR\n5,DUCES,FADE SPEED OUT HITCH FADE,Pass,,L\n6,DUCES RT,READ POWER,Run,R,R\n7,DUCES,MESH RAIL,Pass,,R\n";
const [deuces, power, mesh] = parseHudlCsvText(CSV).cards;

describe("the key: the coach's call drawn into a route per receiver", () => {
  it("reads several route words right to left across the formation, like the card", () => {
    const key = keyRoutes(deuces);
    expect([key.get("Z"), key.get("Y"), key.get("F"), key.get("X")]).toEqual(["fade", "speed-out", "hitch", "fade"]);
    expect(key.get("H")).toBe("block"); // the back stays in to protect
  });

  it("keys every receiver on a run as blocking, and leaves the ball carrier out", () => {
    const key = keyRoutes(power);
    expect([...key.values()].every((k) => k === "block")).toBe(true);
    expect(key.has("H")).toBe(false);
  });

  it("leaves a route the card draws by shape alone (a mesh drag) unkeyed rather than guessing a name for it", () => {
    const key = keyRoutes(mesh);
    expect(key.get("X")).toBe("fade"); // untagged outside receivers clear (GO is FADE to this staff)
    expect([...key.values()]).toContain(null);
  });
});

describe("scoring the reads", () => {
  const read = (letter: string, kind: TrackedRead["kind"], confidence = 0.5): TrackedRead => ({ letter, kind, confidence, seen: 3 });

  it("counts right, committed and missing reads, and GO for FADE only when lenient", () => {
    const verdicts = scorePlay(keyRoutes(deuces), [
      read("Z", "fade"), // right
      read("Y", "slide", 0.1), // wrong, and not committed (low confidence)
      read("F", "hitch", 0.3), // right
      read("X", "go"), // right only if GO = FADE
      read("H", "block", 1), // a blocker read as blocking
    ]);
    const s = summarize(verdicts);
    expect([s.routes, s.right, s.rightLenient]).toEqual([4, 2, 3]);
    expect([s.committed, s.committedRight]).toEqual([3, 2]);
    expect([s.blocks, s.blocksRight, s.missing]).toEqual([1, 1, 0]);
    expect(s.byRoute.fade).toEqual([1, 2]);
    expect(s.mistakes.map(([m]) => m)).toContain("speed-out → slide");
  });

  it("counts a receiver the tracker never matched as a miss", () => {
    const s = summarize(scorePlay(keyRoutes(deuces), [read("Z", "fade")]));
    expect(s.missing).toBe(4);
    expect(s.right).toBe(1);
    expect(report(s)[0]).toContain("1 of 4 (25%)");
  });
});
