import { beforeEach, expect, it, vi } from "vitest";

import { action } from "@/app/routes/chat-api";

import { EMPLOYEE } from "../server-lib/request-fixtures";
import { routeArguments } from "../server-lib/route-arguments";

const SESSION_ID = "apfel-birne-kirsche-pflaume-traube";

const fakes = vi.hoisted(() => ({
  open: vi.fn(),
  create: vi.fn(),
  list: vi.fn(),
  view: vi.fn(),
  submit: vi.fn(),
  cancel: vi.fn(),
  discard: vi.fn(),
  protectOrigin: vi.fn(),
  update: vi.fn(),
  stop: vi.fn(),
  hasJobs: true,
}));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => ({
    chatSessionService: {
      open: fakes.open,
      create: fakes.create,
      list: fakes.list,
      view: fakes.view,
    },
    chatService: { submit: fakes.submit, cancel: fakes.cancel },
    chatAttachmentService: { discard: fakes.discard },
    picaAdminService: { protectOrigin: fakes.protectOrigin },
    picaAcpService: fakes.hasJobs
      ? { update: fakes.update, stop: fakes.stop }
      : null,
  }),
}));

beforeEach(() => {
  fakes.hasJobs = true;
});

async function call(input: unknown): Promise<{
  readonly status: number;
  readonly body: unknown;
}> {
  const response = await action(
    routeArguments(
      new Request("https://pages.example/chat-api", {
        method: "POST",
        body: JSON.stringify(input),
      }),
      EMPLOYEE,
      {},
    ),
  );
  return { status: response.status, body: await response.json() };
}

it("opens, creates, lists and views the own sessions", async () => {
  fakes.open.mockResolvedValue({ sessions: [] });
  fakes.create.mockResolvedValue({ id: "new" });
  fakes.list.mockResolvedValue(["listed"]);
  fakes.view.mockResolvedValue({ id: SESSION_ID });
  expect((await call({ intent: "open" })).body).toEqual({
    ok: true,
    overview: { sessions: [] },
  });
  expect((await call({ intent: "new" })).body).toEqual({
    ok: true,
    view: { id: "new" },
  });
  expect((await call({ intent: "sessions" })).body).toEqual({
    ok: true,
    sessions: ["listed"],
  });
  expect(
    (await call({ intent: "session", sessionId: SESSION_ID })).body,
  ).toEqual({ ok: true, view: { id: SESSION_ID } });
  expect(fakes.view).toHaveBeenCalledWith(EMPLOYEE, SESSION_ID);
});

it.each([
  [{ kind: "reply", reply: { text: "hi" } }, { reply: { text: "hi" } }],
  [{ kind: "job", job: { id: "job" } }, { job: { id: "job" } }],
  [{ kind: "steer", steer: { id: "steer" } }, { steer: { id: "steer" } }],
])(
  "sends a message, protects the origin and answers %j",
  async (sent, expected) => {
    fakes.submit.mockResolvedValue(sent);
    const result = await call({ intent: "send", message: "hello" });
    expect(result.body).toEqual({ ok: true, ...expected });
    expect(fakes.protectOrigin).toHaveBeenCalledWith("https://pages.example");
    expect(fakes.submit).toHaveBeenCalledWith(EMPLOYEE, "hello");
  },
);

it("reads a job update and stops a job when Pica jobs are available", async () => {
  fakes.update.mockResolvedValue({ cursor: 3 });
  const input = { intent: "job", sessionId: SESSION_ID, cursor: 2 };
  expect((await call(input)).body).toEqual({
    ok: true,
    update: { cursor: 3 },
  });
  expect(fakes.update).toHaveBeenCalledWith(EMPLOYEE, input);
  expect((await call({ intent: "stop", sessionId: SESSION_ID })).body).toEqual({
    ok: true,
  });
  expect(fakes.stop).toHaveBeenCalledWith(EMPLOYEE, SESSION_ID);
});

it("answers without update and ignores a stop when no job service exists", async () => {
  fakes.hasJobs = false;
  fakes.update.mockClear();
  fakes.stop.mockClear();
  expect((await call({ intent: "job", sessionId: SESSION_ID })).body).toEqual({
    ok: true,
    update: null,
  });
  expect((await call({ intent: "stop", sessionId: SESSION_ID })).body).toEqual({
    ok: true,
  });
  expect(fakes.update).not.toHaveBeenCalled();
  expect(fakes.stop).not.toHaveBeenCalled();
});

it("discards an attachment and cancels a request", async () => {
  fakes.discard.mockResolvedValue(undefined);
  expect(
    (await call({ intent: "discard", attachmentId: "attachment" })).body,
  ).toEqual({ ok: true });
  expect(fakes.discard).toHaveBeenCalledWith(EMPLOYEE, "attachment");
  expect((await call({ intent: "cancel", requestId: "request" })).body).toEqual(
    { ok: true },
  );
  expect(fakes.cancel).toHaveBeenCalledWith(EMPLOYEE, "request");
});

it("refuses an unknown intent with a stable error code", async () => {
  expect(await call({ intent: "unknown" })).toEqual({
    status: 400,
    body: { ok: false, error: "invalidInput" },
  });
});
