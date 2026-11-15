import { BellRing, CalendarClock, Pause, Play, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";

import {
  describeTaskSchedule,
  formatTaskMoment,
  triggerTimeZone,
} from "./chat-page-task-schedule";

import type {
  AgentChatTaskErrorCode,
  AgentChatTaskView,
} from "@/definition/AgentChatTask";

/** The chat whose tasks the dialog lists: a group, or the direct chat with an agent. */
export type ScheduledTasksChat =
  | {
      readonly kind: "group";
      readonly conversationId: string;
      readonly name: string;
    }
  | {
      readonly kind: "direct";
      readonly agentId: string;
      readonly name: string;
    };

interface TasksAnswer {
  readonly ok: boolean;
  readonly chatTasks?: readonly AgentChatTaskView[];
  readonly taskError?: AgentChatTaskErrorCode;
}

function isTasksAnswer(value: unknown): value is TasksAnswer {
  return typeof value === "object" && value !== null && "ok" in value;
}

/** The fields that name the chat in every request of the dialog. */
function chatFields(chat: ScheduledTasksChat): Record<string, string> {
  return chat.kind === "group"
    ? { conversationId: chat.conversationId }
    : { agentId: chat.agentId };
}

/** The list of the chat, its loading state and the changes of its tasks. */
function useChatTasks(
  chat: ScheduledTasksChat,
  isOpen: boolean,
): {
  readonly tasks: readonly AgentChatTaskView[] | null;
  readonly error: AgentChatTaskErrorCode | null;
  readonly isBusy: boolean;
  readonly change: (fields: Record<string, string>) => void;
} {
  const fetcher = useFetcher();
  const { submit } = fetcher;
  const [tasks, setTasks] = useState<readonly AgentChatTaskView[] | null>(null);
  const key = chat.kind === "group" ? chat.conversationId : chat.agentId;
  const answer = isTasksAnswer(fetcher.data) ? fetcher.data : null;
  const answered = answer?.chatTasks ?? null;
  if (answered !== null && answered !== tasks) setTasks(answered);

  useEffect(() => {
    if (!isOpen) return;
    const formData = new FormData();
    formData.set("intent", "chat-tasks");
    formData.set(chat.kind === "group" ? "conversationId" : "agentId", key);
    void submit(formData, { method: "post" });
  }, [isOpen, chat.kind, key, submit]);

  function change(fields: Record<string, string>): void {
    const formData = new FormData();
    for (const [name, value] of Object.entries({
      ...chatFields(chat),
      ...fields,
    }))
      formData.set(name, value);
    void submit(formData, { method: "post" });
  }

  return {
    tasks,
    error: answer?.ok === false ? (answer.taskError ?? "invalid") : null,
    isBusy: fetcher.state !== "idle",
    change,
  };
}

interface TaskRowProps {
  readonly task: AgentChatTaskView;
  readonly isBusy: boolean;
  readonly onChange: (fields: Record<string, string>) => void;
}

/** When the task runs next, or that it is paused or done. */
function NextRun({
  task,
}: {
  readonly task: AgentChatTaskView;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  let text = t("chatPage.tasks.paused");
  if (task.isActive && task.nextRunAt !== null)
    text = t("chatPage.tasks.next", {
      moment: formatTaskMoment(
        task.nextRunAt,
        i18n.language,
        triggerTimeZone(task.trigger) ?? "UTC",
      ),
    });
  else if (task.trigger.type === "once" && task.trigger.at === null)
    text = t("chatPage.tasks.schedule.done");
  return <span className="text-xs text-muted-foreground">{text}</span>;
}

/** Pausing, resuming and deleting a task; deleting asks once more. */
function TaskActions({
  task,
  isBusy,
  onChange,
}: TaskRowProps): React.ReactElement {
  const { t } = useTranslation();
  const [isConfirming, setIsConfirming] = useState(false);

  function handleToggle(): void {
    onChange({
      intent: "chat-task-active",
      taskId: task.id,
      isActive: task.isActive ? "false" : "true",
    });
  }

  function handleDelete(): void {
    if (!isConfirming) {
      setIsConfirming(true);
      return;
    }
    setIsConfirming(false);
    onChange({ intent: "chat-task-delete", taskId: task.id });
  }

  const ToggleIcon = task.isActive ? Pause : Play;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button
        disabled={isBusy}
        onClick={handleToggle}
        size="xs"
        type="button"
        variant="outline"
      >
        <ToggleIcon aria-hidden="true" className="size-3.5" />
        {task.isActive ? t("chatPage.tasks.pause") : t("chatPage.tasks.resume")}
      </Button>
      <Button
        disabled={isBusy}
        onClick={handleDelete}
        size="xs"
        type="button"
        variant={isConfirming ? "destructive" : "outline"}
      >
        <Trash2 aria-hidden="true" className="size-3.5" />
        {isConfirming
          ? t("chatPage.tasks.confirmDelete")
          : t("chatPage.tasks.delete")}
      </Button>
    </span>
  );
}

function TaskRow({ task, isBusy, onChange }: TaskRowProps): React.ReactElement {
  const { t, i18n } = useTranslation();
  const KindIcon = task.kind === "reminder" ? BellRing : CalendarClock;
  return (
    <li className="flex flex-wrap items-start gap-x-4 gap-y-2 py-3">
      <KindIcon
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
      />
      <span className="flex min-w-48 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium break-words text-foreground">
          {task.request}
        </span>
        <span className="text-[13px] text-foreground">
          {describeTaskSchedule(task.trigger, t, i18n.language)}
        </span>
        <NextRun task={task} />
        <span className="text-xs text-muted-foreground">
          {t(`chatPage.tasks.kind.${task.kind}`, {
            agent: task.agentName,
            person: task.requesterName,
          })}
        </span>
      </span>
      <TaskActions task={task} isBusy={isBusy} onChange={onChange} />
    </li>
  );
}

function TaskList({
  tasks,
  isBusy,
  onChange,
}: {
  readonly tasks: readonly AgentChatTaskView[] | null;
  readonly isBusy: boolean;
  readonly onChange: (fields: Record<string, string>) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  if (tasks === null)
    return (
      <p className="mt-4 text-sm text-muted-foreground">
        {t("chatPage.tasks.loading")}
      </p>
    );
  if (tasks.length === 0)
    return (
      <p className="mt-4 text-sm text-muted-foreground">
        {t("chatPage.tasks.empty")}
      </p>
    );
  return (
    <ul
      aria-label={t("chatPage.tasks.list")}
      className="mt-3 divide-y divide-border/60"
    >
      {tasks.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          isBusy={isBusy}
          onChange={onChange}
        />
      ))}
    </ul>
  );
}

/**
 * "Geplante Aufgaben" of a chat (PAGE-392): the reminders and recurring
 * tasks agents planned here, with their rhythm, their next run and the
 * buttons to pause, resume and delete them.
 *
 * @remarks
 * The server answers only a person of the chat; the list is read whenever
 * the dialog opens and comes back with every change.
 */
export function ChatPageScheduledTasks({
  chat,
  isOpen,
  onOpenChange,
}: {
  readonly chat: ScheduledTasksChat;
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { tasks, error, isBusy, change } = useChatTasks(chat, isOpen);
  return (
    <Dialog onOpenChange={onOpenChange} open={isOpen}>
      <DialogContent className="w-[min(44rem,94vw)]" size="lg">
        <DialogTitle className="text-lg font-semibold">
          {t("chatPage.tasks.title", { name: chat.name })}
        </DialogTitle>
        <DialogDescription className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {t("chatPage.tasks.description")}
        </DialogDescription>
        <TaskList tasks={tasks} isBusy={isBusy} onChange={change} />
        {error === null ? null : (
          <p className="mt-3 text-sm text-destructive" role="alert">
            {t(`chatPage.tasks.error.${error}`)}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
