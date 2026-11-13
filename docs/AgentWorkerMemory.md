# Memory of ACP worker units

Every ACP worker (adapter, CLI runner and the helpers they start)
runs in a transient unit of the server account's systemd user manager, in
`pages-acp.slice`. The limits of a unit are defined in `ACP_WORKER_LIMITS`, the
budget of the slice in `ACP_SLICE_LIMITS` (both in
`backend/agents/cli/CliWorkerUnit.ts`).

## Shared budget

All workers together may use `MemoryMax=10G` and `MemorySwapMax=2G`. These are
starting values for the server with 22 GB. A runaway build therefore meets the
budget of the agents before it reaches the platform.

Before it starts a worker, Pages runs

```text
systemctl --user set-property --runtime pages-acp.slice MemoryMax=10G MemorySwapMax=2G
```

The call repeats on every start, because a runtime property ends with the user
manager. The limit takes effect only where the user manager delegates the
`memory` controller. If the call fails, the worker starts anyway and Pages writes
a warning to the log: a missing budget does not stop a run.

When the workers exceed the budget, the kernel kills a process inside the slice.
`OOMPolicy=kill` then ends the rest of that unit, and the affected agent step
fails. Other workers keep running if the kill freed enough memory.

`systemctl --user show pages-acp.slice -p MemoryMax -p MemorySwapMax` shows the
current values once a worker has started.

## Per worker

`MemoryMax` and `MemorySwapMax` of a worker unit stay `infinity`: the budget
applies to all workers together, so one worker may use all of it.

## OOM priority

Every worker unit sets `OOMScoreAdjust=500`. If the whole host runs out of memory,
the kernel kills agents first. `pages.service` is outside this mechanism; a low
`OOMScoreAdjust` for it is set in its own system unit.

## Unchanged

The unit itself, the bubblewrap isolation, `TasksMax=512`, `CPUQuota=200%`,
`OOMPolicy=kill`, `RuntimeMaxSec` (node deadline + 120 s, else 24 h), the stop
and cleanup ownership, and the concurrency scheduler. The log label of a started
worker is derived from the same constants and reads
`memory infinity, swap infinity, tasks 512, CPU 200%, OOM score 500`: the values of
the unit, not the budget of the slice.

The capability probe (`probeWorkerUnits`) still starts a throw-away unit with
`MemoryMax=32M`; it runs `/usr/bin/true`, never a worker.

## Runtime guide

The current [worker-unit guide](AgentRuntime.md#limited-worker-units-page-127)
uses these shared budgets. The former README values (1536 MiB memory and
256 MiB swap per worker) are historical and no longer apply.
