import { AcpLineChannel } from "@/backend/agents/acp/AcpLineChannel";
import {
  fullEnvironmentProfile,
  redactFullEnvironment,
} from "./CliFullEnvironment";
import { planAcpLaunch } from "./CliAcpLaunch";
import { acpSessionSecrets, createAcpRedactor } from "./CliAcpRedaction";

import type { AgentPlanSessionInput } from "@/backend/agents/AgentPlanExecution";
import type {
  AcpDriver,
  AcpSessionProfile,
} from "@/backend/agents/acp/AcpDriver";
import type { AcpLaunch } from "@/backend/agents/acp/AcpLaunch";
import type { VerifiedStart } from "./CliSessionChecks";
import type { CliGitHubAccess } from "./CliGitHubCredentials";

interface AcpProtocol {
  readonly profile: AcpSessionProfile;
  readonly launch: AcpLaunch;
  readonly channel: AcpLineChannel;
  readonly redact: (text: string) => string;
}

/** Prepares native permissions, transport and credential redaction before the worker is spawned. */
export function prepareAcpProtocol(
  driver: AcpDriver,
  input: AgentPlanSessionInput,
  start: VerifiedStart,
  github: CliGitHubAccess | null,
): AcpProtocol {
  const mode = input.options.access === "read_only" ? "read_only" : "yolo";
  const purpose = input.chat ? "chat" : (input.purpose ?? "plan");
  const nativeProfile = driver.profile(mode, purpose);
  const profile = start.owner
    ? fullEnvironmentProfile(
        nativeProfile,
        input.fullEnvironment?.ownerName ?? "",
      )
    : nativeProfile;
  const launch = planAcpLaunch(driver, input, start.file, profile);
  const channel = new AcpLineChannel(
    input.chat !== undefined &&
      ["codex_cli", "opencode"].includes(driver.provider),
  );
  channel.enableAcknowledgement();
  const redactSession = createAcpRedactor({
    credentials: start.credentials,
    github,
    tokens: acpSessionSecrets(input, launch),
  });
  const redact = (text: string): string =>
    redactFullEnvironment(redactSession(text), start.owner);
  return { profile, launch, channel, redact };
}
