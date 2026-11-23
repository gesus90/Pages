import { describe, expect, it } from "vitest";

import { CalendarError } from "@/backend/error/CalendarError";
import { ChatError } from "@/backend/error/ChatErrors";
import { ConversationError } from "@/backend/error/ConversationError";
import { ConversationObserverError } from "@/backend/error/ConversationObserverError";
import { DecisionModelError } from "@/backend/error/DecisionModelError";
import { DiscordError } from "@/backend/error/DiscordErrors";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { McpDeviceError } from "@/backend/error/McpDeviceError";
import { PicaAcpJobError } from "@/backend/error/PicaAcpJobError";
import { PicaAuthorizationError } from "@/backend/error/PicaAuthorizationError";
import {
  RemoteError,
  isRemoteErrorCode,
  remoteErrorStatus,
} from "@/backend/error/RemoteErrors";
import {
  WIKI_ERROR_MESSAGES,
  WikiAccessDeniedError,
  WikiConflictError,
  WikiPageNotFoundError,
  WikiValidationError,
} from "@/backend/error/WikiErrors";
import type { WikiPage } from "@/definition/Wiki";

describe("service errors", () => {
  it("carry their code as message", () => {
    expect(new ChatError("disabled").message).toBe("disabled");
    expect(new ConversationError("forbidden").code).toBe("forbidden");
    expect(new ConversationObserverError("x").name).toBe(
      "ConversationObserverError",
    );
    expect(new DecisionModelError("decision_no_model").code).toBe(
      "decision_no_model",
    );
    expect(new DiscordError("not_configured").message).toBe("not_configured");
    expect(new PicaAcpJobError("job").code).toBe("job");
  });

  it("keeps the revision of a calendar error only when given", () => {
    expect(new CalendarError("conflict", "m", 4).currentRevision).toBe(4);
    expect(new CalendarError("conflict", "m").currentRevision).toBeUndefined();
  });

  it("rejects authorization with a status that defaults to 400", () => {
    const error = new McpAuthorizationError("c");

    expect(error.status).toBe(400);
    expect(new McpAuthorizationError("c", 403).status).toBe(403);
    expect(new PicaAuthorizationError().name).toBe("PicaAuthorizationError");
  });

  it("keeps status and retry delay of a device error", () => {
    const error = new McpDeviceError("slow_down");

    expect(error.status).toBe(400);
    expect(error.retryAfterSeconds).toBeNull();
    expect(new McpDeviceError("slow_down", 429, 5).retryAfterSeconds).toBe(5);
  });
});

describe("remote errors", () => {
  it("recognizes only known codes", () => {
    expect(isRemoteErrorCode("remote_access_denied")).toBe(true);
    expect(isRemoteErrorCode("nope")).toBe(false);
  });

  it("maps codes to a status with 400 as fallback", () => {
    expect(remoteErrorStatus("remote_access_denied")).toBe(403);
    expect(remoteErrorStatus("remote_connection_not_found")).toBe(404);
    expect(remoteErrorStatus("remote_conflict")).toBe(409);
    expect(remoteErrorStatus("remote_connection_invalid")).toBe(400);
  });

  it("keeps the failure detail only when given", () => {
    expect(new RemoteError("remote_conflict").failure).toBeNull();
    expect(new RemoteError("remote_conflict", "host_unknown").failure).toBe(
      "host_unknown",
    );
  });
});

describe("wiki errors", () => {
  it("takes the message of the validation code", () => {
    const error = new WikiValidationError("titleRequired");

    expect(error.code).toBe("titleRequired");
    expect(error.message).toBe(WIKI_ERROR_MESSAGES.titleRequired);
  });

  it("names missing pages and denied access", () => {
    expect(new WikiPageNotFoundError().name).toBe("WikiPageNotFoundError");
    expect(new WikiAccessDeniedError().name).toBe("WikiAccessDeniedError");
  });

  it("keeps the current page of a conflict", () => {
    const current: WikiPage = {
      id: "p",
      title: "T",
      icon: null,
      scope: "instance",
      projectId: null,
      projectName: null,
      parentId: null,
      ownerId: "u",
      ownerName: "U",
      currentUntil: null,
      updatedAt: "2026-01-01",
      createdAt: "2026-01-01",
      content: "",
      cover: null,
      revision: 1,
      isTemplate: false,
      updatedByName: null,
      anchors: [],
      breadcrumb: [],
    };

    expect(new WikiConflictError(current).current).toBe(current);
  });
});
