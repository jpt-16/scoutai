import { describe, expect, it } from "vitest";
import { parseHudlCsvText } from "./hudlParser";
import { ROUTE_SECONDS, cardFromTracks, type TrackedPlayer } from "./trackedPlay";
import { alignInOrder, matchDetectedLetters, type DetectedPlay, type DetectedPlayer } from "./videoImport";

// The real case (Hudl play 5 of the test recordings): Duces, ball on the left hash. Where the five skill men stood at
// the snap, in yards from the ball (offense's view). The wide side's two receivers stood 16 and 18 yards out; the card
// draws them at 18 and 30, so by nearness alone the slot took the outside man's letter.
const ROW = "PLAY #,HASH,OFF FORM,OFF STR,OFF PLAY,PLAY TYPE,PLAY DIR\n5,L,DUCES,BAL,FADE SPEED OUT HITCH FADE,Pass,L\n";
const card = parseHudlCsvText(ROW).cards[0];

const man = (x: number, y: number, label = "?"): DetectedPlayer => ({
  label,
  start: { x, y },
  waypoints: [],
  endpoint: { x, y: y + 5 },
});

describe("which letter each man on film is", () => {
  it("keeps the order outside in on each side, on the card's own hash", () => {
    const outsideRight = man(18.5, -0.8);
    const slotRight = man(16.1, -2.2);
    const slotLeft = man(-8.6, -1.8);
    const outsideLeft = man(-11.2, 0.1);
    const back = man(1.2, -5.1);
    const play: DetectedPlay = { playName: "", formation: "", units: "yards", players: [man(-0.2, -4.1, "Q"), back, slotLeft, outsideRight, outsideLeft, slotRight] };
    const letters = matchDetectedLetters(play, card);
    expect(letters.get(outsideRight)).toBe("Z");
    expect(letters.get(slotRight)).toBe("Y");
    expect(letters.get(outsideLeft)).toBe("X");
    expect(letters.get(slotLeft)).toBe("F");
    expect(letters.get(back)).toBe("H");
  });

  it("gives the man on film the letter in his place when one of them wasn't tracked", () => {
    // Only the wide side's slot was followed: he is still the slot, not the outside receiver.
    const slotRight = man(16.1, -2.2);
    const letters = matchDetectedLetters({ playName: "", formation: "", units: "yards", players: [slotRight] }, card);
    expect(letters.get(slotRight)).toBe("Y");
  });

  it("never crosses: the man outside never takes a letter inside the next man's", () => {
    const spots = [{ label: "Z", x: 30 }, { label: "Y", x: 18 }];
    const pairs = alignInOrder([20, 17], spots, (p, s) => Math.abs(p - s.x));
    expect(pairs).toEqual([[20, "Z"], [17, "Y"]]);
  });
});

describe("a route is read up to the throw, not through the run after the catch", () => {
  it("a hitch, then the run after the catch upfield and out, is still a hitch", () => {
    const fps = 30;
    const points: [number, number, number][] = [];
    // Stem to 5 yards in 1.4 s, settle back a yard and wait for the ball, then (the catch) run 6 yards upfield and 4 out.
    const caught = ROUTE_SECONDS;
    for (let f = 0; f <= 150; f++) {
      const t = f / fps;
      const y = t < 1.4 ? -1 + (6 / 1.4) * t : t < 2 ? 5 - (t - 1.4) / 0.6 : t < caught ? 4 : 4 + 3 * (t - caught);
      const x = t < caught ? -9 : -9 - 2 * (t - caught);
      points.push([t, x, y]);
    }
    const line: TrackedPlayer[] = [-2.4, -1.2, 0, 1.2, 2.4].map((x, i) => ({
      id: 10 + i,
      team: "offense",
      start: [x, -0.8],
      points: [[0, x, -0.8], [1, x, -0.5], [4, x, -0.5]],
    }));
    const file = {
      tracks: [
        ...line,
        { id: 1, team: "offense" as const, start: [-9, -1] as [number, number], points },
        { id: 2, team: "offense" as const, start: [-0.2, -4.5] as [number, number], points: [[0, -0.2, -4.5], [4, -0.3, -6]] as [number, number, number][] },
      ],
    };
    const { reads } = cardFromTracks(file, card);
    expect(reads.find((r) => r.letter === "F")?.kind).toBe("hitch");
  });
});
