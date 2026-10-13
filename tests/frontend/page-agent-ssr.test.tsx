import { renderToString } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import {
  createStaticHandler,
  createStaticRouter,
  StaticRouterProvider,
} from "react-router";
import { describe, expect, it } from "vitest";

import { PageAgentPageView } from "@/app/components/agents/definitions/page-agent-page";
import { createI18n } from "@/app/lib/i18n";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import type { PageAgentPage } from "@/definition/PageAgent";

// The page is rendered by the server first; it must not need the browser to do so.
describe("PAGE-20 server rendering of the agent list", () => {
  async function renderOnServer(page: PageAgentPage): Promise<string> {
    const i18n = await createI18n("de");
    const handler = createStaticHandler([
      {
        path: "/agents/agents",
        Component: () => <PageAgentPageView page={page} />,
      },
    ]);
    const context = await handler.query(
      new Request("https://pages.invalid/agents/agents"),
    );
    if (context instanceof Response) throw new Error("Unexpected response");
    const router = createStaticRouter(handler.dataRoutes, context);
    return renderToString(
      <I18nextProvider i18n={i18n}>
        <StaticRouterProvider
          router={router}
          context={context}
          hydrate={false}
        />
      </I18nextProvider>,
    );
  }

  it("writes the heading, the create action and the agents as the server sends them", async () => {
    const html = await renderOnServer({
      isAdministrator: false,
      agents: [
        {
          id: "agent",
          ownerId: "bob",
          name: "Nächtliche Prüfung",
          canEdit: true,
          modelProfileId: "admin-model",
          model: "model-a",
          reasoningEffort: "medium",
          revision: 1,
          hasDeletedTargets: false,
          availability: { isUsable: true, reason: null, personalChoices: [] },
          configuration: {
            ...emptyAgentConfiguration(),
            sharing: { isGlobal: true, targets: [] },
          },
        },
      ],
      models: [
        {
          id: "admin-model",
          name: "Freigegeben",
          model: "model-a",
          reasoningEfforts: ["medium"],
          reasoningEffort: "medium",
        },
      ],
      workspaces: [],
      directory: { persons: [], groups: [], departments: [] },
    });
    expect(html).toContain("Agents Liste");
    expect(html).toContain("Agent erstellen");
    expect(html).toContain("Nächtliche Prüfung");
    expect(html).toContain("Global");
    expect(html).toContain("Bereit");
  });

  it("says that no agent is visible and, without a model, why none can be created", async () => {
    const html = await renderOnServer({
      isAdministrator: false,
      agents: [],
      models: [],
      workspaces: [],
      directory: { persons: [], groups: [], departments: [] },
    });
    expect(html).toContain("Keine sichtbaren Agents.");
    expect(html).toContain("Kein freigegebenes Admin-Modell verfügbar.");
  });
});
