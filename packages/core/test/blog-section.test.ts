import { describe, expect, it } from "vitest";
import { createPost, DemoModel, defaultTheme, latestPosts, parseTheme, SECTION_LABELS, SECTION_TYPES, sectionDefaults, setPostPublished } from "../src";
import { makeFixture } from "../evals/fixture";

const BODY = "A warm lamp by the bed helps little ones settle down at night.\n\n## Our picks\n\nStart with something soft.";

describe("blog posts section", () => {
  it("shows two to six of the newest posts", () => {
    expect(SECTION_TYPES).toContain("blog_posts");
    expect(SECTION_LABELS.blog_posts.name).toBe("Blog posts");
    expect(sectionDefaults("blog_posts")).toEqual({ heading: "", limit: 3 });
    const doc = defaultTheme("Shop");
    const blog = (settings: Record<string, unknown>) => ({ ...doc, home: [{ id: "blog0001", type: "blog_posts", hidden: false, settings }] });
    expect(parseTheme(blog({ heading: "Ideas", limit: 6 })).home[0]!.settings).toEqual({ heading: "Ideas", limit: 6 });
    expect(() => parseTheme(blog({ limit: 7 }))).toThrow();
    expect(() => parseTheme(blog({ limit: 1 }))).toThrow();
  });

  it("lists published posts newest first, as cards with a line from each", async () => {
    const f = await makeFixture(new DemoModel());
    const shopId = (await f.shop()).id;
    expect(await latestPosts(f.db, shopId)).toEqual([]);
    const older = await createPost(f.db, shopId, { title: "Night lights for small rooms", body: BODY, imageUrl: "https://images.example.com/room.jpg" }, { published: true, now: new Date("2026-10-01T10:00:00Z") });
    await createPost(f.db, shopId, { title: "Gift ideas under $25", body: BODY, excerpt: "Small gifts that still feel special." }, { published: true, now: new Date("2026-10-20T10:00:00Z") });
    const draft = await createPost(f.db, shopId, { title: "Not ready yet", body: BODY });

    const cards = await latestPosts(f.db, shopId);
    expect(cards.map((c) => c.title)).toEqual(["Gift ideas under $25", "Night lights for small rooms"]);
    expect(cards[0]).toMatchObject({ summary: "Small gifts that still feel special.", imageUrl: null, publishedAt: "2026-10-20T10:00:00.000Z", minutes: 1 });
    expect(cards[1]).toMatchObject({ id: older.id, handle: older.handle, imageUrl: "https://images.example.com/room.jpg", summary: "A warm lamp by the bed helps little ones settle down at night." });
    expect(await latestPosts(f.db, shopId, 1)).toHaveLength(1);

    await setPostPublished(f.db, shopId, draft.id, true, new Date("2026-10-25T10:00:00Z"));
    expect((await latestPosts(f.db, shopId))[0]!.title).toBe("Not ready yet");
    expect(await latestPosts(f.db, "00000000-0000-4000-8000-000000000000")).toEqual([]);
  });
});
