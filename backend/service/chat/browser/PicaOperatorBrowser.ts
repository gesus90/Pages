import { logCaughtError, logEvent } from "@/backend/logging/Logger";
import { redactCredentials } from "@/backend/security/AgentTextSafety";

import { PicaAdminError } from "../admin/PicaAdminContracts";
import { adminScope } from "../admin/PicaAdminFiles";
import { PICA_BROWSER_SCHEMAS } from "./PicaBrowserContracts";
import { PicaBrowserSession } from "./PicaBrowserSession";
import { applyAdministratorInput } from "./PicaBrowserTakeover";
import { browserFailureOutcome, browserOutcome } from "./PicaBrowserOutcome";
import {
  browserFailure,
  checkedAddress,
  navigate,
} from "./PicaBrowserNavigation";
import { captureLiveFrame, observePage } from "./PicaBrowserObservation";
import { runSessionTool } from "./PicaBrowserSessionTools";

import type { Browser } from "playwright-core";
import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type {
  PicaBrowserCommand,
  PicaBrowserOverview,
  PicaBrowserView,
} from "@/definition/PicaBrowser";
import type { PicaToolOutcome } from "../PicaToolSchemas";
import type { PicaBrowserTool } from "./PicaBrowserContracts";
import type { PicaBrowserFrame } from "./PicaBrowserSession";
import type { PicaBrowserSessionStore } from "./PicaBrowserSessionStore";
import type { PicaBrowserOrigins } from "./PicaBrowserTargets";
import type { z } from "zod";

type OpenInput = z.infer<typeof PICA_BROWSER_SCHEMAS.browser_open>;

const MAXIMUM_BROWSERS = 4;
const MAXIMUM_BROWSERS_PER_PERSON = 2;
const IDLE_CLOSE_MS = 15 * 60_000;
const STOPPED_KEEP_MS = 5 * 60_000;
const MAXIMUM_AGE_MS = 2 * 60 * 60_000;
const REAP_INTERVAL_MS = 30_000;
const FRAME_REFRESH_MS = 700;

/** What the operator browser needs from Pages. */
export interface PicaOperatorBrowserDependencies {
  /** Starts the isolated Chromium; production uses the mandatory namespace sandbox, no fallback. */
  readonly launch: () => Promise<Browser>;
  /** The local origins browsers may reach, read on every request. */
  readonly origins: () => PicaBrowserOrigins;
  /** Saved sessions; without a store, signed-in sessions cannot be kept. */
  readonly store: PicaBrowserSessionStore | null;
  /** Own-account state of an agent; this path admits only the self profile. */
  readonly ownerName?: (context: RuntimeExecutionContext) => string;
  readonly selfState?: (
    context: RuntimeExecutionContext,
  ) => Awaited<ReturnType<PicaBrowserSession["storage"]>>;
  /** Reads a text file of the person's handover folder, for uploads. */
  readonly readFile: (
    context: RuntimeExecutionContext,
    relative: string,
  ) => Promise<{ readonly content: string }>;
}

/**
 * Starts, serves and ends the operator browsers of Pica (PAGE-181).
 *
 * @remarks
 * This is a separate path from the restricted admin browser. Every browser is
 * an isolated Chromium process that belongs to one account and one job.
 * Calls arrive through the privileged tool path, which resolved the
 * administrator right just before; the live methods are called by routes that
 * did the same for the person. A browser closes with its job, after 15 idle
 * minutes, after two hours, or when the administrator stops it.
 */
export class PicaOperatorBrowser {
  private readonly dependencies: PicaOperatorBrowserDependencies;
  private readonly sessions = new Map<string, PicaBrowserSession>();
  private readonly stoppedScopes = new Set<string>();
  private readonly startedAt = new Map<string, number>();

  /**
   * Creates the manager.
   *
   * @param dependencies - Launcher, origins, store and file access.
   */
  public constructor(dependencies: PicaOperatorBrowserDependencies) {
    this.dependencies = dependencies;
    setInterval(() => {
      void this.reap();
    }, REAP_INTERVAL_MS).unref();
  }

  /**
   * Runs one operator browser tool of the model.
   *
   * @param tool - The tool name.
   * @param input - The untrusted arguments.
   * @param context - The reauthorized scope of the job.
   * @returns The outcome with the screenshot as image data.
   */
  public async run(
    tool: PicaBrowserTool,
    input: unknown,
    context: RuntimeExecutionContext,
  ): Promise<PicaToolOutcome> {
    try {
      if (tool === "browser_open")
        return await this.open(
          PICA_BROWSER_SCHEMAS.browser_open.parse(input),
          context,
        );
      if (tool === "browser_profiles") return await this.profiles(context);
      return await runSessionTool(
        { tool, input, context },
        {
          find: (browserId) => this.require(context, browserId),
          forget: (session) => {
            this.startedAt.delete(session.id);
            this.sessions.delete(session.id);
          },
          readFile: this.dependencies.readFile,
        },
      );
    } catch (error: unknown) {
      if (context.signal.aborted) throw error;
      if (error instanceof PicaAdminError)
        return browserFailureOutcome(error.message);
      throw error;
    }
  }

  /** Ends every browser of a job; called when the job, the right or the server ends. */
  public async closeScope(context: RuntimeExecutionContext): Promise<void> {
    const scope = adminScope(context);
    this.stoppedScopes.delete(scope);
    for (const [id, session] of this.sessions) {
      if (session.scope !== scope) continue;
      this.sessions.delete(id);
      this.startedAt.delete(id);
      await session.close();
    }
  }

  /** The browsers of a person, for the live view of the chat. */
  public async overview(userId: string | null): Promise<PicaBrowserOverview> {
    const owned = [...this.sessions.values()].filter(
      (session) => userId === null || session.userId === userId,
    );
    await Promise.all(owned.map((session) => session.refreshTitles()));
    const saved = userId
      ? ((await this.dependencies.store?.list(userId)) ?? [])
      : [];
    return {
      browsers: owned.map((session) => session.view()),
      savedSessions: saved.map((entry) => ({
        name: entry.name,
        origins: [...entry.origins],
        savedAt: entry.savedAt,
      })),
    };
  }

  /**
   * The newest picture of a browser, refreshed when it is older than a moment.
   *
   * @param userId - The person asking; foreign browsers answer as missing.
   * @param browserId - The browser.
   * @returns The picture, or `null` when none exists yet.
   */
  public async frame(
    userId: string | null,
    browserId: string,
  ): Promise<PicaBrowserFrame | null> {
    const session = this.owned(userId, browserId);
    const current = session.currentFrame();
    const isStale =
      !current || Date.now() - current.capturedAt > FRAME_REFRESH_MS;
    if (
      isStale &&
      session.currentState !== "stopped" &&
      session.beginCapture()
    ) {
      try {
        const bytes = await captureLiveFrame(session);
        if (bytes) session.storeFrame(bytes);
      } finally {
        session.endCapture();
      }
    }
    return session.currentFrame();
  }

  /**
   * Applies a control of the administrator: pause, stop, takeover, input and the rest.
   *
   * @param userId - The administrator.
   * @param browserId - The browser.
   * @param command - The validated control.
   * @returns The browser as it looks afterwards.
   */
  public async command(
    userId: string | null,
    browserId: string,
    command: PicaBrowserCommand,
    administratorId?: string,
  ): Promise<PicaBrowserView> {
    const session = this.owned(userId, browserId);
    session.touch();
    this.audit(
      administratorId ?? userId ?? session.userId,
      session,
      command.command,
    );
    switch (command.command) {
      case "pause":
        session.pause();
        break;
      case "resume":
        session.resume();
        break;
      case "takeover":
        session.takeOver();
        break;
      case "handback":
        session.handBack();
        break;
      case "stop":
        this.stoppedScopes.add(session.scope);
        await session.stop();
        break;
      case "approveLocalWrites":
        session.areLocalWritesApproved = command.approved;
        session.record(
          "admin",
          command.approved
            ? "Approved changes to local services"
            : "Withdrew the approval of changes to local services",
          "completed",
        );
        break;
      case "saveSession":
        await this.saveSession(session.userId, session, command.name);
        break;
      case "deleteSession":
        await this.dependencies.store?.remove(session.userId, command.name);
        break;
      case "input":
        await applyAdministratorInput(session, command.input);
        break;
    }
    await session.refreshTitles();
    return session.view();
  }

  /**
   * One file the page downloaded, for the administrator.
   *
   * @param userId - The administrator.
   * @param browserId - The browser.
   * @param downloadId - The download.
   * @returns The file name, type and bytes.
   * @throws {PicaAdminError} `DOWNLOAD_NOT_FOUND`.
   */
  public download(
    userId: string | null,
    browserId: string,
    downloadId: string,
  ): {
    readonly fileName: string;
    readonly contentType: string;
    readonly bytes: Buffer;
  } {
    const file = this.owned(userId, browserId)
      .storedDownloads()
      .find((entry) => entry.id === downloadId);
    if (!file) throw new PicaAdminError("DOWNLOAD_NOT_FOUND");
    return {
      fileName: file.fileName,
      contentType: file.contentType,
      bytes: file.bytes,
    };
  }

  /** Returns the job scope of a managed browser, without exposing session state. */
  public scopeOf(browserId: string): string | null {
    return this.sessions.get(browserId)?.scope ?? null;
  }

  /** Lists the saved sessions the model may use. */
  private async profiles(
    context: RuntimeExecutionContext,
  ): Promise<PicaToolOutcome> {
    const saved = this.dependencies.selfState
      ? [{ name: "self", origins: this.dependencies.origins().pages }]
      : ((await this.dependencies.store?.list(context.userId)) ?? []);
    return {
      ok: true,
      result: redactCredentials(
        JSON.stringify({
          sessions: saved.map((entry) => ({
            name: entry.name,
            sites: entry.origins,
          })),
          hint: "Pass a name as profile to browser_open to start signed in. Only the administrator can add sessions.",
        }),
      ),
      error: null,
    };
  }

  private async open(
    input: OpenInput,
    context: RuntimeExecutionContext,
  ): Promise<PicaToolOutcome> {
    const scope = adminScope(context);
    if (this.stoppedScopes.has(scope))
      return browserFailureOutcome("STOPPED_BY_ADMIN");
    const live = [...this.sessions.values()].filter(
      (session) => session.currentState !== "stopped",
    );
    if (
      live.length >= MAXIMUM_BROWSERS ||
      live.filter((session) => session.userId === context.userId).length >=
        MAXIMUM_BROWSERS_PER_PERSON
    )
      return browserFailureOutcome("RESOURCE_LIMIT");
    const origins = this.dependencies.origins();
    const address = input.url ? await checkedAddress(origins, input.url) : null;
    const storage = await this.initialStorage(context, input.profile);
    const session = new PicaBrowserSession({
      userId: context.userId,
      scope,
      conversationId: context.sessionId,
      task: input.task,
      profile: this.dependencies.selfState ? "self" : (input.profile ?? null),
      isAgent: this.dependencies.selfState !== undefined,
      ownerName: this.dependencies.ownerName?.(context),
      device: input.device ?? "desktop",
      browser: await this.dependencies.launch(),
      origins: this.dependencies.origins,
      authorize: context.authorize,
      signal: context.signal,
    });
    try {
      await session.start(storage);
      this.sessions.set(session.id, session);
      this.startedAt.set(session.id, Date.now());
      session.record(
        "pica",
        `Opened a browser for: ${input.task}`,
        "completed",
      );
      if (address)
        session.record(
          "pica",
          await navigate(session, {
            browserId: session.id,
            action: "goto",
            url: address,
          }),
          "completed",
        );
      return browserOutcome(await observePage(session, { detail: "brief" }));
    } catch (error: unknown) {
      this.sessions.delete(session.id);
      const failure = browserFailure(session, error);
      await session.close();
      return browserFailureOutcome(failure.message);
    }
  }

  private async initialStorage(
    context: RuntimeExecutionContext,
    profile: string | undefined,
  ): Promise<Awaited<ReturnType<PicaBrowserSession["storage"]>> | undefined> {
    if (this.dependencies.selfState) {
      if (profile && profile !== "self")
        throw new PicaAdminError("SESSION_DENIED");
      return this.dependencies.selfState(context);
    }
    return profile ? this.savedState(context.userId, profile) : undefined;
  }

  private async savedState(
    userId: string,
    name: string,
  ): Promise<Awaited<ReturnType<PicaBrowserSession["storage"]>>> {
    const store = this.dependencies.store;
    if (!store) throw new PicaAdminError("SESSIONS_UNAVAILABLE");
    return store.read(userId, name);
  }

  private async saveSession(
    userId: string,
    session: PicaBrowserSession,
    name: string,
  ): Promise<void> {
    const store = this.dependencies.store;
    if (!store) throw new PicaAdminError("SESSIONS_UNAVAILABLE");
    await store.save(userId, name, await session.storage());
    session.record("admin", `Saved the session as "${name}"`, "completed");
  }

  private require(
    context: RuntimeExecutionContext,
    browserId: string,
  ): PicaBrowserSession {
    const session = this.sessions.get(browserId);
    if (!session || session.scope !== adminScope(context))
      throw new PicaAdminError("SESSION_DENIED");
    return session;
  }

  private owned(userId: string | null, browserId: string): PicaBrowserSession {
    const session = this.sessions.get(browserId);
    if (!session || (userId !== null && session.userId !== userId))
      throw new PicaAdminError("SESSION_DENIED");
    return session;
  }

  private async reap(): Promise<void> {
    for (const [id, session] of this.sessions) {
      const isStopped = session.currentState === "stopped";
      const age = Date.now() - (this.startedAt.get(id) ?? Date.now());
      const isExpired = isStopped
        ? session.idleFor() > STOPPED_KEEP_MS
        : session.idleFor() > IDLE_CLOSE_MS || age > MAXIMUM_AGE_MS;
      if (!isExpired) continue;
      this.sessions.delete(id);
      this.startedAt.delete(id);
      try {
        await session.close();
      } catch (error: unknown) {
        logCaughtError("PicaOperatorBrowser", error);
      }
    }
  }

  private audit(
    userId: string,
    session: PicaBrowserSession,
    command: string,
  ): void {
    logEvent({
      level: "info",
      event: "pica.browser.control",
      component: "PicaOperatorBrowser",
      message: "Administrator controlled a Pica browser",
      metadata: {
        userId,
        sessionId: session.conversationId,
        runId: session.id,
        operation: command,
        status: "executed",
      },
    });
  }
}
