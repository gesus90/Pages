import { useState } from "react";

/** A checked observation from the native tools; no server-owned identity comes from UI state. */
export interface AdminObservation {
  readonly taskId: string | null;
  readonly browserId: string;
  readonly revision: string;
  readonly content: string;
  readonly title: string;
  readonly target: string;
  readonly status: string;
  readonly error: string;
}

function fields(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null
    ? Object.fromEntries(Object.entries(input))
    : {};
}

function text(input: unknown): string {
  return typeof input === "string" ? input : "";
}

function observation(reply: unknown): AdminObservation {
  const envelope = fields(reply);
  const outcome = fields(envelope.outcome);
  const output = fields(
    typeof outcome.result === "string" ? JSON.parse(outcome.result) : null,
  );
  const result = fields(output.result);
  return {
    taskId: typeof envelope.taskId === "string" ? envelope.taskId : null,
    browserId: text(result.browserId),
    revision: text(result.revision),
    content: Array.isArray(output.result)
      ? output.result
          .map((entry: unknown) => text(fields(entry).name))
          .join("\n")
      : text(result.content),
    title: text(result.title),
    target: text(result.target),
    status: text(result.status) || (outcome.ok === true ? "completed" : ""),
    error: text(envelope.error) || text(outcome.error),
  };
}

/** Keeps the server-issued task, browser and read revision across explicit console actions. */
export function usePicaAdminTools(): {
  readonly isBusy: boolean;
  readonly result: AdminObservation | null;
  readonly run: (
    tool: string,
    parameters: Readonly<Record<string, unknown>>,
  ) => Promise<void>;
} {
  const [isBusy, setIsBusy] = useState(false);
  const [result, setResult] = useState<AdminObservation | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [browserId, setBrowserId] = useState("");
  const [revision, setRevision] = useState("");
  async function run(
    tool: string,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    setIsBusy(true);
    try {
      const response = await fetch("/pica-tools-api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tool,
          taskId,
          parameters: {
            ...parameters,
            ...(tool === "admin_browser_action" ? { browserId } : {}),
            ...(tool === "admin_files_edit" ? { revision } : {}),
          },
        }),
      });
      const received = observation(await response.json());
      if (received.taskId) setTaskId(received.taskId);
      if (received.browserId) setBrowserId(received.browserId);
      if (received.revision) setRevision(received.revision);
      if (tool === "task_close" && response.ok) {
        setTaskId(null);
        setBrowserId("");
        setRevision("");
      }
      setResult(received);
    } catch {
      setResult({
        taskId,
        browserId,
        revision,
        content: "",
        title: "",
        target: "",
        status: "",
        error: "ADMIN_TOOL_FAILED",
      });
    } finally {
      setIsBusy(false);
    }
  }
  return { isBusy, result, run };
}
