import { expect, it } from "vitest";

import {
  planScriptProfileState,
  planScriptProfileText,
} from "@/app/components/agents/plans/plan-script/plan-script-profile";

import { i18n } from "../plan-group-fixture";

import type { AgentPlanInterpreter } from "@/definition/AgentPlanScript";

const PROFILE: AgentPlanInterpreter = {
  id: "shell",
  name: "Shell",
  status: "ok",
  version: "1.0",
  error: null,
};

it("distinguishes unknown, missing and configured profiles by id", () => {
  expect(planScriptProfileState("shell", undefined)).toEqual({
    kind: "unknown",
  });
  expect(planScriptProfileState("other", [PROFILE])).toEqual({
    kind: "missing",
  });
  expect(planScriptProfileState("shell", [PROFILE])).toEqual({
    kind: "ok",
    profile: PROFILE,
  });
});

it("describes successful, missing, failed and stale profiles", () => {
  const translate = i18n.t.bind(i18n);
  expect(
    planScriptProfileText({ kind: "ok", profile: PROFILE }, translate),
  ).toEqual({
    status: translate("plans.scripts.status.ok"),
    short: "1.0",
    reason: null,
    tone: "success",
  });
  expect(planScriptProfileText({ kind: "missing" }, translate)).toMatchObject({
    reason: translate("plans.scripts.missingReason"),
    tone: "destructive",
  });
  const failed: AgentPlanInterpreter = {
    ...PROFILE,
    status: "error",
    error: null,
  };
  expect(
    planScriptProfileText({ kind: "error", profile: failed }, translate),
  ).toMatchObject({
    reason: translate("settings.system.interpreters.errors.failed"),
    tone: "destructive",
  });
  const stale: AgentPlanInterpreter = {
    ...PROFILE,
    status: "unchecked",
    remoteState: "stale",
  };
  expect(
    planScriptProfileText({ kind: "unchecked", profile: stale }, translate),
  ).toMatchObject({
    reason: translate("plans.communication.profile.stale"),
    tone: "neutral",
  });
});
