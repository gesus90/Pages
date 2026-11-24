/**
 * The job of an agent in a stored conversation: one run of its answer in a
 * round of answers.
 * @remarks
 * The chat page learns who answers from its own reading and the parts of the
 * answers over `conversations.v1`, at different times. Both name the job, so
 * the end of an answer ends the "answering" state of exactly that job, also in
 * a reading from the moments after it, while another job of the same agent
 * keeps showing.
 */
export interface ConversationAnswerJob {
  /** The message that opened the round of answers the job belongs to. */
  readonly roundId: string;
  /** One run of the agent's answer in that round; a repeated answer is a new job. */
  readonly jobId: string;
}
