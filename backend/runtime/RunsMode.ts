import { isLocalSessionOwner } from "@/backend/agents/local/LocalSessionMode";

let isRunsProcess = false;
let ownsRuns = false;
let ownsApiBridge = false;

/** Marks the standalone entry before application services are initialized. */
export function enterRunsProcess(): void {
  isRunsProcess = true;
}

/** Whether this process is the standalone scheduler rather than the API. */
export function isPagesRunsProcess(): boolean {
  return isRunsProcess;
}

/** Records exclusive PostgreSQL ownership before constructing any execution service. */
export function setRunsOwnership(owned: boolean): void {
  ownsRuns = owned;
}

/** Only the elected scheduler may recover owners, schedule work or reconcile interrupted runs. */
export function canProcessRuns(): boolean {
  return ownsRuns && !isLocalSessionOwner();
}

/** Records API bridge ownership before recovering its process-local capabilities. */
export function setRunApiOwnership(): void {
  ownsApiBridge = true;
}

/** A partially initialized owner must exit rather than construct a second live service graph. */
export function hasRunServiceOwnership(): boolean {
  return ownsRuns || ownsApiBridge;
}

/** Whether this process owns the API-side runner bridge and chat recovery role. */
export function hasRunApiOwnership(): boolean {
  return ownsApiBridge;
}
