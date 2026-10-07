import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { generateProjectKey } from "@/backend/service/task/ProjectKey";

import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";

/** Where the next work item of a project continues the key sequence. */
export interface KeySequence {
  readonly projectKey: string;
  readonly firstNumber: number;
}

/** The project a key sequence is allocated for. */
export interface NumberedProject {
  readonly id: string;
  readonly name: string;
}

/** Allocates work item numbers one request at a time. */
export class WorkItemNumbering {
  private readonly taskRepository: TaskRepository;
  private readonly queue = new SerialQueue();

  /**
   * Creates a numbering.
   *
   * @param taskRepository - Task persistence boundary holding the sequences.
   */
  public constructor(taskRepository: TaskRepository) {
    this.taskRepository = taskRepository;
  }

  /**
   * Runs work that consumes numbers of a project, excluding other requests.
   *
   * @remarks
   * Number allocation and insert must not interleave between requests, or
   * two tickets created at the same moment would claim the same key. The
   * numbers are reserved for good: a key is not handed out again when the
   * work fails or when its ticket is deleted or moved away later.
   *
   * @param project - Project whose key sequence the work continues.
   * @param count - How many consecutive numbers the work consumes.
   * @param work - Work receiving the sequence to continue from.
   * @returns The result of the work.
   */
  public async run<Result>(
    project: NumberedProject,
    count: number,
    work: (sequence: KeySequence) => Promise<Result>,
  ): Promise<Result> {
    return this.queue.run(async () => {
      const defaultPrefix = generateProjectKey(project.name);
      const projectKey = await this.taskRepository.findOrCreateProjectKey(
        project.id,
        defaultPrefix,
      );
      const firstNumber = await this.taskRepository.reserveNumbers(
        project.id,
        count,
      );

      return work({ firstNumber, projectKey });
    });
  }
}
