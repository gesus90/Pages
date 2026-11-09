import { AgentTerminalRepository } from "@/backend/database/repositories/agent/AgentTerminalRepository";

import { call } from "./world";

import type { RepositoryFlow, RepositoryWorld } from "./world";

function terminals({ database }: RepositoryWorld): AgentTerminalRepository {
  return new AgentTerminalRepository(database);
}

/** Interactive terminals of agent plan execution. */
export const AGENT_TERMINAL_FLOW: RepositoryFlow = {
  title: "agent plan terminals",
  steps: [
    call("AgentTerminalRepository.find", (world) =>
      terminals(world).find("term-1"),
    ),
    call("AgentTerminalRepository.open", (world) =>
      terminals(world).open({
        instanceId: "term-1",
        runId: "run-term-1",
        stepId: "step-1",
        provider: "codex_cli",
        columns: 80,
        rows: 24,
        startedAt: "2026-03-01T10:00:00.000Z",
      }),
    ),
    call("AgentTerminalRepository.find", (world) =>
      terminals(world).find("term-1"),
    ),
    call("AgentTerminalRepository.append", (world) =>
      terminals(world).append("term-1", "output line 1\n"),
    ),
    call("AgentTerminalRepository.after", (world) =>
      terminals(world).after("term-1", 0, 1000),
    ),
    call("AgentTerminalRepository.latest", (world) =>
      terminals(world).latest("term-1", 0, 1000),
    ),
    call("AgentTerminalRepository.before", (world) =>
      terminals(world).before("term-1", 10, 1000),
    ),
    call("AgentTerminalRepository.retain", (world) =>
      terminals(world).retain("term-1", 5),
    ),
    call("AgentTerminalRepository.saveScreen", (world) =>
      terminals(world).saveScreen("term-1", {
        isAlternateScreen: false,
        screen: "screen body",
        sequence: 1,
        columns: 80,
        rows: 24,
      }),
    ),
    call("AgentTerminalRepository.activate", (world) =>
      terminals(world).activate("term-1", "step-2"),
    ),
    call("AgentTerminalRepository.question", (world) =>
      terminals(world).question("term-1", "Awaiting confirmation"),
    ),
    call("AgentTerminalRepository.enqueue", (world) =>
      terminals(world).enqueue("term-1", "user-1", {
        kind: "data",
        text: "y\n",
      }),
    ),
    call("AgentTerminalRepository.takeInputs", (world) =>
      terminals(world).takeInputs("term-1"),
    ),
    call("AgentTerminalRepository.end", (world) =>
      terminals(world).end("term-1", "2026-03-01T10:05:00.000Z"),
    ),
    call("AgentTerminalRepository.markManualInput", (world) =>
      terminals(world).markManualInput(
        "run-term-1",
        "2026-03-01T10:02:00.000Z",
      ),
    ),
    call("AgentTerminalRepository.removeRun", (world) =>
      terminals(world).removeRun("run-term-1"),
    ),
  ],
};
