import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { DemoModel, exportStore, importStore, parseVideo, setProductVideo } from "../src";
import { makeFixture } from "../evals/fixture";

describe("product videos", () => {
  it("understands YouTube, Vimeo and video file links", () => {
    for (const link of ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10", "https://youtu.be/dQw4w9WgXcQ", "https://youtube.com/shorts/dQw4w9WgXcQ", "https://m.youtube.com/watch?v=dQw4w9WgXcQ", "https://www.youtube.com/embed/dQw4w9WgXcQ"]) {
      expect(parseVideo(link)).toEqual({
        kind: "youtube",
        id: "dQw4w9WgXcQ",
        embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0&playsinline=1",
      });
    }
    expect(parseVideo("https://vimeo.com/76979871")).toMatchObject({ kind: "vimeo", id: "76979871", embedUrl: "https://player.vimeo.com/video/76979871?autoplay=1&dnt=1" });
    expect(parseVideo("https://player.vimeo.com/video/76979871")).toMatchObject({ kind: "vimeo", id: "76979871" });
    expect(parseVideo("https://cdn.example.com/lamp.mp4")).toEqual({ kind: "file", url: "https://cdn.example.com/lamp.mp4" });
    // Not playable here: plain http, other sites, broken IDs, pages that aren't videos.
    for (const link of ["http://cdn.example.com/lamp.mp4", "https://example.com/lamp", "https://youtube.com/watch?v=short", "https://www.youtube.com/channel/abc", "https://vimeo.com/channels/staff", "javascript:alert(1)", "not a link", ""]) {
      expect(parseVideo(link)).toBeNull();
    }
  });

  it("is saved per product and comes along in a store export", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const id = f.products.lamp.id;
    await expect(setProductVideo(f.db, shop.id, id, "https://example.com/watch")).rejects.toThrow("YouTube or Vimeo");
    expect(await setProductVideo(f.db, shop.id, id, " https://youtu.be/dQw4w9WgXcQ ")).toMatchObject({ kind: "youtube" });
    const row = await f.db.query.products.findFirst({ where: eq(schema.products.id, id) });
    expect(row!.videoUrl).toBe("https://youtu.be/dQw4w9WgXcQ");

    const data = await exportStore(f.db, shop.id);
    expect(data.products.find((p) => p.handle === row!.handle)!.video_url).toBe("https://youtu.be/dQw4w9WgXcQ");
    const g = await makeFixture(new DemoModel());
    const target = await g.shop();
    await g.db.delete(schema.products).where(eq(schema.products.shopId, target.id));
    await importStore(g.db, target.id, data);
    const copied = await g.db.query.products.findFirst({ where: eq(schema.products.handle, row!.handle) });
    expect(copied!.videoUrl).toBe("https://youtu.be/dQw4w9WgXcQ");

    expect(await setProductVideo(f.db, shop.id, id, "")).toBeNull();
    expect((await f.db.query.products.findFirst({ where: eq(schema.products.id, id) }))!.videoUrl).toBeNull();
  });
});
