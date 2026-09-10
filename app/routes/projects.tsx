import { randomUUID } from "node:crypto";

import {
  CalendarDays,
  ChevronDown,
  FolderPlus,
  MoreHorizontal,
  Search,
  Users,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Form,
  Link,
  data,
  useActionData,
  useLoaderData,
  useNavigate,
  useNavigation,
} from "react-router";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/app/components/ui/dialog";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";
import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import {
  ProjectManagementDeniedError,
  ProjectNotFoundError,
} from "@/backend/service/ProjectService";
import { PROJECT_STATUS, isProjectStatus } from "@/definition/Project";

import type { ChangeEvent, ReactNode } from "react";

import type { Project, ProjectStatus } from "@/definition/Project";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

const MAXIMUM_DESCRIPTION_LENGTH = 10_000;
const MAXIMUM_NAME_LENGTH = 200;
const PLACEHOLDER_COLORS = [
  "#FCE3D3",
  "#DFEAFE",
  "#DCF2E5",
  "#EEE4F8",
  "#E9EDF2",
] as const;

type ProjectActionIntent = "create-project";

type ProjectActionResult =
  | {
      readonly ok: true;
      readonly intent: ProjectActionIntent;
      readonly projectId: string;
    }
  | {
      readonly ok: false;
      readonly intent: ProjectActionIntent;
      readonly error: "forbidden" | "invalidInput" | "projectNotFound";
    };

interface ProjectsLoaderData {
  readonly canManageProjects: boolean;
  readonly projects: readonly Project[];
}

interface ProjectInput {
  readonly name: string;
  readonly description: string;
  readonly status: ProjectStatus;
}

function getPlaceholderColor(projectId: string): string {
  const characterSum = Array.from(projectId).reduce(
    (total, character) => total + character.charCodeAt(0),
    0,
  );

  return PLACEHOLDER_COLORS[characterSum % PLACEHOLDER_COLORS.length];
}

function getInitial(name: string): string {
  return name.trim().charAt(0).toLocaleUpperCase();
}

function getProjectInput(formData: FormData): ProjectInput | null {
  const name = formData.get("name");
  const description = formData.get("description");
  const status = formData.get("status");

  if (
    typeof name !== "string" ||
    typeof description !== "string" ||
    !isProjectStatus(status)
  ) {
    return null;
  }

  const trimmedName = name.trim();
  const trimmedDescription = description.trim();

  if (
    !trimmedName ||
    trimmedName.length > MAXIMUM_NAME_LENGTH ||
    trimmedDescription.length > MAXIMUM_DESCRIPTION_LENGTH
  ) {
    return null;
  }

  return {
    description: trimmedDescription,
    name: trimmedName,
    status,
  };
}

/** Loads projects from SQLite for server-side rendering. */
export async function loader({
  context,
}: LoaderFunctionArgs): Promise<ProjectsLoaderData> {
  const actor = context.get(authenticatedUserContext);

  if (!actor) {
    throw new Error("Authenticated middleware did not provide a user.");
  }

  const services = await getApplicationServices();
  const projects = await services.projectService.findAll(actor);

  return {
    canManageProjects: services.projectService.canManageProjects(actor),
    projects,
  };
}

/** Creates projects through the persistent service layer. */
export async function action({
  context,
  request,
}: ActionFunctionArgs): Promise<ReturnType<typeof data<ProjectActionResult>>> {
  if (request.method !== "POST") {
    throw new Response("Method Not Allowed", {
      headers: { Allow: "POST" },
      status: 405,
    });
  }

  const actor = context.get(authenticatedUserContext);

  if (!actor) {
    throw new Response("Forbidden", { status: 403 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent");
  const services = await getApplicationServices();

  if (intent === "create-project") {
    const input = getProjectInput(formData);

    if (!input) {
      return data<ProjectActionResult>(
        { error: "invalidInput", intent, ok: false },
        { status: 400 },
      );
    }

    const id = randomUUID();

    try {
      await services.projectService.create(actor, {
        description: input.description,
        id,
        name: input.name,
        ownerId: actor.id,
        placeholderColor: getPlaceholderColor(id),
        status: input.status,
      });
    } catch (error: unknown) {
      return getProjectActionError(error, intent);
    }

    return data<ProjectActionResult>({ intent, ok: true, projectId: id });
  }

  return data<ProjectActionResult>(
    { error: "invalidInput", intent: "create-project", ok: false },
    { status: 400 },
  );
}

function getProjectActionError(
  error: unknown,
  intent: ProjectActionIntent,
): ReturnType<typeof data<ProjectActionResult>> {
  if (error instanceof ProjectManagementDeniedError) {
    return data<ProjectActionResult>(
      { error: "forbidden", intent, ok: false },
      { status: 403 },
    );
  }

  if (error instanceof ProjectNotFoundError) {
    return data<ProjectActionResult>(
      { error: "projectNotFound", intent, ok: false },
      { status: 404 },
    );
  }

  throw error;
}

function ProjectPlaceholder({
  project,
}: {
  readonly project: Project;
}): React.ReactElement {
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

function ProjectIcon({
  project,
}: {
  readonly project: Project;
}): React.ReactElement {
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

function getStatusDotClassName(status: ProjectStatus): string {
  switch (status) {
    case PROJECT_STATUS.PLANNED:
      return "bg-primary";
    case PROJECT_STATUS.ACTIVE:
      return "bg-emerald-500";
    case PROJECT_STATUS.PAUSED:
      return "bg-amber-500";
    case PROJECT_STATUS.COMPLETED:
      return "bg-slate-400";
  }
}

function StatusBadge({
  status,
}: {
  readonly status: ProjectStatus;
}): React.ReactElement {
  const { t } = useTranslation();

  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
      <span
        className={`size-2 rounded-full ${getStatusDotClassName(status)}`}
        aria-hidden="true"
      />
      {t(`projects.status.${status}`)}
    </span>
  );
}

function CreateProjectDialog({
  canManageProjects,
}: {
  readonly canManageProjects: boolean;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<ProjectStatus>(
    PROJECT_STATUS.PLANNED,
  );
  const isSubmitting =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "create-project";
  const error =
    actionData?.intent === "create-project" && !actionData.ok
      ? actionData.error
      : null;

  useEffect(() => {
    if (actionData?.intent === "create-project" && actionData.ok) {
      setIsOpen(false);
      setSelectedStatus(PROJECT_STATUS.PLANNED);
      void navigate(`/projekte/${encodeURIComponent(actionData.projectId)}`);
    }
  }, [actionData, navigate]);

  function handleStatusChange(nextValue: string): void {
    setSelectedStatus(nextValue as ProjectStatus);
  }

  if (!canManageProjects) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button>
          <FolderPlus className="size-4" aria-hidden="true" />
          {t("projects.create.trigger")}
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[min(34rem,90vw)]">
        <DialogTitle className="select-none text-lg font-semibold text-foreground">
          {t("projects.create.title")}
        </DialogTitle>
        <Form className="mt-5 flex flex-col gap-3" method="post" noValidate>
          <input name="intent" type="hidden" value="create-project" />
          <input name="status" type="hidden" value={selectedStatus} />
          <label
            className="select-none text-sm font-medium"
            htmlFor="project-name"
          >
            {t("projects.fields.name")}
          </label>
          <Input id="project-name" name="name" required />
          <label
            className="select-none text-sm font-medium"
            htmlFor="project-description"
          >
            {t("projects.fields.description")}
          </label>
          <Textarea
            className="min-h-32 resize-y"
            id="project-description"
            name="description"
          />
          <label
            className="select-none text-sm font-medium"
            htmlFor="project-status"
          >
            {t("projects.fields.status")}
          </label>
          <Select
            id="project-status"
            ariaLabel={t("projects.fields.status")}
            value={selectedStatus}
            onValueChange={handleStatusChange}
            className="w-full"
            options={Object.values(PROJECT_STATUS).map((status) => ({
              value: status,
              label: t(`projects.status.${status}`),
            }))}
          />
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {t(`projects.error.${error}`)}
            </p>
          ) : null}
          <div className="mt-2 flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost">{t("projects.actions.cancel")}</Button>
            </DialogClose>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? t("projects.create.submitting")
                : t("projects.create.submit")}
            </Button>
          </div>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function ProjectCard({
  project,
}: {
  readonly project: Project;
}): React.ReactElement {
  const { t } = useTranslation();

  return (
    <article className="relative rounded-2xl bg-surface p-6 shadow-card transition-shadow hover:shadow-floating">
      <Link
        className="absolute inset-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        to={`/projekte/${encodeURIComponent(project.id)}`}
        prefetch="intent"
        aria-label={project.name}
      />
      <div className="relative pointer-events-none flex items-start justify-between gap-3">
        <ProjectIcon project={project} />
        <span className="pointer-events-auto relative" aria-hidden="true">
          <MoreHorizontal
            className="size-5 select-none text-muted-foreground"
            aria-hidden="true"
          />
        </span>
      </div>
      <div className="pointer-events-none mt-4">
        <h2 className="text-lg font-semibold text-foreground">
          {project.name}
        </h2>
        <p className="mt-1 line-clamp-2 min-h-10 text-sm leading-relaxed text-muted-foreground">
          {project.description || t("projects.noDescription")}
        </p>
        <div className="mt-5 flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${project.progress}%` }}
            />
          </div>
          <span className="text-sm font-medium text-foreground">
            {project.progress} %
          </span>
        </div>
        <div className="mt-4 flex items-start justify-between gap-3">
          <StatusBadge status={project.status} />
          <span className="shrink-0 text-right text-xs leading-snug text-muted-foreground">
            <span className="block">{t("projects.updatedAt")}</span>
            <span className="block">{project.updatedAt}</span>
          </span>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 pt-3 text-xs text-muted-foreground">
          {project.managerName ? (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <Users className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{project.managerName}</span>
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays className="size-3.5 shrink-0" aria-hidden="true" />
            {t("projects.createdAt")} {project.createdAt}
          </span>
        </div>
      </div>
    </article>
  );
}

// Sub-Pixel-Rundungen der Browser sollen am Scroll-Ende keinen Fade erzwingen.
const SCROLL_EDGE_TOLERANCE = 2;

/**
 * Renders the project grid inside a bounded scroll viewport with edge fades.
 *
 * @remarks
 * Inhalt, der oberhalb oder unterhalb des Sichtbereichs liegt, endet als
 * kurzer, weicher Verlauf statt an einer harten Kante. Die Fades erscheinen
 * nur, wenn in der jeweiligen Richtung wirklich weiterer Inhalt existiert,
 * und sind klickdurchlässig, damit darunterliegende Karten erreichbar
 * bleiben. Zwischen Kartengrid und Scrollbar liegt eine Gutter, sodass die
 * Scrollbar an der Außenkante des Containers sitzt und nie in den Karten.
 */
function ProjectGridScrollArea({
  children,
}: {
  readonly children: ReactNode;
}): React.ReactElement {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [hasTopFade, setHasTopFade] = useState(false);
  const [hasBottomFade, setHasBottomFade] = useState(false);

  // Die Fades hängen an gemessenen Layoutwerten und lassen sich daher nicht
  // aus Props ableiten.
  useEffect(() => {
    const viewport = viewportRef.current as HTMLDivElement;

    function updateFades(): void {
      const maxScrollTop = viewport.scrollHeight - viewport.clientHeight;

      setHasTopFade(viewport.scrollTop > SCROLL_EDGE_TOLERANCE);
      setHasBottomFade(
        viewport.scrollTop < maxScrollTop - SCROLL_EDGE_TOLERANCE,
      );
    }

    updateFades();
    viewport.addEventListener("scroll", updateFades, { passive: true });

    if (typeof ResizeObserver === "undefined") {
      return () => {
        viewport.removeEventListener("scroll", updateFades);
      };
    }

    const observer = new ResizeObserver(updateFades);
    observer.observe(viewport);
    observer.observe(viewport.firstElementChild as Element);

    return () => {
      viewport.removeEventListener("scroll", updateFades);
      observer.disconnect();
    };
  }, []);

  return (
    <div className="relative mt-8 min-h-0">
      <div
        ref={viewportRef}
        className="pages-hover-scrollbar max-h-[calc(100dvh-18rem)] overflow-x-hidden overflow-y-auto overscroll-contain"
      >
        <div className="pr-4 pb-2">{children}</div>
      </div>
      <div
        aria-hidden="true"
        className={`pages-scroll-fade-top pointer-events-none absolute inset-x-0 top-0 h-6 transition-opacity duration-200 ${
          hasTopFade ? "opacity-100" : "opacity-0"
        }`}
      />
      <div
        aria-hidden="true"
        className={`pages-scroll-fade-bottom pointer-events-none absolute inset-x-0 bottom-0 h-6 transition-opacity duration-200 ${
          hasBottomFade ? "opacity-100" : "opacity-0"
        }`}
      />
    </div>
  );
}

/** Sort orders supported by the project overview dropdown. */
const PROJECT_SORT_FIELDS = [
  "updatedDesc",
  "updatedAsc",
  "nameAsc",
  "nameDesc",
  "statusAsc",
  "statusDesc",
] as const;

/** A sort order selectable on the project overview. */
type ProjectSortField = (typeof PROJECT_SORT_FIELDS)[number];

/**
 * Status rank used for status sorting.
 *
 * @remarks
 * Active projects come first and completed projects last so the most
 * relevant work stays on top; the reversed order flips this ranking.
 */
const STATUS_WEIGHT: Record<ProjectStatus, number> = {
  active: 0,
  planned: 1,
  paused: 2,
  completed: 3,
};

const PROJECT_SORT_COMPARISONS: Record<
  ProjectSortField,
  (first: Project, second: Project) => number
> = {
  updatedDesc: (first, second) =>
    second.updatedAt.localeCompare(first.updatedAt),
  updatedAsc: (first, second) =>
    first.updatedAt.localeCompare(second.updatedAt),
  nameAsc: (first, second) => first.name.localeCompare(second.name),
  nameDesc: (first, second) => second.name.localeCompare(first.name),
  statusAsc: (first, second) =>
    STATUS_WEIGHT[first.status] - STATUS_WEIGHT[second.status],
  statusDesc: (first, second) =>
    STATUS_WEIGHT[second.status] - STATUS_WEIGHT[first.status],
};

/** Narrows an unknown select value to a supported project sort order. */
function isProjectSortField(value: string): value is ProjectSortField {
  return (PROJECT_SORT_FIELDS as readonly string[]).includes(value);
}

/** Renders the responsive, SQLite-backed project overview. */
export default function ProjectsRoute(): React.ReactElement {
  const { t } = useTranslation();
  const { canManageProjects, projects } = useLoaderData<typeof loader>();
  const [filter, setFilter] = useState<"all" | ProjectStatus>("all");
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<ProjectSortField>("updatedDesc");
  const visibleProjects = projects
    .filter((project) => {
      const matchesFilter = filter === "all" || project.status === filter;
      const query = search.trim().toLocaleLowerCase();
      const matchesSearch =
        !query ||
        project.name.toLocaleLowerCase().includes(query) ||
        project.description.toLocaleLowerCase().includes(query);

      return matchesFilter && matchesSearch;
    })
    .sort(PROJECT_SORT_COMPARISONS[sortField]);

  function handleSortChange(event: ChangeEvent<HTMLSelectElement>): void {
    const nextSortField = event.target.value;

    if (isProjectSortField(nextSortField)) {
      setSortField(nextSortField);
    }
  }

  return (
    <div className="mx-auto max-w-[92rem]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="select-none text-3xl font-semibold tracking-tight text-foreground xl:text-2xl">
              {t("projects.title")}
            </h1>
            <p className="mt-1.5 select-none text-sm text-muted-foreground">
              {t("projects.subtitle")}
            </p>
          </div>
          <CreateProjectDialog canManageProjects={canManageProjects} />
        </div>
        <div className="mt-7 flex flex-wrap items-center gap-2.5">
          <div className="flex flex-wrap items-center gap-1">
            {(
              [
                "all",
                PROJECT_STATUS.PLANNED,
                PROJECT_STATUS.ACTIVE,
                PROJECT_STATUS.PAUSED,
              ] as const
            ).map((status) => (
              <Button
                key={status}
                className={
                  filter === status
                    ? "bg-primary-subtle text-primary-hover shadow-xs hover:bg-primary-subtle"
                    : "text-muted-foreground"
                }
                onClick={() => setFilter(status)}
                variant="ghost"
              >
                {t(`projects.filters.${status}`)}
              </Button>
            ))}
          </div>
          <div className="relative h-9 min-w-52 flex-1 sm:max-w-80">
            <Search
              className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              className="h-9 rounded-lg bg-card pl-10 text-xs xl:pl-10"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("projects.search")}
            />
          </div>
          <label className="relative">
            <span className="sr-only">{t("projects.sort.label")}</span>
            <select
              className="h-9 w-full appearance-none rounded-xl bg-surface py-0 pr-9 pl-3 text-sm text-foreground shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-primary sm:w-56"
              value={sortField}
              onChange={handleSortChange}
            >
              {PROJECT_SORT_FIELDS.map((field) => (
                <option key={field} value={field}>
                  {t(`projects.sort.${field}`)}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
          </label>
        </div>
        {visibleProjects.length ? (
          <ProjectGridScrollArea>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-6">
              {visibleProjects.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
          </ProjectGridScrollArea>
        ) : projects.length ? (
          <div className="mt-8 rounded-2xl bg-muted/40 p-10 text-center text-sm text-muted-foreground">
            {t("projects.noMatches")}
          </div>
        ) : (
          <div className="mt-8 flex flex-col items-center rounded-2xl bg-muted/40 px-6 py-16 text-center">
            <FolderPlus className="size-10 text-primary" aria-hidden="true" />
            <h2 className="mt-4 select-none text-lg font-semibold">
              {t("projects.empty.title")}
            </h2>
            <p className="mt-2 max-w-sm select-none text-sm leading-relaxed text-muted-foreground">
              {t("projects.empty.description")}
            </p>
            <div className="mt-5">
              <CreateProjectDialog canManageProjects={canManageProjects} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
