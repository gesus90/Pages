import { FolderKey } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { Button } from "@/app/components/ui/button";
import { SettingsCard } from "@/app/components/settings/settings-layout";

const grantSchema = z.object({
  permissionId: z.string(),
  folderRef: z.string(),
  folderName: z.string(),
  targetKind: z.enum(["role", "department", "group"]),
  targetId: z.string(),
});
const settingsSchema = z.object({
  ok: z.literal(true),
  result: z.object({
    grants: z.array(grantSchema),
    targets: z.array(
      z.object({
        kind: z.enum(["role", "department", "group"]),
        id: z.string(),
        name: z.string(),
      }),
    ),
  }),
});

type AccessSettings = z.infer<typeof settingsSchema>["result"];
const ENDPOINT = "/storage-api/access";

interface GrantEditor {
  readonly settings: AccessSettings | null;
  readonly path: string;
  readonly target: string;
  readonly isBusy: boolean;
  readonly hasError: boolean;
  readonly setPath: (path: string) => void;
  readonly setTarget: (target: string) => void;
  readonly submit: (event: React.FormEvent<HTMLFormElement>) => void;
  readonly save: (input: object) => Promise<void>;
}

function useStorageGrantEditor(): GrantEditor {
  const [settings, setSettings] = useState<AccessSettings | null>(null);
  const [path, setPath] = useState("");
  const [target, setTarget] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    async function load(): Promise<void> {
      try {
        const response = await fetch(ENDPOINT, { signal: controller.signal });
        const parsed = settingsSchema.safeParse(await response.json());
        if (!response.ok || !parsed.success) {
          setHasError(true);
          return;
        }
        setSettings(parsed.data.result);
      } catch {
        if (!controller.signal.aborted) setHasError(true);
      }
    }
    void load();
    return () => controller.abort();
  }, []);

  async function save(input: object): Promise<void> {
    setIsBusy(true);
    setHasError(false);
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        setHasError(true);
        return;
      }
      const current = await fetch(ENDPOINT);
      const parsed = settingsSchema.safeParse(await current.json());
      if (!current.ok || !parsed.success) {
        setHasError(true);
        return;
      }
      setSettings(parsed.data.result);
    } catch {
      setHasError(true);
    } finally {
      setIsBusy(false);
    }
  }

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const recipient = settings?.targets.find(
      (entry) => `${entry.kind}:${entry.id}` === target,
    );
    if (recipient)
      void save({
        path,
        targetKind: recipient.kind,
        targetId: recipient.id,
        enabled: true,
      });
  }

  return {
    settings,
    path,
    target,
    isBusy,
    hasError,
    setPath,
    setTarget,
    submit,
    save,
  };
}

function GrantForm({
  editor,
}: {
  readonly editor: GrantEditor;
}): React.ReactElement {
  const { t } = useTranslation();
  const { settings, path, target, isBusy, setPath, setTarget, submit } = editor;
  return (
    <form className="flex flex-col gap-3" onSubmit={submit}>
      <label className="text-sm">
        {t("storage.access.path")}
        <input
          className="mt-1 w-full rounded-md border border-input bg-background p-2"
          value={path}
          onChange={(event) => setPath(event.target.value)}
          required
        />
      </label>
      <label className="text-sm">
        {t("storage.access.recipient")}
        <select
          className="mt-1 w-full rounded-md border border-input bg-background p-2"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          required
        >
          <option value="">{t("storage.access.choose")}</option>
          {settings?.targets.map((entry) => (
            <option
              key={`${entry.kind}:${entry.id}`}
              value={`${entry.kind}:${entry.id}`}
            >
              {entry.name} · {t(`storage.access.${entry.kind}`)}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" size="sm" disabled={isBusy || !settings}>
        {t("storage.access.grant")}
      </Button>
    </form>
  );
}

function GrantRows({
  editor,
}: {
  readonly editor: GrantEditor;
}): React.ReactElement {
  const { t } = useTranslation();
  const { settings, isBusy, save } = editor;
  return (
    <ul className="mt-3 flex flex-col gap-2 text-sm">
      {settings?.grants.map((grant) => (
        <li
          className="flex items-center justify-between gap-2"
          key={`${grant.folderRef}:${grant.targetKind}:${grant.targetId}`}
        >
          <span>
            {grant.folderName} ·{" "}
            {settings.targets.find(
              (entry) =>
                entry.kind === grant.targetKind && entry.id === grant.targetId,
            )?.name ?? grant.targetId}
          </span>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={isBusy}
            onClick={() =>
              void save({
                folderRef: grant.folderRef,
                targetKind: grant.targetKind,
                targetId: grant.targetId,
                enabled: false,
              })
            }
          >
            {t("storage.access.revoke")}
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** Configures folder-scoped writing for roles, departments and groups. */
export function StorageAccessCard(): React.ReactElement {
  const { t } = useTranslation();
  const editor = useStorageGrantEditor();
  const { hasError } = editor;
  return (
    <SettingsCard
      icon={<FolderKey aria-hidden="true" className="size-4" />}
      title={t("storage.access.title")}
      description={t("storage.access.description")}
    >
      {hasError ? (
        <p role="alert" className="text-sm text-destructive">
          {t("storage.access.failed")}
        </p>
      ) : null}
      <GrantForm editor={editor} />
      <GrantRows editor={editor} />
    </SettingsCard>
  );
}
