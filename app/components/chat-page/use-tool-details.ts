import { useState } from "react";

import { backendRequestHeaders } from "@/app/lib/backend-request";

import type {
  VirtualToolDetails,
  VirtualToolUse,
} from "@/definition/VirtualChat";

/** How far the details of one call are read. */
type DetailsState =
  | { readonly status: "loading"; readonly url: string }
  | { readonly status: "failed"; readonly url: string }
  | {
      readonly status: "loaded";
      readonly url: string;
      readonly details: VirtualToolDetails;
    };

/** The details of one call and how to read them on demand. */
export interface ToolDetails {
  /** The call with its input and result once they are read. */
  readonly use: VirtualToolUse;
  /** Whether the left out details are not read yet. */
  readonly isLoading: boolean;
  readonly hasFailed: boolean;
  /** Reads the details when the call opens for the first time. */
  onToggle(event: React.SyntheticEvent<HTMLDetailsElement>): void;
}

function isToolDetails(value: unknown): value is VirtualToolDetails {
  return (
    typeof value === "object" &&
    value !== null &&
    "detail" in value &&
    typeof value.detail === "string" &&
    (!("input" in value) || typeof value.input === "string") &&
    (!("output" in value) || typeof value.output === "string")
  );
}

async function readToolDetails(url: string): Promise<VirtualToolDetails> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: backendRequestHeaders({ Accept: "application/json" }),
  });
  if (!response.ok) throw new Error("Tool call details unavailable.");
  const payload: unknown = await response.json();
  if (!isToolDetails(payload)) throw new Error("Tool call details invalid.");
  return payload;
}

/**
 * The input and the result of a call of a stored answer, which the history
 * leaves out; they are read when the person opens the call.
 * @param use - The call as the history holds it.
 * @returns The call with its details once read, and the reading state.
 */
export function useToolDetails(use: VirtualToolUse): ToolDetails {
  const [state, setState] = useState<DetailsState | null>(null);
  const url = use.detailsUrl;
  const own = url !== undefined && state?.url === url ? state : null;

  async function load(target: string): Promise<void> {
    setState({ status: "loading", url: target });
    try {
      const details = await readToolDetails(target);
      setState({ status: "loaded", url: target, details });
    } catch (error: unknown) {
      // The person can open the call again to retry.
      console.warn("Tool call details could not be read.", error);
      setState({ status: "failed", url: target });
    }
  }

  function onToggle(event: React.SyntheticEvent<HTMLDetailsElement>): void {
    if (!event.currentTarget.open || url === undefined) return;
    if (own?.status === "loading" || own?.status === "loaded") return;
    void load(url);
  }

  const details = own?.status === "loaded" ? own.details : null;
  return {
    use: details
      ? {
          ...use,
          ...(details.input === undefined ? {} : { input: details.input }),
          ...(details.output === undefined ? {} : { output: details.output }),
          detail: details.detail === "" ? use.detail : details.detail,
        }
      : use,
    // Until a reading answers, a call with left out details shows them as on their way.
    isLoading: url !== undefined && (own === null || own.status === "loading"),
    hasFailed: own?.status === "failed",
    onToggle,
  };
}
