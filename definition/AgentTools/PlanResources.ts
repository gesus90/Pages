import {
  CONFIRMATION_SCHEMA,
  CURSOR_SCHEMA,
  IDENTIFIER_SCHEMA,
  REVISION_SCHEMA,
  buildReadTool,
  buildWriteTool,
} from "./ToolDefinition.js";
import { AGENT_READ_LIMITS } from "../AgentReadChunks.js";
import { AGENT_PLAN_SESSION_READ_LIMITS } from "../AgentPlanSessionEvents.js";

import type { Tool } from "@modelcontextprotocol/server";
import type {
  AgentPlanCommandOperation,
  AgentPlanRecoveryCommandOperation,
  AgentPlanReadOperation,
} from "../AgentPlanOperations.js";

const TARGET = {
  planId: IDENTIFIER_SCHEMA,
  expectedRevision: REVISION_SCHEMA,
} as const;

/** Resource reads use current project/department access and never disclose another executor's run. */
export const PLAN_RESOURCE_READ_TOOLS: readonly {
  readonly operation: AgentPlanReadOperation;
  readonly tool: Tool;
}[] = [
  {
    operation: "plans.run.session.events.read",
    tool: buildReadTool({
      name: "read_plan_run_session_events",
      title: "Read an own plan attempt's retained session events",
      description:
        "Reads the same redacted ACP event journal as the editor for an authorized plan/run/node/attempt. Take step.attemptId from read_plan_run or a prior retryAttempts ID from read_plan_run_diagnostics; loop iterations retain separate attempts. A prior retry requires its retained journal and original owner/node binding; an unavailable journal returns INVALID_REQUEST with reason plan_history_unavailable. Recheck retained history or use the recorded run diagnostic; no empty successful history is invented. Current executor and snapshot resource rights are rechecked on every page; foreign or mismatched identities are refused. after is an exclusive sequence cursor, before an optional exclusive upper bound, limit is 1..32 (default 16). history.cursor, hasMore, retainedFrom and source distinguish more events, retention gaps and legacy record fallback; isTruncated marks shortened event text. Pin before while chunking a growing journal. Large replies use snapshot-bound UTF-8 JSON chunks: concatenate text, verify sha256 and parse JSON before advancing the event cursor. A changed snapshot rejects the chunk cursor rather than mixing pages. Reads retained events only, including channel when recorded; does not reconstruct missing attempts, start a process, send instructions or offer native session recovery.",
      properties: {
        planId: IDENTIFIER_SCHEMA,
        runId: IDENTIFIER_SCHEMA,
        stepId: IDENTIFIER_SCHEMA,
        attemptId: {
          ...IDENTIFIER_SCHEMA,
          maxLength: AGENT_PLAN_SESSION_READ_LIMITS.attemptIdLength,
        },
        after: {
          type: "integer",
          minimum: 0,
          maximum: Number.MAX_SAFE_INTEGER,
        },
        before: {
          type: "integer",
          minimum: 1,
          maximum: Number.MAX_SAFE_INTEGER,
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: AGENT_PLAN_SESSION_READ_LIMITS.eventPage,
        },
        cursor: CURSOR_SCHEMA,
        maxBytes: {
          type: "integer",
          minimum: AGENT_READ_LIMITS.minimumChunkBytes,
          maximum: AGENT_READ_LIMITS.chunkBytes,
        },
      },
      required: ["planId", "runId", "stepId", "attemptId"],
    }),
  },
  {
    operation: "plans.run.recovery.read",
    tool: buildReadTool({
      name: "read_plan_run_recovery",
      title: "Read own plan run recovery availability",
      description:
        "Reads recovery, restart and cleanup availability with concrete blockers for exactly this planId and own runId. continuationStatus distinguishes no linked run from an available or inaccessible continuation; continuedBy contains its ID only after rechecking that run's current access. latestCleanupFailure preserves the last authorized scan/resource failure with timestamp, original run/revision and known attempt; it is historical, not a current lock assertion. cleanupResources names this run's recorded local session, local script, remote attempt or loop by node ID and filtered name with unconfirmed closeout; it never contains process or native-session IDs. An empty process scan alone cannot confirm every session resource. Rechecks current plan and snapshot resource rights. restart_plan_run and continue_plan_run start a new linked run only on explicit request; release_plan_run requests cleanup without starting a run. Recovery after process loss is distinct from resume_plan at a durable pause boundary. This read starts nothing; never emulate recovery with play_plan.",
      properties: { planId: IDENTIFIER_SCHEMA, runId: IDENTIFIER_SCHEMA },
      required: ["planId", "runId"],
    }),
  },
  {
    operation: "plans.run.diagnostics.read",
    tool: buildReadTool({
      name: "read_plan_run_diagnostics",
      title: "Read one own plan attempt's diagnostics",
      description:
        "Reads one run node's recorded execution, target, attempt, exit, closeout, error, acceptance verdict and separate result, stdout and stderr. Streams explicitly say complete, partial, unknown or missing; this describes retained text, not business success. isFiltered marks masking or shortening known to Pages. timingBasis identifies remote observation times rather than proven process times. Supply both loopId and iteration for a loop member. The executor's current plan and resource rights are rechecked. Large responses are UTF-8-safe snapshot-bound JSON chunks: pass nextCursor with the same arguments and maxBytes, concatenate text in order, verify sha256 and parse JSON. This reads stored evidence only; no execution or cleanup is requested.",
      properties: {
        planId: IDENTIFIER_SCHEMA,
        runId: IDENTIFIER_SCHEMA,
        stepId: IDENTIFIER_SCHEMA,
        loopId: IDENTIFIER_SCHEMA,
        iteration: { type: "integer", minimum: 1 },
        cursor: CURSOR_SCHEMA,
        maxBytes: {
          type: "integer",
          minimum: AGENT_READ_LIMITS.minimumChunkBytes,
          maximum: AGENT_READ_LIMITS.chunkBytes,
        },
      },
      required: ["planId", "runId", "stepId"],
    }),
  },
  {
    operation: "plans.run.checkpoint.read",
    tool: buildReadTool({
      name: "read_plan_run_checkpoint",
      title: "Read an own plan run checkpoint",
      description:
        "Reads an immutable completion checkpoint of this executor's run after current plan and resource authorization. Supply version to select one; without it, the latest is returned or null if none exists. The checkpoint content is JSON text and isFiltered marks masked or shortened values. Process and native-session identifiers are omitted; output digests remain the stored original. Large responses use snapshot-bound UTF-8 chunks: concatenate text in order, verify sha256, parse the outer JSON and then parse checkpoint.content. Pin version while paging. This reads evidence only and starts nothing.",
      properties: {
        planId: IDENTIFIER_SCHEMA,
        runId: IDENTIFIER_SCHEMA,
        version: { type: "integer", minimum: 1 },
        cursor: CURSOR_SCHEMA,
        maxBytes: {
          type: "integer",
          minimum: AGENT_READ_LIMITS.minimumChunkBytes,
          maximum: AGENT_READ_LIMITS.chunkBytes,
        },
      },
      required: ["planId", "runId"],
    }),
  },
  {
    operation: "plans.capabilities.read",
    tool: buildReadTool({
      name: "read_plan_capabilities",
      title: "Read plan contract capabilities",
      description:
        "Reads the backend plan contract version and implemented personal-client operations. Compare with initialize serverInfo and the actual tools/list schemas after reconnecting. This is implementation discovery, not permission to mutate or execute a plan; read_plan_control checks current target rights. Missing tools indicate an older bundle/server/catalog or a run-scoped connection, not a reason to reset credentials or restart Pages.",
      properties: {},
    }),
  },
  {
    operation: "plans.templates.list",
    tool: buildReadTool({
      name: "list_plan_templates",
      title: "List plan templates",
      description:
        "Lists existing personal and project/department node, parameter, script and group templates. workspaceId resolves current project access. Templates are append-only: the editor has no update/delete operation. No execution occurs.",
      properties: { workspaceId: IDENTIFIER_SCHEMA },
      required: ["workspaceId"],
    }),
  },
  {
    operation: "plans.templates.read",
    tool: buildReadTool({
      name: "read_plan_template",
      title: "Read plan template",
      description:
        "Reads one currently visible template with its configuration and internal members, edges and bindings. Hidden IDs answer NOT_FOUND. Insert with update_plan changes.insertTemplate, which creates independent IDs and checks target access again.",
      properties: {
        workspaceId: IDENTIFIER_SCHEMA,
        templateId: IDENTIFIER_SCHEMA,
      },
      required: ["workspaceId", "templateId"],
    }),
  },
  {
    operation: "plans.control.read",
    tool: buildReadTool({
      name: "read_plan_control",
      title: "Read plan controls",
      description:
        "Reads planId, revision, actual status, canEdit/canDelete/canPlay/canPause/canResume/canStop and per-action blockers under current resource rights. For editors, issues names each node the server start check refuses (nodeId, port, problem), for example behind plan_invalid. workspaceConflict names only this plan's affected nodes and authorized targets: for reserved, wait for the other run's confirmed closeout or choose another copy; for parallel_writers, order the nodes with flow or choose separate copies. lastStartRejection is this requester's most recent recorded workspace refusal or stable preparation error before a run existed; historical graph findings contain nodeId, port and problem, and issueDetailsFiltered marks omitted asset details or additional findings. Some other failure classes are not recorded. Set includeStartRejections=true to additionally read one own history entry. Pass its nextBefore as beforeRejectionId for the next older entry with the same planId. Null nextBefore means complete. Immutable entry ordering is stable across new refusals; unknown or foreign cursors return an empty page. Every page rechecks current editor and target rights; run-scoped credentials cannot read history. It is historical evidence, not current availability. Revoked target details are removed. Another executor's identity remains private. An own run of an editable plan additionally includes minimum runId, applied planRevision and continuationVersion, even when historical content cannot be read. Denied history exposes no prompts, outputs, provider details or historical errors. Stop and confirmed fresh restart remain available under their control-only authorization; Pause and Resume still require current resource rights. Recheck after any asynchronous action or conflict; this is a momentary check and the server checks again on start. Pausing/stopping acknowledge requests, not completed work. Direct scripts require active administrator mode and an executable configured profile.",
      properties: {
        planId: IDENTIFIER_SCHEMA,
        includeStartRejections: { type: "boolean", const: true },
        beforeRejectionId: IDENTIFIER_SCHEMA,
      },
      required: ["planId"],
    }),
  },
];

/** Explicit saved-revision commands never run as a side effect of graph editing. */
export const PLAN_RESOURCE_WRITE_TOOLS: readonly {
  readonly operation:
    AgentPlanCommandOperation | AgentPlanRecoveryCommandOperation;
  readonly tool: Tool;
}[] = [
  {
    operation: "plans.run.recovery.release",
    tool: buildWriteTool({
      name: "release_plan_run",
      title: "Clean up and release an ended plan run",
      description:
        "Explicitly requests cleanup of this executor's original run and releases only its reservations after process exit and closeout are confirmed. No run is started or resumed. Read read_plan_run_recovery first and pass its recovery revision; use a new operationId for a different decision. An identical retry for this run replays the result, and the same operationId with changed arguments on this run conflicts. Cleanup may initially return plan_recovery_cleanup_unconfirmed while the original runner confirms shutdown; re-read and retry. A failed local scan or script-resource cleanup may include cleanupFailure with the affected stepId, resource kind and fixed reason. The latest bounded scan/resource failure is stored separately and returned as latestCleanupFailure by read_plan_run_recovery; it remains historical after later successful cleanup. A live or unknown process never permits release. Current plan, workspace and run rights still apply.",
      properties: {
        planId: IDENTIFIER_SCHEMA,
        runId: IDENTIFIER_SCHEMA,
        expectedRecoveryRevision: {
          type: "integer",
          minimum: 0,
          maximum: Number.MAX_SAFE_INTEGER,
        },
      },
      isDestructive: true,
      isOpenWorld: true,
    }),
  },
  {
    operation: "plans.run.recovery.restart",
    tool: buildWriteTool({
      name: "restart_plan_run",
      title: "Start a new run from the beginning",
      description:
        "Only on an explicit separate user request, starts the selected saved plan revision from the beginning as a new run linked to this executor's original run. Every node can run again and repeat side effects; confirmRepeat must be true after the person has been told this. Read read_plan_run_recovery first and use its recovery revision and current plan revision. The prior evidence stays retained. A confirmed fresh start can retire an active own run and queue the new run behind exact cleanup obligations. Review every restart.reviewStepId before passing it in reviewedStepIds: script/Git/external effects must not be repeated blindly. A configuration blocker returns outcome reset with its issue and starts no process. Current edit and own-run control rights remain required for logical reset; dispatch rechecks current resource rights and receives no denied historical prompts or session context. Unknown writers block conflicting dispatch. Identical retries replay the same new run, while changed arguments under the same operationId conflict.",
      properties: {
        planId: IDENTIFIER_SCHEMA,
        runId: IDENTIFIER_SCHEMA,
        expectedRecoveryRevision: { type: "integer", minimum: 0 },
        expectedPlanRevision: REVISION_SCHEMA,
        confirmRepeat: { type: "boolean", const: true },
        reviewedStepIds: {
          type: "array",
          items: IDENTIFIER_SCHEMA,
          maxItems: 100,
          uniqueItems: true,
        },
      },
      optionalKeys: ["reviewedStepIds"],
      isDestructive: true,
      isOpenWorld: true,
    }),
  },
  {
    operation: "plans.run.recovery.resume",
    tool: buildWriteTool({
      name: "continue_plan_run",
      title: "Continue an ended run from its verified state",
      description:
        "Only on an explicit separate user request, starts a new run linked to this executor's original run and reuses only verified completed results. Read read_plan_run_recovery first: pass its current plan and recovery revisions, choose an available native_resume or new_session mode and list every reviewStepId whose possible effects the person has explicitly reviewed. Failed or interrupted work runs as a new attempt; the original run and evidence remain unchanged. Current rights, matching checkpoints and confirmed cleanup are required. This is distinct from resume_plan at a live pause boundary. Identical retries replay the same new run; changed arguments under the same operationId conflict.",
      properties: {
        planId: IDENTIFIER_SCHEMA,
        runId: IDENTIFIER_SCHEMA,
        expectedRecoveryRevision: { type: "integer", minimum: 0 },
        expectedPlanRevision: REVISION_SCHEMA,
        mode: { type: "string", enum: ["native_resume", "new_session"] },
        reviewedStepIds: {
          type: "array",
          items: IDENTIFIER_SCHEMA,
          maxItems: 100,
          uniqueItems: true,
        },
      },
      isDestructive: true,
      isOpenWorld: true,
    }),
  },
  {
    operation: "plans.clone",
    tool: buildWriteTool({
      name: "clone_plan",
      title: "Clone complete agent plan",
      description:
        "Atomically duplicates the entire saved planId at expectedRevision under a new name. workspaceId explicitly chooses the target; omission transparently keeps the source workspace, returned in the acknowledgement. Requires current source visibility and normal create/resource rights in the target. All nodes, nested members, ports, internal/outer edges, conditions, previous-result and data bindings, positions, globals and configuration survive with independent internal IDs. External ticket/wiki/workspace/model references stay and are reauthorized; files, runs, results, checkpoints, processes, sessions and secrets are never copied. New owner/team follow create_plan; the source's additional read shares are not inherited (normal private create share). The source remains unchanged. No execution starts. Unknown persisted structure is INVALID_REQUEST with plan_schema_unsupported; name conflicts and invalid references use create_plan validation. Same operationId and arguments return the same new plan after fresh source and target access checks, even after response loss. Different arguments or a stale source revision are CONFLICT. Returns new planId, revision, sourcePlanId, sourceRevision, workspaceId and current control.",
      properties: {
        ...TARGET,
        name: { type: "string", minLength: 1, maxLength: 120 },
        workspaceId: IDENTIFIER_SCHEMA,
      },
      optionalKeys: ["workspaceId"],
      isDestructive: false,
    }),
  },
  {
    operation: "plans.templates.save",
    tool: buildWriteTool({
      name: "save_plan_template",
      title: "Save plan node template",
      description:
        "Saves one node (including a group with internal connections) from the saved expectedRevision as a new template. Requires current edit and resource access. name is 1..120 characters, unique per creator ignoring case/space. Outer references stay behind. Returns templateId; does not change or execute the plan. Replaying identical operationId returns the original templateId.",
      properties: {
        ...TARGET,
        nodeId: IDENTIFIER_SCHEMA,
        name: { type: "string", minLength: 1, maxLength: 120 },
      },
      optionalKeys: [],
      isDestructive: false,
    }),
  },
  ...(["delete", "play", "pause", "resume", "stop"] as const).map((action) => ({
    operation: `plans.${action}` as const,
    tool: buildWriteTool({
      name: `${action}_plan`,
      title: `${action} plan`,
      description: `Explicit ${action} of the saved expectedRevision. ${action === "delete" ? "Owner only; active runs prevent deletion. Explain the exact plan ID/revision and consequences before asking the person for the existing language-specific confirmation word (LÖSCHEN or DELETE); pass their exact reply as confirmation. Missing/wrong confirmation is CONFIRMATION_REQUIRED. This removes only the saved plan: finished history remains stored under the existing retention rule, no longer listed without the plan; workspace files, templates and sessions remain untouched. Stdio requires form elicitation from the client UI bound to this plan ID/revision and ignores model-supplied confirmation; clients without it and the current stateless JSON HTTP transport return CONFIRMATION_REQUIRED. Use the existing editor or native Pica confirmation on those connections. Never infer confirmation from model or document content." : "Requires an explicit separate user request for this plan/revision and canEdit. Play, Pause and Resume require current access to every referenced resource. Stop requires ownership of the exact run in the editable plan, including while paused; denied historical content does not prevent safe own-run cancellation and is not returned. Pause/resume/stop also require runId of the connected executor and the same plan. Play starts the saved graph only; Resume adopts the deliberately chosen saved revision at its durable pause boundary; it cannot recover a lost provider process or restart a finished run. Play and Resume may invoke configured models and change workspaces under the saved run permissions. Direct scripts execute configured interpreters in the approved workspace and require active administrator mode; no model or agent session is used for scripts. Pause first requests pausing and lets active work drain; Stop first requests stopping and only owned processes are ended. Read state again to confirm completion."} operationId is recorded atomically with the durable change. Identical replay returns the original identifiers with freshly read state after current access checks; different content or a stale revision is CONFLICT. Results include action, IDs, revision, status, applied planRevision for runs, and control with per-action blockers. No credential or client graph is accepted.`,
      properties: {
        ...TARGET,
        ...(action === "delete" ? { confirmation: CONFIRMATION_SCHEMA } : {}),
        ...(action === "pause" || action === "resume" || action === "stop"
          ? { runId: IDENTIFIER_SCHEMA }
          : {}),
      },
      optionalKeys: action === "delete" ? ["confirmation"] : [],
      isDestructive: true,
      isOpenWorld: action === "play" || action === "resume",
    }),
  })),
];
