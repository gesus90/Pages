import type { Project } from "@/definition/Project";

interface ProjectIconProps {
  readonly project: Project;
}

function getInitial(name: string): string {
  return name.trim().charAt(0).toLocaleUpperCase();
}

function ProjectPlaceholder({ project }: ProjectIconProps): React.ReactElement {
  return (
    <span
      className="inline-flex size-12 shrink-0 select-none items-center justify-center rounded-xl text-2xl font-semibold text-foreground"
      style={{ backgroundColor: project.placeholderColor }}
      aria-hidden="true"
    >
      {getInitial(project.name)}
    </span>
  );
}

/** Renders the stored icon of a project, or its colored initial without one. */
export function ProjectIcon({ project }: ProjectIconProps): React.ReactElement {
  if (project.hasIcon) {
    return (
      <img
        className="size-12 shrink-0 rounded-xl object-cover"
        src={`/projekte/${project.id}/icon`}
        alt=""
      />
    );
  }

  return <ProjectPlaceholder project={project} />;
}
