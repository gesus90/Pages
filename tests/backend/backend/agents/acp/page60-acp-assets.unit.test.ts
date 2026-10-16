import { methods } from "@agentclientprotocol/sdk";
import { expect, it, vi } from "vitest";

import { readAgentObject } from "@/backend/agents/AgentPayload";
import { AgentError } from "@/backend/error/AgentErrors";

import { startAcpSession } from "./acp-harness";
import { TICKET } from "../../service/agents/page55-ticket-fixture";
import {
  PNG,
  TEXT,
  ticketAssetWorld,
} from "../../service/agents/page60-ticket-assets-fixture";

vi.mock("@/backend/agents/cli/CliProcessScan", () => ({
  RUN_INSTANCE_VARIABLE: "PAGES_RUN_INSTANCE",
  endTaggedProcesses: vi.fn(async () => ({ found: 0, remaining: 0 })),
}));

it.each(["codex_cli", "claude_code"] as const)(
  "sends evaluable images and full embedded text over the %s ACP prompt",
  async (provider) => {
    const world = ticketAssetWorld();
    const ticket = await world.service.resolve("executor", TICKET.id);
    const ticketInputs = [{ parameter: "ticket", ticket }];
    const started = startAcpSession(
      { promptCapabilities: { image: true, embeddedContext: true } },
      {
        provider,
        hasMcp: false,
        ticketInputs,
        readTicketAssets: () =>
          world.service.readAssets("executor", ticketInputs),
      },
    );
    try {
      expect((await started.session.turn).failure).toBeNull();
      const prompt = started.calls.find(
        (call) => call.method === methods.agent.session.prompt,
      );
      expect(readAgentObject(prompt?.params).prompt).toEqual(
        expect.arrayContaining([
          {
            type: "image",
            mimeType: "image/png",
            data: PNG.toString("base64"),
          },
          {
            type: "resource",
            resource: {
              uri: `pages-ticket://${TICKET.id}/ticket/wiki/text`,
              mimeType: "text/plain",
              text: TEXT,
            },
          },
        ]),
      );
    } finally {
      await started.session.close();
    }
  },
);

it("reports missing image capability explicitly without sending a partial prompt", async () => {
  const world = ticketAssetWorld();
  const ticket = await world.service.resolve("executor", TICKET.id);
  const ticketInputs = [{ parameter: "ticket", ticket }];
  const started = startAcpSession(
    {},
    {
      hasMcp: false,
      ticketInputs,
      readTicketAssets: () =>
        world.service.readAssets("executor", ticketInputs),
    },
  );
  try {
    expect((await started.session.turn).errorCode).toBe(
      "parameter_asset_transfer_unsupported",
    );
    expect(
      started.calls.some(
        (call) => call.method === methods.agent.session.prompt,
      ),
    ).toBe(false);
  } finally {
    await started.session.close();
  }
});

it("reauthorizes at the ACP prompt boundary after the handshake", async () => {
  const world = ticketAssetWorld();
  const ticket = await world.service.resolve("executor", TICKET.id);
  const started = startAcpSession(
    { promptCapabilities: { image: true } },
    {
      hasMcp: false,
      ticketInputs: [{ parameter: "ticket", ticket }],
      readTicketAssets: async () => {
        throw new AgentError("parameter_asset_unavailable");
      },
    },
  );
  try {
    expect((await started.session.turn).errorCode).toBe(
      "parameter_asset_unavailable",
    );
    expect(
      started.calls.some(
        (call) => call.method === methods.agent.session.prompt,
      ),
    ).toBe(false);
  } finally {
    await started.session.close();
  }
});
