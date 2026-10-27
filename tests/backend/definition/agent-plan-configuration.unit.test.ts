import { describe, expect, it } from "vitest";

import { DEFAULT_AGENT_RUN_OPTIONS } from "@/definition/AgentConfiguration";
import {
  agentModelKey,
  copyPlanConfiguration,
  planConfigurationForModel,
  planConfigurationModelKey,
  planSavedModel,
  planStepTemplate,
  planTargetModels,
} from "@/definition/AgentPlanConfiguration";

import { agent } from "./plan-fixtures";

import type { AgentDefinitionChoice } from "@/definition/AgentAvailability";
import type { AgentProviderId } from "@/definition/AgentConnection";
import type { PageAgentModel } from "@/definition/PageAgent";
import type { RunnerModelRoute } from "@/definition/RunnerExecution";

function model(
  id: string,
  overrides: Partial<PageAgentModel> = {},
): PageAgentModel {
  return {
    id,
    name: id,
    model: `model-${id}`,
    reasoning: "none",
    reasoningEfforts: [],
    catalogDefaultReasoningEffort: null,
    reasoningEffort: null,
    provider: "openrouter",
    ...overrides,
  };
}

const ROUTE: RunnerModelRoute = {
  connectionId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  workspaceId: "remote-1",
  catalogRevision: "rev-1",
};

function choice(
  overrides: Partial<AgentDefinitionChoice> = {},
): AgentDefinitionChoice {
  return {
    id: "source-1",
    modelProfileId: "model-profile-1",
    name: "Source agent",
    model: "claude-sonnet-4-5",
    reasoningEffort: "high",
    provider: "claude_code" satisfies AgentProviderId,
    purposes: [],
    revision: 7,
    configuration: {
      scope: "person",
      tag: "",
      markdown: "Do the work",
      projectId: null,
      accessMode: "shared",
      parameters: [
        {
          name: "topic",
          type: "text",
          description: "",
          isRequired: true,
          defaultValue: null,
        },
      ],
      directoryParameter: "dir",
      run: DEFAULT_AGENT_RUN_OPTIONS,
    },
    availability: { isUsable: true, reason: null, personalChoices: [] },
    ...overrides,
  };
}

describe("model keys", () => {
  it("builds an unambiguous key from the connection and the model", () => {
    expect(agentModelKey("c1", "m1")).toBe('["c1","m1"]');
    expect(agentModelKey("a", "b,c")).not.toBe(agentModelKey("a,b", "c"));
  });
});

describe("a configuration for a new node", () => {
  it("starts from a local model with a required workspace input", () => {
    const configuration = planConfigurationForModel(
      model("m1", { connectionId: "c1", provider: "claude_code" }),
    );

    expect(configuration).toMatchObject({
      name: "model-m1",
      revision: 1,
      modelProfileId: "m1",
      connectionId: "c1",
      model: "model-m1",
      provider: "claude_code",
      reasoningEffort: null,
      template: {
        markdown: "",
        directoryParameter: "workspace",
        parameters: [
          {
            name: "workspace",
            type: "workspace",
            isRequired: true,
            defaultValue: null,
          },
        ],
      },
    });
    expect(configuration).not.toHaveProperty("runnerRoute");
  });

  it("starts from a remote model without a local workspace input and keeps its route", () => {
    const configuration = planConfigurationForModel(
      model("m1", { runnerRoute: ROUTE }),
    );

    expect(configuration).toMatchObject({
      runnerRoute: ROUTE,
      template: { parameters: [], directoryParameter: null },
    });
    expect(configuration).not.toHaveProperty("connectionId");
  });

  it("cuts a long model name to 200 characters", () => {
    expect(
      planConfigurationForModel(model("m1", { model: "x".repeat(250) })).name,
    ).toHaveLength(200);
  });
});

describe("the selection key of a configuration", () => {
  it("is the profile id for a remote route or a legacy copy and the pair key for a direct one", () => {
    const base = planConfigurationForModel(model("m1", { connectionId: "c1" }));

    expect(planConfigurationModelKey(base)).toBe(
      agentModelKey("c1", "model-m1"),
    );
    expect(
      planConfigurationModelKey({ ...base, connectionId: undefined }),
    ).toBe("m1");
    expect(planConfigurationModelKey({ ...base, runnerRoute: ROUTE })).toBe(
      "m1",
    );
  });
});

describe("copying a configuration from an agent", () => {
  it("copies the template and pins the model profile of a shared agent", () => {
    const copy = copyPlanConfiguration(choice());

    expect(copy).toEqual({
      name: "Source agent",
      revision: 7,
      modelProfileId: "model-profile-1",
      model: "claude-sonnet-4-5",
      provider: "claude_code",
      reasoningEffort: "high",
      template: {
        markdown: "Do the work",
        parameters: [
          {
            name: "topic",
            type: "text",
            description: "",
            isRequired: true,
            defaultValue: null,
          },
        ],
        directoryParameter: "dir",
        run: DEFAULT_AGENT_RUN_OPTIONS,
      },
    });
  });

  it("falls back to the agent id when it names no model profile", () => {
    expect(
      copyPlanConfiguration(choice({ modelProfileId: undefined }))
        .modelProfileId,
    ).toBe("source-1");
  });

  it("takes the only personal choice, a differing profile, or nothing for a personal agent", () => {
    const personal = (
      overrides: Partial<AgentDefinitionChoice>,
    ): AgentDefinitionChoice =>
      choice({
        ...overrides,
        configuration: { ...choice().configuration, accessMode: "personal" },
      });
    const personalChoice = {
      id: "mine",
      name: "Mine",
      model: "m",
      reasoningEffort: null,
    };

    expect(
      copyPlanConfiguration(
        personal({
          availability: {
            isUsable: true,
            reason: null,
            personalChoices: [personalChoice],
          },
        }),
      ).modelProfileId,
    ).toBe("mine");
    expect(copyPlanConfiguration(personal({})).modelProfileId).toBe(
      "model-profile-1",
    );
    expect(
      copyPlanConfiguration(personal({ modelProfileId: "source-1" }))
        .modelProfileId,
    ).toBe("");
    expect(
      copyPlanConfiguration(personal({ modelProfileId: undefined }))
        .modelProfileId,
    ).toBe("");
  });

  it("leaves out run options the source does not have", () => {
    const source = choice();
    const { configuration: full } = source;
    const configuration: AgentDefinitionChoice["configuration"] = {
      scope: full.scope,
      tag: full.tag,
      markdown: full.markdown,
      projectId: full.projectId,
      accessMode: full.accessMode,
      parameters: full.parameters,
      directoryParameter: full.directoryParameter,
    };

    expect(
      copyPlanConfiguration({ ...source, configuration }).template,
    ).not.toHaveProperty("run");
  });
});

describe("the template of a node", () => {
  it("prefers the pinned copy and falls back to the source agent", () => {
    const pinned = planConfigurationForModel(model("m1"));
    const node = { ...agent("a"), agentId: "source-1" };
    const source = choice();

    expect(planStepTemplate({ ...node, configuration: pinned }, [source])).toBe(
      pinned.template,
    );
    expect(planStepTemplate(node, [source])).toBe(source.configuration);
    expect(
      planStepTemplate({ ...node, agentId: "gone" }, [source]),
    ).toBeUndefined();
  });
});

describe("the models of a node", () => {
  const local = model("local", { connectionId: "c1" });
  const remote = model("remote", { runnerRoute: ROUTE });

  it("finds the saved model by its key, else by connection and model", () => {
    const configuration = planConfigurationForModel(local);

    expect(
      planSavedModel([local, remote], {
        ...configuration,
        connectionId: undefined,
      }),
    ).toEqual({ model: local, alias: null });
    expect(planSavedModel([local, remote], configuration)).toEqual({
      model: local,
      alias: null,
    });
    expect(planSavedModel([remote], configuration)).toBeUndefined();
  });

  it("offers local models for a local target and the models of the same workspace for a remote one", () => {
    expect(planTargetModels([local, remote], undefined)).toEqual([local]);
    expect(planTargetModels([local, remote], { kind: "local" })).toEqual([
      local,
    ]);
    expect(
      planTargetModels([local, remote], {
        kind: "remote",
        workspaceId: "remote-1",
      }),
    ).toEqual([remote]);
    expect(
      planTargetModels([local, remote], {
        kind: "remote",
        workspaceId: "other",
      }),
    ).toEqual([]);
  });
});
