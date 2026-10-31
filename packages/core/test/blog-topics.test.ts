import { describe, expect, it } from "vitest";
import { blogTopics, createPost, DemoModel, exportStore, listPublishedPosts, postTags, relatedPosts, setPostPublished, updatePost } from "../src";
import { makeFixture } from "../evals/fixture";

const body = "A long enough post about lamps, with plenty of words to read before bed tonight.";

describe("blog topics", () => {
  it("tidies topics, lists them by how many posts have them, and shows one topic's posts", async () => {
    expect(postTags(" Guides,  how to , guides,,News ")).toEqual(["Guides", "how to", "News"]);
    expect(() => postTags("a,b,c,d,e,f")).toThrow("up to 5 topics");
    expect(() => postTags("x".repeat(31))).toThrow("under 30 characters");

    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const a = await createPost(f.db, shop.id, { title: "Picking a lamp", body, tags: "Guides, Kids" }, { published: true, now: new Date(Date.now() - 3000) });
    await createPost(f.db, shop.id, { title: "Our new lamp", body, tags: "news, guides" }, { published: true, now: new Date(Date.now() - 2000) });
    await createPost(f.db, shop.id, { title: "A draft", body, tags: "Secret" });
    expect(a.tags).toEqual(["Guides", "Kids"]);

    // Drafts' topics don't show; the same topic in another case counts once.
    expect(await blogTopics(f.db, shop.id)).toEqual([
      { tag: "guides", count: 2 },
      { tag: "Kids", count: 1 },
      { tag: "news", count: 1 },
    ]);
    expect((await listPublishedPosts(f.db, shop.id, 50, { tag: "GUIDES" })).map((p) => p.title)).toEqual(["Our new lamp", "Picking a lamp"]);
    expect((await listPublishedPosts(f.db, shop.id, 50, { tag: "kids" })).map((p) => p.title)).toEqual(["Picking a lamp"]);
    expect(await listPublishedPosts(f.db, shop.id, 50, { tag: "secret" })).toEqual([]);

    await updatePost(f.db, shop.id, a.id, { title: a.title, body, tags: "" });
    expect((await listPublishedPosts(f.db, shop.id, 50, { tag: "kids" })).length).toBe(0);
    // The store file carries them.
    const file = await exportStore(f.db, shop.id);
    expect(file.blog_posts.find((p) => p.title === "Our new lamp")?.tags).toEqual(["news", "guides"]);
  });

  it("suggests the posts sharing the most topics to read next, then the newest", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const at = (n: number) => ({ published: true, now: new Date(Date.UTC(2026, 9, n)) });
    const post = await createPost(f.db, shop.id, { title: "Picking a lamp", body, tags: "Guides, Kids" }, at(1));
    await createPost(f.db, shop.id, { title: "Two in common", body, tags: "kids, guides" }, at(2));
    await createPost(f.db, shop.id, { title: "One in common", body, tags: "Guides" }, at(3));
    await createPost(f.db, shop.id, { title: "Newest, none in common", body }, at(5));
    await createPost(f.db, shop.id, { title: "Older, none in common", body }, at(4));
    const draft = await createPost(f.db, shop.id, { title: "Draft in common", body, tags: "Guides, Kids" });

    const titles = async (p: { id: string; tags: string[] }, limit?: number) => (await relatedPosts(f.db, shop.id, p, limit)).map((c) => c.title);
    expect(await titles(post)).toEqual(["Two in common", "One in common", "Newest, none in common"]);
    expect(await titles(post, 5)).toEqual(["Two in common", "One in common", "Newest, none in common", "Older, none in common"]);
    // A post with no topics gets the newest; drafts never show.
    expect(await titles({ id: draft.id, tags: [] }, 2)).toEqual(["Newest, none in common", "Older, none in common"]);
    await setPostPublished(f.db, shop.id, draft.id, true, new Date(Date.UTC(2026, 9, 6)));
    expect((await titles(post))[0]).toBe("Draft in common");
  });
});
