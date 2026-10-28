/** The private runner journal directory associated with a workspace lease. */
export interface AdmissionLease {
  readonly folder: string;
  readonly createdAt: number;
  readonly processId: number;
  readonly identity: string | null;
}

/** Checks whether the original job may still own its workspace. */
export function isLeaseActive(lease: AdmissionLease): Promise<boolean>;

/** The attempt identity used to release one runner reservation. */
export interface AdmissionJob {
  readonly jobId: string;
  readonly sessionId: string;
  readonly plan: { readonly attemptId: string };
}

/** Releases only the matching reservation after confirmed closeout. */
export function releaseJob(job: AdmissionJob): Promise<void>;
