import { expect, it, vi } from "vitest";

import {
  installWorkerHooks,
  mocks,
  state,
  scriptCommand,
  runWorker,
  storedResult,
} from "./runner-execution-worker-harness";

installWorkerHooks();

const MODEL_FILES = {
  "openrouter.json": {
    apiKey: "router-key-value",
    syncedAt: "rev-1",
    models: [
      { id: "free/model", isFree: true, supportsImages: false },
      { id: "paid/model", isFree: false },
    ],
  },
};

function modelCommand(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return scriptCommand({
    program: {
      kind: "model",
      model: "free/model",
      prompt: "question",
      route: { catalogRevision: "rev-1" },
    },
    ...overrides,
  });
}

function completion(content: unknown): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
  });
}

it("asks the free OpenRouter model and returns the redacted answer", async () => {
  const fetchMock = vi.fn(async () =>
    completion("answer with router-key-value inside"),
  );
  vi.stubGlobal("fetch", fetchMock);
  mocks.modelAssetContent.mockResolvedValue("question-content");

  await runWorker({ command: modelCommand(), files: MODEL_FILES });

  expect(mocks.modelAssetContent).toHaveBeenCalledWith(
    state.folder,
    "question",
    false,
  );
  const [url, init] = fetchMock.mock.calls[0] as unknown as [
    string,
    RequestInit & { headers: Record<string, string> },
  ];
  expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
  expect(init.redirect).toBe("error");
  expect(init.headers.Authorization).toBe("Bearer router-key-value");
  expect(JSON.parse(init.body as string)).toEqual({
    model: "free/model",
    messages: [{ role: "user", content: "question-content" }],
    max_tokens: 512,
  });
  expect(mocks.spawn).not.toHaveBeenCalled();
  expect(await storedResult()).toEqual({
    status: "completed",
    result: {
      output: "answer with [redacted] inside",
      exitCode: 0,
      signal: null,
      reason: null,
      closeout: "confirmed",
    },
  });
});

it.each([
  ["no provider catalog", {}, "free/model"],
  [
    "a changed catalog revision",
    { "openrouter.json": { ...MODEL_FILES["openrouter.json"], syncedAt: "x" } },
    "free/model",
  ],
  ["a model that is no longer free", MODEL_FILES, "paid/model"],
  ["an unknown model", MODEL_FILES, "other/model"],
])("refuses a model job with %s", async (label, files, model) => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const command = modelCommand();

  await runWorker({
    command: {
      ...command,
      program: { ...(command.program as object), model },
    },
    files,
  });

  expect(fetchMock).not.toHaveBeenCalled();
  expect(await storedResult()).toMatchObject({
    status: "failed",
    result: { reason: "spawn", output: null },
  });
});

it("cancels the body of a refused model request", async () => {
  const cancel = vi.fn(async () => undefined);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, body: { cancel } })),
  );

  await runWorker({ command: modelCommand(), files: MODEL_FILES });

  expect(cancel).toHaveBeenCalled();
  expect((await storedResult()).result.reason).toBe("spawn");
});

it("handles a refused model request without a body", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false })),
  );

  await runWorker({ command: modelCommand(), files: MODEL_FILES });

  expect((await storedResult()).status).toBe("failed");
});

it("stops reading a model answer above the output budget", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => completion("x".repeat(200))),
  );

  await runWorker({
    command: modelCommand({ outputBytes: 20 }),
    files: MODEL_FILES,
  });

  expect(await storedResult()).toMatchObject({
    status: "failed",
    result: { output: null, exitCode: 1, reason: "output_limit" },
  });
});

it.each([
  ["a non-text answer", 42],
  ["a blank answer", "   "],
  ["a missing answer", undefined],
])("fails a model job with %s", async (label, content) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => completion(content)),
  );

  await runWorker({ command: modelCommand(), files: MODEL_FILES });

  expect(await storedResult()).toMatchObject({
    status: "failed",
    result: { output: null, reason: "spawn" },
  });
});

it("fails a model job whose answer carries no choices", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 200 })),
  );

  await runWorker({ command: modelCommand(), files: MODEL_FILES });

  expect((await storedResult()).status).toBe("failed");
});
