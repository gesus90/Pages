/**
 * Limits of the files a plan owns or hands to one of its steps (PAGE-292).
 *
 * @remarks
 * The upload of a plan asset and the handover of files to a step share one
 * budget, so every file a plan accepts can also be handed over. Ticket and
 * wiki uploads, chat attachments, model content and the files an agent returns
 * keep their own, smaller limits.
 */
export const PLAN_HANDOVER_LIMITS = {
  /** Files handed to one step. */
  files: 64,
  /** The largest file and the largest total of originals per step: 512 MiB = 512 × 1024 × 1024 bytes. */
  bytes: 512 * 1024 * 1024,
  /**
   * What is read into memory and offered to the model: 10 MiB per step.
   *
   * @remarks
   * Files beyond this budget are streamed as originals and reach the agent as
   * files only, so memory stays bounded however large the handover is. An ACP
   * prompt inlines of these only what fits into its 8 MiB message; the other
   * files reach the agent through their original copies (PAGE-295).
   */
  inlineBytes: 10 * 1024 * 1024,
} as const;

/** The plan limit as people read it; 1 MiB is 1,048,576 bytes. */
export const PLAN_HANDOVER_LIMIT_LABEL = "512 MiB";
