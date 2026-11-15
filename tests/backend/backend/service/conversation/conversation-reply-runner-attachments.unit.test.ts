import { expect, it, vi } from "vitest";

import { ConversationGeneratedImages } from "@/backend/service/conversation/content/ConversationGeneratedImages";
import { ConversationReplyRunner } from "@/backend/service/conversation/ConversationReplyRunner";

import {
  createReplyRunnerFixture,
  replyJob,
  replyStagedAttachment,
} from "./conversation-reply-runner-fixture";

import type { ConversationAgentRequest } from "@/backend/service/conversation/ConversationAgentReplies";

it("copies and binds workspace files inside the job callback before its workspace disappears", async () => {
  const { runner, answer, dependencies, messages } = createReplyRunnerFixture();
  let workspaceExists = true;
  vi.mocked(dependencies.agentFiles.select).mockImplementation(async () => {
    if (!workspaceExists) throw new Error("Workspace already removed");
    return {
      text: "Answer",
      lines: ["Answer", "![File](file:/workspace/report.txt)"],
      files: [
        {
          path: "/workspace/report.txt",
          name: "report.txt",
          mimeType: "text/plain",
          sizeBytes: 3,
          lineIndex: 1,
        },
      ],
    };
  });
  vi.mocked(dependencies.attachments.stage).mockImplementation(async () => {
    expect(workspaceExists).toBe(true);
    return replyStagedAttachment;
  });
  answer.mockImplementation(async (request: ConversationAgentRequest) => {
    await request.consumeAnswer?.("Answer");
    workspaceExists = false;
    return "Answer";
  });
  const result = await runner.run(replyJob);
  expect(result?.id).toBe("answer");
  expect(workspaceExists).toBe(false);
  expect(dependencies.attachments.bind).toHaveBeenCalledWith(
    expect.anything(),
    [replyStagedAttachment.id],
  );
  expect(dependencies.attachments.stage).toHaveBeenCalledOnce();
  expect(messages.insert).toHaveBeenCalledOnce();
});

it("PAGE-382 attaches the images the agent generated during its answer, after the files of its lines", async () => {
  const { messages, dependencies } = createReplyRunnerFixture();
  const generatedImages = new ConversationGeneratedImages();
  generatedImages.add({ agentId: "agent", conversationId: "group" }, [
    "generated-1",
    "generated-2",
  ]);
  vi.mocked(dependencies.agentFiles.select).mockResolvedValueOnce({
    text: "Hier:",
    files: [
      {
        path: "/home/a/Results/eins.png",
        name: "eins.png",
        mimeType: "image/png",
        sizeBytes: 3,
        lineIndex: 1,
      },
    ],
    lines: ["Hier:", "![Eins](file:/home/a/Results/eins.png)"],
  });
  vi.mocked(dependencies.attachments.stage).mockResolvedValueOnce(
    replyStagedAttachment,
  );
  const runner = new ConversationReplyRunner({
    ...dependencies,
    generatedImages,
  });
  await runner.run(replyJob);
  expect(messages.insert).toHaveBeenCalledWith(
    expect.objectContaining({ text: "Hier:" }),
    expect.anything(),
  );
  expect(dependencies.attachments.bind).toHaveBeenCalledWith(
    { id: "answer", conversationId: "group", senderId: "agent" },
    ["attachment-1", "generated-1", "generated-2"],
  );
  // Taken once: the next answer does not carry them again.
  expect(
    generatedImages.count({ agentId: "agent", conversationId: "group" }),
  ).toBe(0);
});

it("PAGE-382 lets generated images go when the round ends with a hint instead of an answer", async () => {
  const { dependencies, answer } = createReplyRunnerFixture();
  const generatedImages = new ConversationGeneratedImages();
  generatedImages.add({ agentId: "agent", conversationId: "group" }, [
    "generated-1",
  ]);
  answer.mockRejectedValueOnce(new Error("model failed"));
  const runner = new ConversationReplyRunner({
    ...dependencies,
    generatedImages,
  });
  await runner.run(replyJob);
  expect(dependencies.attachments.bind).not.toHaveBeenCalled();
  expect(dependencies.attachments.release).toHaveBeenCalledWith("agent", [
    "generated-1",
  ]);
});

it("PAGE-386 shows an earlier attachment of the chat by its reference line and binds it to the stored answer", async () => {
  const { messages, dependencies } = createReplyRunnerFixture();
  const pending = {
    attachmentId: "table",
    name: "Kosten.xlsx",
    mimeType: "text/csv",
    sourceMessageId: "message-table",
    sourceSenderId: "conan",
  };
  const references = {
    select: vi.fn().mockResolvedValue({
      text: "Siehe die Tabelle von Conan.",
      references: [pending],
    }),
    bind: vi.fn().mockResolvedValue(undefined),
  };
  const withReferences = new ConversationReplyRunner({
    ...dependencies,
    references,
  });
  vi.mocked(dependencies.runner.answer).mockResolvedValueOnce(
    "Siehe die Tabelle von Conan.\n![Kosten](anhang:table)",
  );
  await withReferences.run(replyJob);
  expect(references.select).toHaveBeenCalledWith(
    "group",
    "agent",
    "Siehe die Tabelle von Conan.\n![Kosten](anhang:table)",
  );
  expect(dependencies.agentFiles.select).toHaveBeenCalledWith(
    "Siehe die Tabelle von Conan.",
  );
  expect(references.bind).toHaveBeenCalledWith(
    expect.objectContaining({ id: "answer", conversationId: "group" }),
    [pending],
  );
  expect(dependencies.attachments.stage).not.toHaveBeenCalled();
  expect(messages.insert).toHaveBeenCalledOnce();
});
