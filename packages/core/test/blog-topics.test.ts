import { describe, expect, it } from "vitest";
import { blogTopics, createPost, DemoModel, exportStore, listPublishedPosts, postTags, updatePost } from "../src";
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
});
