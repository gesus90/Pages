import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form, useNavigation } from "react-router";

import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";

import type { ProjectIntegration } from "@/definition/Project";

interface ProjectIntegrationsTabProps {
  readonly integration: ProjectIntegration | null;
  readonly canWrite: boolean;
}

/** Renders the GitHub integration settings without ever exposing the stored secret. */
export function ProjectIntegrationsTab({
  integration,
  canWrite,
}: ProjectIntegrationsTabProps): React.ReactElement {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const [replaceToken, setReplaceToken] = useState(false);
  const [syncDirection, setSyncDirection] = useState<string>(
    integration?.syncDirection ?? "bidirectional",
  );
  const [syncIntervalMinutes, setSyncIntervalMinutes] = useState<string>(
    String(integration?.syncIntervalMinutes ?? 15),
  );
  const isSaving =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "save-integration";
  const isTesting =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "test-integration";
  const showTokenField = !integration?.hasToken || replaceToken;

  if (!canWrite) {
    return (
      <section className="rounded-2xl bg-muted/40 p-6">
        <h2 className="font-semibold text-foreground">
          {t("projectDetail.integrations.github")}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {integration?.isConnected
            ? t("projectDetail.integrations.connected")
            : t("projectDetail.integrations.notConnected")}
        </p>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl bg-muted/40 p-6">
        <h2 className="font-semibold text-foreground">
          {t("projectDetail.integrations.github")}
        </h2>
        <Form method="post" className="mt-4 flex flex-col gap-4">
          <input name="intent" type="hidden" value="save-integration" />
          <label className="flex flex-col gap-2 text-sm font-medium">
            <span className="select-none">
              {t("projectDetail.integrations.repoUrl")}
            </span>
            <Input
              name="repoUrl"
              type="url"
              defaultValue={integration?.repoUrl ?? ""}
              placeholder={t("projectDetail.integrations.repoPlaceholder")}
            />
          </label>
          <div className="flex flex-col gap-2">
            <span className="select-none text-sm font-medium">
              {t("projectDetail.integrations.token")}
            </span>
            {showTokenField ? (
              <Input
                name="token"
                type="password"
                autoComplete="off"
                placeholder="•••••••••••••••••••"
              />
            ) : (
              <>
                <Input
                  name="token"
                  type="password"
                  autoComplete="off"
                  value="•••••••••••••••"
                  readOnly
                  aria-hidden="true"
                  tabIndex={-1}
                  className="pointer-events-none select-none"
                />
                <p className="text-sm font-medium text-emerald-700">
                  {t("projectDetail.integrations.tokenSet")}
                </p>
                <button
                  type="button"
                  onClick={() => setReplaceToken(true)}
                  className="self-start rounded-xl bg-surface px-3 py-1.5 text-xs shadow-xs font-semibold text-foreground hover:bg-muted"
                >
                  {t("projectDetail.integrations.replaceToken")}
                </button>
              </>
            )}
          </div>

          <fieldset className="flex flex-col gap-2  pt-4">
            <legend className="select-none px-1 text-sm font-semibold text-foreground">
              {t("projectDetail.integrations.sync")}
            </legend>
            {(
              [
                "syncIssues",
                "syncStatus",
                "syncComments",
                "syncPullRequests",
                "syncCommits",
              ] as const
            ).map((field) => (
              <label
                key={field}
                className="flex cursor-pointer select-none items-center gap-2.5 text-sm text-foreground"
              >
                <input
                  type="checkbox"
                  name={field}
                  value="on"
                  defaultChecked={
                    field === "syncIssues"
                      ? (integration?.syncIssues ?? true)
                      : field === "syncStatus"
                        ? (integration?.syncStatus ?? true)
                        : field === "syncComments"
                          ? (integration?.syncComments ?? true)
                          : field === "syncPullRequests"
                            ? (integration?.syncPullRequests ?? false)
                            : (integration?.syncCommits ?? false)
                  }
                  className="size-4 accent-orange-600"
                />
                {t(`projectDetail.integrations.${field}`)}
              </label>
            ))}
          </fieldset>

          <input name="syncDirection" type="hidden" value={syncDirection} />
          <input
            name="syncIntervalMinutes"
            type="hidden"
            value={syncIntervalMinutes}
          />
          <div className="flex flex-col gap-2 text-sm font-medium">
            <span className="select-none">
              {t("projectDetail.integrations.direction")}
            </span>
            <Select
              id="integration-direction"
              ariaLabel={t("projectDetail.integrations.direction")}
              value={syncDirection}
              onValueChange={setSyncDirection}
              className="w-full"
              options={[
                {
                  value: "bidirectional",
                  label: t("projectDetail.integrations.directionBidirectional"),
                },
                {
                  value: "push",
                  label: t("projectDetail.integrations.directionPush"),
                },
                {
                  value: "pull",
                  label: t("projectDetail.integrations.directionPull"),
                },
              ]}
            />
          </div>

          <div className="flex flex-col gap-2 text-sm font-medium">
            <span className="select-none">
              {t("projectDetail.integrations.interval")}
            </span>
            <Select
              id="integration-interval"
              ariaLabel={t("projectDetail.integrations.interval")}
              value={syncIntervalMinutes}
              onValueChange={setSyncIntervalMinutes}
              className="w-full"
              options={[
                {
                  value: "0",
                  label: t("projectDetail.integrations.intervalManual"),
                },
                {
                  value: "5",
                  label: t("projectDetail.integrations.intervalMinutes", {
                    count: 5,
                  }),
                },
                {
                  value: "15",
                  label: t("projectDetail.integrations.intervalMinutes", {
                    count: 15,
                  }),
                },
                {
                  value: "30",
                  label: t("projectDetail.integrations.intervalMinutes", {
                    count: 30,
                  }),
                },
                {
                  value: "60",
                  label: t("projectDetail.integrations.intervalMinutes", {
                    count: 60,
                  }),
                },
              ]}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={isSaving}>
              {isSaving
                ? t("projectDetail.integrations.saving")
                : t("projectDetail.integrations.save")}
            </Button>
          </div>
        </Form>
      </section>

      {integration ? (
        <section className="rounded-2xl bg-muted/40 p-6">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <span
              className={`size-2 rounded-full ${integration.isConnected ? "bg-emerald-500" : "bg-muted-foreground"}`}
              aria-hidden="true"
            />
            {integration.isConnected
              ? t("projectDetail.integrations.connected")
              : t("projectDetail.integrations.notConnected")}
          </p>
          <dl className="mt-3 flex flex-col gap-2 text-sm">
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
          <div className="mt-4 flex flex-wrap gap-2">
            <Form method="post">
              <input name="intent" type="hidden" value="test-integration" />
              <Button
                type="submit"
                variant="ghost"
                className="border"
                disabled={isTesting}
              >
                {isTesting
                  ? t("projectDetail.integrations.testing")
                  : t("projectDetail.integrations.test")}
              </Button>
            </Form>
            {integration.isConnected ? (
              <Form method="post">
                <input name="intent" type="hidden" value="sync-integration" />
                <Button type="submit" variant="ghost" className="border">
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
                type="submit"
                variant="ghost"
                className="border text-destructive hover:text-destructive"
              >
                {t("projectDetail.integrations.disconnect")}
              </Button>
            </Form>
          </div>
        </section>
      ) : null}
    </div>
  );
}
