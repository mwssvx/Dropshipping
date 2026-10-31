import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@sf/db";
import { createPost, DemoModel, getPublishedPostByHandle, isScheduled, latestPosts, listPublishedPosts, NotFoundError, searchPages, setPostPublished } from "../src";
import { makeFixture } from "../evals/fixture";

const HOUR = 3_600_000;
const body = "A long enough post about lamps, with plenty of words to read before bed tonight.";

describe("scheduled blog posts", () => {
  it("waits for its time on every store page, and can be moved, published now or taken back", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const later = new Date(Date.now() + 2 * HOUR);
    const post = await createPost(f.db, shop.id, { title: "Winter lamps", body }, { published: true, publishAt: later });
    expect(post).toMatchObject({ status: "published", publishedAt: later });
    expect(isScheduled(post)).toBe(true);

    // Not on the blog, the home page cards, its own address or in search yet.
    expect(await listPublishedPosts(f.db, shop.id)).toEqual([]);
    expect(await latestPosts(f.db, shop.id)).toEqual([]);
    await expect(getPublishedPostByHandle(f.db, shop.id, post.handle)).rejects.toThrow(NotFoundError);
    expect((await searchPages(f.db, shop.id, "winter", null)).pages).toEqual([]);

    // Its time comes.
    await f.db.update(schema.blogPosts).set({ publishedAt: new Date(Date.now() - 1000) }).where(eq(schema.blogPosts.id, post.id));
    expect((await listPublishedPosts(f.db, shop.id)).map((p) => p.title)).toEqual(["Winter lamps"]);
    expect((await getPublishedPostByHandle(f.db, shop.id, post.handle)).post.id).toBe(post.id);
    expect((await searchPages(f.db, shop.id, "winter", null)).pages.map((p) => p.title)).toEqual(["Winter lamps"]);

    // Another, moved to a new time, then published now, then taken back while waiting.
    const second = await createPost(f.db, shop.id, { title: "Spring lamps", body }, { published: true, publishAt: later });
    const moved = await setPostPublished(f.db, shop.id, second.id, true, new Date(), new Date(later.getTime() + HOUR));
    expect(moved.publishedAt).toEqual(new Date(later.getTime() + HOUR));
    const now = new Date();
    expect((await setPostPublished(f.db, shop.id, second.id, true, now)).publishedAt).toEqual(now);
    const third = await createPost(f.db, shop.id, { title: "Autumn lamps", body }, { published: true, publishAt: later });
    // A draft that never went up keeps no publish date.
    expect(await setPostPublished(f.db, shop.id, third.id, false)).toMatchObject({ status: "draft", publishedAt: null });
    // A live post keeps its first date when saved again with a time in the past.
    const first = (await setPostPublished(f.db, shop.id, post.id, true, new Date(), new Date(Date.now() - 10 * HOUR))).publishedAt!;
    expect(first.getTime()).toBeLessThan(Date.now());
    expect(first.getTime()).toBeGreaterThan(Date.now() - HOUR);

    await expect(createPost(f.db, shop.id, { title: "Far away", body }, { published: true, publishAt: new Date(Date.now() + 400 * 24 * HOUR) })).rejects.toThrow("within the next year");
    await expect(createPost(f.db, shop.id, { title: "Short", body: "Too short." }, { published: true, publishAt: later })).rejects.toThrow("nearly empty");
  });
});
