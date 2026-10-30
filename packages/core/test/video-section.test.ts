import { describe, expect, it } from "vitest";
import { defaultTheme, parseTheme, parseVideo, SECTION_TYPES, sectionDefaults } from "../src";
import { parseVideo as parseVideoInBrowser } from "../src/video-link";

describe("video section", () => {
  it("takes the same video links as product videos", () => {
    expect(SECTION_TYPES).toContain("video");
    expect(sectionDefaults("video")).toEqual({ heading: "", text: "", videoUrl: "", coverUrl: "" });
    expect(parseVideoInBrowser).toBe(parseVideo);
    const doc = defaultTheme("Shop");
    const video = (videoUrl: string) => ({ ...doc, home: [{ id: "video001", type: "video", hidden: false, settings: { heading: "How it's made", videoUrl } }] });

    for (const url of ["https://youtu.be/dQw4w9WgXcQ", "https://vimeo.com/76979871", "https://cdn.example.com/clip.mp4", ""]) {
      expect(parseTheme(video(url)).home[0]).toMatchObject({ settings: { videoUrl: url } });
    }
    for (const url of ["https://example.com/about", "http://youtu.be/dQw4w9WgXcQ", "https://youtube.com/watch?v=short"]) {
      expect(() => parseTheme(video(url))).toThrow("Paste a YouTube or Vimeo link");
    }
  });
});
