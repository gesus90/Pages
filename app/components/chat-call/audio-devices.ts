/** A microphone or loudspeaker the browser lists. */
export interface AudioDevice {
  readonly id: string;
  /** Empty while the browser hides the names, before any permission. */
  readonly label: string;
}

/** What the browser lists, and the system default each kind carries a name for. */
export interface AudioDeviceList {
  readonly microphones: readonly AudioDevice[];
  readonly speakers: readonly AudioDevice[];
  /**
   * How many microphones the browser reports, also those it lists without an
   * ID before a permission; `0` means there is no microphone.
   */
  readonly microphoneCount: number;
  /** The name of the system default microphone, when the browser tells it. */
  readonly defaultMicrophoneLabel: string;
  /** The name of the system default loudspeaker, when the browser tells it. */
  readonly defaultSpeakerLabel: string;
}

/** Why the microphone could not be opened. */
export type MicrophoneFailure = "blocked" | "none" | "unavailable";

/** Raised when the microphone cannot be opened; `failure` tells the person why. */
export class MicrophoneError extends Error {
  public readonly failure: MicrophoneFailure;

  public constructor(failure: MicrophoneFailure) {
    super(`The microphone cannot be opened: ${failure}.`);
    this.name = "MicrophoneError";
    this.failure = failure;
  }
}

/** The pseudo devices some browsers list for "whatever the system uses". */
const VIRTUAL_DEVICE_IDS: ReadonlySet<string> = new Set([
  "default",
  "communications",
]);

/** The prefix browsers put before the name of the default device, such as "Default - ". */
const DEFAULT_LABEL_PREFIX = /^(?:default|standard(?:gerät)?)\s*[-–:]\s*/i;

/** What the browser lists before it was asked, or where it lists nothing. */
export const NO_AUDIO_DEVICES: AudioDeviceList = {
  microphones: [],
  speakers: [],
  microphoneCount: 0,
  defaultMicrophoneLabel: "",
  defaultSpeakerLabel: "",
};

/** Whether the browser may open a microphone here: it needs a secure page. */
export function canCaptureAudio(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

/**
 * Whether the browser can send a playback to a chosen output.
 * @remarks
 * Without it, every sound of the page, the test tone and the call, runs over
 * the output of the system.
 */
export function canSelectAudioOutput(): boolean {
  return (
    typeof HTMLMediaElement !== "undefined" &&
    "setSinkId" in HTMLMediaElement.prototype
  );
}

function ofKind(
  devices: readonly MediaDeviceInfo[],
  kind: MediaDeviceKind,
): readonly AudioDevice[] {
  return devices
    .filter(
      (device) =>
        device.kind === kind &&
        device.deviceId !== "" &&
        !VIRTUAL_DEVICE_IDS.has(device.deviceId),
    )
    .map((device) => ({ id: device.deviceId, label: device.label }));
}

function defaultLabel(
  devices: readonly MediaDeviceInfo[],
  kind: MediaDeviceKind,
): string {
  const entry = devices.find(
    (device) => device.kind === kind && device.deviceId === "default",
  );
  return entry ? entry.label.replace(DEFAULT_LABEL_PREFIX, "") : "";
}

/**
 * Lists the microphones and loudspeakers the browser knows.
 * @remarks
 * Listing asks for no permission and opens no device. Before a permission the
 * browser may hide the names, and some list no loudspeaker at all.
 */
export async function listAudioDevices(): Promise<AudioDeviceList> {
  if (
    typeof navigator === "undefined" ||
    typeof navigator.mediaDevices?.enumerateDevices !== "function"
  )
    return NO_AUDIO_DEVICES;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return {
      microphones: ofKind(devices, "audioinput"),
      speakers: ofKind(devices, "audiooutput"),
      microphoneCount: devices.filter((device) => device.kind === "audioinput")
        .length,
      defaultMicrophoneLabel: defaultLabel(devices, "audioinput"),
      defaultSpeakerLabel: defaultLabel(devices, "audiooutput"),
    };
  } catch (error: unknown) {
    console.warn("Pages could not list the audio devices.", error);
    return NO_AUDIO_DEVICES;
  }
}

/**
 * Tells which device an ID names in a list.
 * @param chosenId - The stored choice; `null` for the system default.
 * @param devices - What the browser lists now.
 * @returns The ID to use, `""` for the system default. An empty list cannot
 * tell, so the choice stays; a list without the device means it was removed.
 */
export function usableDeviceId(
  chosenId: string | null,
  devices: readonly AudioDevice[],
): string {
  if (chosenId === null) return "";
  if (devices.length === 0) return chosenId;
  return devices.some((device) => device.id === chosenId) ? chosenId : "";
}

function failureOf(error: unknown): MicrophoneFailure {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "blocked";
  if (name === "NotFoundError" || name === "DevicesNotFoundError")
    return "none";
  return "unavailable";
}

function microphoneConstraints(deviceId: string): MediaStreamConstraints {
  return {
    audio: {
      ...(deviceId === "" ? {} : { deviceId: { exact: deviceId } }),
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  };
}

/**
 * Opens the microphone, which is where the browser asks for permission.
 * @param deviceId - The chosen microphone, `""` for the system default. A
 * chosen device that is gone falls back to the system default.
 * @returns The stream with the audio track; its tracks must be stopped to release the device.
 * @throws {MicrophoneError} `blocked` when the permission is refused, `none`
 * without a microphone, `unavailable` when it cannot be opened.
 */
export async function openMicrophone(deviceId: string): Promise<MediaStream> {
  if (!canCaptureAudio()) throw new MicrophoneError("unavailable");
  try {
    return await navigator.mediaDevices.getUserMedia(
      microphoneConstraints(deviceId),
    );
  } catch (error: unknown) {
    const isGone =
      deviceId !== "" &&
      error instanceof DOMException &&
      error.name === "OverconstrainedError";
    if (isGone) return openMicrophone("");
    throw new MicrophoneError(failureOf(error));
  }
}

/**
 * Stops every track of a stream, which releases the device behind it.
 * @param stream - The stream to release; `null` does nothing.
 */
export function releaseStream(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

/**
 * Sends the playback of an element to a chosen output.
 * @param element - The audio element that plays.
 * @param deviceId - The chosen loudspeaker, `""` for the system output.
 * @returns `false` when the output could not be set and the element keeps
 * playing on the system output, for instance because the device is gone.
 */
export async function routeToOutput(
  element: HTMLMediaElement,
  deviceId: string,
): Promise<boolean> {
  if (!canSelectAudioOutput()) return deviceId === "";
  try {
    await element.setSinkId(deviceId);
    return true;
  } catch (error: unknown) {
    console.warn("Pages could not use the chosen audio output.", error);
    return false;
  }
}
