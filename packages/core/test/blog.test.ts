import { describe, expect, it } from "vitest";
import {
  createPost, createShop, deletePost, DemoModel, draftPostWithAi, exportStore, getPublishedPostByHandle, importStore, listPublishedPosts, postBlocks,
  postSummary, readingMinutes, setPostPublished, signUp, updatePost,
} from "../src";
import { makeFixture } from "../evals/fixture";

describe("blog", () => {
  it("drafts, publishes and shows posts with their featured products", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const post = await createPost(f.db, shop.id, { title: "Five ways to light a small room", body: "Short." , productIds: [f.products.lamp.id, f.products.stand.id] });
    expect(post).toMatchObject({ handle: "five-ways-to-light-a-small-room", status: "draft", publishedAt: null });
    await expect(createPost(f.db, shop.id, { title: "Other", handle: post.handle })).rejects.toThrow("already uses the address /blog/five-ways");
    expect((await createPost(f.db, shop.id, { title: "Five ways to light a small room" })).handle).toBe("five-ways-to-light-a-small-room-2");
    await expect(createPost(f.db, shop.id, { title: "Bad", body: "<script>alert(1)</script>" })).rejects.toThrow("plain text");

    await expect(setPostPublished(f.db, shop.id, post.id, true)).rejects.toThrow("nearly empty");
    await expect(getPublishedPostByHandle(f.db, shop.id, post.handle)).rejects.toThrow("not found");
    const body = "Small rooms feel bigger with soft light.\n\n## Start low\n\nPut one light near the floor.\n• A lamp by the bed\n• A strip under a shelf\n\nThat's it.";
    await updatePost(f.db, shop.id, post.id, { title: post.title, handle: post.handle, body, productIds: [f.products.lamp.id, f.products.stand.id] });
    const first = await setPostPublished(f.db, shop.id, post.id, true, new Date("2026-10-01T00:00:00Z"));
    // Republishing keeps the first date.
    await setPostPublished(f.db, shop.id, post.id, false);
    expect((await setPostPublished(f.db, shop.id, post.id, true)).publishedAt).toEqual(first.publishedAt);

    const shown = await getPublishedPostByHandle(f.db, shop.id, post.handle);
    // The phone stand is a draft product, so it isn't featured.
    expect(shown.products.map((p) => p.title)).toEqual(["Sunset Projection Lamp"]);
    expect((await listPublishedPosts(f.db, shop.id)).map((p) => p.id)).toEqual([post.id]);
    expect(postBlocks(body)).toEqual([
      { type: "paragraph", text: "Small rooms feel bigger with soft light." },
      { type: "heading", text: "Start low" },
      { type: "paragraph", text: "Put one light near the floor." },
      { type: "list", items: ["A lamp by the bed", "A strip under a shelf"] },
      { type: "paragraph", text: "That's it." },
    ]);
    expect(postSummary(shown.post)).toBe("Small rooms feel bigger with soft light.");
    expect(readingMinutes(body)).toBe(1);

    // Posts travel in the store file, with their products and publish state.
    const user = await signUp(f.db, { email: "copy@example.com", password: "correct horse" });
    const copy = await createShop(f.db, user.id, { name: "Copy", country: "US" });
    await importStore(f.db, copy.id, JSON.parse(JSON.stringify(await exportStore(f.db, shop.id))));
    const copied = await getPublishedPostByHandle(f.db, copy.id, post.handle);
    expect(copied.post.publishedAt).toEqual(first.publishedAt);
    expect(copied.products.map((p) => p.title)).toEqual(["Sunset Projection Lamp"]);

    await expect(deletePost(f.db, copy.id, post.id)).rejects.toThrow("not found");
    await deletePost(f.db, shop.id, post.id);
    expect(await listPublishedPosts(f.db, shop.id)).toEqual([]);
  });

  it("the AI writer saves a draft featuring the products the merchant picked", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    await expect(draftPostWithAi(f.ctx, shop, { topic: " " })).rejects.toThrow("Say what the post");
    const run = await draftPostWithAi(f.ctx, shop, { topic: "How to pick a night light for a kid's room", productIds: [f.products.lamp.id] });
    expect(run.status).toBe("done");
    expect(run.postId).toBeTruthy();
    const post = (await f.db.query.blogPosts.findFirst({ where: (p, { eq }) => eq(p.id, run.postId!) }))!;
    expect(post).toMatchObject({ status: "draft", aiGenerated: true, productIds: [f.products.lamp.id], title: "How to pick a night light for a kid's room" });
    expect(postBlocks(post.body).some((b) => b.type === "heading")).toBe(true);
    expect(run.text).toContain("saved as a draft");
  });
});
