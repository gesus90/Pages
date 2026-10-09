import { Readable } from "node:stream";

import { RouterContextProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: vi.fn(),
}));

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { describeTicketUploadFailure } from "@/app/lib/task-actions/ticket-upload.server";
import TasksLayout, {
  loader as layoutLoader,
  shouldRevalidate,
} from "@/app/routes/tasks-layout";
import { loader as downloadLoader } from "@/app/routes/ticket-attachment";
import { action as uploadAction } from "@/app/routes/ticket-attachments";
import { ProjectAccessDeniedError } from "@/backend/error/ProjectErrors";
import {
  WorkItemAccessDeniedError,
  WorkItemNotFoundError,
  WorkItemValidationError,
} from "@/backend/error/WorkItemErrors";

import { createUser } from "../helpers/factories";

import type { ShouldRevalidateFunctionArgs } from "react-router";

const user = createUser();
const open = vi.fn();
const upload = vi.fn();
const findEntries = vi.fn();
const findExpandedKeys = vi.fn();

function context(actor: typeof user | null): RouterContextProvider {
  const provider = new RouterContextProvider();

  if (actor) {
    provider.set(authenticatedUserContext, actor);
  }

  return provider;
}

beforeEach(() => {
  vi.mocked(getApplicationServices).mockResolvedValue({
    taskAttachmentService: { open, upload },
    ticketTreeService: { findEntries, findExpandedKeys },
  } as never);
});

describe("ticket layout", () => {
  it("loads the tree of the person", async () => {
    findEntries.mockResolvedValue([{ id: "t1" }]);
    findExpandedKeys.mockResolvedValue(["t1"]);

    await expect(
      layoutLoader({ context: context(user) } as never),
    ).resolves.toEqual({ entries: [{ id: "t1" }], expandedKeys: ["t1"] });
    expect(findEntries).toHaveBeenCalledWith(user);
    await expect(
      layoutLoader({ context: context(null) } as never),
    ).rejects.toThrow("Authenticated middleware did not provide a user.");
  });

  it("reloads after changes and refreshes, not on moves between ticket pages", () => {
    const base = (
      overrides: Partial<ShouldRevalidateFunctionArgs>,
    ): ShouldRevalidateFunctionArgs =>
      ({
        currentUrl: new URL("http://pages.invalid/aufgaben"),
        defaultShouldRevalidate: true,
        nextUrl: new URL("http://pages.invalid/aufgaben/PAGE-1"),
        ...overrides,
      }) as ShouldRevalidateFunctionArgs;
    const form = (intent: string): FormData => {
      const data = new FormData();

      data.set("intent", intent);

      return data;
    };

    expect(shouldRevalidate(base({}))).toBe(false);
    expect(
      shouldRevalidate(
        base({ nextUrl: new URL("http://pages.invalid/aufgaben") }),
      ),
    ).toBe(true);
    expect(shouldRevalidate(base({ formData: form("change-parent") }))).toBe(
      true,
    );
    expect(
      shouldRevalidate(base({ formData: form("set-tree-expanded") })),
    ).toBe(false);
    expect(
      shouldRevalidate(base({ formData: form("save-board-preferences") })),
    ).toBe(false);
    expect(TasksLayout()).toBeTruthy();
  });
});

describe("ticket attachment routes", () => {
  it("maps upload failures to answers", () => {
    expect(
      describeTicketUploadFailure(
        new WorkItemValidationError("attachmentTooLarge"),
      ),
    ).toEqual({ error: "attachmentTooLarge", status: 413 });
    expect(
      describeTicketUploadFailure(
        new WorkItemValidationError("attachmentFileEmpty"),
      ),
    ).toEqual({ error: "attachmentFileEmpty", status: 400 });
    expect(describeTicketUploadFailure(new WorkItemNotFoundError())).toEqual({
      error: "notFound",
      status: 404,
    });
    expect(describeTicketUploadFailure(new ProjectAccessDeniedError())).toEqual(
      { error: "notFound", status: 404 },
    );
    expect(
      describeTicketUploadFailure(new WorkItemAccessDeniedError()),
    ).toEqual({ error: "forbidden", status: 403 });
    expect(describeTicketUploadFailure(new Error("disk"))).toBeNull();
  });

  it("takes uploads only as PUT from signed-in people", async () => {
    const request = new Request(
      "http://pages.invalid/aufgaben-api/attachments?ticket=t1&name=a.txt",
      { body: "data", method: "PUT" },
    );

    upload.mockResolvedValue({ id: "a1" });
    const answer = await uploadAction({
      context: context(user),
      request,
    } as never);

    await expect(answer.json()).resolves.toEqual({ attachment: { id: "a1" } });
    expect(upload).toHaveBeenCalledWith(
      user,
      "t1",
      expect.objectContaining({ fileName: "a.txt" }),
    );

    await expect(
      uploadAction({
        context: context(user),
        request: new Request("http://pages.invalid/aufgaben-api/attachments", {
          method: "POST",
        }),
      } as never),
    ).rejects.toMatchObject({ status: 405 });
    await expect(
      uploadAction({
        context: context(null),
        request: new Request("http://pages.invalid/aufgaben-api/attachments", {
          method: "PUT",
        }),
      } as never),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("answers refused uploads with their reason and passes other failures on", async () => {
    const request = (): Request =>
      new Request("http://pages.invalid/aufgaben-api/attachments", {
        method: "PUT",
      });

    upload.mockRejectedValueOnce(new WorkItemAccessDeniedError());
    const refused = await uploadAction({
      context: context(user),
      request: request(),
    } as never);

    expect(refused.status).toBe(403);
    await expect(refused.json()).resolves.toEqual({ error: "forbidden" });
    expect(upload).toHaveBeenCalledWith(
      user,
      "",
      expect.objectContaining({ fileName: "" }),
    );

    upload.mockRejectedValueOnce(new Error("disk full"));
    await expect(
      uploadAction({ context: context(user), request: request() } as never),
    ).rejects.toThrow("disk full");
  });

  it("serves images inline and other files as downloads", async () => {
    const ask = (query = "", actor: typeof user | null = user) =>
      ({
        context: context(actor),
        params: { attachmentId: "a1" },
        request: new Request(
          `http://pages.invalid/aufgaben/attachments/a1${query}`,
        ),
      }) as never;
    const opened = (isEmbeddable: boolean) => ({
      attachment: {
        contentType: isEmbeddable ? "image/png" : "application/octet-stream",
        fileName: "Plan.png",
        isEmbeddable,
        size: 5,
      },
      stream: Readable.from([Buffer.from("bytes")]),
    });

    open.mockResolvedValueOnce(opened(true));
    const inline = await downloadLoader(ask());

    expect(inline.headers.get("Content-Disposition")).toContain("inline");
    expect(inline.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(inline.headers.get("Content-Security-Policy")).toContain("sandbox");
    await expect(inline.text()).resolves.toBe("bytes");

    open.mockResolvedValueOnce(opened(true));
    expect(
      (await downloadLoader(ask("?download=1"))).headers.get(
        "Content-Disposition",
      ),
    ).toContain("attachment");

    open.mockResolvedValueOnce(opened(false));
    expect(
      (await downloadLoader(ask())).headers.get("Content-Disposition"),
    ).toContain("attachment");

    open.mockRejectedValueOnce(new WorkItemNotFoundError());
    await expect(downloadLoader(ask())).rejects.toMatchObject({ status: 404 });

    open.mockRejectedValueOnce(new WorkItemAccessDeniedError());
    await expect(downloadLoader(ask())).rejects.toBeInstanceOf(
      WorkItemAccessDeniedError,
    );

    await expect(downloadLoader(ask("", null))).rejects.toMatchObject({
      status: 403,
    });
  });
});
