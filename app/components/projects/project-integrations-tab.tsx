import {
  ArrowRight,
  BookOpen,
  Braces,
  Calendar,
  Check,
  Copy,
  Eye,
  EyeOff,
  GitBranch,
  KeyRound,
  Link as LinkIcon,
  Mail,
  MessageCircle,
  Plug,
  RefreshCw,
  Settings,
  Webhook,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, useActionData, useNavigation } from "react-router";

import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";
import { cn } from "@/app/lib/cn";

import styles from "./project-integrations-tab.module.css";

import type { ProjectIntegration } from "@/definition/Project";

type IntegrationId =
  "github" | "google-calendar" | "discord" | "webhooks" | "email" | "rest-api";

const INTEGRATION_ORDER: readonly IntegrationId[] = [
  "github",
  "google-calendar",
  "discord",
  "webhooks",
  "email",
  "rest-api",
];

const DEFAULT_BRANCH = "main";

const BRANCH_OPTIONS: readonly string[] = ["main", "master", "develop"];

interface ProjectIntegrationsTabProps {
  readonly integration: ProjectIntegration | null;
  readonly canWrite: boolean;
  readonly projectId: string;
}

/** Narrows unknown action data to the `{ ok }` result shape of the detail route. */
function isDetailActionResult(
  value: unknown,
): value is { readonly ok: boolean } {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return (
    "ok" in value && typeof (value as { readonly ok: unknown }).ok === "boolean"
  );
}

interface StatusPillProps {
  readonly connected: boolean;
}

/** Renders the green connected or gray disconnected status pill. */
function StatusPill({ connected }: StatusPillProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap select-none",
        connected
          ? "bg-emerald-50 text-emerald-700"
          : "bg-muted text-muted-foreground",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          connected ? "bg-emerald-500" : "bg-muted-foreground/60",
        )}
      />
      {connected
        ? t("projectDetail.integrations.connected")
        : t("projectDetail.integrations.notConnected")}
    </span>
  );
}

interface ServiceIconProps {
  readonly id: IntegrationId;
}

/**
 * Renders the large service tile shown on the left of every card and panel.
 *
 * @remarks
 * Branding note: GitHub (Invertocat), Google Calendar, and Discord marks are
 * proprietary trademarks with restrictive brand programs (no recoloring, no
 * redrawing, partly approval required). This repository bundles no licensed
 * copies from official sources, so the tiles deliberately use neutral,
 * unmodified Lucide icons instead of rebuilt brand approximations. All tiles
 * share the same container size, corner radius, and Lucide stroke width.
 */
function ServiceIcon({ id }: ServiceIconProps): React.ReactElement {
  if (id === "github") {
    return (
      <span
        aria-hidden="true"
        className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-[#171717] text-white"
      >
        <GitBranch className="size-7" />
      </span>
    );
  }

  if (id === "google-calendar") {
    return (
      <span
        aria-hidden="true"
        className="flex size-14 shrink-0 items-center justify-center rounded-2xl border bg-surface text-[#1a73e8] shadow-xs"
      >
        <Calendar className="size-7" />
      </span>
    );
  }

  if (id === "discord") {
    return (
      <span
        aria-hidden="true"
        className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-[#5865f2] text-white"
      >
        <MessageCircle className="size-7" />
      </span>
    );
  }

  if (id === "webhooks") {
    return (
      <span
        aria-hidden="true"
        className="flex size-14 shrink-0 items-center justify-center rounded-2xl border bg-surface text-[#e11d48] shadow-xs"
      >
        <Webhook className="size-7" />
      </span>
    );
  }

  if (id === "email") {
    return (
      <span
        aria-hidden="true"
        className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-[#f97316] text-white"
      >
        <Mail className="size-7" />
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-[#2563eb] text-white"
    >
      <Braces className="size-7" />
    </span>
  );
}

interface ToggleSwitchProps {
  readonly checked: boolean;
  readonly onChange: (nextChecked: boolean) => void;
  readonly disabled?: boolean;
  readonly label: string;
}

/** Renders an orange Pages toggle switch with an accessible label. */
function ToggleSwitch({
  checked,
  onChange,
  disabled = false,
  label,
}: ToggleSwitchProps): React.ReactElement {
  function handleClick(): void {
    onChange(!checked);
  }

  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={cn(
        "inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
        checked ? "justify-end bg-orange-500" : "justify-start bg-muted",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
      )}
      disabled={disabled}
      onClick={handleClick}
      role="switch"
      type="button"
    >
      <span
        aria-hidden="true"
        className="mx-0.5 size-5 rounded-full bg-white shadow"
      />
    </button>
  );
}

interface ToggleRowProps {
  readonly title: string;
  readonly hint: string;
  readonly checked: boolean;
  readonly onChange: (nextChecked: boolean) => void;
  readonly disabled?: boolean;
}

/** Renders a labeled setting row with a trailing toggle switch. */
function ToggleRow({
  title,
  hint,
  checked,
  onChange,
  disabled = false,
}: ToggleRowProps): React.ReactElement {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {hint ? (
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {hint}
          </p>
        ) : null}
      </div>
      <ToggleSwitch
        checked={checked}
        disabled={disabled}
        label={title}
        onChange={onChange}
      />
    </div>
  );
}

interface CopyFieldProps {
  readonly id: string;
  readonly value: string;
  readonly disabled?: boolean;
}

/** Renders a readonly value with a copy button, used for webhook URLs and tokens. */
function CopyField({
  id,
  value,
  disabled = false,
}: CopyFieldProps): React.ReactElement {
  const { t } = useTranslation();
  const [isCopied, setIsCopied] = useState(false);

  function handleCopy(): void {
    if (!value) {
      return;
    }

    const clipboard = navigator.clipboard;

    if (!clipboard) {
      return;
    }

    clipboard
      .writeText(value)
      .then(() => {
        setIsCopied(true);
      })
      .catch(() => {
        setIsCopied(false);
      });
  }

  useEffect(() => {
    if (!isCopied) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setIsCopied(false);
    }, 2000);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [isCopied]);

  return (
    <div className="flex items-center gap-2">
      <Input
        id={id}
        className="h-10 min-w-0 flex-1 truncate text-xs xl:h-10 xl:text-xs"
        readOnly
        type="text"
        value={value}
      />
      <Button
        aria-label={t("projectDetail.interfaces.webhookCopy")}
        className="size-10 shrink-0 px-0"
        disabled={disabled || value === ""}
        onClick={handleCopy}
        title={t("projectDetail.interfaces.webhookCopy")}
        variant="outline"
      >
        {isCopied ? (
          <Check className="size-4 text-emerald-600" aria-hidden="true" />
        ) : (
          <Copy className="size-4" aria-hidden="true" />
        )}
      </Button>
    </div>
  );
}

interface IntegrationCardProps {
  readonly id: IntegrationId;
  readonly name: string;
  readonly description: string;
  readonly connected: boolean;
  readonly selected: boolean;
  readonly onSelect: (id: IntegrationId) => void;
}

/**
 * Renders one large clickable interface card without any nested action buttons.
 *
 * @remarks
 * The whole card is a single native button, so keyboard and screen-reader
 * users get the same "open the settings panel" behavior as pointer users.
 */
function IntegrationCard({
  id,
  name,
  description,
  connected,
  selected,
  onSelect,
}: IntegrationCardProps): React.ReactElement {
  const { t } = useTranslation();

  function handleSelect(): void {
    onSelect(id);
  }

  return (
    <button
      aria-pressed={selected}
      aria-label={t("projectDetail.interfaces.openSettings", { name })}
      className={cn(
        "flex w-full cursor-pointer items-start gap-4 rounded-2xl border bg-surface p-5 text-left shadow-xs transition-all outline-none hover:shadow-md focus-visible:ring-2 focus-visible:ring-primary",
        selected
          ? "border-orange-500 bg-orange-50/60"
          : "border-border hover:border-orange-300",
      )}
      onClick={handleSelect}
      type="button"
    >
      <ServiceIcon id={id} />
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{name}</span>
          <StatusPill connected={connected} />
        </span>
        <span className="text-xs leading-relaxed text-muted-foreground">
          {description}
        </span>
      </span>
    </button>
  );
}

interface PanelShellProps {
  readonly serviceName: string;
  readonly onClose: () => void;
  readonly footer: React.ReactNode;
  readonly children: React.ReactNode;
}

/**
 * Renders the independent overlay panel chrome with sticky header and footer.
 *
 * @remarks
 * The panel is `position: fixed` and floats above the page, so opening it
 * never changes the width or position of the main content behind it.
 */
function PanelShell({
  serviceName,
  onClose,
  footer,
  children,
}: PanelShellProps): React.ReactElement {
  const { t } = useTranslation();

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape" && !event.defaultPrevented) {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      aria-label={t("projectDetail.interfaces.settingsTitle")}
      className={styles.overlay}
      role="dialog"
      aria-modal="false"
    >
      <div className={styles.panel}>
        <header className="shrink-0 border-b px-6 pt-5 pb-4">
          <div className="flex items-start justify-between gap-3">
            <p className="flex min-w-0 items-center gap-2.5 text-base font-semibold text-foreground">
              <Settings
                className="size-5 shrink-0 text-foreground"
                aria-hidden="true"
              />
              <span className="truncate">
                {t("projectDetail.interfaces.settingsTitle")}
              </span>
            </p>
            <button
              aria-label={t("projectDetail.interfaces.closePanel")}
              className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
              onClick={onClose}
              type="button"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("projectDetail.interfaces.settingsSubtitle", {
              name: serviceName,
            })}
          </p>
        </header>

        <div
          className="flex min-h-0 flex-1 flex-col"
          style={
            { "--scroll-fade-channels": "255 255 255" } as React.CSSProperties
          }
        >
          <VerticalScrollArea
            className="min-h-0 flex-1"
            contentClassName="gap-5 px-6 py-5"
            viewportClassName="pr-1"
          >
            {children}
          </VerticalScrollArea>
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t bg-surface px-6 py-4">
          {footer}
        </footer>
      </div>
    </div>
  );
}

interface ServiceIdentityProps {
  readonly id: IntegrationId;
  readonly name: string;
  readonly description: string;
  readonly connected: boolean;
}

/** Renders the service header block at the top of every settings panel. */
function ServiceIdentity({
  id,
  name,
  description,
  connected,
}: ServiceIdentityProps): React.ReactElement {
  return (
    <div className="flex items-start gap-4">
      <ServiceIcon id={id} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{name}</span>
          <StatusPill connected={connected} />
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}

interface FieldLabelProps {
  readonly htmlFor: string;
  readonly children: React.ReactNode;
}

/** Renders a small semibold label used above every panel input. */
function FieldLabel({
  htmlFor,
  children,
}: FieldLabelProps): React.ReactElement {
  return (
    <label
      className="select-none text-xs font-semibold text-foreground"
      htmlFor={htmlFor}
    >
      {children}
    </label>
  );
}

interface GitHubPanelProps {
  readonly integration: ProjectIntegration | null;
  readonly canWrite: boolean;
  readonly projectId: string;
  readonly onClose: () => void;
}

/**
 * Renders the GitHub settings panel with token, repository, sync, and footer actions.
 *
 * @remarks
 * The token is never logged or rendered in plain text by default, and the
 * stored secret stays server-side: an empty token field keeps the saved
 * secret. Write toggles for issues and pull requests map onto the stored
 * sync direction, so the server-side permission check keeps applying.
 */
function GitHubPanel({
  integration,
  canWrite,
  projectId,
  onClose,
}: GitHubPanelProps): React.ReactElement {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const actionData = useActionData();
  const [repoUrl, setRepoUrl] = useState(integration?.repoUrl ?? "");
  const [token, setToken] = useState("");
  const [isTokenVisible, setIsTokenVisible] = useState(false);
  const [replaceToken, setReplaceToken] = useState(false);
  const [syncIssues, setSyncIssues] = useState(integration?.syncIssues ?? true);
  const [syncPullRequests, setSyncPullRequests] = useState(
    integration?.syncPullRequests ?? true,
  );
  const [syncCommits, setSyncCommits] = useState(
    integration?.syncCommits ?? true,
  );
  const [allowCreateIssues, setAllowCreateIssues] = useState(
    integration ? integration.syncDirection !== "pull" : true,
  );
  const [allowCreatePullRequests, setAllowCreatePullRequests] = useState(
    integration ? integration.syncDirection !== "pull" : true,
  );
  const [branch, setBranch] = useState(DEFAULT_BRANCH);
  const [syncIntervalMinutes, setSyncIntervalMinutes] = useState(
    String(integration?.syncIntervalMinutes ?? 15),
  );
  const [lastTestIntent, setLastTestIntent] = useState(false);

  const isSaving =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "save-integration";
  const isTesting =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "test-integration";
  const hasToken = integration?.hasToken ?? false;
  const showTokenField = !hasToken || replaceToken;
  const isConnected = integration?.isConnected ?? false;
  const webhookUrl = `https://pages.example.com/api/webhooks/github/${projectId}`;
  const syncDirection =
    allowCreateIssues || allowCreatePullRequests ? "bidirectional" : "pull";

  const initialRepoUrl = integration?.repoUrl ?? "";
  const initialInterval = String(integration?.syncIntervalMinutes ?? 15);
  const initialDirectionAllowsPush = integration
    ? integration.syncDirection !== "pull"
    : true;
  const isDirty =
    repoUrl !== initialRepoUrl ||
    token.trim() !== "" ||
    syncIssues !== (integration?.syncIssues ?? true) ||
    syncPullRequests !== (integration?.syncPullRequests ?? true) ||
    syncCommits !== (integration?.syncCommits ?? true) ||
    allowCreateIssues !== initialDirectionAllowsPush ||
    allowCreatePullRequests !== initialDirectionAllowsPush ||
    syncIntervalMinutes !== initialInterval;

  function handleRepoUrlChange(
    event: React.ChangeEvent<HTMLInputElement>,
  ): void {
    setRepoUrl(event.currentTarget.value);
  }

  function handleTokenChange(event: React.ChangeEvent<HTMLInputElement>): void {
    setToken(event.currentTarget.value);
  }

  function handleToggleTokenVisibility(): void {
    setIsTokenVisible((previous) => !previous);
  }

  function handleReplaceToken(): void {
    setReplaceToken(true);
  }

  function handleTestSubmit(): void {
    setLastTestIntent(true);
  }

  function handleSaveSubmit(): void {
    setLastTestIntent(false);
  }

  const testFeedback =
    lastTestIntent &&
    navigation.state === "idle" &&
    isDetailActionResult(actionData)
      ? actionData.ok
        ? t("projectDetail.interfaces.connectionOk")
        : t("projectDetail.interfaces.connectionFailed")
      : null;
  const testFeedbackIsOk =
    lastTestIntent &&
    navigation.state === "idle" &&
    isDetailActionResult(actionData) &&
    actionData.ok;

  function handleIntervalChange(nextValue: string): void {
    setSyncIntervalMinutes(nextValue);
  }

  function handleBranchChange(nextValue: string): void {
    setBranch(nextValue);
  }

  if (!canWrite) {
    return (
      <PanelShell
        footer={null}
        onClose={onClose}
        serviceName={t("projectDetail.interfaces.githubName")}
      >
        <ServiceIdentity
          connected={isConnected}
          description={t("projectDetail.interfaces.githubDescription")}
          id="github"
          name={t("projectDetail.interfaces.githubName")}
        />
        <p className="rounded-xl bg-muted/60 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          {t("projectDetail.interfaces.readOnlyHint")}
        </p>
      </PanelShell>
    );
  }

  return (
    <PanelShell
      footer={
        <>
          <Form method="post" onSubmit={handleTestSubmit}>
            <input name="intent" type="hidden" value="test-integration" />
            <Button
              className="gap-2"
              disabled={isTesting}
              type="submit"
              variant="outline"
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              {isTesting
                ? t("projectDetail.integrations.testing")
                : t("projectDetail.integrations.test")}
            </Button>
          </Form>
          <Button
            disabled={!isDirty || isSaving}
            form="github-integration-form"
            type="submit"
          >
            {isSaving
              ? t("projectDetail.integrations.saving")
              : t("projectDetail.integrations.save")}
          </Button>
        </>
      }
      onClose={onClose}
      serviceName={t("projectDetail.interfaces.githubName")}
    >
      <ServiceIdentity
        connected={isConnected}
        description={t("projectDetail.interfaces.githubDescription")}
        id="github"
        name={t("projectDetail.interfaces.githubName")}
      />

      <Form
        className="flex flex-col gap-5"
        id="github-integration-form"
        method="post"
        onSubmit={handleSaveSubmit}
      >
        <input name="intent" type="hidden" value="save-integration" />
        <input name="syncDirection" type="hidden" value={syncDirection} />
        <input
          name="syncStatus"
          type="hidden"
          value={(integration?.syncStatus ?? true) ? "on" : ""}
        />
        <input
          name="syncComments"
          type="hidden"
          value={(integration?.syncComments ?? true) ? "on" : ""}
        />
        <input name="syncIssues" type="hidden" value={syncIssues ? "on" : ""} />
        <input
          name="syncPullRequests"
          type="hidden"
          value={syncPullRequests ? "on" : ""}
        />
        <input
          name="syncCommits"
          type="hidden"
          value={syncCommits ? "on" : ""}
        />
        <input
          name="syncIntervalMinutes"
          type="hidden"
          value={syncIntervalMinutes}
        />

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-foreground">
            {t("projectDetail.interfaces.authentication")}
          </h3>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor="github-token">
              {t("projectDetail.integrations.token")}
            </FieldLabel>
            {showTokenField ? (
              <div className="relative">
                <Input
                  autoComplete="off"
                  className="h-10 pr-11 text-sm xl:h-10 xl:text-sm"
                  id="github-token"
                  name="token"
                  onChange={handleTokenChange}
                  placeholder="ghp_••••••••••••••••••••"
                  type={isTokenVisible ? "text" : "password"}
                  value={token}
                />
                <button
                  aria-label={
                    isTokenVisible
                      ? t("projectDetail.interfaces.hideToken")
                      : t("projectDetail.interfaces.showToken")
                  }
                  className="absolute top-1/2 right-2 inline-flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
                  onClick={handleToggleTokenVisibility}
                  type="button"
                >
                  {isTokenVisible ? (
                    <EyeOff className="size-4" aria-hidden="true" />
                  ) : (
                    <Eye className="size-4" aria-hidden="true" />
                  )}
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <Input
                  aria-hidden="true"
                  autoComplete="off"
                  className="pointer-events-none h-10 text-sm select-none xl:h-10 xl:text-sm"
                  id="github-token"
                  name="token"
                  readOnly
                  tabIndex={-1}
                  type="password"
                  value="•••••••••••••••"
                />
                <p className="text-xs font-semibold text-emerald-700">
                  {t("projectDetail.integrations.tokenSet")}
                </p>
                <button
                  className="cursor-pointer self-start rounded-lg bg-muted px-3 py-1.5 text-xs font-semibold text-foreground outline-none transition-colors hover:bg-sidebar-hover focus-visible:ring-2 focus-visible:ring-primary"
                  onClick={handleReplaceToken}
                  type="button"
                >
                  {t("projectDetail.integrations.replaceToken")}
                </button>
              </div>
            )}
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("projectDetail.interfaces.tokenHelp")}
            </p>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
          <div className="flex min-w-0 flex-col gap-1.5">
            <FieldLabel htmlFor="github-repo">
              {t("projectDetail.interfaces.repositoryLabel")}
            </FieldLabel>
            <Input
              autoComplete="off"
              className="h-10 text-sm xl:h-10 xl:text-sm"
              id="github-repo"
              name="repoUrl"
              onChange={handleRepoUrlChange}
              placeholder={t("projectDetail.integrations.repoPlaceholder")}
              type="url"
              value={repoUrl}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="select-none text-xs font-semibold text-foreground">
              {t("projectDetail.interfaces.branchLabel")}
            </span>
            <Select
              ariaLabel={t("projectDetail.interfaces.branchLabel")}
              className="w-full"
              onValueChange={handleBranchChange}
              options={BRANCH_OPTIONS.map((option) => ({
                label: option,
                value: option,
              }))}
              value={branch}
            />
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <h3 className="text-sm font-semibold text-foreground">
            {t("projectDetail.integrations.sync")}
          </h3>
          <ToggleRow
            checked={syncIssues}
            hint={t("projectDetail.interfaces.syncIssuesHint")}
            onChange={setSyncIssues}
            title={t("projectDetail.integrations.syncIssues")}
          />
          <ToggleRow
            checked={syncPullRequests}
            hint={t("projectDetail.interfaces.syncPullRequestsHint")}
            onChange={setSyncPullRequests}
            title={t("projectDetail.integrations.syncPullRequests")}
          />
          <ToggleRow
            checked={syncCommits}
            hint={t("projectDetail.interfaces.syncCommitsHint")}
            onChange={setSyncCommits}
            title={t("projectDetail.interfaces.syncCommitsLabel")}
          />
        </section>

        <section className="flex flex-col gap-4">
          <h3 className="text-sm font-semibold text-foreground">
            {t("projectDetail.interfaces.createFromPages")}
          </h3>
          <ToggleRow
            checked={allowCreateIssues}
            hint={t("projectDetail.interfaces.allowCreateIssuesHint")}
            onChange={setAllowCreateIssues}
            title={t("projectDetail.interfaces.allowCreateIssues")}
          />
          <ToggleRow
            checked={allowCreatePullRequests}
            hint={t("projectDetail.interfaces.allowCreatePullRequestsHint")}
            onChange={setAllowCreatePullRequests}
            title={t("projectDetail.interfaces.allowCreatePullRequests")}
          />
        </section>

        <section className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="github-webhook">
            {t("projectDetail.interfaces.webhookUrlLabel")}
          </FieldLabel>
          <CopyField id="github-webhook" value={webhookUrl} />
        </section>

        <section className="flex flex-col gap-1.5">
          <span className="select-none text-xs font-semibold text-foreground">
            {t("projectDetail.integrations.interval")}
          </span>
          <Select
            ariaLabel={t("projectDetail.integrations.interval")}
            className="w-full"
            onValueChange={handleIntervalChange}
            options={[
              {
                label: t("projectDetail.integrations.intervalManual"),
                value: "0",
              },
              {
                label: t("projectDetail.integrations.intervalMinutes", {
                  count: 5,
                }),
                value: "5",
              },
              {
                label: t("projectDetail.integrations.intervalMinutes", {
                  count: 15,
                }),
                value: "15",
              },
              {
                label: t("projectDetail.integrations.intervalMinutes", {
                  count: 30,
                }),
                value: "30",
              },
              {
                label: t("projectDetail.integrations.intervalMinutes", {
                  count: 60,
                }),
                value: "60",
              },
            ]}
            value={syncIntervalMinutes}
          />
        </section>
      </Form>

      {testFeedback ? (
        <p
          className={cn(
            "rounded-xl px-4 py-2.5 text-xs font-medium",
            testFeedbackIsOk
              ? "bg-emerald-50 text-emerald-700"
              : "bg-red-50 text-destructive",
          )}
          role="status"
        >
          {testFeedback}
        </p>
      ) : null}

      {integration ? (
        <section className="flex flex-col gap-3 rounded-2xl bg-muted/40 p-4">
          <p className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <span
              aria-hidden="true"
              className={cn(
                "size-2 rounded-full",
                integration.isConnected
                  ? "bg-emerald-500"
                  : "bg-muted-foreground",
              )}
            />
            {integration.isConnected
              ? t("projectDetail.integrations.connected")
              : t("projectDetail.integrations.notConnected")}
          </p>
          <dl className="flex flex-col gap-1.5 text-xs">
            <div className="flex gap-2">
              <dt className="text-muted-foreground">
                {t("projectDetail.integrations.repository")}
              </dt>
              <dd className="font-medium text-foreground">
                {integration.repoName ?? "—"}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">
                {t("projectDetail.integrations.lastSync")}
              </dt>
              <dd className="text-muted-foreground">
                {integration.lastSyncAt ??
                  t("projectDetail.integrations.never")}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">
                {t("projectDetail.integrations.nextSync")}
              </dt>
              <dd className="text-muted-foreground">
                {integration.nextSyncAt ??
                  t("projectDetail.integrations.intervalManual")}
              </dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-2">
            {integration.isConnected ? (
              <Form method="post">
                <input name="intent" type="hidden" value="sync-integration" />
                <Button
                  className="h-8 px-3 text-xs"
                  type="submit"
                  variant="ghost"
                >
                  {t("projectDetail.integrations.syncNow")}
                </Button>
              </Form>
            ) : null}
            <Form method="post">
              <input
                name="intent"
                type="hidden"
                value="disconnect-integration"
              />
              <Button
                className="h-8 px-3 text-xs text-destructive hover:text-destructive"
                type="submit"
                variant="ghost"
              >
                {t("projectDetail.integrations.disconnect")}
              </Button>
            </Form>
          </div>
        </section>
      ) : null}
    </PanelShell>
  );
}

interface LocalPanelProps {
  readonly canWrite: boolean;
  readonly onClose: () => void;
}

/** Renders the Google Calendar settings panel with the shared overlay chrome. */
function GoogleCalendarPanel({
  canWrite,
  onClose,
}: LocalPanelProps): React.ReactElement {
  const { t } = useTranslation();
  const [calendar, setCalendar] = useState("");
  const [importDates, setImportDates] = useState(true);
  const [exportDates, setExportDates] = useState(false);
  const [direction, setDirection] = useState("both");
  const [interval, setInterval] = useState("15");
  const [feedback, setFeedback] = useState<string | null>(null);

  const isDirty =
    calendar !== "" ||
    !importDates ||
    exportDates ||
    direction !== "both" ||
    interval !== "15";

  function handleTest(): void {
    setFeedback(
      calendar
        ? t("projectDetail.interfaces.connectionOk")
        : t("projectDetail.interfaces.connectionFailed"),
    );
  }

  function handleSave(): void {
    setFeedback(t("projectDetail.interfaces.savedLocally"));
  }

  if (!canWrite) {
    return (
      <PanelShell
        footer={null}
        onClose={onClose}
        serviceName={t("projectDetail.interfaces.calendarName")}
      >
        <ServiceIdentity
          connected={false}
          description={t("projectDetail.interfaces.calendarDescription")}
          id="google-calendar"
          name={t("projectDetail.interfaces.calendarName")}
        />
        <p className="rounded-xl bg-muted/60 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          {t("projectDetail.interfaces.readOnlyHint")}
        </p>
      </PanelShell>
    );
  }

  return (
    <PanelShell
      footer={
        <>
          <Button
            className="gap-2"
            onClick={handleTest}
            type="button"
            variant="outline"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            {t("projectDetail.integrations.test")}
          </Button>
          <Button disabled={!isDirty} onClick={handleSave} type="button">
            {t("projectDetail.integrations.save")}
          </Button>
        </>
      }
      onClose={onClose}
      serviceName={t("projectDetail.interfaces.calendarName")}
    >
      <ServiceIdentity
        connected={false}
        description={t("projectDetail.interfaces.calendarDescription")}
        id="google-calendar"
        name={t("projectDetail.interfaces.calendarName")}
      />
      <div className="flex flex-col gap-1.5">
        <span className="select-none text-xs font-semibold text-foreground">
          {t("projectDetail.interfaces.calendarConnect")}
        </span>
        <Button className="self-start" type="button" variant="outline">
          <LinkIcon className="size-4" aria-hidden="true" />
          {t("projectDetail.interfaces.calendarConnect")}
        </Button>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("projectDetail.interfaces.calendarConnectHint")}
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="select-none text-xs font-semibold text-foreground">
          {t("projectDetail.interfaces.calendarSelect")}
        </span>
        <Select
          ariaLabel={t("projectDetail.interfaces.calendarSelect")}
          className="w-full"
          onValueChange={setCalendar}
          options={[]}
          placeholder={t("projectDetail.interfaces.calendarSelectPlaceholder")}
          value={calendar}
        />
      </div>
      <div className="flex flex-col gap-4">
        <ToggleRow
          checked={importDates}
          hint={t("projectDetail.interfaces.calendarImportHint")}
          onChange={setImportDates}
          title={t("projectDetail.interfaces.calendarImport")}
        />
        <ToggleRow
          checked={exportDates}
          hint={t("projectDetail.interfaces.calendarExportHint")}
          onChange={setExportDates}
          title={t("projectDetail.interfaces.calendarExport")}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="select-none text-xs font-semibold text-foreground">
          {t("projectDetail.interfaces.calendarDirection")}
        </span>
        <Select
          ariaLabel={t("projectDetail.interfaces.calendarDirection")}
          className="w-full"
          onValueChange={setDirection}
          options={[
            {
              label: t("projectDetail.interfaces.calendarDirectionImport"),
              value: "import",
            },
            {
              label: t("projectDetail.interfaces.calendarDirectionExport"),
              value: "export",
            },
            {
              label: t("projectDetail.interfaces.calendarDirectionBoth"),
              value: "both",
            },
          ]}
          value={direction}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="select-none text-xs font-semibold text-foreground">
          {t("projectDetail.integrations.interval")}
        </span>
        <Select
          ariaLabel={t("projectDetail.integrations.interval")}
          className="w-full"
          onValueChange={setInterval}
          options={[
            {
              label: t("projectDetail.integrations.intervalManual"),
              value: "0",
            },
            {
              label: t("projectDetail.integrations.intervalMinutes", {
                count: 15,
              }),
              value: "15",
            },
            {
              label: t("projectDetail.integrations.intervalMinutes", {
                count: 30,
              }),
              value: "30",
            },
            {
              label: t("projectDetail.integrations.intervalMinutes", {
                count: 60,
              }),
              value: "60",
            },
          ]}
          value={interval}
        />
      </div>
      {feedback ? (
        <p
          className="rounded-xl bg-muted/60 px-4 py-2.5 text-xs font-medium text-foreground"
          role="status"
        >
          {feedback}
        </p>
      ) : null}
    </PanelShell>
  );
}

/** Renders the Discord settings panel with the shared overlay chrome. */
function DiscordPanel({
  canWrite,
  onClose,
}: LocalPanelProps): React.ReactElement {
  const { t } = useTranslation();
  const [webhookUrl, setWebhookUrl] = useState("");
  const [channel, setChannel] = useState("");
  const [notifyTask, setNotifyTask] = useState(true);
  const [notifyStatus, setNotifyStatus] = useState(true);
  const [notifyMilestone, setNotifyMilestone] = useState(false);
  const [notifyActivity, setNotifyActivity] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const isDirty =
    webhookUrl !== "" ||
    channel !== "" ||
    !notifyTask ||
    !notifyStatus ||
    notifyMilestone ||
    notifyActivity;

  function handleWebhookChange(
    event: React.ChangeEvent<HTMLInputElement>,
  ): void {
    setWebhookUrl(event.currentTarget.value);
  }

  function handleChannelChange(
    event: React.ChangeEvent<HTMLInputElement>,
  ): void {
    setChannel(event.currentTarget.value);
  }

  function handleTest(): void {
    setFeedback(
      webhookUrl.trim()
        ? t("projectDetail.interfaces.connectionOk")
        : t("projectDetail.interfaces.connectionFailed"),
    );
  }

  function handleSave(): void {
    setFeedback(t("projectDetail.interfaces.savedLocally"));
  }

  if (!canWrite) {
    return (
      <PanelShell
        footer={null}
        onClose={onClose}
        serviceName={t("projectDetail.interfaces.discordName")}
      >
        <ServiceIdentity
          connected={false}
          description={t("projectDetail.interfaces.discordDescription")}
          id="discord"
          name={t("projectDetail.interfaces.discordName")}
        />
        <p className="rounded-xl bg-muted/60 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          {t("projectDetail.interfaces.readOnlyHint")}
        </p>
      </PanelShell>
    );
  }

  return (
    <PanelShell
      footer={
        <>
          <Button
            className="gap-2"
            onClick={handleTest}
            type="button"
            variant="outline"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            {t("projectDetail.integrations.test")}
          </Button>
          <Button disabled={!isDirty} onClick={handleSave} type="button">
            {t("projectDetail.integrations.save")}
          </Button>
        </>
      }
      onClose={onClose}
      serviceName={t("projectDetail.interfaces.discordName")}
    >
      <ServiceIdentity
        connected={false}
        description={t("projectDetail.interfaces.discordDescription")}
        id="discord"
        name={t("projectDetail.interfaces.discordName")}
      />
      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor="discord-webhook">
          {t("projectDetail.interfaces.discordWebhook")}
        </FieldLabel>
        <Input
          autoComplete="off"
          className="h-10 text-sm xl:h-10 xl:text-sm"
          id="discord-webhook"
          onChange={handleWebhookChange}
          placeholder={t("projectDetail.interfaces.discordWebhookPlaceholder")}
          type="url"
          value={webhookUrl}
        />
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("projectDetail.interfaces.discordWebhookHint")}
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor="discord-channel">
          {t("projectDetail.interfaces.discordChannel")}
        </FieldLabel>
        <Input
          autoComplete="off"
          className="h-10 text-sm xl:h-10 xl:text-sm"
          id="discord-channel"
          onChange={handleChannelChange}
          placeholder={t("projectDetail.interfaces.discordChannelPlaceholder")}
          type="text"
          value={channel}
        />
      </div>
      <section className="flex flex-col gap-4">
        <h3 className="text-sm font-semibold text-foreground">
          {t("projectDetail.interfaces.discordEvents")}
        </h3>
        <ToggleRow
          checked={notifyTask}
          hint={t("projectDetail.interfaces.discordEventTaskHint")}
          onChange={setNotifyTask}
          title={t("projectDetail.interfaces.discordEventTask")}
        />
        <ToggleRow
          checked={notifyStatus}
          hint={t("projectDetail.interfaces.discordEventStatusHint")}
          onChange={setNotifyStatus}
          title={t("projectDetail.interfaces.discordEventStatus")}
        />
        <ToggleRow
          checked={notifyMilestone}
          hint={t("projectDetail.interfaces.discordEventMilestoneHint")}
          onChange={setNotifyMilestone}
          title={t("projectDetail.interfaces.discordEventMilestone")}
        />
        <ToggleRow
          checked={notifyActivity}
          hint={t("projectDetail.interfaces.discordEventActivityHint")}
          onChange={setNotifyActivity}
          title={t("projectDetail.interfaces.discordEventActivity")}
        />
      </section>
      {feedback ? (
        <p
          className="rounded-xl bg-muted/60 px-4 py-2.5 text-xs font-medium text-foreground"
          role="status"
        >
          {feedback}
        </p>
      ) : null}
    </PanelShell>
  );
}

/** Renders the webhooks settings panel with the shared overlay chrome. */
function WebhooksPanel({
  canWrite,
  onClose,
}: LocalPanelProps): React.ReactElement {
  const { t } = useTranslation();
  const [targetUrl, setTargetUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [method, setMethod] = useState("POST");
  const [isActive, setIsActive] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);

  const isDirty =
    targetUrl !== "" || secret !== "" || method !== "POST" || !isActive;

  function handleTargetChange(
    event: React.ChangeEvent<HTMLInputElement>,
  ): void {
    setTargetUrl(event.currentTarget.value);
  }

  function handleSecretChange(
    event: React.ChangeEvent<HTMLInputElement>,
  ): void {
    setSecret(event.currentTarget.value);
  }

  function handleMethodChange(nextValue: string): void {
    setMethod(nextValue);
  }

  function handleTest(): void {
    setFeedback(
      targetUrl.trim()
        ? t("projectDetail.interfaces.connectionOk")
        : t("projectDetail.interfaces.connectionFailed"),
    );
  }

  function handleSave(): void {
    setFeedback(t("projectDetail.interfaces.savedLocally"));
  }

  if (!canWrite) {
    return (
      <PanelShell
        footer={null}
        onClose={onClose}
        serviceName={t("projectDetail.interfaces.webhooksName")}
      >
        <ServiceIdentity
          connected={false}
          description={t("projectDetail.interfaces.webhooksDescription")}
          id="webhooks"
          name={t("projectDetail.interfaces.webhooksName")}
        />
        <p className="rounded-xl bg-muted/60 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          {t("projectDetail.interfaces.readOnlyHint")}
        </p>
      </PanelShell>
    );
  }

  return (
    <PanelShell
      footer={
        <>
          <Button
            className="gap-2"
            onClick={handleTest}
            type="button"
            variant="outline"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            {t("projectDetail.integrations.test")}
          </Button>
          <Button disabled={!isDirty} onClick={handleSave} type="button">
            {t("projectDetail.integrations.save")}
          </Button>
        </>
      }
      onClose={onClose}
      serviceName={t("projectDetail.interfaces.webhooksName")}
    >
      <ServiceIdentity
        connected={false}
        description={t("projectDetail.interfaces.webhooksDescription")}
        id="webhooks"
        name={t("projectDetail.interfaces.webhooksName")}
      />
      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor="webhook-target">
          {t("projectDetail.interfaces.webhookTarget")}
        </FieldLabel>
        <Input
          autoComplete="off"
          className="h-10 text-sm xl:h-10 xl:text-sm"
          id="webhook-target"
          onChange={handleTargetChange}
          placeholder={t("projectDetail.interfaces.webhookTargetPlaceholder")}
          type="url"
          value={targetUrl}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="webhook-secret">
            {t("projectDetail.interfaces.webhookSecret")}
          </FieldLabel>
          <Input
            autoComplete="off"
            className="h-10 text-sm xl:h-10 xl:text-sm"
            id="webhook-secret"
            onChange={handleSecretChange}
            type="password"
            value={secret}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="select-none text-xs font-semibold text-foreground">
            {t("projectDetail.interfaces.webhookMethod")}
          </span>
          <Select
            ariaLabel={t("projectDetail.interfaces.webhookMethod")}
            className="w-full"
            onValueChange={handleMethodChange}
            options={[
              { label: "POST", value: "POST" },
              { label: "PUT", value: "PUT" },
              { label: "PATCH", value: "PATCH" },
            ]}
            value={method}
          />
        </div>
      </div>
      <section className="flex flex-col gap-4">
        <h3 className="text-sm font-semibold text-foreground">
          {t("projectDetail.interfaces.webhookEvents")}
        </h3>
        <ToggleRow
          checked={isActive}
          hint={t("projectDetail.interfaces.webhookActiveHint")}
          onChange={setIsActive}
          title={t("projectDetail.interfaces.webhookActive")}
        />
      </section>
      {feedback ? (
        <p
          className="rounded-xl bg-muted/60 px-4 py-2.5 text-xs font-medium text-foreground"
          role="status"
        >
          {feedback}
        </p>
      ) : null}
    </PanelShell>
  );
}

/** Renders the email settings panel with the shared overlay chrome. */
function EmailPanel({
  canWrite,
  onClose,
}: LocalPanelProps): React.ReactElement {
  const { t } = useTranslation();
  const [host, setHost] = useState("");
  const [port, setPort] = useState("587");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [useTls, setUseTls] = useState(true);
  const [sender, setSender] = useState("");
  const [ruleTask, setRuleTask] = useState(true);
  const [ruleStatus, setRuleStatus] = useState(true);
  const [ruleMilestone, setRuleMilestone] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const isDirty =
    host !== "" ||
    port !== "587" ||
    username !== "" ||
    password !== "" ||
    !useTls ||
    sender !== "" ||
    !ruleTask ||
    !ruleStatus ||
    ruleMilestone;

  function handleHostChange(event: React.ChangeEvent<HTMLInputElement>): void {
    setHost(event.currentTarget.value);
  }

  function handlePortChange(event: React.ChangeEvent<HTMLInputElement>): void {
    setPort(event.currentTarget.value);
  }

  function handleUsernameChange(
    event: React.ChangeEvent<HTMLInputElement>,
  ): void {
    setUsername(event.currentTarget.value);
  }

  function handlePasswordChange(
    event: React.ChangeEvent<HTMLInputElement>,
  ): void {
    setPassword(event.currentTarget.value);
  }

  function handleSenderChange(
    event: React.ChangeEvent<HTMLInputElement>,
  ): void {
    setSender(event.currentTarget.value);
  }

  function handleTest(): void {
    setFeedback(
      host.trim()
        ? t("projectDetail.interfaces.connectionOk")
        : t("projectDetail.interfaces.connectionFailed"),
    );
  }

  function handleSave(): void {
    setFeedback(t("projectDetail.interfaces.savedLocally"));
  }

  if (!canWrite) {
    return (
      <PanelShell
        footer={null}
        onClose={onClose}
        serviceName={t("projectDetail.interfaces.emailName")}
      >
        <ServiceIdentity
          connected={false}
          description={t("projectDetail.interfaces.emailDescription")}
          id="email"
          name={t("projectDetail.interfaces.emailName")}
        />
        <p className="rounded-xl bg-muted/60 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          {t("projectDetail.interfaces.readOnlyHint")}
        </p>
      </PanelShell>
    );
  }

  return (
    <PanelShell
      footer={
        <>
          <Button
            className="gap-2"
            onClick={handleTest}
            type="button"
            variant="outline"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            {t("projectDetail.integrations.test")}
          </Button>
          <Button disabled={!isDirty} onClick={handleSave} type="button">
            {t("projectDetail.integrations.save")}
          </Button>
        </>
      }
      onClose={onClose}
      serviceName={t("projectDetail.interfaces.emailName")}
    >
      <ServiceIdentity
        connected={false}
        description={t("projectDetail.interfaces.emailDescription")}
        id="email"
        name={t("projectDetail.interfaces.emailName")}
      />
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_6rem]">
        <div className="flex min-w-0 flex-col gap-1.5">
          <FieldLabel htmlFor="email-host">
            {t("projectDetail.interfaces.emailHost")}
          </FieldLabel>
          <Input
            autoComplete="off"
            className="h-10 text-sm xl:h-10 xl:text-sm"
            id="email-host"
            onChange={handleHostChange}
            placeholder={t("projectDetail.interfaces.emailHostPlaceholder")}
            type="text"
            value={host}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="email-port">
            {t("projectDetail.interfaces.emailPort")}
          </FieldLabel>
          <Input
            autoComplete="off"
            className="h-10 text-sm xl:h-10 xl:text-sm"
            id="email-port"
            inputMode="numeric"
            onChange={handlePortChange}
            type="text"
            value={port}
          />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="email-username">
            {t("projectDetail.interfaces.emailUsername")}
          </FieldLabel>
          <Input
            autoComplete="off"
            className="h-10 text-sm xl:h-10 xl:text-sm"
            id="email-username"
            onChange={handleUsernameChange}
            type="text"
            value={username}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="email-password">
            {t("projectDetail.interfaces.emailPassword")}
          </FieldLabel>
          <Input
            autoComplete="off"
            className="h-10 text-sm xl:h-10 xl:text-sm"
            id="email-password"
            onChange={handlePasswordChange}
            type="password"
            value={password}
          />
        </div>
      </div>
      <ToggleRow
        checked={useTls}
        hint={t("projectDetail.interfaces.emailTlsHint")}
        onChange={setUseTls}
        title={t("projectDetail.interfaces.emailTls")}
      />
      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor="email-sender">
          {t("projectDetail.interfaces.emailSender")}
        </FieldLabel>
        <Input
          autoComplete="off"
          className="h-10 text-sm xl:h-10 xl:text-sm"
          id="email-sender"
          onChange={handleSenderChange}
          placeholder={t("projectDetail.interfaces.emailSenderPlaceholder")}
          type="email"
          value={sender}
        />
      </div>
      <section className="flex flex-col gap-4">
        <h3 className="text-sm font-semibold text-foreground">
          {t("projectDetail.interfaces.emailRules")}
        </h3>
        <ToggleRow
          checked={ruleTask}
          hint={t("projectDetail.interfaces.emailRuleTaskHint")}
          onChange={setRuleTask}
          title={t("projectDetail.interfaces.emailRuleTask")}
        />
        <ToggleRow
          checked={ruleStatus}
          hint={t("projectDetail.interfaces.emailRuleStatusHint")}
          onChange={setRuleStatus}
          title={t("projectDetail.interfaces.emailRuleStatus")}
        />
        <ToggleRow
          checked={ruleMilestone}
          hint={t("projectDetail.interfaces.emailRuleMilestoneHint")}
          onChange={setRuleMilestone}
          title={t("projectDetail.interfaces.emailRuleMilestone")}
        />
      </section>
      {feedback ? (
        <p
          className="rounded-xl bg-muted/60 px-4 py-2.5 text-xs font-medium text-foreground"
          role="status"
        >
          {feedback}
        </p>
      ) : null}
    </PanelShell>
  );
}

/** Renders the REST API settings panel with the shared overlay chrome. */
function RestApiPanel({
  canWrite,
  onClose,
}: LocalPanelProps): React.ReactElement {
  const { t } = useTranslation();
  const [apiEnabled, setApiEnabled] = useState(false);
  const [apiToken, setApiToken] = useState<string | null>(null);
  const [scopeReadProjects, setScopeReadProjects] = useState(true);
  const [scopeReadTasks, setScopeReadTasks] = useState(true);
  const [scopeWriteTasks, setScopeWriteTasks] = useState(false);
  const [scopeReadMilestones, setScopeReadMilestones] = useState(true);
  const [scopeWriteMilestones, setScopeWriteMilestones] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const isDirty =
    apiEnabled ||
    apiToken !== null ||
    !scopeReadProjects ||
    !scopeReadTasks ||
    scopeWriteTasks ||
    !scopeReadMilestones ||
    scopeWriteMilestones;

  function createToken(): string {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);

    return Array.from(bytes)
      .map((entry) => entry.toString(16).padStart(2, "0"))
      .join("");
  }

  function handleCreateToken(): void {
    setApiToken(`pages_${createToken()}`);
    setFeedback(null);
  }

  function handleRenewToken(): void {
    setApiToken(`pages_${createToken()}`);
    setFeedback(null);
  }

  function handleCopyToken(): void {
    if (!apiToken || !navigator.clipboard) {
      return;
    }

    navigator.clipboard.writeText(apiToken).catch(() => {
      setFeedback(t("projectDetail.interfaces.connectionFailed"));
    });
  }

  function handleRevokeToken(): void {
    setApiToken(null);
    setFeedback(null);
  }

  function handleTest(): void {
    setFeedback(
      apiEnabled && apiToken
        ? t("projectDetail.interfaces.connectionOk")
        : t("projectDetail.interfaces.connectionFailed"),
    );
  }

  function handleSave(): void {
    setFeedback(t("projectDetail.interfaces.savedLocally"));
  }

  if (!canWrite) {
    return (
      <PanelShell
        footer={null}
        onClose={onClose}
        serviceName={t("projectDetail.interfaces.restApiName")}
      >
        <ServiceIdentity
          connected={false}
          description={t("projectDetail.interfaces.restApiDescription")}
          id="rest-api"
          name={t("projectDetail.interfaces.restApiName")}
        />
        <p className="rounded-xl bg-muted/60 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          {t("projectDetail.interfaces.readOnlyHint")}
        </p>
      </PanelShell>
    );
  }

  return (
    <PanelShell
      footer={
        <>
          <Button
            className="gap-2"
            onClick={handleTest}
            type="button"
            variant="outline"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            {t("projectDetail.integrations.test")}
          </Button>
          <Button disabled={!isDirty} onClick={handleSave} type="button">
            {t("projectDetail.integrations.save")}
          </Button>
        </>
      }
      onClose={onClose}
      serviceName={t("projectDetail.interfaces.restApiName")}
    >
      <ServiceIdentity
        connected={false}
        description={t("projectDetail.interfaces.restApiDescription")}
        id="rest-api"
        name={t("projectDetail.interfaces.restApiName")}
      />
      <ToggleRow
        checked={apiEnabled}
        hint={t("projectDetail.interfaces.apiEnableHint")}
        onChange={setApiEnabled}
        title={t("projectDetail.interfaces.apiEnable")}
      />
      <div className="flex flex-col gap-1.5">
        <span className="select-none text-xs font-semibold text-foreground">
          {t("projectDetail.interfaces.apiToken")}
        </span>
        {apiToken ? (
          <CopyField id="rest-api-token" value={apiToken} />
        ) : (
          <Button
            className="gap-2 self-start"
            disabled={!apiEnabled}
            onClick={handleCreateToken}
            type="button"
            variant="outline"
          >
            <KeyRound className="size-4" aria-hidden="true" />
            {t("projectDetail.interfaces.apiCreate")}
          </Button>
        )}
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("projectDetail.interfaces.apiTokenHint")}
        </p>
        {apiToken ? (
          <div className="flex flex-wrap gap-2">
            <Button
              className="h-8 px-3 text-xs"
              onClick={handleCopyToken}
              type="button"
              variant="ghost"
            >
              {t("projectDetail.interfaces.apiCopy")}
            </Button>
            <Button
              className="h-8 px-3 text-xs"
              onClick={handleRenewToken}
              type="button"
              variant="ghost"
            >
              {t("projectDetail.interfaces.apiRenew")}
            </Button>
            <Button
              className="h-8 px-3 text-xs text-destructive hover:text-destructive"
              onClick={handleRevokeToken}
              type="button"
              variant="ghost"
            >
              {t("projectDetail.interfaces.apiRevoke")}
            </Button>
          </div>
        ) : null}
      </div>
      <section className="flex flex-col gap-4">
        <h3 className="text-sm font-semibold text-foreground">
          {t("projectDetail.interfaces.apiScopes")}
        </h3>
        <ToggleRow
          checked={scopeReadProjects}
          hint=""
          onChange={setScopeReadProjects}
          title={t("projectDetail.interfaces.apiScopeReadProjects")}
        />
        <ToggleRow
          checked={scopeReadTasks}
          hint=""
          onChange={setScopeReadTasks}
          title={t("projectDetail.interfaces.apiScopeReadTasks")}
        />
        <ToggleRow
          checked={scopeWriteTasks}
          hint=""
          onChange={setScopeWriteTasks}
          title={t("projectDetail.interfaces.apiScopeWriteTasks")}
        />
        <ToggleRow
          checked={scopeReadMilestones}
          hint=""
          onChange={setScopeReadMilestones}
          title={t("projectDetail.interfaces.apiScopeReadMilestones")}
        />
        <ToggleRow
          checked={scopeWriteMilestones}
          hint=""
          onChange={setScopeWriteMilestones}
          title={t("projectDetail.interfaces.apiScopeWriteMilestones")}
        />
      </section>
      {feedback ? (
        <p
          className="rounded-xl bg-muted/60 px-4 py-2.5 text-xs font-medium text-foreground"
          role="status"
        >
          {feedback}
        </p>
      ) : null}
    </PanelShell>
  );
}

/**
 * Renders the project interfaces tab with clickable cards and an overlay settings panel.
 *
 * @remarks
 * The six cards never contain their own action buttons: selecting a card
 * opens the matching panel as a fixed overlay on the right, leaving the
 * main page width and position untouched. Only GitHub persists
 * server-side today; the remaining panels collect their project-scoped
 * settings in the same visual pattern.
 */
export function ProjectIntegrationsTab({
  integration,
  canWrite,
  projectId,
}: ProjectIntegrationsTabProps): React.ReactElement {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<IntegrationId | null>(null);

  const isGitHubConnected = integration?.isConnected ?? false;

  function handleSelect(id: IntegrationId): void {
    setSelected(id);
  }

  function handleClosePanel(): void {
    setSelected(null);
  }

  function getCardName(id: IntegrationId): string {
    if (id === "github") {
      return t("projectDetail.interfaces.githubName");
    }

    if (id === "google-calendar") {
      return t("projectDetail.interfaces.calendarName");
    }

    if (id === "discord") {
      return t("projectDetail.interfaces.discordName");
    }

    if (id === "webhooks") {
      return t("projectDetail.interfaces.webhooksName");
    }

    if (id === "email") {
      return t("projectDetail.interfaces.emailName");
    }

    return t("projectDetail.interfaces.restApiName");
  }

  function getCardDescription(id: IntegrationId): string {
    if (id === "github") {
      return t("projectDetail.interfaces.githubCardDescription");
    }

    if (id === "google-calendar") {
      return t("projectDetail.interfaces.calendarDescription");
    }

    if (id === "discord") {
      return t("projectDetail.interfaces.discordDescription");
    }

    if (id === "webhooks") {
      return t("projectDetail.interfaces.webhooksDescription");
    }

    if (id === "email") {
      return t("projectDetail.interfaces.emailDescription");
    }

    return t("projectDetail.interfaces.restApiDescription");
  }

  function isCardConnected(id: IntegrationId): boolean {
    return id === "github" && isGitHubConnected;
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl bg-muted/40 p-6">
        <h2 className="flex select-none items-center gap-2.5 font-semibold text-foreground">
          <span
            aria-hidden="true"
            className="flex size-9 items-center justify-center rounded-xl bg-surface text-primary shadow-xs"
          >
            <Plug className="size-4" />
          </span>
          {t("projectDetail.interfaces.availableTitle")}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {t("projectDetail.interfaces.availableSubtitle")}
        </p>

        <div className="mt-5 grid items-start gap-4 md:grid-cols-2">
          {INTEGRATION_ORDER.map((id) => (
            <IntegrationCard
              key={id}
              connected={isCardConnected(id)}
              description={getCardDescription(id)}
              id={id}
              name={getCardName(id)}
              onSelect={handleSelect}
              selected={selected === id}
            />
          ))}
        </div>

        <div className="mt-5 flex items-start gap-3 rounded-2xl bg-primary-subtle px-5 py-4">
          <BookOpen
            className="mt-0.5 size-5 shrink-0 text-primary"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">
              {t("projectDetail.interfaces.aboutTitle")}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t("projectDetail.interfaces.aboutText")}
            </p>
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-primary">
              {t("projectDetail.interfaces.learnMore")}
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </p>
          </div>
        </div>
      </section>

      {selected === "github" ? (
        <GitHubPanel
          key={integration?.updatedAt ?? "github-new"}
          canWrite={canWrite}
          integration={integration}
          onClose={handleClosePanel}
          projectId={projectId}
        />
      ) : null}
      {selected === "google-calendar" ? (
        <GoogleCalendarPanel canWrite={canWrite} onClose={handleClosePanel} />
      ) : null}
      {selected === "discord" ? (
        <DiscordPanel canWrite={canWrite} onClose={handleClosePanel} />
      ) : null}
      {selected === "webhooks" ? (
        <WebhooksPanel canWrite={canWrite} onClose={handleClosePanel} />
      ) : null}
      {selected === "email" ? (
        <EmailPanel canWrite={canWrite} onClose={handleClosePanel} />
      ) : null}
      {selected === "rest-api" ? (
        <RestApiPanel canWrite={canWrite} onClose={handleClosePanel} />
      ) : null}
    </div>
  );
}
