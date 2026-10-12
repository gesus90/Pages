import { expect, it } from "vitest";

import {
  addAgentComment,
  COMMENT_READER,
  commentThreads,
  useAgentCommentHarness,
} from "../helpers/wiki-agent-comments";

const setup = useAgentCommentHarness();

it("reads only pageId, cursor and limit and refuses any other parameter", async () => {
  const harness = await setup();
  await addAgentComment(harness);

  const threads = commentThreads(
    await harness.comments.read(COMMENT_READER, {
      pageId: harness.page.id,
      limit: 10,
    }),
  );
  expect(threads.threads).toHaveLength(1);

  for (const extra of [{ query: "text" }, { includeResolved: true }])
    await expect(
      harness.comments.read(COMMENT_READER, {
        pageId: harness.page.id,
        ...extra,
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
});
