import { AgentWikiCommentService } from "@/backend/service/agents/AgentWikiCommentService";

import { useWikiFieldHarness } from "./wiki-fields";

import type {
  AgentWikiCommentAdded,
  AgentWikiComments,
} from "@/definition/AgentWikiComments";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { PagesAgentReadResponse } from "@/definition/PagesAgentOperations";
import type { PagesAgentWriteResponse } from "@/definition/PagesAgentWrites";
import type { WikiFieldHarness } from "./wiki-fields";

export const COMMENT_READER: AgentIdentity = {
  userId: "reader",
  isAdmin: false,
  permissions: [],
};
export const COMMENT_WRITER: AgentIdentity = {
  userId: "writer",
  isAdmin: false,
  permissions: ["write"],
};

/** Real migrated persistence and the same wiki policy used by the application. */
export interface AgentCommentHarness extends WikiFieldHarness {
  readonly comments: AgentWikiCommentService;
}

/** Adds an account with visibility but no write capability to the existing wiki fixture. */
export function useAgentCommentHarness(): () => Promise<AgentCommentHarness> {
  const setup = useWikiFieldHarness();
  return async () => {
    const harness = await setup();
    await harness.addUser("reader", {
      capabilities: [],
      departments: ["alpha"],
      displayName: "Reader",
    });
    return {
      ...harness,
      comments: new AgentWikiCommentService(harness.dependencies),
    };
  };
}

/** Narrows a public add result without asserting an unrelated write response. */
export function addedComment(
  response: PagesAgentWriteResponse,
): AgentWikiCommentAdded {
  if (!("parentId" in response.result) || !("commentId" in response.result))
    throw new Error("Expected a comment add result.");
  return response.result;
}

/** Narrows the public thread result by its schema. */
export function commentThreads(
  response: PagesAgentReadResponse,
): AgentWikiComments {
  if (!("threads" in response.result))
    throw new Error("Expected wiki comment threads.");
  return response.result;
}

/** Creates a first comment using a server-verified fixture identity. */
export async function addAgentComment(
  harness: AgentCommentHarness,
  overrides: Readonly<Record<string, unknown>> = {},
): Promise<AgentWikiCommentAdded> {
  return addedComment(
    await harness.comments.apply(COMMENT_READER, "wiki.comment.add", {
      operationId: "add",
      pageId: harness.page.id,
      body: "Original comment",
      ...overrides,
    }),
  );
}
