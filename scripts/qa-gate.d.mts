/** Version of the evidence format of the QA gate. */
export const QA_GATE_RUNNER: "qa-gate-v1";

/** Exit code of a gate whose checks reported code findings for a repair. */
export const QA_CODE_EXIT_CODE: number;

/** Exit code of a gate that could not judge the code. */
export const QA_INFRASTRUCTURE_EXIT_CODE: number;

/** The smallest soft address space limit under which the project checks start. */
export const QA_MINIMUM_ADDRESS_SPACE_BYTES: number;

/** One checked step of the gate. */
export interface QaStep {
  readonly name: string;
  readonly args: readonly string[];
  readonly passed: RegExp;
  readonly findings?: readonly RegExp[];
}

/** How one step of the gate ended. */
export interface QaStepResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly spawnError: string | null;
  readonly timedOut: boolean;
  readonly output: string;
}

/** The judgement of a step or of the whole gate. */
export interface QaVerdict {
  readonly outcome: "passed" | "code" | "infrastructure";
  readonly reason: string | null;
}

/** The commit and cleanliness of a checkout. */
export interface QaCheckout {
  readonly head: string | null;
  readonly isClean: boolean;
}

export const QA_STEPS: readonly QaStep[];

export function describeExitCode(code: number | null): string;

export function classifyQaStep(step: QaStep, result: QaStepResult): QaVerdict;

export function readAddressSpaceLimit(limitsText: string): number | null;

export function readCheckout(root: string): QaCheckout;

export function runQaStep(
  step: QaStep,
  options: {
    readonly root: string;
    readonly logFile: string;
    readonly command?: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly signal?: AbortSignal;
  },
): Promise<QaStepResult>;

export function refusalBeforeSteps(context: {
  readonly checkout: QaCheckout;
  readonly previous: {
    readonly head: string | null;
    readonly ok: boolean;
    readonly outcome: string;
    readonly reason: string | null;
  } | null;
  readonly addressSpaceLimit: number | null;
}): string | null;

export function qaLogDirectory(root: string, now?: Date): string;

export function runQaGate(options: {
  readonly root: string;
  readonly evidenceFile?: string;
  readonly previousFile?: string;
  readonly logDirectory?: string;
  readonly addressSpaceLimit?: number | null;
  readonly steps?: readonly QaStep[];
  readonly command?: string;
  readonly signal?: AbortSignal;
}): Promise<number>;

export function evidenceIssues(
  evidence: unknown,
  checkout: QaCheckout,
): readonly string[];

export function verifyQaEvidence(root: string, evidenceFile: string): number;
