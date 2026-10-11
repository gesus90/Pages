import { expect, it, vi } from "vitest";

import { createMcpServices } from "@/app/lib/mcp-services.server";
import { ServerCache } from "@/backend/cache/ServerCache";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";

import { pageInput } from "../helpers/wiki-harness";
import { useWikiFieldHarness, wikiFieldState } from "../helpers/wiki-fields";

import type { WikiFieldHarness } from "../helpers/wiki-fields";

function application(
  harness: WikiFieldHarness,
): ReturnType<typeof createMcpServices> {
  const users = new UserRepository(harness.database);
  const authorization = new AuthorizationRepository(harness.database);
  return createMcpServices(
    harness.database,
    { getById: (id) => users.findById(id) },
    {
      getContext: async (id) => {
        const account = (await authorization.snapshot()).accounts.find(
          (entry) => entry.userId === id,
        );
        if (!account) throw new Error("Expected test account.");
        return account;
      },
    },
    {
      directory: harness.filesDirectory,
      wikiService: harness.service,
      tickets: {
        cache: ServerCache.disabled(),
        publisher: { publish: vi.fn() },
      },
    },
  );
}

const setup = useWikiFieldHarness();

it("dispatches the four operations through a real credential and transaction and replays after response loss", async () => {
  const harness = await setup();
  const services = application(harness);
  const credential = await services.personalAgentTokenService.create(
    "writer",
    "field-test",
    null,
  );
  const parent = await harness.service.create(
    harness.actor,
    pageInput({ title: "Destination", scope: "project", projectId: "alpha" }),
  );
  const common = { pageId: `/wiki/${harness.page.id}` };
  const calls = [
    {
      operation: "wiki.page.setTitle",
      parameters: {
        ...common,
        operationId: "title",
        expectedRevision: 1,
        title: "Changed",
      },
    },
    {
      operation: "wiki.page.setContent",
      parameters: {
        ...common,
        operationId: "content",
        expectedRevision: 2,
        content: "Changed\r\ntext",
      },
    },
    {
      operation: "wiki.page.setIcon",
      parameters: {
        ...common,
        operationId: "icon",
        expectedRevision: 3,
        icon: null,
      },
    },
    {
      operation: "wiki.page.move",
      parameters: {
        ...common,
        operationId: "move",
        expectedRevision: 4,
        projectId: "alpha",
        parentId: `/wiki/${parent.id}`,
        beforeId: null,
      },
    },
  ];
  expect(
    await services.pagesAgentApiService.handle(credential.token, {
      operation: "verify",
    }),
  ).toMatchObject({
    tools: expect.arrayContaining(calls.map((call) => call.operation)),
  });
  const events = vi.fn();
  services.pagesEventPublisher.subscribe(events);
  for (const call of calls) {
    const response = await services.pagesAgentApiService.handle(
      credential.token,
      call,
    );
    expect(response).toMatchObject({
      apiVersion: "1",
      result: { pageId: harness.page.id, changed: true },
    });
    expect(
      await services.pagesAgentApiService.handle(credential.token, call),
    ).toEqual(response);
  }
  expect(
    await harness.database.query(
      "SELECT title, content, icon, parent_id, revision FROM wiki_pages WHERE id = $id;",
      { id: harness.page.id },
    ),
  ).toEqual([["Changed", "Changed\r\ntext", null, parent.id, 4]]);
  expect(events).toHaveBeenCalledTimes(4);
  expect(await harness.repository.versions.list(harness.page.id)).toHaveLength(
    4,
  );
  await services.personalAgentTokenService.revoke(
    "writer",
    credential.summary.id,
  );
  const before = await wikiFieldState(harness.database, {
    includeOperationKeys: true,
  });
  await expect(
    services.pagesAgentApiService.handle(credential.token, calls[0]),
  ).rejects.toMatchObject({ status: 401 });
  expect(
    await wikiFieldState(harness.database, { includeOperationKeys: true }),
  ).toEqual(before);
});
