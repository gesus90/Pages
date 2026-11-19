import { Info, Mic, TriangleAlert, Volume2, X } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { Select } from "@/app/components/ui/select";
import { cn } from "@/app/lib/cn";

import { canSelectAudioOutput, usableDeviceId } from "./audio-devices";
import {
  useAudioPreferences,
  writeAudioPreferences,
} from "./audio-preferences";
import { useAudioDevices } from "./use-audio-devices";
import { useMicrophoneTest } from "./use-microphone-test";
import { useOutputTest } from "./use-output-test";

import type { TFunction } from "i18next";
import type { AudioDevice, AudioDeviceList } from "./audio-devices";
import type { ChosenAudioDevice } from "./audio-preferences";
import type { AudioDevices } from "./use-audio-devices";
import type { MicrophoneTest } from "./use-microphone-test";
import type { OutputTest } from "./use-output-test";

interface AudioSettingsDialogProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
}

const FOCUS_RING =
  "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none";

const DIALOG_BUTTON = cn(
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-3.5 text-[13px] font-semibold text-foreground hover:bg-muted disabled:pointer-events-none disabled:opacity-45",
  FOCUS_RING,
);

const SELECT_FIELD =
  "h-10 w-full rounded-xl bg-background px-3 text-[13px] shadow-none ring-1 ring-border disabled:opacity-55";

/** The name a device shows with: its own, or a numbered one while the browser hides names. */
function deviceName(
  t: TFunction,
  kind: "microphone" | "speaker",
  device: AudioDevice,
  index: number,
): string {
  return device.label === ""
    ? t(`chatCall.audio.${kind}.numbered`, { number: index + 1 })
    : device.label;
}

function defaultName(t: TFunction, label: string): string {
  return label === ""
    ? t("chatCall.audio.defaultDevice")
    : t("chatCall.audio.defaultDeviceNamed", { name: label });
}

function chosen(
  t: TFunction,
  kind: "microphone" | "speaker",
  devices: readonly AudioDevice[],
  id: string,
): ChosenAudioDevice | null {
  const index = devices.findIndex((device) => device.id === id);
  const device = devices[index];
  if (device === undefined) return null;
  return { id, label: deviceName(t, kind, device, index) };
}

function Notice({
  tone,
  children,
}: {
  readonly tone: "warning" | "muted";
  readonly children: React.ReactNode;
}): React.ReactElement {
  const Icon = tone === "warning" ? TriangleAlert : Info;
  return (
    <p
      className={cn(
        "mt-2.5 flex items-start gap-2.5 rounded-xl px-3 py-2.5 text-[13px] leading-[18px] text-foreground",
        tone === "warning" ? "bg-warning/14" : "bg-muted",
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          "mt-px size-4 shrink-0",
          tone === "warning" ? "text-warning" : "text-muted-foreground",
        )}
      />
      <span>{children}</span>
    </p>
  );
}

function SectionTitle({
  id,
  icon: Icon,
  children,
}: {
  readonly id: string;
  readonly icon: typeof Mic;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <label
      htmlFor={id}
      className="mb-2 flex items-center gap-2 text-[13px] font-semibold"
    >
      <Icon aria-hidden="true" className="size-3.5 text-muted-foreground" />
      {children}
    </label>
  );
}

function LevelBar({
  level,
  label,
}: {
  readonly level: number;
  readonly label: string;
}): React.ReactElement {
  const percent = Math.round(level * 100);
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="h-2 min-w-0 flex-1 overflow-hidden rounded bg-muted"
    >
      <div
        className="h-full rounded bg-success"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

function meterHint(test: MicrophoneTest, t: TFunction): string {
  if (test.status === "starting") return t("chatCall.audio.microphone.opening");
  if (test.status !== "running") return t("chatCall.audio.microphone.idle");
  return test.hasHeard
    ? t("chatCall.audio.microphone.heard")
    : t("chatCall.audio.microphone.waiting");
}

function MicrophoneMeter({
  test,
}: {
  readonly test: MicrophoneTest;
}): React.ReactElement {
  const { t } = useTranslation();
  const isRunning = test.status === "running";
  return (
    <>
      <div className="mt-2.5 flex items-center gap-3">
        <LevelBar
          level={isRunning ? test.level : 0}
          label={t("chatCall.audio.microphone.level")}
        />
        <span
          className={cn(
            "shrink-0 text-xs",
            isRunning && test.hasHeard
              ? "text-success"
              : "text-muted-foreground",
          )}
        >
          {meterHint(test, t)}
        </span>
        <button
          type="button"
          className={DIALOG_BUTTON}
          disabled={test.status === "starting"}
          onClick={isRunning ? test.stop : test.start}
        >
          <Mic aria-hidden="true" className="size-4" />
          {t(
            isRunning
              ? "chatCall.audio.microphone.stop"
              : "chatCall.audio.microphone.start",
          )}
        </button>
      </div>
      {isRunning ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("chatCall.audio.microphone.speak")}
        </p>
      ) : null}
    </>
  );
}

function MicrophoneProblem({
  problem,
  test,
}: {
  readonly problem: MicrophoneProblemKind;
  readonly test: MicrophoneTest;
}): React.ReactElement {
  const { t } = useTranslation();
  const isMissing = problem === "none";
  return (
    <>
      <Notice tone={isMissing ? "muted" : "warning"}>
        {t(`chatCall.audio.microphone.${problem}`)}
      </Notice>
      <div className="mt-2.5 flex justify-end">
        <button
          type="button"
          className={DIALOG_BUTTON}
          disabled={isMissing}
          onClick={test.start}
        >
          {t(
            problem === "lost"
              ? "chatCall.audio.microphone.start"
              : "chatCall.audio.microphone.retry",
          )}
        </button>
      </div>
    </>
  );
}

interface DeviceOption {
  readonly value: string;
  readonly label: string;
}

/**
 * Keeps the stored choice selectable while the browser hides the devices
 * before a permission, so the field never shows an empty value.
 */
function withStoredChoice(
  options: readonly DeviceOption[],
  stored: ChosenAudioDevice | null,
  value: string,
): readonly DeviceOption[] {
  if (stored === null || value === "") return options;
  if (options.some((option) => option.value === value)) return options;
  return [...options, { value, label: stored.label }];
}

type MicrophoneProblemKind = "blocked" | "none" | "lost" | "unavailable";

/** What keeps the microphone from being tested, or `null` while the meter shows. */
function microphoneProblem(
  devices: AudioDevices,
  test: MicrophoneTest,
): MicrophoneProblemKind | null {
  if (test.status === "idle")
    return devices.isLoaded && devices.list.microphoneCount === 0
      ? "none"
      : null;
  if (test.status === "starting" || test.status === "running") return null;
  return test.status;
}

function MicrophoneSection({
  devices,
  value,
  test,
  onChange,
}: {
  readonly devices: AudioDevices;
  /** The chosen microphone that is still listed, `""` for the system default. */
  readonly value: string;
  readonly test: MicrophoneTest;
  readonly onChange: (id: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const fieldId = useId();
  const { list } = devices;
  const problem = microphoneProblem(devices, test);
  const stored = useAudioPreferences().microphone;
  const options = [
    { value: "", label: defaultName(t, list.defaultMicrophoneLabel) },
    ...list.microphones.map((device, index) => ({
      value: device.id,
      label: deviceName(t, "microphone", device, index),
    })),
  ];
  return (
    <section>
      <SectionTitle id={fieldId} icon={Mic}>
        {t("chatCall.audio.microphone.title")}
      </SectionTitle>
      <Select
        id={fieldId}
        value={problem === "none" ? "" : value}
        onValueChange={onChange}
        options={
          problem === "none"
            ? [{ value: "", label: t("chatCall.audio.noDevice") }]
            : withStoredChoice(options, stored, value)
        }
        disabled={problem === "none"}
        className={SELECT_FIELD}
      />
      {problem === null ? (
        <MicrophoneMeter test={test} />
      ) : (
        <MicrophoneProblem problem={problem} test={test} />
      )}
    </section>
  );
}

function SpeakerSection({
  list,
  value,
  test,
  onChange,
}: {
  readonly list: AudioDeviceList;
  /** The chosen loudspeaker that is still listed, `""` for the system output. */
  readonly value: string;
  readonly test: OutputTest;
  readonly onChange: (id: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const fieldId = useId();
  const isSelectable = canSelectAudioOutput();
  const stored = useAudioPreferences().speaker;
  const options = isSelectable
    ? withStoredChoice(
        [
          { value: "", label: defaultName(t, list.defaultSpeakerLabel) },
          ...list.speakers.map((device, index) => ({
            value: device.id,
            label: deviceName(t, "speaker", device, index),
          })),
        ],
        stored,
        value,
      )
    : [{ value: "", label: t("chatCall.audio.systemOutput") }];
  const hint = test.isPlaying
    ? t("chatCall.audio.speaker.playing")
    : t("chatCall.audio.speaker.idle");
  return (
    <section>
      <SectionTitle id={fieldId} icon={Volume2}>
        {t("chatCall.audio.speaker.title")}
      </SectionTitle>
      <Select
        id={fieldId}
        value={isSelectable ? value : ""}
        onValueChange={onChange}
        options={options}
        disabled={!isSelectable}
        className={SELECT_FIELD}
      />
      {isSelectable ? null : (
        <Notice tone="muted">{t("chatCall.audio.speaker.unselectable")}</Notice>
      )}
      {isSelectable && list.speakers.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("chatCall.audio.speaker.afterTest")}
        </p>
      ) : null}
      {test.usedSystemOutput ? (
        <Notice tone="warning">{t("chatCall.audio.speaker.fallback")}</Notice>
      ) : null}
      <ToneRow hint={isSelectable ? hint : null} test={test} />
    </section>
  );
}

function ToneRow({
  hint,
  test,
}: {
  readonly hint: string | null;
  readonly test: OutputTest;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "mt-2.5 flex items-center gap-3",
        hint === null ? "justify-end" : "justify-between",
      )}
    >
      {hint === null ? null : (
        <span className="text-xs text-muted-foreground">{hint}</span>
      )}
      <button
        type="button"
        className={DIALOG_BUTTON}
        disabled={test.isPlaying}
        onClick={test.play}
      >
        {test.isPlaying ? (
          <ToneBars />
        ) : (
          <Volume2 aria-hidden="true" className="size-4" />
        )}
        {t(
          test.isPlaying
            ? "chatCall.audio.speaker.isPlaying"
            : "chatCall.audio.speaker.play",
        )}
      </button>
    </div>
  );
}

/** Four bars that rise and fall while the test tone plays; they stand still for reduced motion. */
function ToneBars(): React.ReactElement {
  return (
    <span aria-hidden="true" className="flex h-4 items-end gap-0.5">
      {[0.55, 1, 0.7, 0.85].map((height, index) => (
        <span
          key={height}
          className="w-[3px] animate-pulse rounded-full bg-primary motion-reduce:animate-none"
          style={{
            height: `${height * 100}%`,
            animationDelay: `${index * 120}ms`,
          }}
        />
      ))}
    </span>
  );
}

function AudioSettingsBody(): React.ReactElement {
  const { t } = useTranslation();
  const devices = useAudioDevices();
  const preferences = useAudioPreferences();
  const { list } = devices;
  const microphoneId = usableDeviceId(
    preferences.microphone?.id ?? null,
    list.microphones,
  );
  const speakerId = usableDeviceId(
    preferences.speaker?.id ?? null,
    list.speakers,
  );
  const microphoneTest = useMicrophoneTest(microphoneId, devices.refresh);
  const outputTest = useOutputTest(speakerId);

  function chooseMicrophone(id: string): void {
    microphoneTest.stop();
    writeAudioPreferences({
      microphone: chosen(t, "microphone", list.microphones, id),
    });
  }

  function chooseSpeaker(id: string): void {
    writeAudioPreferences({
      speaker: chosen(t, "speaker", list.speakers, id),
    });
  }

  return (
    <>
      <div className="mt-5 flex flex-col gap-5">
        <MicrophoneSection
          devices={devices}
          value={microphoneId}
          test={microphoneTest}
          onChange={chooseMicrophone}
        />
        <SpeakerSection
          list={list}
          value={speakerId}
          test={outputTest}
          onChange={chooseSpeaker}
        />
      </div>
      <div className="mt-[22px] flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {t("chatCall.audio.footer")}
        </p>
        <DialogClose className={DIALOG_BUTTON}>
          {t("chatCall.audio.close")}
        </DialogClose>
      </div>
    </>
  );
}

/**
 * The dialog "Audio-Einstellungen": microphone and loudspeaker for the calls
 * of this browser, with a level test and a test tone.
 * @remarks
 * Opening it asks for no permission; only "Mikrofon testen" opens the
 * microphone. "Test beenden" and closing the dialog release the microphone
 * and stop the tone, while a running call goes on. The choice is kept in
 * this browser and applies from the next call.
 */
export function AudioSettingsDialog({
  isOpen,
  onOpenChange,
}: AudioSettingsDialogProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(520px,92vw)] rounded-[20px] ring-1 ring-border">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <DialogTitle className="text-lg leading-6 font-bold">
              {t("chatCall.audio.title")}
            </DialogTitle>
            <DialogDescription className="mt-1 text-[13px] leading-[18px] text-muted-foreground">
              {t("chatCall.audio.description")}
            </DialogDescription>
          </div>
          <DialogClose
            aria-label={t("chatCall.audio.closeDialog")}
            className={cn(
              "inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground",
              FOCUS_RING,
            )}
          >
            <X aria-hidden="true" className="size-4" />
          </DialogClose>
        </div>
        <AudioSettingsBody />
      </DialogContent>
    </Dialog>
  );
}
