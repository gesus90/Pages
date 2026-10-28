import { expect, it } from "vitest";

import {
  firstPlanLocation,
  isPlanNameUsed,
  planContextRequest,
  planLocationFields,
  planLocationOptions,
  planLocationValue,
  planProjects,
  planRequestError,
} from "@/app/components/agents/plans/plan-management/plan-context-model";

import { i18n } from "../plan-flow-fixture";
import {
  localWorkspace,
  managementPage,
  planView,
  remoteWorkspace,
} from "./plan-management-fixture";

it("lists each project of the visible workspaces once", () => {
  expect(planProjects(managementPage())).toEqual([
    { value: "alpha", label: "Project alpha" },
    { value: "beta", label: "Project beta" },
  ]);
});

it("names a plan's location by its remote target or its local workspace", () => {
  expect(planLocationValue({ workspaceId: "one" })).toBe("local:one");
  expect(
    planLocationValue({
      workspaceId: "one",
      executionTarget: { kind: "local" },
    }),
  ).toBe("local:one");
  expect(
    planLocationValue({
      workspaceId: "one",
      executionTarget: { kind: "remote", workspaceId: "far" },
    }),
  ).toBe("remote:far");
});

it("offers the local and remote workspaces of one project with host, directory and reason", () => {
  const page = managementPage({
    workspaces: [
      localWorkspace("one", "alpha"),
      localWorkspace("bare", "alpha", { path: "" }),
      localWorkspace("mirror", "alpha", { kind: "remote" }),
      localWorkspace("three", "beta"),
    ],
  });
  const options = planLocationOptions(page, "alpha", i18n.t);
  expect(options.map((option) => option.value)).toEqual([
    "local:one",
    "local:bare",
    "remote:far",
    "remote:blocked",
  ]);
  const [one, bare, far, blocked] = options;
  expect(one).toEqual({
    value: "local:one",
    label: i18n.t("plans.manage.localOption", { name: "Workspace one" }),
    description: `${i18n.t("plans.execution.local")} · /synthetic/one`,
    hint: `${i18n.t("plans.manage.location.local")} · /synthetic/one`,
    disabled: false,
    kind: "local",
  });
  expect(bare?.description).toBe(i18n.t("plans.execution.local"));
  expect(bare?.hint).toBe(i18n.t("plans.manage.location.local"));
  expect(far).toEqual({
    value: "remote:far",
    label: i18n.t("plans.manage.remoteOption", {
      name: "Remote far",
      host: "Runner",
    }),
    description: "Runner · /remote/far",
    hint: `${i18n.t("plans.manage.location.remote", { host: "Runner" })} · /remote/far`,
    disabled: false,
    kind: "remote",
  });
  expect(blocked?.disabled).toBe(true);
  expect(blocked?.description).toBe(
    `Runner · /remote/blocked · ${i18n.t("plans.manage.remoteDenied")}`,
  );
});

it("explains why a remote workspace is unavailable, with a fallback for unknown failures", () => {
  const page = managementPage({
    workspaces: [],
    remoteWorkspaces: [
      remoteWorkspace("own", "alpha", { reason: "github_missing" }),
      remoteWorkspace("ssh", "alpha", { reason: "host_unknown" }),
      remoteWorkspace("odd", "alpha", { reason: "never_heard_of" }),
    ],
  });
  const [own, ssh, odd] = planLocationOptions(page, "alpha", i18n.t);
  expect(own?.description).toBe(
    `Runner · /remote/own · ${i18n.t("remote.workspace.reason.github_missing")}`,
  );
  expect(ssh?.description).toBe(
    `Runner · /remote/ssh · ${i18n.t("remote.failure.host_unknown")}`,
  );
  expect(odd?.description).toBe(
    `Runner · /remote/odd · ${i18n.t("plans.execution.unavailable")}`,
  );
  expect(
    planLocationOptions(
      managementPage({ remoteWorkspaces: undefined }),
      "alpha",
      i18n.t,
    ).map((option) => option.kind),
  ).toEqual(["local", "local"]);
});

it("resolves a location to the plan's workspace and target only inside its project", () => {
  const page = managementPage();
  expect(
    planLocationFields(page, { projectId: "alpha", location: "local:two" }),
  ).toEqual({ workspaceId: "two", executionTarget: undefined });
  expect(
    planLocationFields(page, { projectId: "beta", location: "local:two" }),
  ).toBeNull();
  expect(
    planLocationFields(page, { projectId: "alpha", location: "remote:far" }),
  ).toEqual({
    workspaceId: "far",
    executionTarget: { kind: "remote", workspaceId: "far" },
  });
  for (const location of ["remote:blocked", "remote:gone", "other:far", ""])
    expect(planLocationFields(page, { projectId: "alpha", location })).toBe(
      null,
    );
  expect(
    planLocationFields(managementPage({ remoteWorkspaces: undefined }), {
      projectId: "alpha",
      location: "remote:far",
    }),
  ).toBeNull();
});

it("starts a project at its first usable location, or at none", () => {
  const options = planLocationOptions(managementPage(), "alpha", i18n.t);
  expect(firstPlanLocation(options)).toBe("local:one");
  expect(firstPlanLocation(options.slice(3))).toBe("");
  expect(firstPlanLocation([])).toBe("");
});

it("warns about a name already used in the same team and project, ignoring case and the renamed plan", () => {
  const page = managementPage({
    plans: [
      planView(),
      planView({ id: "other-team", name: "Other", departmentId: "else" }),
    ],
  });
  const same = { projectId: "alpha", departmentId: "team" };
  expect(isPlanNameUsed(page, { ...same, name: "  review PLAN " })).toBe(true);
  expect(
    isPlanNameUsed(page, { ...same, name: "Review plan", exceptId: "plan" }),
  ).toBe(false);
  expect(isPlanNameUsed(page, { ...same, name: "Other" })).toBe(false);
  expect(
    isPlanNameUsed(page, { ...same, projectId: "beta", name: "Review plan" }),
  ).toBe(false);
  expect(isPlanNameUsed(page, { ...same, name: "   " })).toBe(false);
  expect(
    isPlanNameUsed(page, { ...same, departmentId: null, name: "Review plan" }),
  ).toBe(false);
});

it("translates a refusal, with the panel's general error for unknown codes", () => {
  expect(planRequestError(null, i18n.t)).toBeNull();
  expect(planRequestError("plan_name_taken", i18n.t)).toBe(
    i18n.t("settings.agents.error.plan_name_taken"),
  );
  expect(planRequestError("never_heard_of", i18n.t)).toBe(
    i18n.t("plans.panel.error"),
  );
});

it("sends a trimmed name with the workspace and the remote target, or nothing while incomplete", () => {
  const page = managementPage();
  expect(
    planContextRequest(page, {
      name: "  Next ",
      projectId: "alpha",
      location: "local:one",
    }),
  ).toEqual({ name: "Next", workspaceId: "one", target: "" });
  expect(
    planContextRequest(page, {
      name: "Next",
      projectId: "alpha",
      location: "remote:far",
    }),
  ).toEqual({
    name: "Next",
    workspaceId: "far",
    target: JSON.stringify({ kind: "remote", workspaceId: "far" }),
  });
  expect(
    planContextRequest(page, {
      name: "  ",
      projectId: "alpha",
      location: "local:one",
    }),
  ).toBeNull();
  expect(
    planContextRequest(page, {
      name: "Next",
      projectId: "alpha",
      location: "",
    }),
  ).toBeNull();
});
