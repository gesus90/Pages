import { expect, it, vi } from "vitest";

import { ConversationObserverError } from "@/backend/error/ConversationObserverError";
import { ConversationAccounts } from "@/backend/service/conversation/ConversationDirectory";
import { ConversationGroupSummaries } from "@/backend/service/conversation/ConversationGroupSummaries";
import { CONVERSATION_SUMMARY_LIMITS } from "@/definition/ConversationObserver";

import { OWNER } from "../chat/page48-chat-fixture";

import type { StoredGroupContext } from "@/backend/database/repositories/conversation/ConversationGroupContextRepository";
import type { ConversationGroupSummariesDependencies } from "@/backend/service/conversation/ConversationGroupSummaries";

it("PAGE-344 retries quota exhaustion on a later tick and advances only after a valid summary", async () => {
  let moment = new Date("2026-11-13T10:00:00Z");
  let stored: StoredGroupContext | null = null;
  const accounts = new ConversationAccounts(
    new Map([
      [
        OWNER.id,
        {
          user: OWNER,
          participant: {
            id: OWNER.id,
            name: "Owner",
            kind: "human",
            color: null,
          },
          isAvailable: true,
          role: "",
        },
      ],
    ]),
  );
  const dependencies: ConversationGroupSummariesDependencies = {
    contexts: {
      candidates: vi.fn(async () => [
        { conversationId: "group", throughSequence: 0 },
      ]),
      changedSources: vi.fn(async () => []),
      find: vi.fn(async () => stored),
      invalidate: vi.fn(),
      recordFailure: vi.fn(async (_id, failure) => {
        stored = {
          ...failure,
          conversationId: "group",
          summary: "",
          decisions: [],
          openItems: [],
          responsibilities: [],
          sources: [],
          throughSequence: 0,
          revision: 0,
          hasExcerpts: false,
          updatedAt: null,
        };
      }),
      pendingCount: vi.fn(async () => 0),
      saveSummary: vi.fn(async () => true),
    },
    messages: {
      contentAfter: vi.fn(async () => [
        {
          id: "m1",
          conversationId: "group",
          sequence: 1,
          senderId: OWNER.id,
          text: "Decision",
          clientMessageId: "client",
          mentions: [],
          notice: null,
          voice: null,
          createdAt: moment.toISOString(),
        },
      ]),
    },
    conversations: {
      findForMember: vi.fn<
        ConversationGroupSummariesDependencies["conversations"]["findForMember"]
      >(async () => ({
        id: "group",
        name: "Team",
        kind: "group",
        lastActivityAt: moment.toISOString(),
        isMuted: false,
        unreadCount: 0,
      })),
    },
    rounds: { findByReply: vi.fn() },
    directory: { read: vi.fn(async () => accounts) },
    model: {
      ask: vi
        .fn()
        .mockRejectedValueOnce(
          new ConversationObserverError("provider_quota_exhausted"),
        )
        .mockResolvedValueOnce(
          JSON.stringify({
            summary: "Decision kept",
            decisions: ["Decision"],
            openItems: [],
            responsibilities: [],
          }),
        ),
    },
    now: () => moment,
  };
  const service = new ConversationGroupSummaries(dependencies);
  await service.runDue();
  expect(dependencies.contexts.recordFailure).toHaveBeenCalledWith(
    "group",
    expect.objectContaining({
      status: "unavailable",
      errorCode: "provider_quota_exhausted",
    }),
  );
  expect(dependencies.contexts.saveSummary).not.toHaveBeenCalled();
  await service.runDue();
  expect(dependencies.model.ask).toHaveBeenCalledOnce();
  moment = new Date(
    moment.getTime() + CONVERSATION_SUMMARY_LIMITS.intervalMilliseconds,
  );
  await service.runDue();
  expect(dependencies.model.ask).toHaveBeenCalledTimes(2);
  expect(dependencies.contexts.saveSummary).toHaveBeenCalledWith(
    "group",
    expect.objectContaining({
      throughSequence: 1,
      summary: "Decision kept",
      status: "current",
    }),
    0,
  );
});
