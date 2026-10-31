import { describe, expect, it } from "vitest";
import { createCampaign, createPost, DemoModel, postEmail } from "../src";
import { makeFixture } from "../evals/fixture";

const body = "Long nights are lamp season. Here is what we are bringing in for the cold months ahead.\n\n## Our picks\n\n- The sunset lamp";

describe("emailing a blog post", () => {
  it("writes a campaign from a post that's up, and nothing for drafts or posts still waiting", async () => {
    const f = await makeFixture(new DemoModel());
    const shop = await f.shop();
    const live = await createPost(f.db, shop.id, { title: "Winter is coming", body, excerpt: "What's new for the cold months." }, { published: true });
    const draft = await createPost(f.db, shop.id, { title: "Not yet", body });
    const later = await createPost(f.db, shop.id, { title: "Later", body }, { published: true, publishAt: new Date(Date.now() + 86_400_000) });

    const email = (await postEmail(f.db, shop.id, live.id))!;
    expect(email).toEqual({
      subject: "Winter is coming",
      body: "Hi {first_name},\n\nNew on our blog: Winter is coming\n\nWhat's new for the cold months.",
      buttonLabel: "Read the post",
      buttonPath: "/blog/winter-is-coming",
      audience: "subscribers",
      audienceTag: null,
      audienceProductId: null,
    });
    // It's a valid campaign as it is.
    expect((await createCampaign(f.db, shop.id, null, email)).status).toBe("draft");
    expect(await postEmail(f.db, shop.id, draft.id)).toBeNull();
    expect(await postEmail(f.db, shop.id, later.id)).toBeNull();
    expect(await postEmail(f.db, "00000000-0000-0000-0000-000000000000", live.id)).toBeNull();
  });
});
