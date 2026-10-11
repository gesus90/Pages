import { expect, it } from "vitest";

import { createMcpServices } from "@/app/lib/mcp-services.server";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { WIKI_SETTING_DEFAULTS } from "@/definition/Wiki";

import {
  planningTicket,
  useAgentPlanningHarness,
} from "../helpers/agent-planning";

const setup = useAgentPlanningHarness();

it("dispatches ticket and milestone operations through a real credential, replays safely and rejects revocation", async () => {
  const run = await setup();
  const authorization = new AuthorizationRepository(run.database);
  const services = createMcpServices(
    run.database,
    { getById: (id) => run.users.findById(id) },
    {
      getContext: async (id) => {
        const account = (await authorization.snapshot()).accounts.find(
          ({ userId }) => userId === id,
        );
        if (!account) throw new Error("Expected account.");
        return account;
      },
    },
    {
      directory: run.filesDirectory,
      wikiService: {
        getSettings: async () => WIKI_SETTING_DEFAULTS,
        openAttachment: (...parameters) =>
          run.service.openAttachment(...parameters),
      },
      tickets: { cache: run.cache, publisher: { publish: run.publish } },
    },
  );
  const credential = await services.personalAgentTokenService.create(
    "owner",
    "planning-test",
    null,
  );
  const api = services.pagesAgentApiService;
  const input = { operation: "ticket.create", parameters: planningTicket() };
  const first = await api.handle(credential.token, input);
  expect(first).toMatchObject({ apiVersion: "1", result: { key: "PAGE-1" } });
  expect(await api.handle(credential.token, input)).toEqual(first);
  expect(
    await api.handle(credential.token, {
      operation: "ticket.read",
      parameters: { ticketId: "PAGE-1" },
    }),
  ).toMatchObject({ result: { key: "PAGE-1", title: "Original" } });
  expect(
    await api.handle(credential.token, {
      operation: "ticket.setTitle",
      parameters: {
        operationId: "title",
        ticketId: "PAGE-1",
        expectedTitle: "Original",
        title: "New",
      },
    }),
  ).toMatchObject({ result: { changed: true } });
  expect(
    await api.handle(credential.token, {
      operation: "milestones.read",
      parameters: { projectId: "p1" },
    }),
  ).toMatchObject({ result: { milestones: [], dependencies: [] } });
  await services.personalAgentTokenService.revoke(
    "owner",
    credential.summary.id,
  );
  await expect(api.handle(credential.token, input)).rejects.toMatchObject({
    status: 401,
  });
  expect(await run.database.query("SELECT COUNT(*) FROM work_items;")).toEqual([
    [1],
  ]);
});
