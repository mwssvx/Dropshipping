import { describe, expect, it } from "vitest";
import { contrastRatio, THEME_PRESET_IDS, THEME_PRESETS } from "../src";

describe("theme contrast", () => {
  it("every ready-made theme keeps text, buttons and links readable", () => {
    for (const id of THEME_PRESET_IDS) {
      const c = THEME_PRESETS[id].look.colors;
      expect(contrastRatio(c.text, c.background), `${id} text`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c.accentText, c.accent), `${id} buttons`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c.accent, c.background), `${id} links`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrastRatio("#facc15", "#ffffff")).toBeLessThan(4.5);
  });
});
