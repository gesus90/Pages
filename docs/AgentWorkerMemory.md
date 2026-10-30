# Memory of ACP worker units

Every ACP worker (adapter, CLI runner, MCP bridge and the helpers they start)
runs in a transient unit of the server account's systemd user manager, in
`pages-acp.slice`. Its limits are defined in `ACP_WORKER_LIMITS`
(`backend/agents/cli/CliWorkerUnit.ts`).

## Memory and swap

`MemoryMax` and `MemorySwapMax` of a worker unit are `infinity`: Pages sets no
fixed RAM or swap ceiling per worker. The host's normal memory accounting
still applies to the unit's cgroup, including the kernel's memory management
and OOM handling for the whole machine. `OOMPolicy=kill` is unchanged, so if
the kernel kills a process of a worker, systemd ends the rest of that unit.

Unchanged: the unit itself, the bubblewrap isolation, `TasksMax=512`,
`CPUQuota=200%`, `RuntimeMaxSec` (node deadline + 120 s, else 24 h), the stop
and cleanup ownership, and the concurrency scheduler. The log label of a
started worker is derived from the same constants and reads
`memory infinity, swap infinity`.

The capability probe (`probeWorkerUnits`) still starts a throw-away unit with
`MemoryMax=32M`; it runs `/usr/bin/true`, never a worker.

## README

The table of limits under "Limited worker units (PAGE-127)" in `README.md`
is historical for `MemoryMax` (1536 MiB) and `MemorySwapMax` (256 MiB): those
two rows no longer apply. The other rows are current. README itself is
protected and was not changed.
