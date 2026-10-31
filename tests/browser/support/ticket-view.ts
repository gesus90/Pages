import type { Locator, Page } from "@playwright/test";
import type { SeedTicket } from "./seed";

/** Where a ticket is opened: its own page or the dialog above the board. */
export type TicketSurface = "page" | "dialog";

/** The ticket view and its image viewer, found the way a person finds them. */
export class TicketView {
  public readonly page: Page;
  public readonly ticket: SeedTicket;
  public readonly surface: TicketSurface;

  /**
   * Creates the view of one ticket.
   *
   * @param page - The browser page.
   * @param ticket - The fixture ticket.
   * @param surface - Whether the ticket opens as a page or as a dialog.
   */
  public constructor(page: Page, ticket: SeedTicket, surface: TicketSurface) {
    this.page = page;
    this.ticket = ticket;
    this.surface = surface;
  }

  /**
   * The region the ticket is shown in.
   *
   * @remarks
   * While the viewer is open the ticket is hidden from assistive technology,
   * so the locators of the ticket also find hidden elements: a test must see
   * what the viewer covers, such as an editor that opened behind it.
   */
  public get root(): Locator {
    // Found by its text: the accessible name of a dialog that is hidden from
    // assistive technology is empty, and the viewer hides this one.
    return this.surface === "dialog"
      ? this.page.locator('[role="dialog"]', { hasText: this.ticket.key })
      : this.page.locator("main");
  }

  /** The description section of the ticket. */
  public get description(): Locator {
    return this.root.locator("section", {
      has: this.page.getByRole("heading", {
        includeHidden: true,
        name: "Description",
      }),
    });
  }

  /** The buttons that open the images of the description, in displayed order. */
  public get imageButtons(): Locator {
    return this.description.getByRole("button", {
      includeHidden: true,
      name: /^Open image/u,
    });
  }

  /** The image viewer dialog. */
  public get viewer(): Locator {
    return this.page.getByRole("dialog", { name: "Image viewer" });
  }

  /** The image the viewer shows. */
  public get viewerImage(): Locator {
    return this.viewer.getByRole("img");
  }

  /** The close button of the image viewer. */
  public get closeButton(): Locator {
    return this.viewer.getByRole("button", { name: "Close image viewer" });
  }

  /** The arrow to the previous image. */
  public get previousButton(): Locator {
    return this.viewer.getByRole("button", { name: "Previous image" });
  }

  /** The arrow to the next image. */
  public get nextButton(): Locator {
    return this.viewer.getByRole("button", { name: "Next image" });
  }

  /** The position of the image being shown, such as "2 / 5". */
  public get position(): Locator {
    return this.viewer.getByRole("status").filter({ hasText: /^\d+ \/ \d+$/u });
  }

  /** The explicit edit button of the description. */
  public get editButton(): Locator {
    return this.description.getByRole("button", {
      includeHidden: true,
      name: "Edit description",
    });
  }

  /** The description editor, which only exists while editing. */
  public get editor(): Locator {
    // Hidden ones count too: an open viewer hides the page behind it from
    // assistive technology, and an editor that opened there must still show.
    return this.page.getByRole("textbox", {
      includeHidden: true,
      name: `Description of ${this.ticket.key}`,
    });
  }

  /**
   * Loads every image of the description now.
   *
   * @remarks
   * The images load lazily, so the text below them shifts while a person
   * scrolls. A test that compares scroll positions loads them first.
   */
  public async loadAllImages(): Promise<void> {
    await this.description
      .locator("img[data-viewer-image]")
      .evaluateAll((images: HTMLImageElement[]) =>
        Promise.all(
          images.map((image) => {
            image.loading = "eager";

            // A deleted attachment cannot be decoded; its error is the point.
            return image.decode().catch(() => undefined);
          }),
        ),
      );
  }

  /** Opens the ticket and waits until its description is there. */
  public async open(): Promise<void> {
    await this.page.goto(
      this.surface === "dialog"
        ? `/aufgaben?item=${this.ticket.key}`
        : `/aufgaben/${this.ticket.key}`,
    );
    await this.description.waitFor();
  }
}
