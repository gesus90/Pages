import { randomUUID } from "node:crypto";

import { logCaughtError } from "@/backend/logging/Logger";
import {
  CONVERSATION_AGENT_REPLY_PREFIX,
  CONVERSATION_TEXT_MAXIMUM_LENGTH,
} from "@/definition/Conversation";
import { CONVERSATION_ATTACHMENT_MAXIMUM_COUNT } from "@/definition/ConversationContent";

import { findConversationMentions } from "./ConversationMentions";
import { toConversationMessage } from "./ConversationReader";
import { changedEvent } from "./ConversationReplyNotices";
import { agentSelectionText } from "./content/ConversationAgentFiles";
import { EMPTY_MESSAGE_CONTENT } from "./content/ConversationMessageContent";

import type { StoredConversationMessage } from "@/backend/database/repositories/conversation/ConversationMessageRepository";
import type { ConversationTargetState } from "@/backend/database/repositories/conversation/ConversationRoundRepository";
import type {
  ConversationMessage,
  ConversationNotice,
} from "@/definition/Conversation";
import type { AgentFile } from "./content/ConversationAgentFiles";
import type { PendingAttachmentReference } from "./content/ConversationAttachmentReferences";
import type { ConversationAccounts } from "./ConversationDirectory";
import type { LiveAnswerSink } from "./ConversationLiveAnswer";
import type {
  ConversationReplyJob,
  ConversationReplyRunnerDependencies,
} from "./ConversationReplyTypes";

const COMPONENT = "ConversationAgentReplies";

/** What posting one agent answer or hint needs from the runner. */
export interface ReplyPostHost {
  readonly dependencies: ConversationReplyRunnerDependencies;
  readonly now: () => string;
  readonly setState: (
    job: ConversationReplyJob,
    state: ConversationTargetState,
    details?: {
      readonly replyMessageId?: string;
      readonly notice?: ConversationNotice | null;
    },
  ) => Promise<void>;
}

/**
 * Stores the answer or hint as the agent's message and announces it.
 * @returns The stored answer; `null` for a hint or a repeated store.
 */
export async function postConversationReply(
  host: ReplyPostHost,
  job: ConversationReplyJob,
  accounts: ConversationAccounts,
  reply: {
    readonly text: string;
    readonly notice: ConversationNotice | null;
    readonly liveAnswer?: LiveAnswerSink;
  },
): Promise<ConversationMessage | null> {
  const { conversation, memberIds } = job.round;
  const staged = await stageReplyPayload(host, job, accounts, reply);
  const agentAnswer = reply.liveAnswer?.complete();
  let outcome: Awaited<
    ReturnType<ConversationReplyRunnerDependencies["messages"]["insert"]>
  >;
  try {
    outcome = await host.dependencies.messages.insert(
      {
        id: randomUUID(),
        conversationId: conversation.id,
        senderId: job.agentId,
        // One key per asking message: an agent may answer a round again and again;
        // the answer to the round's own message keeps its earlier key.
        clientMessageId: `${CONVERSATION_AGENT_REPLY_PREFIX}${job.round.originMessageId}${job.triggerMessageId === job.round.originMessageId ? "" : `:${job.triggerMessageId}`}`,
        text: staged.text,
        mentions: staged.mentions,
        createdAt: host.now(),
        voice: null,
        notice: reply.notice,
        ...(agentAnswer ? { agentAnswer } : {}),
      },
      changedEvent(conversation.id),
    );
  } catch (error: unknown) {
    await releaseReplyFiles(
      host.dependencies,
      job.agentId,
      staged.attachmentIds,
    );
    throw error;
  }
  // Round and attachment updates can fail after the message has committed.
  if (outcome.isNew && reply.notice === null)
    reply.liveAnswer?.finish({
      messageId: outcome.message.id,
      state: "answered",
    });
  await host.setState(job, reply.notice === null ? "answered" : "failed", {
    replyMessageId: outcome.message.id,
    notice: reply.notice,
  });
  if (!outcome.isNew) {
    // A repeated store keeps the first answer; the copies of this one go.
    await releaseReplyFiles(
      host.dependencies,
      job.agentId,
      staged.attachmentIds,
    );
    return null;
  }
  await bindReplyFiles(
    host.dependencies,
    outcome.message,
    staged.attachmentIds,
  );
  await bindReplyReferences(
    host.dependencies,
    outcome.message,
    staged.references,
  );
  const content = await host.dependencies.content.describe([outcome.message]);
  const message = toConversationMessage(
    outcome.message,
    accounts,
    content.get(outcome.message.id) ?? EMPTY_MESSAGE_CONTENT,
  );
  host.dependencies.publisher.publish(changedEvent(conversation.id));
  host.dependencies.events.publish({
    kind: "message",
    message,
    recipientIds: memberIds,
  });
  if (reply.notice !== null) return null;
  return message;
}

async function stageReplyPayload(
  host: ReplyPostHost,
  job: ConversationReplyJob,
  accounts: ConversationAccounts,
  reply: {
    readonly text: string;
    readonly notice: ConversationNotice | null;
  },
): Promise<{
  readonly text: string;
  readonly mentions: readonly string[];
  readonly attachmentIds: readonly string[];
  readonly references: readonly PendingAttachmentReference[];
}> {
  const { conversation, memberIds } = job.round;
  // A hint of Pages attaches nothing; an answer attaches its file lines and shows its references.
  const referenced =
    reply.notice === null && host.dependencies.references
      ? await host.dependencies.references.select(
          conversation.id,
          job.agentId,
          reply.text,
        )
      : { text: reply.text, references: [] };
  const selection =
    reply.notice === null
      ? await host.dependencies.agentFiles.select(referenced.text)
      : null;
  // The files are stored first, so a file that fails keeps its line with the reason.
  const files = selection
    ? await stageReplyFiles(
        host.dependencies,
        conversation.id,
        job.agentId,
        selection.files,
      )
    : { attachmentIds: [], failed: [] };
  const staged = await withGeneratedImages(
    host.dependencies,
    job,
    files,
    reply.notice,
  );
  const text = Array.from(
    selection ? agentSelectionText(selection, staged.failed) : reply.text,
  )
    .slice(0, CONVERSATION_TEXT_MAXIMUM_LENGTH)
    .join("");
  // An answer mentions as a person's message does, so it can hand over.
  const mentions =
    reply.notice === null && conversation.kind === "group"
      ? findConversationMentions(text, memberIds, {
          accounts,
          senderId: job.agentId,
        })
      : [];
  return {
    text,
    mentions,
    attachmentIds: staged.attachmentIds,
    references: referenced.references,
  };
}

async function withGeneratedImages(
  dependencies: ConversationReplyRunnerDependencies,
  job: ConversationReplyJob,
  files: { attachmentIds: string[]; failed: AgentFile[] },
  notice: ConversationNotice | null,
): Promise<{ attachmentIds: string[]; failed: AgentFile[] }> {
  const generated =
    dependencies.generatedImages?.take({
      agentId: job.agentId,
      conversationId: job.round.conversation.id,
    }) ?? [];
  if (generated.length === 0) return files;
  const room =
    notice === null
      ? Math.max(
          0,
          CONVERSATION_ATTACHMENT_MAXIMUM_COUNT - files.attachmentIds.length,
        )
      : 0;
  await releaseReplyFiles(dependencies, job.agentId, generated.slice(room));
  return {
    attachmentIds: [...files.attachmentIds, ...generated.slice(0, room)],
    failed: files.failed,
  };
}

/**
 * Stores one file of an answer: a web export package with all its files, a
 * model with its PNG start image as preview image, any other file as it is.
 */
async function stageReplyFile(
  dependencies: ConversationReplyRunnerDependencies,
  target: { readonly conversationId: string; readonly senderId: string },
  file: AgentFile,
): Promise<{ readonly id: string }> {
  if (file.webPackage && dependencies.webPackages)
    return dependencies.webPackages.stage(target, file.webPackage);
  return dependencies.attachments.stage(target, {
    name: file.name,
    // Without the package store a manifest is a plain JSON file.
    mimeType: file.webPackage ? "application/json" : file.mimeType,
    source: dependencies.agentFiles.open(file),
    ...(file.posterPath
      ? {
          thumbnail: {
            mimeType: "image/png",
            source: dependencies.agentFiles.open({ path: file.posterPath }),
          },
        }
      : {}),
  });
}

async function stageReplyFiles(
  dependencies: ConversationReplyRunnerDependencies,
  conversationId: string,
  agentId: string,
  files: readonly AgentFile[],
): Promise<{ attachmentIds: string[]; failed: AgentFile[] }> {
  const attachmentIds: string[] = [];
  const failed: AgentFile[] = [];
  for (const file of files) {
    try {
      const stored = await stageReplyFile(
        dependencies,
        { conversationId, senderId: agentId },
        file,
      );
      attachmentIds.push(stored.id);
    } catch (error: unknown) {
      // The line of the file stays in the answer with the reason.
      logCaughtError(COMPONENT, error);
      failed.push(file);
    }
  }
  return { attachmentIds, failed };
}

async function bindReplyReferences(
  dependencies: ConversationReplyRunnerDependencies,
  answer: StoredConversationMessage,
  references: readonly PendingAttachmentReference[],
): Promise<void> {
  try {
    await dependencies.references?.bind(answer, references);
  } catch (error: unknown) {
    logCaughtError(COMPONENT, error);
  }
}

async function bindReplyFiles(
  dependencies: ConversationReplyRunnerDependencies,
  answer: StoredConversationMessage,
  attachmentIds: readonly string[],
): Promise<void> {
  if (attachmentIds.length === 0) return;
  try {
    await dependencies.attachments.bind(
      {
        id: answer.id,
        conversationId: answer.conversationId,
        senderId: answer.senderId,
      },
      attachmentIds,
    );
  } catch (error: unknown) {
    logCaughtError(COMPONENT, error);
    await releaseReplyFiles(dependencies, answer.senderId, attachmentIds);
  }
}

async function releaseReplyFiles(
  dependencies: ConversationReplyRunnerDependencies,
  agentId: string,
  attachmentIds: readonly string[],
): Promise<void> {
  if (attachmentIds.length === 0) return;
  try {
    await dependencies.attachments.release(agentId, attachmentIds);
  } catch (error: unknown) {
    logCaughtError(COMPONENT, error);
  }
}
