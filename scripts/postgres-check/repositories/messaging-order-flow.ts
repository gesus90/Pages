import { ChatSteerRepository } from "@/backend/database/repositories/chat/ChatSteerRepository";
import { ChatAttachmentRepository } from "@/backend/database/repositories/chat/ChatAttachmentRepository";
import { DiscordAttemptRepository } from "@/backend/database/repositories/discord/DiscordAttemptRepository";
import { DiscordDeliveryRepository } from "@/backend/database/repositories/discord/DiscordDeliveryRepository";
import { PersonalAgentTokenRepository } from "@/backend/database/repositories/mcp/PersonalAgentTokenRepository";
import { PicaMobileNotificationDeliveryRepository } from "@/backend/database/repositories/mobile/PicaMobileNotificationDeliveryRepository";
import { PicaMobileNotificationEventRepository } from "@/backend/database/repositories/mobile/PicaMobileNotificationEventRepository";

import { inOrder } from "./saved-order-flows";
import { call, prepare, reversedInPostgres, stored } from "./world";

import type { RepositoryFlow, RepositoryStep } from "./world";

const USER = "user-order-messaging";
const SESSION = "chat-order";
const PROJECT = "project-order-messaging";
const T1 = "2026-04-01T08:00:00.000Z";
const T2 = "2026-04-01T09:00:00.000Z";
const LATER = "2026-04-02T09:00:00.000Z";
/** Created in this order, so a sort by identifier or by name shows. */
const CREATED = ["order-z", "order-a", "order-m"] as const;

function createdRows(statement: string): readonly RepositoryStep[] {
  return CREATED.map((id) => prepare(statement, { id }));
}

const OUTBOX_ROW = `
  INSERT INTO pica_mobile_notification_deliveries (
      delivery_id, event_id, device_id, account_id, run_id, event_type, seq, state,
      attempts, not_before, expires_at, created_at
  )
  VALUES (
      $id, 'event', $id, '${USER}', 'run-order', 'step_started', 1, 'pending',
      0, '${T1}', '${LATER}', '${T1}'
  );
`;

const ANSWER_FILE = `
  INSERT INTO chat_attachments (
      id, session_id, file_name, content_type, size, storage_name, origin, pica_run_id
  )
  VALUES ($id, '${SESSION}', 'gleich.txt', 'text/plain', 1, $id, 'assistant', 'run-order');
`;

/** Rows with equal sort keys come back as they were created, on both databases. */
export const MESSAGING_ORDER_FLOW: RepositoryFlow = {
  title: "messaging creation order",
  steps: [
    ...createdRows(`
      INSERT INTO personal_agent_tokens (id, user_id, name, token_hash, created_at)
      VALUES ($id, '${USER}', $id, $id, 5);
    `),
    reversedInPostgres("personal_agent_tokens"),
    call("PersonalAgentTokenRepository.list", async ({ database }) =>
      inOrder(
        await new PersonalAgentTokenRepository(database).list(USER),
        [...CREATED],
        (token) => token.id,
      ),
    ),
    prepare(`DELETE FROM personal_agent_tokens WHERE user_id = '${USER}';`),

    ...CREATED.map((id) =>
      call("DiscordAttemptRepository.insertAttempt", ({ database }) =>
        new DiscordAttemptRepository(database).insertAttempt({
          id,
          stateHash: id,
          projectId: PROJECT,
          userId: USER,
          baseUrl: "https://pages.example",
          createdAt: T1,
          expiresAt: LATER,
        }),
      ),
    ),
    reversedInPostgres("discord_connection_attempts"),
    call("DiscordAttemptRepository.findLatestAttempt", async ({ database }) =>
      inOrder(
        [
          await new DiscordAttemptRepository(database).findLatestAttempt(
            PROJECT,
            USER,
          ),
        ],
        ["order-z"],
        (attempt) => attempt?.id,
      ),
    ),

    prepare("DELETE FROM discord_deliveries;"),
    ...(["ticket.created", "milestone.created"] as const).map(
      (eventType, index) =>
        call("DiscordDeliveryRepository.enqueueDelivery", ({ database }) =>
          new DiscordDeliveryRepository(database).enqueueDelivery({
            id: CREATED[index] ?? "",
            projectId: PROJECT,
            eventType,
            subjectKey: "/tasks/PAGE-ORDER",
            contentJson: "{}",
            now: T1,
          }),
        ),
    ),
    reversedInPostgres("discord_deliveries"),
    call("DiscordDeliveryRepository.enqueueDelivery", ({ database }) =>
      new DiscordDeliveryRepository(database).enqueueDelivery({
        id: "order-merged",
        projectId: PROJECT,
        eventType: "ticket.updated",
        subjectKey: "/tasks/PAGE-ORDER",
        contentJson: '{"merged":true}',
        now: T1,
      }),
    ),
    stored(
      "SELECT id, content_json FROM discord_deliveries ORDER BY creation_order;",
    ),
    call("DiscordDeliveryRepository.claimDue", async ({ database }) =>
      inOrder(
        await new DiscordDeliveryRepository(database).claimDue(T1, LATER, 1),
        ["order-z"],
        (delivery) => delivery.id,
      ),
    ),
    prepare(
      `UPDATE discord_deliveries SET status = 'pending', locked_until = NULL;`,
    ),
    call("DiscordDeliveryRepository.claimDue", async ({ database }) =>
      inOrder(
        await new DiscordDeliveryRepository(database).claimDue(T1, LATER, 5),
        ["order-z", "order-a"],
        (delivery) => delivery.id,
      ),
    ),
    ...(
      [
        ["order-z", "rate_limited"],
        ["order-a", "bot_removed"],
      ] as const
    ).map(([id, problem]) =>
      call("DiscordDeliveryRepository.reschedule", ({ database }) =>
        new DiscordDeliveryRepository(database).reschedule(id, {
          attempts: 1,
          nextAttemptAt: LATER,
          problem,
          now: T2,
        }),
      ),
    ),
    reversedInPostgres("discord_deliveries"),
    call("DiscordDeliveryRepository.summarize", async ({ database }) =>
      inOrder(
        [await new DiscordDeliveryRepository(database).summarize(PROJECT)],
        ["rate_limited"],
        (summary) => summary.lastProblem,
      ),
    ),
    prepare("DELETE FROM discord_deliveries;"),

    prepare("DELETE FROM pica_mobile_notification_deliveries;"),
    ...createdRows(OUTBOX_ROW),
    reversedInPostgres("pica_mobile_notification_deliveries"),
    call(
      "PicaMobileNotificationDeliveryRepository.claimDue",
      async ({ database }) =>
        inOrder(
          await new PicaMobileNotificationDeliveryRepository(database).claimDue(
            T1,
            LATER,
            2,
          ),
          ["order-z", "order-a"],
          (delivery) => delivery.deliveryId,
        ),
    ),
    prepare("DELETE FROM pica_mobile_notification_deliveries;"),

    prepare("DELETE FROM pica_mobile_notification_events;"),
    ...createdRows(`
      INSERT INTO pica_mobile_notification_events (
          event_id, account_id, plan_id, run_id, seq, event_type, occurred_at
      )
      VALUES ($id, '${USER}', 'plan', $id, 1, 'run_failed', '${T2}');
    `),
    reversedInPostgres("pica_mobile_notification_events"),
    call("PicaMobileNotificationEventRepository.prune", ({ database }) =>
      new PicaMobileNotificationEventRepository(database).prune({
        eventsBefore: T1,
        deliveriesBefore: T1,
        maximumEventsPerAccount: 2,
      }),
    ),
    call("stored", async ({ database }) =>
      inOrder(
        await database.query(
          "SELECT event_id FROM pica_mobile_notification_events ORDER BY creation_order;",
        ),
        ["order-z", "order-a"],
        (row) => row[0],
      ),
    ),
    prepare("DELETE FROM pica_mobile_notification_events;"),

    ...CREATED.map((messageId) =>
      call("ChatSteerRepository.create", ({ database }) =>
        new ChatSteerRepository(database).create(
          { messageId, jobId: "job-order" },
          SESSION,
        ),
      ),
    ),
    reversedInPostgres("chat_steers"),
    call("ChatSteerRepository.list", async ({ database }) =>
      inOrder(
        await new ChatSteerRepository(database).list(SESSION),
        [...CREATED],
        (steer) => steer.messageId,
      ),
    ),
    ...CREATED.map((messageId) =>
      call("ChatSteerRepository.select", ({ database }) =>
        new ChatSteerRepository(database).select(SESSION, {
          messageId,
          items: [],
        }),
      ),
    ),
    reversedInPostgres("chat_selections"),
    call("ChatSteerRepository.selections", async ({ database }) =>
      inOrder(
        await new ChatSteerRepository(database).selections(SESSION),
        [...CREATED],
        (selection) => selection.messageId,
      ),
    ),

    ...createdRows(ANSWER_FILE),
    reversedInPostgres("chat_attachments"),
    call("ChatAttachmentRepository.claimAnswerFiles", async ({ database }) =>
      inOrder(
        await new ChatAttachmentRepository(database).claimAnswerFiles(
          SESSION,
          "run-order",
          "message-order",
        ),
        [...CREATED],
        (file) => file.storageName,
      ),
    ),
    prepare(`DELETE FROM chat_attachments WHERE session_id = '${SESSION}';`),
    ...createdRows(ANSWER_FILE),
    reversedInPostgres("chat_attachments"),
    call(
      "ChatAttachmentRepository.removeUnclaimedAnswerFiles",
      async ({ database }) =>
        inOrder(
          (
            await new ChatAttachmentRepository(
              database,
            ).removeUnclaimedAnswerFiles(SESSION, null)
          ).map((storageName) => [storageName]),
          [...CREATED],
          (row) => row[0],
        ),
    ),
    prepare(`DELETE FROM chat_steers WHERE session_id = '${SESSION}';`),
    prepare(`DELETE FROM chat_selections WHERE session_id = '${SESSION}';`),
    prepare(
      `DELETE FROM discord_connection_attempts WHERE project_id = '${PROJECT}';`,
    ),
  ],
};
