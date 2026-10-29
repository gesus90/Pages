import { RequestError, agent, client, methods } from "@agentclientprotocol/sdk";
import { afterEach, expect, it, vi } from "vitest";

import { createAcpSessionState } from "@/backend/agents/acp/AcpEvents";
import { confirmAcpConfiguration } from "@/backend/agents/acp/AcpSessionConfiguration";

import type {
  ClientConnection,
  SessionConfigOption,
  SetSessionConfigOptionRequest,
} from "@agentclientprotocol/sdk";
import type { AcpConfigurationTarget } from "@/backend/agents/acp/AcpSessionConfiguration";

const logging = vi.hoisted(() => ({ logCaughtError: vi.fn() }));

vi.mock("@/backend/logging/Logger", () => logging);

afterEach(() => {
  logging.logCaughtError.mockReset();
});

type Answer = (
  request: SetSessionConfigOptionRequest,
) => SessionConfigOption[] | Promise<SessionConfigOption[]>;

function select(
  id: string,
  currentValue: string,
  values: string[],
): SessionConfigOption {
  return {
    id,
    name: id,
    type: "select",
    currentValue,
    options: values.map((value) => ({ value, name: value })),
  };
}

const MODEL = select("model", "a", ["a", "b"]);

function target(answer: Answer = () => []): {
  readonly configuration: AcpConfigurationTarget;
  readonly connection: ClientConnection;
  readonly requests: SetSessionConfigOptionRequest[];
} {
  const requests: SetSessionConfigOptionRequest[] = [];
  const adapter = agent({ name: "fake" }).onRequest(
    methods.agent.session.setConfigOption,
    async (context) => {
      requests.push(context.params);
      return { configOptions: await answer(context.params) };
    },
  );
  const connection = client({ name: "pages" }).connect(adapter);
  return {
    connection,
    requests,
    configuration: {
      connection,
      state: createAcpSessionState(),
      errors: { adapterUnsupported: "plan_acp_adapter_unsupported" },
      sessionId: "s-1",
    },
  };
}

it("skips an optional option the adapter does not offer", async () => {
  const { configuration, requests } = target();

  await expect(
    confirmAcpConfiguration(
      configuration,
      [MODEL],
      [
        {
          id: "effort",
          value: "high",
          refusal: "plan_reasoning_unsupported",
          isOptional: true,
        },
      ],
    ),
  ).resolves.toEqual([MODEL]);
  expect(requests).toEqual([]);
});

it("fails a missing effort option with its own refusal", async () => {
  const { configuration } = target();

  await expect(
    confirmAcpConfiguration(
      configuration,
      [MODEL],
      [{ id: "effort", value: "high", refusal: "plan_reasoning_unsupported" }],
    ),
  ).rejects.toMatchObject({ code: "plan_reasoning_unsupported" });
  expect(configuration.state.events).toEqual([
    "effort high is not an option of the adapter (the adapter)",
  ]);
});

it("fails another missing option as an unsupported adapter", async () => {
  const { configuration } = target();
  configuration.state.effective.adapter = "codex-acp 2.2.2";

  await expect(
    confirmAcpConfiguration(
      configuration,
      [],
      [{ id: "mode", value: "agent", refusal: "plan_model_unavailable" }],
    ),
  ).rejects.toMatchObject({ code: "plan_acp_adapter_unsupported" });
  expect(configuration.state.events).toEqual([
    "mode agent is not an option of the adapter (codex-acp 2.2.2)",
  ]);
});

it("refuses a value the adapter does not list", async () => {
  const { configuration } = target();

  await expect(
    confirmAcpConfiguration(
      configuration,
      [MODEL],
      [{ id: "model", value: "z", refusal: "plan_model_unavailable" }],
    ),
  ).rejects.toMatchObject({ code: "plan_model_unavailable" });
  expect(configuration.state.events).toEqual([
    "model z is not among a, b (the adapter)",
  ]);
});

it("keeps a value that is already selected without a request", async () => {
  const { configuration, requests } = target();

  await expect(
    confirmAcpConfiguration(
      configuration,
      [MODEL],
      [{ id: "model", value: "a", refusal: "plan_model_unavailable" }],
    ),
  ).resolves.toEqual([MODEL]);
  expect(requests).toEqual([]);
});

it("explicitly reapplies and confirms a selected value when required", async () => {
  const { configuration, requests } = target(() => [MODEL]);
  await expect(
    confirmAcpConfiguration(
      configuration,
      [MODEL],
      [
        {
          id: "model",
          value: "a",
          refusal: "plan_model_unavailable",
          isExplicit: true,
        },
      ],
    ),
  ).resolves.toEqual([MODEL]);
  expect(requests).toMatchObject([{ configId: "model", value: "a" }]);
});

it("sets and confirms each step with the options of the previous one", async () => {
  const effort = select("effort", "low", ["low", "high"]);
  const { configuration, requests } = target((request) =>
    request.configId === "model"
      ? [select("model", "b", ["a", "b"]), effort]
      : [
          select("model", "b", ["a", "b"]),
          select("effort", "high", ["low", "high"]),
        ],
  );

  const options = await confirmAcpConfiguration(
    configuration,
    [MODEL],
    [
      { id: "model", value: "b", refusal: "plan_model_unavailable" },
      { id: "effort", value: "high", refusal: "plan_reasoning_unsupported" },
    ],
  );

  expect(options).toEqual([
    select("model", "b", ["a", "b"]),
    select("effort", "high", ["low", "high"]),
  ]);
  expect(requests).toEqual([
    { sessionId: "s-1", configId: "model", value: "b" },
    { sessionId: "s-1", configId: "effort", value: "high" },
  ]);
  expect(configuration.state.events).toEqual([
    "model b confirmed",
    "effort high confirmed",
  ]);
});

it("accepts the adapter's own choice for a resolved value", async () => {
  const { configuration, requests } = target(() => [
    select("model", "opus", ["opus", "sonnet"]),
  ]);

  await confirmAcpConfiguration(
    configuration,
    [select("model", "opus", ["opus"])],
    [
      {
        id: "model",
        value: "claude-opus-5-5",
        refusal: "plan_model_unavailable",
        isResolvedByAdapter: true,
      },
    ],
  );

  expect(requests).toHaveLength(1);
  expect(configuration.state.events).toEqual(["model claude-opus-5-5 as opus"]);
});

it("refuses a change whose option disappears from the answer", async () => {
  const { configuration } = target(() => []);

  await expect(
    confirmAcpConfiguration(
      configuration,
      [MODEL],
      [{ id: "model", value: "b", refusal: "plan_model_unavailable" }],
    ),
  ).rejects.toMatchObject({ code: "plan_model_unavailable" });
  expect(configuration.state.events).toEqual([
    "model b was not confirmed by the adapter (the adapter)",
  ]);
});

it("refuses a change the adapter does not apply", async () => {
  const { configuration } = target(() => [MODEL]);

  await expect(
    confirmAcpConfiguration(
      configuration,
      [MODEL],
      [{ id: "model", value: "b", refusal: "plan_model_unavailable" }],
    ),
  ).rejects.toMatchObject({ code: "plan_model_unavailable" });
  expect(configuration.state.events).toEqual([
    "model b was not confirmed, the adapter kept a (the adapter)",
  ]);
});

it("reports an explicit refusal of the adapter with the step's code", async () => {
  const { configuration } = target(() => {
    throw RequestError.invalidParams();
  });

  await expect(
    confirmAcpConfiguration(
      configuration,
      [MODEL],
      [{ id: "model", value: "b", refusal: "plan_model_unavailable" }],
    ),
  ).rejects.toMatchObject({ code: "plan_model_unavailable" });
  expect(configuration.state.events).toEqual([
    "model b was refused by the adapter (the adapter)",
  ]);
  expect(logging.logCaughtError).toHaveBeenCalledWith(
    "AcpSessionConfiguration",
    expect.any(RequestError),
  );
});

it("passes on a refusal that arrives with the connection already lost", async () => {
  const { configuration, connection } = target(() => {
    throw RequestError.invalidParams();
  });
  logging.logCaughtError.mockImplementation(() => {
    connection.close();
  });

  await expect(
    confirmAcpConfiguration(
      configuration,
      [MODEL],
      [{ id: "model", value: "b", refusal: "plan_model_unavailable" }],
    ),
  ).rejects.toBeInstanceOf(RequestError);
  expect(configuration.state.events).toEqual([]);
});

it("passes on the failure of a closed connection", async () => {
  const { configuration, connection } = target();
  connection.close();

  await expect(
    confirmAcpConfiguration(
      configuration,
      [MODEL],
      [{ id: "model", value: "b", refusal: "plan_model_unavailable" }],
    ),
  ).rejects.toThrow("ACP connection closed");
  expect(configuration.state.events).toEqual([]);
});

it("refuses selector drift when changing mode silently resets a previously confirmed effort", async () => {
  const modes = select("mode", "default", ["default", "yolo"]);
  const effort = select("thinking_level", "high", ["low", "high"]);
  const { configuration, connection } = target((request) => [
    MODEL,
    select("mode", request.configId === "mode" ? "yolo" : "default", [
      "default",
      "yolo",
    ]),
    select("thinking_level", request.configId === "mode" ? "high" : "low", [
      "low",
      "high",
    ]),
  ]);
  try {
    await expect(
      confirmAcpConfiguration(
        configuration,
        [MODEL, effort, modes],
        [
          { id: "model", value: "a", refusal: "plan_model_unavailable" },
          {
            id: "thinking_level",
            value: "low",
            refusal: "plan_reasoning_unsupported",
          },
          {
            id: "mode",
            value: "yolo",
            refusal: "plan_permission_mode_unenforceable",
          },
        ],
      ),
    ).rejects.toMatchObject({ code: "plan_reasoning_unsupported" });
  } finally {
    connection.close();
  }
});
