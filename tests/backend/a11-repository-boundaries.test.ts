import { expect, it } from "vitest";

import { AdministrationActivityRepository } from "@/backend/database/repositories/AdministrationActivityRepository";
import { ChatAttachmentRepository } from "@/backend/database/repositories/chat/ChatAttachmentRepository";
import { ChatSessionRepository } from "@/backend/database/repositories/chat/ChatSessionRepository";
import { ChatSettingsRepository } from "@/backend/database/repositories/chat/ChatSettingsRepository";
import { ProjectActivityRepository } from "@/backend/database/repositories/project/ProjectActivityRepository";
import { CHAT_ATTACHMENT_LIMITS, CHAT_MEBIBYTE } from "@/definition/Chat";

import { createDatabase } from "../helpers/factories";

it("rejects unsupported persisted administration activity origins", async () => {
  const database = createDatabase();
  database.query.mockResolvedValue([
    [
      "activity",
      "actor",
      "admin.users.list",
      "ui",
      "person",
      "target",
      "{}",
      "2026-10-12",
    ],
  ]);
  await expect(
    new AdministrationActivityRepository(database).findAll(),
  ).rejects.toThrow("Invalid administration activity source.");
});

it.each(["ui", "mcp", "ai", "foreign"])(
  "validates project activity source %s explicitly",
  async (source) => {
    const database = createDatabase();
    database.query.mockResolvedValue([
      [
        "activity",
        "project",
        "actor",
        "Actor",
        "project",
        "updated",
        "Updated",
        "2026-10-12",
        source,
      ],
    ]);
    const activity = new ProjectActivityRepository(database).findByProjectId(
      "project",
    );
    if (source === "foreign") {
      await expect(activity).rejects.toThrow(
        "Invalid project activity source.",
      );
      return;
    }
    await expect(activity).resolves.toEqual([
      expect.objectContaining({ source, id: "activity" }),
    ]);
  },
);

it("returns documented chat defaults when no settings row exists", async () => {
  const database = createDatabase();
  database.query.mockResolvedValue([]);
  await expect(new ChatSettingsRepository(database).read()).resolves.toEqual({
    attachmentLimitBytes:
      CHAT_ATTACHMENT_LIMITS.defaultMegabytes * CHAT_MEBIBYTE,
    systemInstruction: null,
  });
});

it("rejects an unsupported persisted message role", async () => {
  const database = createDatabase();
  database.query.mockResolvedValue([
    ["message", "system", "Text", "2026-10-12"],
  ]);
  await expect(
    new ChatSessionRepository(database).messages("session"),
  ).rejects.toThrow('Database returned an unsupported chat role "system".');
});

it("refuses appending when the owner's session disappeared before the transaction", async () => {
  const database = createDatabase();
  database.query.mockResolvedValue([]);
  await expect(
    new ChatSessionRepository(database).append("owner", "session", {
      role: "user",
      content: "Text",
    }),
  ).rejects.toMatchObject({ code: "sessionMissing" });
  expect(database.query).toHaveBeenCalledOnce();
  expect(database.execute).not.toHaveBeenCalled();
});

it("does not record an attachment at a missing or foreign session", async () => {
  const database = createDatabase();
  database.query.mockResolvedValue([]);
  await expect(
    new ChatAttachmentRepository(database).insert("owner", {
      sessionId: "foreign",
      fileName: "readme.txt",
      contentType: "text/plain",
      size: 4,
      storageName: "storage",
    }),
  ).resolves.toBeNull();
  expect(database.query).toHaveBeenCalledWith(
    expect.stringContaining("user_id = $user_id"),
    expect.objectContaining({ user_id: "owner", session_id: "foreign" }),
  );
});
