import { randomBytes, randomUUID } from "node:crypto";

import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { logCaughtError } from "@/backend/logging/Logger";
import { redactCredentials } from "@/backend/security/AgentTextSafety";

import { PicaAdminError } from "../admin/PicaAdminContracts";
import {
  PICA_BROWSER_NETWORK_LIMITS,
  PicaBrowserProxy,
} from "./PicaBrowserProxy";
import { PicaBrowserTransport } from "./PicaBrowserTransport";

import type { Browser, BrowserContext, Dialog, Page } from "playwright-core";
import type {
  PicaBrowserAction,
  PicaBrowserDevice,
  PicaBrowserDownload,
  PicaBrowserState,
  PicaBrowserTab,
  PicaBrowserView,
} from "@/definition/PicaBrowser";
import type { PicaBrowserCapturedFile } from "./PicaBrowserProxy";
import type { PicaBrowserOrigins } from "./PicaBrowserTargets";

/** The cookies and local storage of one browser, as Playwright keeps them. */
export type PicaBrowserStorageState = Awaited<
  ReturnType<BrowserContext["storageState"]>
>;

/** Viewport of each device preset, in CSS pixels. */
export const PICA_BROWSER_PRESETS: Readonly<
  Record<PicaBrowserDevice, { readonly width: number; readonly height: number }>
> = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
};

const USER_AGENTS: Readonly<Record<PicaBrowserDevice, string>> = {
  desktop:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
  mobile:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36",
};

/** How long a call waits for the administrator to resume or hand back before it reports the state. */
const GATE_WAIT_MS = 20_000;
const MAXIMUM_TABS = 8;
const MAXIMUM_ACTIONS = 60;
const MAXIMUM_NOTES = 12;
const MAXIMUM_DOWNLOADS = 20;
const MAXIMUM_DOWNLOAD_BYTES = 25 * 1024 * 1024;
const MAXIMUM_DOWNLOAD_TOTAL_BYTES = 100 * 1024 * 1024;
const TITLE_TIMEOUT_MS = 500;

/** What a session is created from; every fact is server-owned. */
export interface PicaBrowserSessionInit {
  readonly userId: string;
  readonly scope: string;
  readonly conversationId: string;
  readonly task: string;
  readonly profile: string | null;
  readonly device: PicaBrowserDevice;
  readonly browser: Browser;
  /** Marks the own-account agent path, which refuses downloads and keeps administrator handover separate. */
  readonly isAgent?: boolean;
  readonly ownerName?: string | undefined;
  readonly origins: () => PicaBrowserOrigins;
  /** Rechecks the owning account and the job; throws when either ended. */
  readonly authorize: () => Promise<void>;
  /** The signal of the job; its end closes the browser. */
  readonly signal: AbortSignal;
}

/** The last picture of the page, kept for the live view. */
export interface PicaBrowserFrame {
  readonly bytes: Buffer;
  readonly version: number;
  readonly capturedAt: number;
}

/** A file kept on the server because the page asked the browser to download it. */
export interface PicaBrowserStoredDownload extends PicaBrowserDownload {
  readonly bytes: Buffer;
}

function shorten(text: string, length: number): string {
  const single = redactCredentials(text).replace(/\s+/gu, " ").trim();
  return single.length > length ? `${single.slice(0, length - 1)}…` : single;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * One operator browser: an isolated Chromium, its tabs and the control state.
 *
 * @remarks
 * The session belongs to one account and one job. It knows who controls
 * the browser (`running`, `paused`, `takeover`, `stopped`), keeps the action
 * log and the last picture for the live view, and holds files the page
 * downloaded. Nothing in it is ever sent to a model except what the
 * observation code selects.
 */
export class PicaBrowserSession {
  public readonly id = randomUUID();
  public readonly userId: string;
  public readonly scope: string;
  public readonly conversationId: string;
  public readonly task: string;
  public readonly profile: string | null;
  /** The key under which the page registry of element references hides in the page. */
  public readonly referenceKey = `__pica_${randomBytes(9).toString("hex")}`;
  /** Pages whose text fields an administrator typed into; their values stay out of every model view. */
  public readonly sensitivePages = new WeakSet<Page>();
  /** Runs one call at a time: model actions and administrator input never interleave. */
  public readonly queue = new SerialQueue();
  /** Keeps two screenshots of one page from overlapping, since masks change the page while they are taken. */
  public readonly shots = new SerialQueue();
  /** The name of each element of the last observation, for readable action entries. */
  public readonly elementNames = new Map<string, string>();
  public areLocalWritesApproved = false;
  public handoverReason: string | null = null;
  /** The answer to give a dialog the current action may open. */
  public dialogAnswer: "accept" | "dismiss" | null = null;
  private readonly init: PicaBrowserSessionInit;
  private readonly transport = new PicaBrowserTransport({
    responseBytes: PICA_BROWSER_NETWORK_LIMITS.responseBytes,
    requestMilliseconds: PICA_BROWSER_NETWORK_LIMITS.requestMilliseconds,
  });
  private readonly abort = new AbortController();
  private readonly lifetime: AbortSignal;
  private readonly tabs: Page[] = [];
  private readonly titles = new WeakMap<Page, string>();
  private readonly actions: PicaBrowserAction[] = [];
  private readonly notes: string[] = [];
  private readonly downloads: PicaBrowserStoredDownload[] = [];
  private context: BrowserContext | null = null;
  private proxy: PicaBrowserProxy | null = null;
  private active = 0;
  private state: PicaBrowserState = "running";
  private device: PicaBrowserDevice;
  private width: number;
  private height: number;
  private frame: PicaBrowserFrame | null = null;
  private lastActivity = Date.now();
  private lastAddress = "";
  private isCapturing = false;
  private isClosed = false;
  private closing: Promise<void> | null = null;

  /**
   * Creates a session around a started browser; call {@link start} next.
   *
   * @param init - Server-owned facts of the session.
   */
  public constructor(init: PicaBrowserSessionInit) {
    this.init = init;
    this.userId = init.userId;
    this.scope = init.scope;
    this.conversationId = init.conversationId;
    this.task = init.task;
    this.profile = init.profile;
    this.device = init.device;
    this.width = PICA_BROWSER_PRESETS[init.device].width;
    this.height = PICA_BROWSER_PRESETS[init.device].height;
    this.lifetime = AbortSignal.any([this.abort.signal, init.signal]);
    init.signal.addEventListener("abort", () => void this.close(), {
      once: true,
    });
  }

  /** Creates the isolated context and its first tab. */
  public async start(storage?: PicaBrowserStorageState): Promise<void> {
    await this.openContext(storage);
  }

  /** The signal that ends when the browser stops or closes. */
  public get signal(): AbortSignal {
    return this.lifetime;
  }

  /** The control state. */
  public get currentState(): PicaBrowserState {
    return this.state;
  }

  /** The device preset in use. */
  public get currentDevice(): PicaBrowserDevice {
    return this.device;
  }

  /** The origins the browser may reach besides the public internet. */
  public allowedOrigins(): PicaBrowserOrigins {
    return this.init.origins();
  }

  /** The browser context; the session must be started and open. */
  public requireContext(): BrowserContext {
    if (this.isClosed || this.context === null)
      throw new PicaAdminError("BROWSER_CLOSED");
    return this.context;
  }

  /** The tab calls act on. */
  public activePage(): Page {
    this.requireContext();
    const page = this.tabs[this.active] ?? this.tabs[this.tabs.length - 1];
    if (!page) throw new PicaAdminError("BROWSER_CLOSED");
    return page;
  }

  /** The open tabs in order. */
  public openPages(): readonly Page[] {
    return this.tabs;
  }

  /** Makes another tab the one calls act on. */
  public activate(index: number): Page {
    const page = this.tabs[index];
    if (!page) throw new PicaAdminError("TAB_NOT_FOUND");
    this.active = index;
    return page;
  }

  /**
   * Waits until the administrator lets Pica act.
   *
   * @param signal - The signal of the calling job.
   * @throws {PicaAdminError} `STOPPED_BY_ADMIN`, `PAUSED_BY_ADMIN` or
   * `ADMIN_HAS_CONTROL` when the state does not return to `running` in time.
   */
  public async admit(signal: AbortSignal): Promise<void> {
    const deadline = Date.now() + GATE_WAIT_MS;
    while (this.state !== "running") {
      if (this.state === "stopped")
        throw new PicaAdminError("STOPPED_BY_ADMIN");
      if (Date.now() >= deadline)
        throw new PicaAdminError(
          this.state === "paused" ? "PAUSED_BY_ADMIN" : "ADMIN_HAS_CONTROL",
        );
      signal.throwIfAborted();
      await delay(200);
    }
    this.requireContext();
    this.touch();
  }

  /** Marks activity, so an idle browser can be closed. */
  public touch(): void {
    this.lastActivity = Date.now();
  }

  /** Milliseconds since the last call or input. */
  public idleFor(): number {
    return Date.now() - this.lastActivity;
  }

  /** Lets the administrator pause Pica; the running call finishes first. */
  public pause(): void {
    if (this.state === "running") this.transition("paused", "Paused");
  }

  /** Lets Pica continue after a pause. */
  public resume(): void {
    if (this.state === "paused") this.transition("running", "Resumed");
  }

  /** Gives the controls to the administrator; Pica waits. */
  public takeOver(): void {
    if (this.state === "running" || this.state === "paused")
      this.transition("takeover", "Took over the browser");
  }

  /** Gives the controls back to Pica. */
  public handBack(): void {
    if (this.state !== "takeover") return;
    this.handoverReason = null;
    this.transition("running", "Handed the browser back to Pica");
  }

  /** Pica asks the administrator to take over, for example to sign in. */
  public requestHandover(reason: string): void {
    this.handoverReason = shorten(reason, 300);
    if (this.state !== "stopped") this.state = "takeover";
    this.record(
      "pica",
      `Asked the administrator to take over: ${this.handoverReason}`,
      "completed",
    );
  }

  /** Ends the browser for good: no later call of this session runs. */
  public async stop(): Promise<void> {
    if (this.state === "stopped") return;
    this.state = "stopped";
    this.handoverReason = null;
    this.record("admin", "Stopped the browser", "completed");
    await this.close();
  }

  /** Adds an entry to the action log. */
  public record(
    actor: PicaBrowserAction["actor"],
    summary: string,
    status: PicaBrowserAction["status"],
  ): void {
    this.actions.push({
      at: new Date().toISOString(),
      actor,
      summary: shorten(summary, 300),
      status,
    });
    if (this.actions.length > MAXIMUM_ACTIONS) this.actions.shift();
  }

  /** Remembers something the next observation reports, such as a blocked request. */
  public note(message: string): void {
    const text = shorten(message, 200);
    if (this.notes.includes(text)) return;
    this.notes.push(text);
    if (this.notes.length > MAXIMUM_NOTES) this.notes.shift();
  }

  /** Returns and clears the notes. */
  public takeNotes(): readonly string[] {
    return this.notes.splice(0, this.notes.length);
  }

  /** The reason the proxy refused the last request, if any. */
  public takeRefusal(): string | null {
    return this.proxy?.takeRefusal() ?? null;
  }

  /** Keeps the newest picture for the live view and returns its version. */
  public storeFrame(bytes: Buffer): number {
    const version = (this.frame?.version ?? 0) + 1;
    this.frame = { bytes, version, capturedAt: Date.now() };
    return version;
  }

  /** The newest picture, if any. */
  public currentFrame(): PicaBrowserFrame | null {
    return this.frame;
  }

  /** Lets one caller at a time take a live picture; others reuse the last one. */
  public beginCapture(): boolean {
    if (this.isCapturing) return false;
    this.isCapturing = true;
    return true;
  }

  /** Ends a live capture. */
  public endCapture(): void {
    this.isCapturing = false;
  }

  /** The downloads kept for this browser. */
  public storedDownloads(): readonly PicaBrowserStoredDownload[] {
    return this.downloads;
  }

  /** Keeps a downloaded file; oversized files and files beyond the budget are refused with a note. */
  public keepDownload(file: PicaBrowserCapturedFile): void {
    if (this.init.isAgent === true) {
      this.note("Downloads are disabled for agent browsers.");
      return;
    }
    const total = this.downloads.reduce((sum, entry) => sum + entry.size, 0);
    if (
      file.bytes.length > MAXIMUM_DOWNLOAD_BYTES ||
      total + file.bytes.length > MAXIMUM_DOWNLOAD_TOTAL_BYTES ||
      this.downloads.length >= MAXIMUM_DOWNLOADS
    ) {
      this.note(`Download "${file.fileName}" was refused: too large.`);
      return;
    }
    this.downloads.push({
      id: randomUUID(),
      fileName: file.fileName,
      contentType: file.contentType,
      size: file.bytes.length,
      at: new Date().toISOString(),
      bytes: file.bytes,
    });
    this.note(`Downloaded "${file.fileName}" (${file.bytes.length} bytes).`);
  }

  /** Reads the titles of the tabs for the view; a busy tab keeps its last title. */
  public async refreshTitles(): Promise<void> {
    await Promise.all(
      this.tabs.map(async (page) => {
        try {
          const title = await Promise.race([
            page.title(),
            delay(TITLE_TIMEOUT_MS).then(() => null),
          ]);
          if (title !== null) this.titles.set(page, title);
        } catch (error: unknown) {
          logCaughtError("PicaBrowserSession", error);
        }
      }),
    );
  }

  /** The facts the live view shows. */
  public view(): PicaBrowserView {
    const page = this.tabs[this.active] ?? this.tabs[0];
    return {
      browserId: this.id,
      ...(this.init.isAgent === true
        ? { isAgent: true, ownerName: this.init.ownerName }
        : {}),
      task: shorten(this.task, 500),
      state: this.state,
      url: page ? shorten(page.url(), 500) : this.lastAddress,
      title: page ? shorten(this.titles.get(page) ?? "", 200) : "",
      device: this.device,
      width: this.width,
      height: this.height,
      frameVersion: this.frame?.version ?? 0,
      tabs: this.tabList(),
      actions: [...this.actions],
      downloads: this.downloads.map((entry) => ({
        id: entry.id,
        fileName: entry.fileName,
        contentType: entry.contentType,
        size: entry.size,
        at: entry.at,
      })),
      handoverReason: this.handoverReason,
      profile: this.profile,
      areLocalWritesApproved: this.areLocalWritesApproved,
      updatedAt: new Date().toISOString(),
    };
  }

  /** The tabs as the model and the view list them. */
  public tabList(): PicaBrowserTab[] {
    return this.tabs.map((page, index) => ({
      index,
      url: shorten(page.url(), 300),
      title: shorten(this.titles.get(page) ?? "", 120),
      isActive: index === this.active,
    }));
  }

  /**
   * Switches between device presets by starting a fresh context with the same cookies and storage.
   *
   * @param device - The preset to use.
   * @returns The address that was open, to load again.
   */
  public async changeDevice(device: PicaBrowserDevice): Promise<string> {
    const context = this.requireContext();
    const url = this.activePage().url();
    const storage = await context.storageState();
    this.device = device;
    this.width = PICA_BROWSER_PRESETS[device].width;
    this.height = PICA_BROWSER_PRESETS[device].height;
    this.tabs.length = 0;
    await context.close();
    await this.openContext(storage);
    return url;
  }

  /** Records a custom viewport size of the active tab. */
  public async resize(width: number, height: number): Promise<void> {
    await this.activePage().setViewportSize({ width, height });
    this.width = width;
    this.height = height;
  }

  /** The cookies and local storage of this browser, for saving a session. */
  public async storage(): Promise<PicaBrowserStorageState> {
    return this.requireContext().storageState();
  }

  /** Closes the browser and everything it holds; safe to call twice. */
  public close(): Promise<void> {
    this.closing ??= this.closeResources();
    return this.closing;
  }

  private transition(next: PicaBrowserState, summary: string): void {
    this.state = next;
    this.record("admin", summary, "completed");
  }

  private async closeResources(): Promise<void> {
    if (this.isClosed) return;
    this.isClosed = true;
    // A stopped browser keeps showing where it was.
    const open = this.tabs[this.active] ?? this.tabs[0];
    if (open) this.lastAddress = shorten(open.url(), 500);
    if (this.state !== "stopped") this.state = "stopped";
    this.abort.abort("closed");
    this.transport.close();
    try {
      await this.init.browser.close();
    } catch (error: unknown) {
      logCaughtError("PicaBrowserSession", error);
    }
    this.tabs.length = 0;
    this.downloads.length = 0;
  }

  private async openContext(storage?: PicaBrowserStorageState): Promise<void> {
    const preset = PICA_BROWSER_PRESETS[this.device];
    const isMobile = this.device === "mobile";
    const context = await this.init.browser.newContext({
      viewport: { width: preset.width, height: preset.height },
      userAgent: USER_AGENTS[this.device],
      isMobile,
      hasTouch: isMobile,
      deviceScaleFactor: 1,
      acceptDownloads: false,
      serviceWorkers: "block",
      permissions: [],
      locale: "en-US",
      ...(storage ? { storageState: storage } : {}),
    });
    context.setDefaultTimeout(8000);
    context.setDefaultNavigationTimeout(20_000);
    await context.routeWebSocket("**/*", (socket) => socket.close());
    const proxy = new PicaBrowserProxy(
      {
        signal: this.signal,
        origins: this.init.origins,
        // While the administrator drives, the requests of the page are theirs.
        areWritesApproved: () =>
          this.areLocalWritesApproved || this.state === "takeover",
        authorize: this.init.authorize,
        note: (message) => this.note(message),
        capture: (file) => this.keepDownload(file),
        hasOwnAccount: this.init.isAgent === true,
      },
      context,
      this.transport,
    );
    await context.route("**/*", (route) => proxy.handle(route));
    context.on("page", (page) => this.adopt(page));
    this.context = context;
    this.proxy = proxy;
    this.active = 0;
    this.adopt(await context.newPage());
  }

  private adopt(page: Page): void {
    if (this.tabs.includes(page)) return;
    if (this.tabs.length >= MAXIMUM_TABS) {
      this.note("A new tab was closed: too many tabs are open.");
      void page.close().catch(() => undefined);
      return;
    }
    this.tabs.push(page);
    if (this.tabs.length > 1) {
      this.active = this.tabs.length - 1;
      this.note(`A new tab opened (tab ${this.active}).`);
    }
    page.on("dialog", (dialog) => void this.answerDialog(dialog));
    page.on("console", (message) => {
      if (message.type() === "error")
        this.note(`Console error: ${message.text()}`);
    });
    page.on("pageerror", (error) => this.note(`Page error: ${error.message}`));
    page.on("load", () => this.sensitivePages.delete(page));
    page.on("response", (response) => {
      if (
        response.request().isNavigationRequest() &&
        response.status() >= 400 &&
        response.frame() === page.mainFrame()
      ) {
        const url = new URL(response.url());
        this.note(`HTTP ${response.status()} for ${url.host}${url.pathname}.`);
      }
    });
    page.on("close", () => this.drop(page));
  }

  private drop(page: Page): void {
    const index = this.tabs.indexOf(page);
    if (index < 0) return;
    this.tabs.splice(index, 1);
    if (this.active >= this.tabs.length)
      this.active = Math.max(0, this.tabs.length - 1);
  }

  private async answerDialog(dialog: Dialog): Promise<void> {
    const type = dialog.type();
    const fallback =
      type === "alert" || type === "beforeunload" ? "accept" : "dismiss";
    const answer = this.dialogAnswer ?? fallback;
    this.note(
      `A ${type} dialog "${dialog.message()}" was ${answer === "accept" ? "accepted" : "dismissed"}.`,
    );
    try {
      if (answer === "accept") await dialog.accept();
      else await dialog.dismiss();
    } catch (error: unknown) {
      logCaughtError("PicaBrowserSession", error);
    }
  }
}
