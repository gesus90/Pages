import { createHash } from "node:crypto";
import { RUNNER_RELEASE } from "@/definition/RunnerMaintenance";
import setupTemplate from "@/scripts/pages_setup.sh?raw";
import serviceManager from "@/scripts/runner/service-manager.sh?raw";
import runnerTransport from "@/scripts/runner/transport.mjs?raw";
import runnerExecution from "@/scripts/runner/execution.mjs?raw";
import runnerApi from "@/scripts/runner/api.mjs?raw";
import runnerFullEnvironment from "@/scripts/runner/full-environment.mjs?raw";
import runnerGitHub from "@/scripts/runner/github.mjs?raw";
import runnerCli from "@/scripts/runner/cli.mjs?raw";
import runnerPages from "@/scripts/runner/pages.mjs?raw";
import runnerAssetReturn from "@/scripts/runner/asset-return.mjs?raw";
import runnerAntigravity from "@/scripts/runner/antigravity.mjs?raw";
import runnerOpenCode from "@/scripts/runner/opencode.mjs?raw";
import runnerLive from "@/scripts/runner/live.mjs?raw";
import runnerSchedule from "@/scripts/runner/schedule.mjs?raw";
import runnerJournal from "@/scripts/runner/journal.mjs?raw";
import runnerProvider from "@/scripts/runner/provider.mjs?raw";
import runnerChunks from "@/scripts/runner/chunks.mjs?raw";
import runnerLines from "@/scripts/runner/lines.mjs?raw";
import runnerOutput from "@/scripts/runner/output.mjs?raw";
import runnerResult from "@/scripts/runner/result.mjs?raw";
import runnerWire from "@/scripts/runner/wire.mjs?raw";
import runnerJobs from "@/scripts/runner/jobs.mjs?raw";
import runnerAdmission from "@/scripts/runner/admission.mjs?raw";
import runnerInterpreters from "@/scripts/runner/interpreters.mjs?raw";
import runnerRevocation from "@/scripts/runner/revocation.mjs?raw";
import runnerTemporary from "@/scripts/runner/temporary.mjs?raw";
import runnerCgroups from "@/scripts/runner/cgroups.mjs?raw";
import runnerLocalAccounts from "@/scripts/runner/local-accounts.mjs?raw";
import runnerAccounts from "@/scripts/runner/accounts.mjs?raw";
import runnerBrowser from "@/scripts/runner/browser.mjs?raw";
import runnerUsage from "@/scripts/runner/usage.mjs?raw";
import runnerLaunch from "@/scripts/runner/launch.mjs?raw";
import runnerSsh from "@/scripts/runner/ssh.mjs?raw";
import runnerWorkerControl from "@/scripts/runner/worker-control.mjs?raw";
import runnerScripts from "@/scripts/runner/scripts.mjs?raw";
import runnerProcesses from "@/scripts/runner/processes.mjs?raw";

import runnerAddress from "@/scripts/runner/address.mjs?raw";
import runnerUpdate from "@/scripts/runner/update.mjs?raw";
import runnerMaintenance from "@/scripts/runner/maintenance.mjs?raw";
import runnerBootstrap from "@/scripts/runner/bootstrap.mjs?raw";
import type { RunnerUpdatePackage } from "@/definition/RunnerMaintenance";

/** The exact setup artifact transferred by Pages. */
export const setupScript = setupTemplate
  .replace("__PAGES_SERVICE_MANAGER__", () => serviceManager)
  .replace("__PAGES_RUNNER_TRANSPORT__", () => runnerTransport)
  .replace("__PAGES_RUNNER_ADDRESS__", () => runnerAddress)
  .replace("__PAGES_RUNNER_UPDATE__", () => runnerUpdate)
  .replace("__PAGES_RUNNER_MAINTENANCE__", () => runnerMaintenance)
  .replace("__PAGES_RUNNER_BOOTSTRAP__", () => runnerBootstrap)
  .replace("__PAGES_RUNNER_EXECUTION__", () => runnerExecution)
  .replace("__PAGES_RUNNER_API__", () => runnerApi)
  .replace("__PAGES_RUNNER_FULL_ENVIRONMENT__", () => runnerFullEnvironment)
  .replace("__PAGES_RUNNER_CLI__", () => runnerCli)
  .replace("__PAGES_RUNNER_PAGES__", () => runnerPages)
  .replace("__PAGES_RUNNER_ASSET_RETURN__", () => runnerAssetReturn)
  .replace("__PAGES_RUNNER_OPENCODE__", () => runnerOpenCode)
  .replace("__PAGES_RUNNER_ANTIGRAVITY__", () => runnerAntigravity)
  .replace("__PAGES_RUNNER_LIVE__", () => runnerLive)
  .replace("__PAGES_RUNNER_SCHEDULE__", () => runnerSchedule)
  .replace("__PAGES_RUNNER_JOURNAL__", () => runnerJournal)
  .replace("__PAGES_RUNNER_PROVIDER__", () => runnerProvider)
  .replace("__PAGES_RUNNER_CHUNKS__", () => runnerChunks)
  .replace("__PAGES_RUNNER_LINES__", () => runnerLines)
  .replace("__PAGES_RUNNER_OUTPUT__", () => runnerOutput)
  .replace("__PAGES_RUNNER_RESULT__", () => runnerResult)
  .replace("__PAGES_RUNNER_WIRE__", () => runnerWire)
  .replace("__PAGES_RUNNER_JOBS__", () => runnerJobs)
  .replace("__PAGES_RUNNER_ADMISSION__", () => runnerAdmission)
  .replace("__PAGES_RUNNER_INTERPRETERS__", () => runnerInterpreters)
  .replace("__PAGES_RUNNER_TEMPORARY__", () => runnerTemporary)
  .replace("__PAGES_RUNNER_CGROUPS__", () => runnerCgroups)
  .replace("__PAGES_RUNNER_ACCOUNTS__", () => runnerAccounts)
  .replace("__PAGES_RUNNER_LOCAL_ACCOUNTS__", () => runnerLocalAccounts)
  .replace("__PAGES_RUNNER_BROWSER__", () => runnerBrowser)
  .replace("__PAGES_RUNNER_USAGE__", () => runnerUsage)
  .replace("__PAGES_RUNNER_LAUNCH__", () => runnerLaunch)
  .replace("__PAGES_RUNNER_SSH__", () => runnerSsh)
  .replace("__PAGES_RUNNER_WORKER_CONTROL__", () => runnerWorkerControl)
  .replace("__PAGES_RUNNER_SCRIPTS__", () => runnerScripts)
  .replace("__PAGES_RUNNER_PROCESSES__", () => runnerProcesses)
  .replace("__PAGES_RUNNER_REVOCATION__", () => runnerRevocation)
  .replace("__PAGES_RUNNER_GITHUB__", () => runnerGitHub);

const files = {
  "transport.mjs": runnerTransport,
  "execution.mjs": runnerExecution,
  "api.mjs": runnerApi,
  "full-environment.mjs": runnerFullEnvironment,
  "github.mjs": runnerGitHub,
  "cli.mjs": runnerCli,
  "pages.mjs": runnerPages,
  "asset-return.mjs": runnerAssetReturn,
  "antigravity.mjs": runnerAntigravity,
  "opencode.mjs": runnerOpenCode,
  "live.mjs": runnerLive,
  "schedule.mjs": runnerSchedule,
  "journal.mjs": runnerJournal,
  "provider.mjs": runnerProvider,
  "chunks.mjs": runnerChunks,
  "lines.mjs": runnerLines,
  "output.mjs": runnerOutput,
  "result.mjs": runnerResult,
  "wire.mjs": runnerWire,
  "jobs.mjs": runnerJobs,
  "admission.mjs": runnerAdmission,
  "interpreters.mjs": runnerInterpreters,
  "revocation.mjs": runnerRevocation,
  "temporary.mjs": runnerTemporary,
  "cgroups.mjs": runnerCgroups,
  "local-accounts.mjs": runnerLocalAccounts,
  "accounts.mjs": runnerAccounts,
  "browser.mjs": runnerBrowser,
  "usage.mjs": runnerUsage,
  "launch.mjs": runnerLaunch,
  "ssh.mjs": runnerSsh,
  "worker-control.mjs": runnerWorkerControl,
  "scripts.mjs": runnerScripts,
  "processes.mjs": runnerProcesses,
  "address.mjs": runnerAddress,
  "update.mjs": runnerUpdate,
  "maintenance.mjs": runnerMaintenance,
  "bootstrap.mjs": runnerBootstrap,
};

/** Returns the complete shipped module package used by local and remote runners. */
export function runnerUpdatePackage(): RunnerUpdatePackage {
  const bytes = Buffer.from(JSON.stringify({ version: RUNNER_RELEASE, files }));
  if (bytes.length > 1024 * 1024)
    throw new Error("Runner package exceeds wire budget");
  return {
    version: RUNNER_RELEASE,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    payload: bytes.toString("base64"),
  };
}
