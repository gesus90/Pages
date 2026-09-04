import type { TaskRepository } from "@/backend/database/repositories/TaskRepository";

/** Establishes the business-logic boundary for tasks. */
export class TaskService {
  private readonly taskRepository: TaskRepository;

  /**
   * Creates a task service.
   *
   * @param taskRepository - Task persistence boundary.
   */
  public constructor(taskRepository: TaskRepository) {
    this.taskRepository = taskRepository;
  }
}
