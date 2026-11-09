import { readCurrentSessionUser } from "../PicaMobileSessionUser";

import type { AuthService } from "@/backend/auth/AuthService";
import type { SpeechRecognitionService } from "@/backend/service/speech/SpeechRecognitionService";
import type { PicaMobileSessionIdentity } from "../PicaMobileDashboardProvider";
import type {
  PicaMobileSpeechLimitsOutcome,
  PicaMobileSpeechOutcome,
  PicaMobileSpeechProvider,
  PicaMobileSpeechRecording,
} from "./PicaMobileSpeechProvider";

/** The Pages services the speech recognition of Pica Mobile is answered from. */
export interface PicaMobileSpeechServices {
  readonly authService: Pick<AuthService, "getAuthenticatedUser">;
  readonly speechRecognitionService: Pick<
    SpeechRecognitionService,
    "limits" | "transcribe"
  >;
}

/**
 * Answers `speech.v1` with the speech recognition of the instance (PAGE-273).
 *
 * @remarks
 * The account behind the session is read first. An account that may use
 * Pica is active and has no pending password change, as the chat demands;
 * {@link readCurrentSessionUser} ends the connection for every other one.
 */
export class PagesPicaMobileSpeech implements PicaMobileSpeechProvider {
  private readonly resolveServices: () => Promise<PicaMobileSpeechServices>;

  /**
   * Creates the provider.
   *
   * @param resolveServices - Resolves the Pages services when a request needs
   * them, so the listener works before the database does.
   */
  public constructor(resolveServices: () => Promise<PicaMobileSpeechServices>) {
    this.resolveServices = resolveServices;
  }

  /** Announces `speech.v1` only while speech recognition is set up. */
  public async isAvailable(
    session: PicaMobileSessionIdentity,
  ): Promise<boolean> {
    const outcome = await this.readLimits(session);
    return outcome.kind === "limits" && outcome.limits !== null;
  }

  /** Reads the limits for the account behind the session. */
  public async readLimits(
    session: PicaMobileSessionIdentity,
  ): Promise<PicaMobileSpeechLimitsOutcome> {
    const services = await this.resolveServices();
    const user = await readCurrentSessionUser(services.authService, session);
    if (user === null) return { kind: "sessionEnded" };
    return {
      kind: "limits",
      limits: await services.speechRecognitionService.limits(),
    };
  }

  /** Recognizes a recording for the account behind the session. */
  public async transcribe(
    session: PicaMobileSessionIdentity,
    recording: PicaMobileSpeechRecording,
  ): Promise<PicaMobileSpeechOutcome> {
    const services = await this.resolveServices();
    const user = await readCurrentSessionUser(services.authService, session);
    if (user === null) {
      recording.audio.fill(0);
      return { kind: "sessionEnded" };
    }
    return {
      kind: "result",
      outcome: await services.speechRecognitionService.transcribe(recording),
    };
  }
}
