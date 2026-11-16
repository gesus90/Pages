import {
  Check,
  MessageCircleQuestion,
  SendHorizontal,
  ShieldCheck,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Textarea } from "@/app/components/ui/textarea";
import { cn } from "@/app/lib/cn";

import { useQuestionAnswer } from "./use-question-answer";

import type { QuestionAnswering } from "./use-question-answer";
import type {
  AgentQuestionItem,
  AgentQuestionView,
} from "@/definition/AgentChatQuestion";

interface QuestionItemProps {
  readonly item: AgentQuestionItem;
  readonly question: AgentQuestionView;
  readonly answering: QuestionAnswering;
  /** Whether one click on a button answers the whole card. */
  readonly isOneClick: boolean;
}

/** The buttons of one question: the recommended one first in the accent color. */
function QuestionOptions({
  item,
  question,
  answering,
  isOneClick,
}: QuestionItemProps): React.ReactElement {
  const { t } = useTranslation();
  const isLocked = !question.canAnswer || answering.isSending;
  const answer = question.answers.find((entry) => entry.questionId === item.id);
  const chosen = answer?.optionIds ?? answering.draft(item.id).optionIds;
  return (
    <div
      role="group"
      aria-label={item.text}
      className="flex flex-col gap-2 sm:flex-row sm:flex-wrap"
    >
      {item.options.map((option) => {
        const isChosen = chosen.includes(option.id);
        const isAccent =
          question.status === "open" ? option.isRecommended : isChosen;
        return (
          <Button
            key={option.id}
            size="sm"
            variant={isAccent ? "default" : "outline"}
            aria-pressed={isChosen}
            disabled={isLocked}
            className={cn(
              "w-full justify-start sm:w-auto",
              isChosen && !isAccent && "ring-2 ring-primary",
            )}
            onClick={() => {
              if (isOneClick) answering.sendChoice(item, option.id);
              else answering.choose(item, option.id);
            }}
          >
            {isChosen ? (
              <Check aria-hidden="true" className="size-3.5" />
            ) : null}
            <span>{option.label}</span>
            {option.isRecommended ? (
              <span className="sr-only">
                {t("chatPage.question.recommended")}
              </span>
            ) : null}
          </Button>
        );
      })}
    </div>
  );
}

/** One question: its text, its buttons and, while open, the field for a free answer. */
function QuestionItem(props: QuestionItemProps): React.ReactElement {
  const { t } = useTranslation();
  const { item, question, answering } = props;
  const answer = question.answers.find((entry) => entry.questionId === item.id);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-foreground">{item.text}</p>
      {item.isMultipleChoice ? (
        <p className="text-xs text-muted-foreground">
          {t("chatPage.question.multiple")}
        </p>
      ) : null}
      <QuestionOptions {...props} />
      {question.canAnswer ? (
        <Textarea
          aria-label={t("chatPage.question.freeText")}
          placeholder={t("chatPage.question.freeTextPlaceholder")}
          className="min-h-11 text-sm"
          rows={1}
          maxLength={2000}
          value={answering.draft(item.id).freeText}
          disabled={answering.isSending}
          onChange={(event) =>
            answering.setFreeText(item.id, event.target.value)
          }
        />
      ) : null}
      {answer?.freeText ? (
        <p className="rounded-lg bg-muted px-3 py-2 text-sm text-foreground">
          {t("chatPage.question.freeTextAnswer", { text: answer.freeText })}
        </p>
      ) : null}
    </div>
  );
}

/** The line at the foot of the card: who answered, or why it no longer waits. */
function QuestionStatus({
  question,
}: {
  readonly question: AgentQuestionView;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (question.status === "answered" && question.answeredBy)
    return (
      <p role="status" className="text-xs text-muted-foreground">
        {t("chatPage.question.answeredBy", { name: question.answeredBy.name })}
      </p>
    );
  if (question.status === "expired" || question.status === "cancelled")
    return (
      <p role="status" className="text-xs text-muted-foreground">
        {t(`chatPage.question.${question.status}`)}
      </p>
    );
  if (!question.canAnswer)
    return (
      <p className="text-xs text-muted-foreground">
        {t("chatPage.question.notForYou")}
      </p>
    );
  return null;
}

/**
 * The card of a question an agent asks during its round: head
 * with icon, the questions with their answer buttons (the recommended one
 * first, in the accent color), a free answer, and after the answer who chose
 * what, locked.
 */
export function ChatPageQuestionCard({
  question,
}: {
  readonly question: AgentQuestionView;
}): React.ReactElement {
  const { t } = useTranslation();
  const answering = useQuestionAnswer(question);
  const isConfirmation = question.confirmsTool !== null;
  const Icon = isConfirmation ? ShieldCheck : MessageCircleQuestion;
  const [first] = question.items;
  const isOneClick =
    question.items.length === 1 && first?.isMultipleChoice === false;
  const hasFreeText = question.items.some(
    (item) => answering.draft(item.id).freeText.trim() !== "",
  );
  return (
    <section
      aria-label={t(
        isConfirmation
          ? "chatPage.question.confirmTitle"
          : "chatPage.question.title",
      )}
      data-question-status={question.status}
      className="flex w-full max-w-[min(100%,32rem)] min-w-0 flex-col gap-3 rounded-xl border bg-surface p-3 shadow-xs"
    >
      <header className="flex items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted">
          <Icon aria-hidden="true" className="size-3.5 text-foreground" />
        </span>
        <span className="text-[13px] font-semibold text-foreground">
          {t(
            isConfirmation
              ? "chatPage.question.confirmTitle"
              : "chatPage.question.title",
          )}
        </span>
        {isConfirmation ? (
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {question.confirmsTool}
          </span>
        ) : null}
      </header>
      {question.items.map((item) => (
        <QuestionItem
          key={item.id}
          item={item}
          question={question}
          answering={answering}
          isOneClick={isOneClick && !hasFreeText}
        />
      ))}
      {question.canAnswer && (!isOneClick || hasFreeText) ? (
        <Button
          size="sm"
          className="self-end"
          disabled={!answering.isComplete}
          isPending={answering.isSending}
          onClick={answering.send}
        >
          <SendHorizontal aria-hidden="true" className="size-3.5" />
          {t("chatPage.question.send")}
        </Button>
      ) : null}
      <QuestionStatus question={question} />
    </section>
  );
}
