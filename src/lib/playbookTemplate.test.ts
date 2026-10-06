import { describe, expect, it } from "vitest";
import { parseHudlCsvText } from "./hudlParser";
import { PLAYBOOK_TEMPLATE_CSV } from "./playbookTemplate";
import { loadScript, saveScript, storeScript } from "./scriptStore";

describe("playbook template", () => {
  it("reads as five plays the app can draw, with no warnings", () => {
    const result = parseHudlCsvText(PLAYBOOK_TEMPLATE_CSV);
    expect(result.cards).toHaveLength(5);
    expect(result.warnings).toEqual([]);
    expect(result.cards.every((c) => c.formationKey !== "unknown")).toBe(true);
    expect(result.cards.map((c) => c.playCall)).toContain("MESH RAIL");
  });
});

describe("playbook storage slot", () => {
  // A minimal localStorage, since Vitest runs without a DOM.
  const memory = new Map<string, string>();
  const store = {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  };
  Object.assign(globalThis, { window: { localStorage: store } });

  it("keeps the playbook apart from the scout script", () => {
    const result = parseHudlCsvText(PLAYBOOK_TEMPLATE_CSV);
    saveScript("scout.csv", parseHudlCsvText("OFF FORM,OFF PLAY\nSPREAD,IZ\n"));
    saveScript("our-playbook.csv", result, "playbook");
    expect(loadScript()?.cards).toHaveLength(1);
    expect(loadScript("playbook")?.cards).toHaveLength(5);
    expect(loadScript("playbook")?.fileName).toBe("our-playbook.csv");
    // An edit to the playbook never lands in the scout script.
    const playbook = loadScript("playbook")!;
    storeScript({ ...playbook, cards: playbook.cards.slice(0, 2) }, "playbook");
    expect(loadScript("playbook")?.cards).toHaveLength(2);
    expect(loadScript()?.cards).toHaveLength(1);
  });

  it("titles an empty playbook 'Our playbook'", () => {
    const stored = storeScript({ fileName: "", films: [], savedAt: "", cards: [], warnings: [] }, "playbook");
    expect(stored.fileName).toBe("Our playbook");
  });
});
