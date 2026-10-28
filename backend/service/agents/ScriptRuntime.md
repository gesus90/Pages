# Agent plan script runtime (PAGE-123)

Scripts are ordinary server processes in the existing Pages DAG engine. Saving,
opening, validating, upgrading and migrating a plan never executes its script
content. Explicit Play prepares the saved revision and reserves its workspace.
Scripts may select an authorized registered remote workspace as `executionTarget`.
Runner 1.2.0 executes them through the durable dispatcher, with runner-owned
interpreter identities and binary digests, frozen source, JSON stdin, finite
timeouts and output/process limits. A transport interruption never restarts a
claim. A vanished worker without an exit record finishes as `lost`; explicit
cancellation finishes as `interrupted`, with cleanup evidence. Remote profiles
are offered separately from local profiles and rechecked before dispatch. No
remote target falls back to a local process. See [the runner contract](../../../docs/PagesRunner.md#remote-pläne-scope-erweiterung-page-142)
for supported modes and operational limits. Local plans retain their existing runtime.
Existing agent nodes and groups keep their existing runners. Script members of
loops remain stored but are refused with `loopScriptUnsupported`; extending loop
execution is outside PAGE-123.

## Authorization and interpreters

Direct execution requires the executor's **active administrator mode**, current
plan edit/run permission, project access and a registered workspace inside the
server's approved roots. Existing authorization and workspace services check
these again immediately before spawn. Plan sharing grants no administrator or
OS privilege. Processes run as the Pages service's OS UID/GID. The resolved
directory, executor, attempt and diagnostic PID are in the ordinary run step.
A workspace is not a filesystem sandbox; only trusted administrators execute
configured scripts.

The stable profile ID resolves to its configured absolute executable. The
server validates the profile and executable permission, refuses failed profile
observations and pins the path in the private run snapshot. Changed or missing
profiles never select an alternative. Bash, Python and Node.js receive one
separate argument: a private UTF-8 source file named `script.cjs` (Node's CommonJS
entry contract; Bash and Python interpret the content regardless of suffix).
Relative filesystem operations use the plan workspace; module imports relative
to the source file use its private directory. Scripts loading project modules
must explicitly resolve them from the working directory.
There is no shell command-line concatenation, source interpolation, model call
or ACP session.

The environment is a fresh allowlist: PATH (interpreter/Node directories and
standard executable directories), private HOME/TMPDIR/XDG directories, C.UTF-8
locale, dumb terminal, NO_COLOR and the existing per-attempt ownership tag.
The child inherits umask 0077; newly created files default to owner-only access.
Provider keys, gateway tokens, GitHub credentials, proxy settings, SSH agents
and interpreter startup hooks are not inherited. No arbitrary credential
injection is provided. Source and inputs must not contain secrets; the existing
plan-save guard applies. A credential-shaped declared result fails instead of
changing the forwarded data value silently. Displayed streams use diagnostic redaction. This does not
promise detection of arbitrary secrets or an OS sandbox.

## Data and limits

Declared literal/parameter/variable/ticket bindings use existing typed ports.
Text inputs receive text, including an authorized ticket source's snapshotted
markdown. Numeric parameters retain their existing port type; use a text
parameter for a textual number. Input content is frozen with the run; live
resource rights are rechecked. Only explicit `result` bindings read successful
predecessors from this run. Nothing selects predecessors or older runs implicitly.

stdin receives exactly one serialized UTF-8 JSON object followed by EOF:

```json
{ "branch": "pages_plus", "commit": "0123456789abcdef" }
```

Keys are declared input names and every value is a string. Optional unbound/null
inputs are omitted. Explicit optional empty text stays `""`. Missing or blank
required text fails before spawn, including a required binding to empty stdout.
The card keeps manually cleared script text bound; its Disconnect control removes
the binding and restores the unbound state.
Values are never substituted into source or process arguments. The serialized
input document is limited to 1 MiB in UTF-8 bytes.

stdout preserves text, including whitespace, BOM and newlines. JSON remains text
and a bare SHA remains a bare SHA. No wrapper, exit code or transport newline is
added. stderr is separate diagnostic text. For a local script, each stream is
limited to **128 KiB in UTF-8 bytes**. A remote runner limits the combined
streams to **64 KiB** and retains a stderr tail of at most 16,384 UTF-16 units.
Invalid UTF-8 or an output overflow fails the step rather than returning a
shortened successful result. Unicode split across chunks remains intact.
Credential-shaped content is filtered; Pages cannot always tell whether the
runner already filtered it. Diagnostics on failed streams may be incomplete;
the failure is explicit, and a remote stderr tail has unknown completeness.
A script declares zero or one named text output. With no output its flow can
succeed and its data result is null. With one output, empty stdout is `""`.
Removing an output invalidates consumer bindings instead of inventing data.

An output can explicitly select `report` or `gate`. Both require one JSON object
with exactly `status`, `summary`, and a nonempty `checks` array. Each check has
exactly `name`, `status`, and `detail`; statuses are `passed`, `failed`, or
`partial`, names are unique, and the overall status must match the checks. A
`report` keeps successful report creation separate from failed or incomplete
checks: its exact output is available to an explicitly bound following review
script or repair agent, and its business assessment is a warning. A `gate`
fails its own node unless every check passed. A forwarded report must reach a
gate on every flow path to End. This checks the declared report; the script must
actually run the required commands and report their real outcomes. Missing,
invalid or contradictory JSON fails at the script node. An omitted policy keeps
the ordinary unrestricted text contract; stderr remains diagnostic.

### Example: three reviews, repair, recheck and finish

In a disposable project, create this flow and bind the named results explicitly:

```text
Start → Prepare → Review 1 → Review 2 → Review 3 → Fix agent → Recheck → Finish → End
```

Prepare only checks the starting environment; it does not reset Git or discard
files. Each review is a Python script with one text output named `report` and
policy `report`. Review 2 has a required text input `previous` bound to Review 1;
Review 3 binds its `previous` input to Review 2. Give the fix agent three named
text inputs and bind them to the three review results. The agent's instruction
must name the repair work and its permissions must allow that work. Recheck has
a required `repair` input bound to the agent result, and its output `report`
uses policy `gate`. Finish has a required `proof` input bound to Recheck. All
three reviewers and the fix agent use the explicitly selected workspace in the
shown order; no automatic branch or checkout changes are implied.

This reviewer runs one actual command, captures its exit or timeout, and emits
a complete finding even if that command failed. Replace the command with the
project's real check. Review 2 and 3 may use this same shape while accepting
their required `previous` input; the input is read as data, not source code.

```python
import json
import subprocess
import sys

inputs = json.load(sys.stdin)
command = [sys.executable, "-m", "unittest", "discover", "-s", "tests/unit"]
try:
    completed = subprocess.run(command, capture_output=True, timeout=120, check=False)
    status = "passed" if completed.returncode == 0 else "failed"
    detail = f"exit {completed.returncode}"
except subprocess.TimeoutExpired:
    status = "partial"
    detail = "timeout after 120 seconds"
print(json.dumps({
    "status": status,
    "summary": "Unit check: " + status,
    "checks": [{"name": "unit", "status": status, "detail": detail}],
}))
```

Configure the other reviewers with their real integration and lint commands.
The successful script exit says the report was created, not that its check
passed. A failed or partial report remains visible and reaches the bound fix
agent. For Recheck, actually run all required checks again and return one check
entry per command, with the overall status `failed` if any failed, `partial` if
none failed but at least one is incomplete, and `passed` only if all passed.
Do not merely copy the earlier statuses. The gate blocks Finish on a failed,
partial, missing or malformed report. A minimal Finish script reads the proof
and does no publication by itself:

```python
import json
import sys

inputs = json.load(sys.stdin)
proof = json.loads(inputs["proof"])
if proof["status"] != "passed":
    raise SystemExit("Recheck did not pass")
print("Verified checks completed")
```

The gate validates the declared evidence format and outcomes; it cannot prove
that a script honestly ran its commands. A commit, merge, push or deployment is
never added by this example and remains subject to its own explicit authority.

Timeout is **1–86,400 whole seconds**, default **60**, in the shared definition,
editor and backend. No unlimited mode or silent clamp exists. Exit 0 is technical
success, separate from a declared report assessment. Nonzero exit, spawn failure, signal,
timeout, output/encoding failure and cancellation retain distinct causes.
Failed dependencies never release success successors. Unaffected branches
finish under the existing engine semantics.

## Scheduling, lifecycle and recovery

Scripts share the existing **two request execution slots** across active runs;
native ACP admission is separate. Unordered scripts or script/CLI pairs on the
same resolved local working copy are refused before start. Explicitly ordered
steps may reuse it; separate working copies can run concurrently. Every attempt has
separate source, stdin, streams and private runtime resources. Other runs cannot
use a reserved workspace. Joins
use the existing ready frontier and start once, only after all required
predecessors succeeded and their explicitly bound results exist.

For a detected workspace conflict, the expanded run panel and
`read_plan_control` name this plan's affected nodes and resolved targets. A
parallel-writer refusal calls for flow ordering or separate copies; an existing
reservation calls for confirmed closeout or a different copy. Other runs' owner
and identifiers are not disclosed. Availability is a momentary check: the
transaction checks reservations again on start. New remote reservations also
match a registered canonical path paired with its connection or confirmed SSH
host key. The runner rechecks the path and coordinates copies for runners of the
same OS account. A matching host key is a conservative match, not proof of a
shared physical filesystem; older runs and unrelated hosts, accounts or mount
namespaces may lack that protection.

Pause closes dispatch and lets already started processes drain. A stable pause
is acknowledged only when they finish; arbitrary processes are never suspended
or resumed. Resume adopts pending work at the durable boundary and retains
completed scripts/results. Stop is persisted before aborting active work.
Stop/timeout terminate only the fresh owned process group and tagged descendants,
send TERM, escalate to KILL with a bounded grace period and confirm actual exit,
stream closure and absence of live owned processes. No port owner, unrelated
service or persisted PID is killed. Unconfirmed cleanup fails the step and
retains its workspace reservation.
Live ownership scans start at the monotonic boot time recorded just before
spawn, so older unrelated processes with unreadable environments are excluded
without relaxing ownership checks. Startup retries unconfirmed script closeouts
through the existing reservation recovery, without replaying their work.

An attempt is persisted before spawn. Known PID, streams, exit/signal, timestamps
and cleanup state follow in `AgentPlanStepResult.script`. Success and its
immutable checkpoint commit together. Checkpoints include configuration/binding
digests, workspace identity and process result; there is no parallel history.
Checkpoint process evidence sets its duplicate stdout field to null; the
declared data is stored once in `result.output`, while the run step retains
both full streams. This also keeps escaped text within the existing 2 MiB
checkpoint budget. Existing Agent API report responses retain their explicit
1 MiB transport budget and refuse oversized responses without truncation.
Private resources are removed after ownership-marker verification and confirmed
process cleanup. Workspace code, product files and business reports are never
runtime cleanup targets.

After backend interruption, startup recovery reconciles tagged leftovers using
their start scope, marks the attempt interrupted or cleanup unconfirmed, and
preserves completed results. It never dispatches a script or trusts a saved PID.
Recovery inspection offers no native-session replay for scripts. A deliberate
new Play creates a new run after reviewing possible side effects; exactly-once
external effects are not promised. Linux `/proc` inspection is required and
unavailable inspection fails closed. Scripts deliberately escaping OS ownership
tracking are outside this trusted administrator execution contract.

The existing run-details panel shows process identity, workspace, timing,
exit/signal, cleanup and separate stdout/stderr with localized failures.
Remote script details show the pinned interpreter profile and recorded runner
attempt; an absent stream is distinct from an empty one. Historical remote
script results can supply stdout when no separate stream was retained.
The last successfully selected plan is remembered in an account-scoped HttpOnly
browser cookie for one year. An explicit plan URL wins; reopening without a plan
restores the preference and rechecks access. A missing/revoked plan remains
visibly unavailable. Without a preference, existing default-plan behavior
applies. Remembering a selection starts no run.
