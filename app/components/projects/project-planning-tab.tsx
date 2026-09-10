import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, Link } from "react-router";

import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Tabs } from "@/app/components/ui/tabs";
import { getMilestoneProgress } from "@/app/components/projects/project-progress";

import type { ProjectEvent } from "@/definition/Project";
import type { Milestone, WorkItemDetail } from "@/definition/Task";

interface ProjectPlanningTabProps {
  readonly milestones: readonly Milestone[];
  readonly events: readonly ProjectEvent[];
  readonly workItems: readonly WorkItemDetail[];
  readonly canWrite: boolean;
}

type PlanningSection = "milestones" | "dates" | "structure";

function MilestoneCard({
  milestone,
  workItems,
  canWrite,
}: {
  readonly milestone: Milestone;
  readonly workItems: readonly WorkItemDetail[];
  readonly canWrite: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const progress = getMilestoneProgress(milestone.id, workItems);

  return (
    <li className="rounded-2xl bg-muted/40 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-foreground">
            {milestone.name}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {milestone.dueAt ?? "—"}
          </p>
        </div>
        {canWrite && milestone.status !== "completed" ? (
          <Form method="post">
            <input
              name="intent"
              type="hidden"
              value="update-milestone-status"
            />
            <input name="milestoneId" type="hidden" value={milestone.id} />
            <input name="status" type="hidden" value="completed" />
            <button
              type="submit"
              className="shrink-0 rounded-xl bg-surface px-3 py-1.5 text-xs font-semibold text-foreground shadow-xs hover:bg-surface-hover"
            >
              ✓
            </button>
          </Form>
        ) : null}
      </div>
      {milestone.description ? (
        <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
          {milestone.description}
        </p>
      ) : null}
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${progress.percentage}%` }}
        />
      </div>
      <p className="mt-2 text-sm font-medium text-foreground">
        {progress.percentage} %
      </p>
      <p className="text-xs text-muted-foreground">
        {progress.done} / {progress.total} {t("projectDetail.planning.tasks")}
      </p>
    </li>
  );
}

function TaskTree({
  workItems,
}: {
  readonly workItems: readonly WorkItemDetail[];
}): React.ReactElement {
  const { t } = useTranslation();
  const topLevel = workItems.filter((item) => item.parentId === null);

  if (!topLevel.length) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("projectDetail.planning.noTasks")}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {topLevel.map((item) => {
        const children = workItems.filter(
          (child) => child.parentId === item.id,
        );

        return (
          <li
            key={item.id}
            className="rounded-xl bg-muted/40 px-4 py-3 shadow-card"
          >
            <div className="flex items-center gap-3 text-sm">
              <span className="shrink-0 rounded bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
                {item.key}
              </span>
              <Link
                className="min-w-0 flex-1 truncate font-medium text-foreground hover:text-primary"
                to={`/aufgaben?item=${encodeURIComponent(item.key)}`}
              >
                {item.title}
              </Link>
              <span className="shrink-0 text-xs text-muted-foreground">
                {item.statusName}
              </span>
            </div>
            {children.length ? (
              <ul className="mt-2 ml-4 flex flex-col gap-1.5 border-l-2 border-muted pl-4">
                {children.map((child) => (
                  <li
                    key={child.id}
                    className="flex items-center gap-2 text-sm text-muted-foreground"
                  >
                    <span className="font-mono text-xs">{child.key}</span>
                    <Link
                      className="min-w-0 flex-1 truncate hover:text-primary"
                      to={`/aufgaben?item=${encodeURIComponent(child.key)}`}
                    >
                      {child.title}
                    </Link>
                    <span className="shrink-0 text-xs">{child.statusName}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Renders milestones, dates, and the shared task structure of the project. */
export function ProjectPlanningTab({
  milestones,
  events,
  workItems,
  canWrite,
}: ProjectPlanningTabProps): React.ReactElement {
  const { t } = useTranslation();
  const [section, setSection] = useState<PlanningSection>("milestones");

  function handleSectionChange(nextSection: string): void {
    setSection(nextSection as PlanningSection);
  }

  return (
    <div className="flex flex-col gap-4">
      <Tabs
        value={section}
        onValueChange={handleSectionChange}
        ariaLabel={t("projectDetail.planning.milestones")}
        tabs={(["milestones", "dates", "structure"] as const).map((entry) => ({
          value: entry,
          label: t(`projectDetail.planning.${entry}`),
        }))}
      />

      {section === "milestones" ? (
        <div className="flex flex-col gap-4">
          {canWrite ? (
            <Form
              method="post"
              className="grid gap-2 rounded-2xl bg-muted/40 p-5 sm:grid-cols-[1fr_1fr_auto]"
            >
              <input name="intent" type="hidden" value="create-milestone" />
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                <span className="select-none text-xs text-muted-foreground">
                  {t("projectDetail.planning.milestoneName")}
                </span>
                <Input name="name" required maxLength={200} />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                <span className="select-none text-xs text-muted-foreground">
                  {t("projectDetail.planning.milestoneDue")}
                </span>
                <Input name="dueAt" type="date" />
              </label>
              <div className="flex items-end">
                <Button type="submit">
                  {t("projectDetail.planning.newMilestone")}
                </Button>
              </div>
              <label className="flex flex-col gap-1.5 text-sm font-medium sm:col-span-3">
                <span className="select-none text-xs text-muted-foreground">
                  {t("projectDetail.planning.milestoneDescription")}
                </span>
                <Input name="description" maxLength={2000} />
              </label>
            </Form>
          ) : null}
          {milestones.length ? (
            <ul className="grid gap-4 md:grid-cols-2">
              {milestones.map((milestone) => (
                <MilestoneCard
                  key={milestone.id}
                  milestone={milestone}
                  workItems={workItems}
                  canWrite={canWrite}
                />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("projectDetail.planning.noMilestones")}
            </p>
          )}
        </div>
      ) : null}

      {section === "dates" ? (
        <div className="flex flex-col gap-4">
          {canWrite ? (
            <Form
              method="post"
              className="grid gap-2 rounded-2xl bg-muted/40 p-5 sm:grid-cols-[1fr_1fr_auto]"
            >
              <input name="intent" type="hidden" value="create-event" />
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                <span className="select-none text-xs text-muted-foreground">
                  {t("projectDetail.planning.dateTitle")}
                </span>
                <Input name="title" required maxLength={200} />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  <span className="select-none text-xs text-muted-foreground">
                    {t("projectDetail.planning.dateValue")}
                  </span>
                  <Input name="eventDate" type="date" required />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  <span className="select-none text-xs text-muted-foreground">
                    {t("projectDetail.planning.dateTime")}
                  </span>
                  <Input name="eventTime" type="time" />
                </label>
              </div>
              <div className="flex items-end">
                <Button type="submit">
                  {t("projectDetail.planning.newDate")}
                </Button>
              </div>
            </Form>
          ) : null}
          {events.length ? (
            <ul className="flex flex-col gap-2">
              {events.map((event) => (
                <li
                  key={event.id}
                  className="flex items-center gap-3 rounded-xl bg-muted/40 px-4 py-3 text-sm"
                >
                  <span className="w-24 shrink-0 text-muted-foreground">
                    {event.eventDate}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-foreground">
                      {event.title}
                    </span>
                    {event.eventTime ? (
                      <span className="block text-xs text-muted-foreground">
                        {event.eventTime}
                      </span>
                    ) : null}
                  </span>
                  {canWrite ? (
                    <Form method="post">
                      <input
                        name="intent"
                        type="hidden"
                        value="archive-event"
                      />
                      <input name="eventId" type="hidden" value={event.id} />
                      <button
                        type="submit"
                        className="rounded-md px-2 text-muted-foreground hover:text-destructive"
                        aria-label={event.title}
                      >
                        ×
                      </button>
                    </Form>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("projectDetail.planning.noDates")}
            </p>
          )}
        </div>
      ) : null}

      {section === "structure" ? <TaskTree workItems={workItems} /> : null}
    </div>
  );
}
