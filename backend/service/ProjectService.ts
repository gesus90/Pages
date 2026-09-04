import type { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";

/** Establishes the business-logic boundary for projects. */
export class ProjectService {
  private readonly projectRepository: ProjectRepository;

  /**
   * Creates a project service.
   *
   * @param projectRepository - Project persistence boundary.
   */
  public constructor(projectRepository: ProjectRepository) {
    this.projectRepository = projectRepository;
  }
}
