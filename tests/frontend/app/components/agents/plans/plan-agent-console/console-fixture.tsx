import { I18nextProvider } from "react-i18next";
import { render } from "@testing-library/react";
import { vi } from "vitest";

import { createI18n } from "@/app/lib/i18n";

import { SESSION_VIEW } from "../../page161-session-fixture";
import { runStep, syntheticSession } from "../../page72-run-fixture";

import type { RenderResult } from "@testing-library/react";
import type { SessionCommands } from "@/app/components/agents/plans/plan-agent-console/use-session-commands";
import type { AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";
import type {
  AgentSessionMessage,
  AgentSessionTokenUsage,
  AgentSessionView,
} from "@/definition/AgentSessionJournal";

const i18n = createI18n("en");

function Translations({
  children,
}: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}

/** Renders a console section with the real English translations, kept across rerenders. */
export function renderConsole(element: React.ReactElement): RenderResult {
  return render(element, { wrapper: Translations });
}

/** A session view that accepts instructions, with explicit overrides per tested state. */
export function sessionView(
  overrides: Partial<AgentSessionView> = {},
): AgentSessionView {
  return {
    ...SESSION_VIEW,
    state: "idle",
    continuation: { mode: "live", reason: null, hasPlanCheckpoint: false },
    actions: {
      canSend: true,
      canCancelRun: false,
      canCancelTurn: false,
      canRecover: false,
    },
    ...overrides,
  };
}

/** Commands at the mocked route boundary: nothing pending, no notice, sending succeeds. */
export function sessionCommands(
  overrides: Partial<SessionCommands> = {},
): SessionCommands {
  return {
    isPending: false,
    notice: null,
    send: vi.fn<SessionCommands["send"]>(async () => true),
    cancel: vi.fn<SessionCommands["cancel"]>(async () => undefined),
    ...overrides,
  };
}

/** One user instruction in the given delivery status. */
export function sessionMessage(
  id: string,
  status: AgentSessionMessage["status"],
): AgentSessionMessage {
  return {
    id,
    attemptId: "attempt-page161",
    userId: "synthetic-user",
    kind: "instruction",
    text: `Instruction ${id}`,
    status,
    createdAt: "2026-10-26T00:00:00.000Z",
    updatedAt: "2026-10-26T00:00:00.000Z",
  };
}

/** Token counts with explicit overrides; unreported counts stay `null`. */
export function tokenUsage(
  overrides: Partial<AgentSessionTokenUsage> = {},
): AgentSessionTokenUsage {
  return {
    inputTokens: 1200,
    outputTokens: 300,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    totalTokens: 1500,
    inputIncludesCache: true,
    isPartial: false,
    ...overrides,
  };
}

/** A CLI session record of a node, taken from the synthetic record with a CLI runner. */
export function cliSession(
  overrides: Partial<AgentPlanSessionRecord> = {},
): AgentPlanSessionRecord {
  return { ...syntheticSession(), runner: "codex_cli", ...overrides };
}

/** A running agent step result with a CLI session record. */
export function cliStep(
  overrides: Partial<AgentPlanStepResult> = {},
): AgentPlanStepResult {
  return runStep("node", {
    status: "running",
    session: cliSession(),
    ...overrides,
  });
}
