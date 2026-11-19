import { MonitorSmartphone, Plug, Smartphone } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { useRegionFormatter } from "@/app/components/common/region-provider";
import {
  SettingsCard,
  SettingsSectionHeader,
} from "@/app/components/settings/settings-layout";
import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/app/components/ui/dialog";
import { Input } from "@/app/components/ui/input";
import { showSuccessToast } from "@/app/components/ui/toast";
import { useManagementPending } from "@/app/components/users/use-management-pending";

import { usePicaMobilePort } from "./use-pica-mobile-port";

import type { ConnectionsView } from "@/definition/Connections";
import type { McpDeviceView } from "@/definition/McpDevice";
import type { PicaMobileSettingsView } from "@/definition/PicaMobile";
import type { PicaMobilePortForm } from "./use-pica-mobile-port";

interface McpDeviceRevoke {
  readonly isPending: boolean;
  readonly hasFailed: boolean;
  readonly revoke: () => void;
}

function useMcpDeviceRevoke(deviceId: string): McpDeviceRevoke {
  const { t } = useTranslation();
  const fetcher = useFetcher<{
    mcpDevice?: { isRevoked: boolean };
    error?: string;
  }>();
  const isSending = useRef(false);

  useEffect(() => {
    if (fetcher.state !== "idle") {
      isSending.current = true;
      return;
    }

    if (!isSending.current) {
      return;
    }

    isSending.current = false;

    if (fetcher.data?.mcpDevice) {
      showSuccessToast(t("settings.connections.mcpDevices.revoked"));
    }
  }, [fetcher.state, fetcher.data, t]);

  function revoke(): void {
    const form = new FormData();

    form.set("intent", "revoke-mcp-device");
    form.set("deviceId", deviceId);
    void fetcher.submit(form, { method: "post" });
  }

  return {
    isPending: fetcher.state !== "idle",
    hasFailed: fetcher.state === "idle" && fetcher.data?.error !== undefined,
    revoke,
  };
}

function McpDeviceRevokeDialog({
  device,
}: {
  readonly device: McpDeviceView;
}): React.ReactElement {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const { isPending, hasFailed, revoke } = useMcpDeviceRevoke(device.id);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="destructive-soft">
          {t("settings.connections.mcpDevices.revoke")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">
          {t("settings.connections.mcpDevices.revokeTitle", {
            name: device.name,
          })}
        </DialogTitle>
        <DialogDescription className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {t("settings.connections.mcpDevices.revokeDescription")}
        </DialogDescription>
        {hasFailed ? (
          <p
            role="alert"
            className="pages-selectable mt-3 text-sm text-destructive"
          >
            {t("settings.connections.mcpDevices.error")}
          </p>
        ) : null}
        <footer className="mt-6 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost">
              {t("settings.connections.mcpDevices.cancel")}
            </Button>
          </DialogClose>
          <Button isPending={isPending} variant="destructive" onClick={revoke}>
            {t("settings.connections.mcpDevices.revoke")}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

function McpDevicesCard({
  devices,
}: {
  readonly devices: readonly McpDeviceView[];
}): React.ReactElement {
  const { t } = useTranslation();
  const { formatDateTime } = useRegionFormatter();

  return (
    <SettingsCard
      icon={<MonitorSmartphone className="size-4" />}
      title={t("settings.connections.mcpDevices.title")}
      description={t("settings.connections.mcpDevices.description")}
    >
      {devices.length === 0 ? (
        <p className="pages-selectable text-sm text-muted-foreground">
          {t("settings.connections.mcpDevices.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {devices.map((device) => (
            <li
              className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              key={device.id}
            >
              <div className="min-w-0">
                <p className="pages-selectable text-sm font-semibold break-words text-foreground">
                  {device.name}
                </p>
                <p className="pages-selectable mt-0.5 text-xs text-muted-foreground">
                  {t("settings.connections.mcpDevices.version", {
                    version: device.clientVersion,
                  })}
                  {" · "}
                  {t("settings.connections.mcpDevices.pairedAt", {
                    date: formatDateTime(device.pairedAt),
                  })}
                  {" · "}
                  {device.lastUsedAt === null
                    ? t("settings.connections.mcpDevices.neverUsed")
                    : t("settings.connections.mcpDevices.lastUsed", {
                        date: formatDateTime(device.lastUsedAt),
                      })}
                </p>
              </div>
              <McpDeviceRevokeDialog device={device} />
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
  );
}

function PicaMobilePortField({
  form,
}: {
  readonly form: PicaMobilePortForm;
}): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="sm:max-w-44 lg:max-w-none">
      <label
        htmlFor="pica-mobile-port"
        className="mb-1.5 block text-sm font-medium"
      >
        {t("settings.connections.picaMobile.port.label")}
      </label>
      <Input
        id="pica-mobile-port"
        name="port"
        inputMode="numeric"
        autoComplete="off"
        value={form.text}
        onChange={(event) => form.changeText(event.target.value)}
        disabled={form.pending}
        aria-invalid={form.error !== null}
        aria-describedby="pica-mobile-port-message"
        className="aria-invalid:ring-2 aria-invalid:ring-destructive"
      />
      <p
        id="pica-mobile-port-message"
        role="alert"
        className="pages-selectable mt-1.5 text-xs text-destructive empty:hidden"
      >
        {form.error === null
          ? null
          : t(`settings.connections.picaMobile.error.${form.error}`, {
              port: form.text.trim(),
            })}
      </p>
    </div>
  );
}

function PicaMobileAddressField({
  address,
  hasHost,
}: {
  readonly address: string;
  readonly hasHost: boolean;
}): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div>
      <label
        htmlFor="pica-mobile-address"
        className="mb-1.5 block text-sm font-medium"
      >
        {t("settings.connections.picaMobile.address.label")}
      </label>
      <Input
        id="pica-mobile-address"
        readOnly
        autoComplete="off"
        value={address}
        aria-describedby="pica-mobile-address-hint"
        className="pages-selectable bg-muted/50 font-mono shadow-none"
      />
      <p
        id="pica-mobile-address-hint"
        className="mt-1.5 text-xs text-muted-foreground"
      >
        {hasHost
          ? t("settings.connections.picaMobile.address.hint")
          : t("settings.connections.picaMobile.address.noHost")}
      </p>
    </div>
  );
}

function PicaMobileCard({
  settings,
}: {
  readonly settings: PicaMobileSettingsView;
}): React.ReactElement {
  const { t } = useTranslation();
  const form = usePicaMobilePort(settings);
  const inactiveError =
    settings.isListening || form.error !== null ? null : settings.listenError;

  return (
    <SettingsCard
      icon={<Smartphone className="size-4" />}
      title={t("settings.connections.picaMobile.title")}
      description={t("settings.connections.picaMobile.description")}
      wrapHeader
      action={
        <span className="inline-flex min-h-8 items-center rounded-lg border border-border bg-surface px-3 text-xs font-semibold text-muted-foreground shadow-xs">
          {t("settings.connections.picaMobile.adminOnly")}
        </span>
      }
    >
      <form
        onSubmit={form.submit}
        noValidate
        className="grid gap-x-6 gap-y-5 lg:grid-cols-[11rem_minmax(0,1fr)]"
      >
        <PicaMobilePortField form={form} />
        <PicaMobileAddressField
          address={form.address}
          hasHost={settings.host !== null}
        />
        {inactiveError ? (
          <p
            role="status"
            className="pages-selectable text-sm text-destructive lg:col-span-2"
          >
            {t("settings.connections.picaMobile.inactive")}{" "}
            {t(`settings.connections.picaMobile.error.${inactiveError}`, {
              port: settings.port,
            })}
          </p>
        ) : null}
        <div className="flex justify-end lg:col-span-2">
          <Button
            type="submit"
            isPending={form.pending}
            disabled={!form.canSave}
          >
            {t("settings.connections.picaMobile.save")}
          </Button>
        </div>
      </form>
    </SettingsCard>
  );
}

/** Composes the connections section using the established settings components. */
export function ConnectionsPanel({
  view,
}: {
  readonly view: ConnectionsView;
}): React.ReactElement {
  const { t } = useTranslation();
  const loading = useManagementPending();
  return (
    <div className="w-full max-w-6xl">
      <SettingsSectionHeader
        icon={<Plug className="size-4" aria-hidden="true" />}
        title={t("settings.connections.title")}
        description={t("settings.connections.description")}
      />
      {loading ? (
        <div
          aria-busy="true"
          aria-label={t("settings.connections.loading")}
          className="h-48 animate-pulse rounded-2xl bg-muted/40"
        />
      ) : (
        <div className="space-y-4">
          {view.picaMobile ? (
            <PicaMobileCard settings={view.picaMobile} />
          ) : null}
          <McpDevicesCard devices={view.mcpDevices ?? []} />
        </div>
      )}
    </div>
  );
}
