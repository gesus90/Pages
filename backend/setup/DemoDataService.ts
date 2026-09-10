import { randomUUID } from "node:crypto";

import { PROJECT_ROLE, PROJECT_STATUS } from "@/definition/Project";
import { ROLE } from "@/definition/Role";

import type { PasswordHasher } from "@/backend/auth/PasswordHasher";
import type { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import type { UserRepository } from "@/backend/database/repositories/UserRepository";
import type { ProjectRole } from "@/definition/Project";

const DEMO_EMAIL_DOMAIN = "pages.local";
const DEMO_PROJECT_NAME = "Pages";
const DEMO_PROJECT_PLACEHOLDER_COLOR = "#FCE3D3";

// Join dates spread deterministically across August and September 2026 so
// repeated runs keep stable timestamps instead of re-rolling random ones.
const JOIN_SPREAD_START_MS = Date.UTC(2026, 7, 3, 8, 12);
const JOIN_SPREAD_STEP_HOURS = 34;
const JOIN_SPREAD_JITTER_MINUTES = 17;
const JOIN_SPREAD_JITTER_MODULO = 55;

/** One demo person seeded with a fixed project role and account state. */
interface DemoTeamEntry {
  readonly firstName: string;
  readonly lastName: string;
  readonly projectRole: ProjectRole;
  /** Inactive accounts render as invited since they cannot sign in yet. */
  readonly invited: boolean;
}

const DEMO_TEAM: readonly DemoTeamEntry[] = [
  {
    firstName: "Max",
    lastName: "Mustermann",
    projectRole: PROJECT_ROLE.MEMBER,
    invited: false,
  },
  {
    firstName: "Anna",
    lastName: "Schmidt",
    projectRole: PROJECT_ROLE.MEMBER,
    invited: false,
  },
  {
    firstName: "Sarah",
    lastName: "Wagner",
    projectRole: PROJECT_ROLE.MEMBER,
    invited: false,
  },
  {
    firstName: "Tom",
    lastName: "Becker",
    projectRole: PROJECT_ROLE.MEMBER,
    invited: false,
  },
  {
    firstName: "Lisa",
    lastName: "König",
    projectRole: PROJECT_ROLE.MEMBER,
    invited: false,
  },
  {
    firstName: "Daniel",
    lastName: "Fischer",
    projectRole: PROJECT_ROLE.MEMBER,
    invited: false,
  },
  {
    firstName: "Laura",
    lastName: "Weber",
    projectRole: PROJECT_ROLE.MEMBER,
    invited: false,
  },
  {
    firstName: "Michael",
    lastName: "Hoffmann",
    projectRole: PROJECT_ROLE.MEMBER,
    invited: false,
  },
  {
    firstName: "Julia",
    lastName: "Schneider",
    projectRole: PROJECT_ROLE.MEMBER,
    invited: true,
  },
  {
    firstName: "David",
    lastName: "Meyer",
    projectRole: PROJECT_ROLE.MEMBER,
    invited: false,
  },
  {
    firstName: "Sophie",
    lastName: "Schulz",
    projectRole: PROJECT_ROLE.MEMBER,
    invited: false,
  },
  {
    firstName: "Martin",
    lastName: "Bauer",
    projectRole: PROJECT_ROLE.MEMBER,
    invited: false,
  },
  {
    firstName: "Katharina",
    lastName: "Richter",
    projectRole: PROJECT_ROLE.MEMBER,
    invited: false,
  },
  {
    firstName: "Alexander",
    lastName: "Klein",
    projectRole: PROJECT_ROLE.MEMBER,
    invited: false,
  },
  {
    firstName: "Nina",
    lastName: "Wolf",
    projectRole: PROJECT_ROLE.MEMBER,
    invited: false,
  },
  {
    firstName: "Felix",
    lastName: "Schröder",
    projectRole: PROJECT_ROLE.MEMBER,
    invited: false,
  },
  {
    firstName: "Johanna",
    lastName: "Neumann",
    projectRole: PROJECT_ROLE.MEMBER,
    invited: true,
  },
  {
    firstName: "Sebastian",
    lastName: "Schwarz",
    projectRole: PROJECT_ROLE.MEMBER,
    invited: false,
  },
  {
    firstName: "Marie",
    lastName: "Zimmermann",
    projectRole: PROJECT_ROLE.MEMBER,
    invited: false,
  },
  {
    firstName: "Lukas",
    lastName: "Braun",
    projectRole: PROJECT_ROLE.MEMBER,
    invited: false,
  },
  {
    firstName: "Lea",
    lastName: "Hartmann",
    projectRole: PROJECT_ROLE.MEMBER,
    invited: false,
  },
  {
    firstName: "Jan",
    lastName: "Krüger",
    projectRole: PROJECT_ROLE.MEMBER,
    invited: false,
  },
  {
    firstName: "Vanessa",
    lastName: "Werner",
    projectRole: PROJECT_ROLE.MEMBER,
    invited: false,
  },
  {
    firstName: "Tobias",
    lastName: "Schmitt",
    projectRole: PROJECT_ROLE.MEMBER,
    invited: true,
  },
  {
    firstName: "Carina",
    lastName: "Lange",
    projectRole: PROJECT_ROLE.MEMBER,
    invited: false,
  },
  {
    firstName: "Patrick",
    lastName: "Schuster",
    projectRole: PROJECT_ROLE.MEMBER,
    invited: false,
  },
  {
    firstName: "Miriam",
    lastName: "Vogel",
    projectRole: PROJECT_ROLE.MEMBER,
    invited: false,
  },
  {
    firstName: "Florian",
    lastName: "Roth",
    projectRole: PROJECT_ROLE.VIEWER,
    invited: false,
  },
  {
    firstName: "Eva",
    lastName: "Günther",
    projectRole: PROJECT_ROLE.VIEWER,
    invited: false,
  },
  {
    firstName: "Kevin",
    lastName: "Lorenz",
    projectRole: PROJECT_ROLE.VIEWER,
    invited: false,
  },
  {
    firstName: "Sandra",
    lastName: "Frank",
    projectRole: PROJECT_ROLE.VIEWER,
    invited: true,
  },
  {
    firstName: "Christian",
    lastName: "Berger",
    projectRole: PROJECT_ROLE.VIEWER,
    invited: false,
  },
  {
    firstName: "Melanie",
    lastName: "Krause",
    projectRole: PROJECT_ROLE.VIEWER,
    invited: false,
  },
  {
    firstName: "Benjamin",
    lastName: "Keller",
    projectRole: PROJECT_ROLE.VIEWER,
    invited: false,
  },
  {
    firstName: "Isabel",
    lastName: "Böhm",
    projectRole: PROJECT_ROLE.VIEWER,
    invited: false,
  },
  {
    firstName: "Robert",
    lastName: "Schulte",
    projectRole: PROJECT_ROLE.VIEWER,
    invited: true,
  },
  {
    firstName: "Natalie",
    lastName: "Weiß",
    projectRole: PROJECT_ROLE.VIEWER,
    invited: false,
  },
  {
    firstName: "Andreas",
    lastName: "Peters",
    projectRole: PROJECT_ROLE.MANAGER,
    invited: false,
  },
  {
    firstName: "Nicole",
    lastName: "Jung",
    projectRole: PROJECT_ROLE.MANAGER,
    invited: true,
  },
  {
    firstName: "Dennis",
    lastName: "Fuchs",
    projectRole: PROJECT_ROLE.MANAGER,
    invited: false,
  },
];

/** Transliterates a name part into stable ASCII for usernames and emails. */
function toUsernameToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
}

/** Returns the stable demo username for a first and last name. */
function toDemoUsername(firstName: string, lastName: string): string {
  return `${toUsernameToken(firstName)}.${toUsernameToken(lastName)}`;
}

/** Formats a date as a SQLite-compatible timestamp in UTC. */
function formatSQLiteTimestamp(value: Date): string {
  const pad = (part: number): string => String(part).padStart(2, "0");

  return (
    `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())} ` +
    `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}`
  );
}

/** Returns the deterministic join timestamp for a demo entry index. */
function toDemoJoinedAt(index: number): string {
  const timestamp =
    JOIN_SPREAD_START_MS +
    index * JOIN_SPREAD_STEP_HOURS * 3_600_000 +
    ((index * JOIN_SPREAD_JITTER_MINUTES) % JOIN_SPREAD_JITTER_MODULO) * 60_000;

  return formatSQLiteTimestamp(new Date(timestamp));
}

/** Seeds demo users and their Pages project memberships. */
export class DemoDataService {
  private readonly userRepository: UserRepository;
  private readonly projectRepository: ProjectRepository;
  private readonly passwordHasher: PasswordHasher;

  /**
   * Creates a demo data service.
   *
   * @param userRepository - User persistence boundary.
   * @param projectRepository - Project persistence boundary.
   * @param passwordHasher - Password hashing for demo credentials.
   */
  public constructor(
    userRepository: UserRepository,
    projectRepository: ProjectRepository,
    passwordHasher: PasswordHasher,
  ) {
    this.userRepository = userRepository;
    this.projectRepository = projectRepository;
    this.passwordHasher = passwordHasher;
  }

  /**
   * Creates missing demo users and assigns them to the Pages project.
   *
   * @returns How many demo users were created by this call.
   *
   * @remarks
   * Existing users and memberships are never modified, so repeated runs
   * create no duplicates. Demo accounts share one unknown random password
   * hash, which keeps the one-time seeding cost to a single scrypt run and
   * means nobody can sign in as a demo user out of the box.
   */
  public async ensureDemoTeam(): Promise<number> {
    const existingIdsByUsername = new Map(
      (await this.userRepository.findAll()).map((user) => [
        user.username,
        user.id,
      ]),
    );
    // One hash for every demo account: the password itself stays unknown.
    const passwordHash = await this.passwordHasher.hash(randomUUID());
    let createdCount = 0;

    for (const [index, entry] of DEMO_TEAM.entries()) {
      const username = toDemoUsername(entry.firstName, entry.lastName);

      if (existingIdsByUsername.has(username)) {
        continue;
      }

      const joinedAt = toDemoJoinedAt(index);
      const id = randomUUID();

      await this.userRepository.insert({
        id,
        username,
        displayName: `${entry.firstName} ${entry.lastName}`,
        passwordHash,
        email: `${username}@${DEMO_EMAIL_DOMAIN}`,
        role: ROLE.EMPLOYEE,
        isActive: !entry.invited,
        createdAt: joinedAt,
      });

      existingIdsByUsername.set(username, id);
      createdCount += 1;
    }

    await this.ensurePagesTeamMemberships(existingIdsByUsername);

    return createdCount;
  }

  private async ensurePagesTeamMemberships(
    userIdsByUsername: ReadonlyMap<string, string>,
  ): Promise<void> {
    const projectId = await this.ensurePagesProject();

    if (!projectId) {
      return;
    }

    const existingMemberIds = new Set(
      (await this.projectRepository.findMembers(projectId)).map(
        (member) => member.userId,
      ),
    );
    const admin = await this.userRepository.findCredentialsByUsername("admin");

    if (admin && !existingMemberIds.has(admin.user.id)) {
      await this.projectRepository.addMember(
        projectId,
        admin.user.id,
        PROJECT_ROLE.MANAGER,
      );
    }

    for (const [index, entry] of DEMO_TEAM.entries()) {
      const userId = userIdsByUsername.get(
        toDemoUsername(entry.firstName, entry.lastName),
      );

      if (!userId || existingMemberIds.has(userId)) {
        continue;
      }

      await this.projectRepository.addMember(
        projectId,
        userId,
        entry.projectRole,
        toDemoJoinedAt(index),
      );
    }
  }

  private async ensurePagesProject(): Promise<string | null> {
    const existing = (await this.projectRepository.findAll()).find(
      (project) => project.name === DEMO_PROJECT_NAME,
    );

    if (existing) {
      return existing.id;
    }

    const admin = await this.userRepository.findCredentialsByUsername("admin");

    if (!admin) {
      return null;
    }

    const projectId = randomUUID();

    await this.projectRepository.insert({
      id: projectId,
      name: DEMO_PROJECT_NAME,
      description: "Demo-Projekt zur Veranschaulichung der Teamverwaltung.",
      ownerId: admin.user.id,
      placeholderColor: DEMO_PROJECT_PLACEHOLDER_COLOR,
      status: PROJECT_STATUS.ACTIVE,
    });

    return projectId;
  }
}
