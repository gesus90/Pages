import type {
  VirtualChatDirectory,
  VirtualChatMessage,
  VirtualGroup,
  VirtualParticipant,
} from "@/definition/VirtualChat";

const PARTICIPANTS: readonly VirtualParticipant[] = [
  {
    id: "pica",
    name: "Pica",
    role: "Allgemeine Assistentin",
    task: "Beantwortet Fragen zu Wiki, Tickets und Projekten",
    model: "Claude Sonnet 5.5",
    reasoning: "medium",
    tools: ["Wiki", "Tickets", "Projekte"],
    color: "primary",
    avatar: "pica",
    status: "active",
    unreadCount: 0,
  },
  {
    id: "theo",
    name: "Theo",
    role: "Ticket-Autor",
    task: "Schreibt und verfeinert Tickets",
    model: "Claude Opus 5.5",
    reasoning: "high",
    tools: ["Tickets", "Wiki"],
    color: "indigo",
    avatar: "initial",
    status: "active",
    unreadCount: 2,
  },
  {
    id: "mira",
    name: "Mira",
    role: "Code-Reviewerin",
    task: "Prüft Commits und Pull Requests",
    model: "Claude Opus 5.5",
    reasoning: "high",
    tools: ["GitHub", "Tickets"],
    color: "pink",
    avatar: "initial",
    status: "working",
    unreadCount: 0,
  },
  {
    id: "ops-bot",
    name: "Ops-Bot",
    role: "Server & Deployments",
    task: "Überwacht Server und Deployments",
    model: "Claude Haiku 5.5",
    reasoning: "low",
    tools: ["Terminal", "Arbeitsplätze"],
    color: "teal",
    avatar: "initial",
    status: "off",
    unreadCount: 0,
  },
  {
    id: "ana",
    name: "Ana",
    role: "Wiki-Redakteurin",
    task: "Pflegt Wiki-Seiten und Release-Notes",
    model: "Claude Sonnet 5.5",
    reasoning: "medium",
    tools: ["Wiki", "Tickets"],
    color: "lime",
    avatar: "initial",
    status: "active",
    unreadCount: 1,
  },
];

const GROUPS: readonly VirtualGroup[] = [
  {
    id: "release-team",
    name: "Release-Team",
    description: "bereitet Release 1.0 vor",
    memberIds: ["theo", "mira", "ana"],
    unreadCount: 0,
  },
  {
    id: "betrieb",
    name: "Betrieb",
    description: "hält Server und Deployments am Laufen",
    memberIds: ["ops-bot", "pica"],
    unreadCount: 3,
  },
];

const RELEASE_TEAM_HISTORY: readonly VirtualChatMessage[] = [
  {
    id: "release-team-1",
    authorId: null,
    content: "Wir wollen morgen 1.0 ausliefern. Was fehlt noch?",
    toolUses: [],
  },
  {
    id: "release-team-2",
    authorId: "theo",
    content:
      "Im Meilenstein **Version 1.0** sind noch 3 Tickets offen: PAGE-246, PAGE-250 und PAGE-251.",
    toolUses: [{ name: "list_tickets", detail: "3 offen" }],
  },
  {
    id: "release-team-3",
    authorId: "mira",
    content:
      "Der letzte Commit auf `main` ist sauber. PAGE-251 ist noch nicht gemergt – das blockiert.",
    toolUses: [{ name: "github", detail: "compare main" }],
  },
  {
    id: "release-team-4",
    authorId: "ana",
    content:
      "Ich bereite die Release-Notes im Wiki vor und hänge die drei Tickets an, sobald sie fertig sind.",
    toolUses: [],
  },
];

const THEO_HISTORY: readonly VirtualChatMessage[] = [
  {
    id: "theo-1",
    authorId: null,
    content:
      "Schreib ein Ticket: Einstellungen aufräumen, Screenreader-Karte raus.",
    toolUses: [],
  },
  {
    id: "theo-2",
    authorId: "theo",
    content:
      "Erledigt – **PAGE-251** angelegt, Status To Do, unter PAGE-39. Die Ursache der abgeschnittenen Ränder habe ich gleich mit aufgenommen.",
    toolUses: [{ name: "create_ticket", detail: "PAGE-251" }],
  },
  {
    id: "theo-3",
    authorId: "theo",
    content: "Soll ich die Screenshots als Anhang dranhängen?",
    toolUses: [],
  },
];

const BETRIEB_HISTORY: readonly VirtualChatMessage[] = [
  {
    id: "betrieb-1",
    authorId: "ops-bot",
    content: "Das nächtliche Backup ist durchgelaufen, alle Dienste antworten.",
    toolUses: [{ name: "health_check", detail: "alle grün" }],
  },
  {
    id: "betrieb-2",
    authorId: "pica",
    content: "Ich habe die Wartungsnotiz im Wiki auf den neuen Stand gebracht.",
    toolUses: [],
  },
];

const PICA_HISTORY: readonly VirtualChatMessage[] = [
  {
    id: "pica-1",
    authorId: null,
    content: "Wo steht die Anleitung für neue Arbeitsplätze?",
    toolUses: [],
  },
  {
    id: "pica-2",
    authorId: "pica",
    content:
      "Im Wiki unter **Agents → Arbeitsplätze**. Dort ist auch beschrieben, wie du eine Verbindung prüfst.",
    toolUses: [{ name: "wiki_search", detail: "Arbeitsplätze" }],
  },
];

const MIRA_HISTORY: readonly VirtualChatMessage[] = [
  {
    id: "mira-1",
    authorId: "mira",
    content: "Ich sehe mir gerade den letzten Pull Request an.",
    toolUses: [],
  },
];

const ANA_HISTORY: readonly VirtualChatMessage[] = [
  {
    id: "ana-1",
    authorId: "ana",
    content: "Die Release-Notes für 1.0 liegen als Entwurf im Wiki.",
    toolUses: [{ name: "wiki_page", detail: "Entwurf" }],
  },
];

/**
 * The fixed sample source of the chat page (PAGE-254), with the contents of
 * the two design screenshots.
 *
 * @remarks
 * Names, roles and messages are examples. Later tickets replace this source
 * with stored participants and groups; the page reads only the
 * {@link VirtualChatDirectory} contract.
 */
export const CHAT_PAGE_SAMPLE: VirtualChatDirectory = {
  participants: PARTICIPANTS,
  groups: GROUPS,
  histories: {
    "release-team": RELEASE_TEAM_HISTORY,
    betrieb: BETRIEB_HISTORY,
    pica: PICA_HISTORY,
    theo: THEO_HISTORY,
    mira: MIRA_HISTORY,
    "ops-bot": [],
    ana: ANA_HISTORY,
  },
  modelChoices: ["Claude Opus 5.5", "Claude Sonnet 5.5", "Claude Haiku 5.5"],
  toolChoices: [
    "Tickets",
    "Wiki",
    "Projekte",
    "GitHub",
    "Terminal",
    "Arbeitsplätze",
  ],
};
