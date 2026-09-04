import type {
  NewUser,
  UserCredentials,
  UserRepository,
} from "@/backend/database/repositories/UserRepository";
import type { User } from "@/definition/User";

/** Establishes the business-logic boundary for users. */
export class UserService {
  private readonly userRepository: UserRepository;

  /**
   * Creates a user service.
   *
   * @param userRepository - User persistence boundary.
   */
  public constructor(userRepository: UserRepository) {
    this.userRepository = userRepository;
  }

  /**
   * Returns the user with the given identifier.
   *
   * @param id - User identifier.
   * @returns The user, or `null` when no user exists.
   */
  public async getById(id: string): Promise<User | null> {
    return this.userRepository.findById(id);
  }

  /**
   * Returns the credentials stored for a username.
   *
   * @param username - Username entered during login.
   * @returns The credentials, or `null` when no user exists.
   */
  public async findCredentialsByUsername(
    username: string,
  ): Promise<UserCredentials | null> {
    return this.userRepository.findCredentialsByUsername(username);
  }

  /**
   * Creates a user.
   *
   * @param user - User values including the password hash.
   */
  public async createUser(user: NewUser): Promise<void> {
    await this.userRepository.insert(user);
  }
}
