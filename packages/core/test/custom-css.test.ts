import { describe, expect, it } from "vitest";
import { CUSTOM_CSS_MAX, customCssProblem, defaultTheme, parseTheme } from "../src/theme-doc";

describe("custom CSS", () => {
  it("allows ordinary CSS, media queries, https images and quoted escapes", () => {
    for (const css of [
      "",
      ".store .btn-primary { border-radius: 999px; }",
      "@media (max-width: 640px) { .store header { padding: 0 } }",
      ".store > main h1 { background: url(https://cdn.example.com/a.png) no-repeat; }",
      '.hero { background-image: url("data:image/svg+xml;utf8,%3Csvg%3E%3C/svg%3E"); }',
      '.quote::before { content: "\\201C"; } /* a { comment } */',
      "@keyframes pop { from { opacity: 0 } to { opacity: 1 } }",
    ]) expect(customCssProblem(css), css).toBeNull();
  });

  it("refuses anything that could break out of the style tag, load other files or hide a word", () => {
    expect(customCssProblem("</style><script>alert(1)</script>")).toMatch(/can't contain "<"/);
    expect(customCssProblem('@import "https://x.example/a.css";')).toMatch(/@import/);
    expect(customCssProblem("@IMPORT url(https://x.example/a.css);")).toMatch(/@import/);
    expect(customCssProblem("a { background: url(http://x.example/a.png) }")).toMatch(/https web address/);
    expect(customCssProblem("a { background: url(javascript:alert(1)) }")).toMatch(/run code|https/);
    expect(customCssProblem("a { width: expression(alert(1)) }")).toMatch(/run code/);
    expect(customCssProblem("a { background: u\\72l(http://x.example/a.png) }")).toMatch(/Backslashes/);
    expect(customCssProblem("@\\69mport 'x.css';")).toMatch(/Backslashes/);
    expect(customCssProblem(".a { color: red;")).toBe("A { is missing its closing }.");
    expect(customCssProblem(".a { color: red; }}")).toBe("There's a } without a { before it.");
    expect(customCssProblem(".a { content: '}' }")).toBeNull(); // braces in quotes don't count
    expect(customCssProblem("a{}".repeat(CUSTOM_CSS_MAX))).toMatch(/under 20,000 characters/);
  });

  it("is part of the theme: empty by default, checked when the theme is saved", () => {
    const theme = defaultTheme("Shop");
    expect(parseTheme(theme).settings.customCss).toBe("");
    const { customCss: _, ...older } = theme.settings; // themes saved before custom CSS existed
    expect(parseTheme({ ...theme, settings: older }).settings.customCss).toBe("");
    expect(parseTheme({ ...theme, settings: { ...theme.settings, customCss: "h1 { color: red }" } }).settings.customCss).toBe("h1 { color: red }");
    expect(() => parseTheme({ ...theme, settings: { ...theme.settings, customCss: "</style>" } })).toThrow(/can't contain "<"/);
  });
});
