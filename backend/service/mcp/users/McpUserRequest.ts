import { z } from "zod";

import { CAPABILITY } from "@/definition/Authorization";

import { McpUserError } from "./McpUserError";

const MAXIMUM_IDENTIFIER_LENGTH = 200;
const MAXIMUM_NAME_LENGTH = 200;
const MAXIMUM_EMAIL_LENGTH = 320;
const MAXIMUM_SEARCH_LENGTH = 200;
const MAXIMUM_CURSOR_LENGTH = 2048;
const MAXIMUM_REFERENCES = 100;
/** The page size of a list without `limit`. */
const DEFAULT_LIMIT = 50;

const identifierField = z.string().trim().min(1).max(MAXIMUM_IDENTIFIER_LENGTH);
const nameField = z.string().max(MAXIMUM_NAME_LENGTH);
const emailField = z.string().max(MAXIMUM_EMAIL_LENGTH).nullable();
const referencesField = z
  .array(identifierField)
  .max(MAXIMUM_REFERENCES)
  .refine((ids) => new Set(ids).size === ids.length);
const permissionsField = z
  .array(z.enum(Object.values(CAPABILITY)))
  .max(Object.values(CAPABILITY).length)
  .refine((permissions) => new Set(permissions).size === permissions.length);
const rankField = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const confirmationField = z.string().max(20).optional();
const operationField = identifierField;

const scopeSchema = z
  .object({
    managedDepartments: referencesField,
    allDepartments: z.boolean(),
    allProjects: z.boolean(),
  })
  .strict();

const roleFieldsSchema = z
  .object({
    name: nameField,
    rank: rankField,
    departmentBound: z.boolean(),
    permissions: permissionsField,
  })
  .strict();

const membersStateSchema = z
  .object({ name: nameField, memberIds: referencesField })
  .strict();

const profileFields = {
  username: nameField.optional(),
  firstName: nameField.optional(),
  lastName: nameField.optional(),
  email: emailField.optional(),
};

const listSchema = z
  .object({
    text: z.string().max(MAXIMUM_SEARCH_LENGTH).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(DEFAULT_LIMIT),
    cursor: z.string().min(1).max(MAXIMUM_CURSOR_LENGTH).optional(),
  })
  .strict();

const userListSchema = listSchema
  .extend({ isActive: z.enum(["true", "false"]).optional() })
  .strict();

// Every body is strict: actor facts, `canManage`, a password or any other
// unknown field is refused instead of ignored.
const createUserSchema = z
  .object({
    operationId: operationField,
    username: nameField,
    firstName: nameField,
    lastName: nameField,
    email: emailField.default(null),
    roleId: identifierField.nullable(),
    isAdmin: z.boolean().default(false),
    departmentIds: referencesField.default([]),
  })
  .strict();

const updateUserSchema = z
  .object({
    operationId: operationField,
    ...profileFields,
    expected: z.object(profileFields).strict(),
  })
  .strict();

const activeSchema = z
  .object({
    operationId: operationField,
    isActive: z.boolean(),
    expected: z.object({ isActive: z.boolean() }).strict(),
    confirmation: confirmationField,
  })
  .strict();

const resetSchema = z
  .object({ operationId: operationField, confirmation: confirmationField })
  .strict();

const departmentsSchema = z
  .object({
    operationId: operationField,
    departmentIds: referencesField,
    expected: z.object({ departmentIds: referencesField }).strict(),
    confirmation: confirmationField,
  })
  .strict();

const scopeChangeSchema = z
  .object({
    operationId: operationField,
    scope: scopeSchema,
    expected: z.object({ scope: scopeSchema }).strict(),
    confirmation: confirmationField,
  })
  .strict();

const administratorSchema = z
  .object({
    operationId: operationField,
    isAdmin: z.boolean(),
    expected: z.object({ isAdmin: z.boolean() }).strict(),
    confirmation: confirmationField,
  })
  .strict();

const assignSchema = z
  .object({
    operationId: operationField,
    targetType: z.enum(["person", "group", "department"]),
    targetId: identifierField,
    expectedAssignments: z
      .array(
        z
          .object({
            userId: identifierField,
            roleId: identifierField.nullable(),
          })
          .strict(),
      )
      .max(MAXIMUM_REFERENCES),
    confirmation: confirmationField,
  })
  .strict();

const roleCreateSchema = roleFieldsSchema
  .extend({ operationId: operationField })
  .strict();

const roleUpdateSchema = roleFieldsSchema
  .partial()
  .extend({
    operationId: operationField,
    expected: roleFieldsSchema,
    confirmation: confirmationField,
  })
  .strict();

const roleDeleteSchema = z
  .object({
    operationId: operationField,
    expected: roleFieldsSchema,
    confirmation: confirmationField,
  })
  .strict();

const departmentCreateSchema = z
  .object({ operationId: operationField, name: nameField })
  .strict();

const departmentUpdateSchema = z
  .object({
    operationId: operationField,
    name: nameField,
    expected: z.object({ name: nameField }).strict(),
  })
  .strict();

const membersDeleteSchema = z
  .object({
    operationId: operationField,
    expected: membersStateSchema,
    confirmation: confirmationField,
  })
  .strict();

const groupCreateSchema = z
  .object({
    operationId: operationField,
    name: nameField,
    memberIds: referencesField,
  })
  .strict();

const groupUpdateSchema = z
  .object({
    operationId: operationField,
    name: nameField.optional(),
    memberIds: referencesField.optional(),
    expected: membersStateSchema,
    confirmation: confirmationField,
  })
  .strict();

/** Query of a list: search text, page size and continuation. */
export type McpUserListRequest = z.infer<typeof listSchema>;
/** Query of `GET /users`. */
export type McpUserDirectoryRequest = z.infer<typeof userListSchema>;
/** Body of `POST /users`. */
export type McpUserCreateRequest = z.infer<typeof createUserSchema>;
/** Body of `PATCH /users/{userId}`. */
export type McpUserUpdateRequest = z.infer<typeof updateUserSchema>;
/** Body of `POST /users/{userId}/active`. */
export type McpUserActiveRequest = z.infer<typeof activeSchema>;
/** Body of `POST /users/{userId}/password-reset`. */
export type McpUserResetRequest = z.infer<typeof resetSchema>;
/** Body of `POST /users/{userId}/departments`. */
export type McpUserDepartmentsRequest = z.infer<typeof departmentsSchema>;
/** Body of `POST /users/{userId}/scope`. */
export type McpUserScopeRequest = z.infer<typeof scopeChangeSchema>;
/** Body of `POST /users/{userId}/administrator`. */
export type McpUserAdministratorRequest = z.infer<typeof administratorSchema>;
/** Body of `POST /roles/{roleId}/assign`. */
export type McpRoleAssignRequest = z.infer<typeof assignSchema>;
/** The stored fields of a role. */
export type McpRoleFields = z.infer<typeof roleFieldsSchema>;
/** Body of `POST /roles`. */
export type McpRoleCreateRequest = z.infer<typeof roleCreateSchema>;
/** Body of `PATCH /roles/{roleId}`. */
export type McpRoleUpdateRequest = z.infer<typeof roleUpdateSchema>;
/** Body of `DELETE /roles/{roleId}`. */
export type McpRoleDeleteRequest = z.infer<typeof roleDeleteSchema>;
/** Body of `POST /departments`. */
export type McpDepartmentCreateRequest = z.infer<typeof departmentCreateSchema>;
/** Body of `PATCH /departments/{departmentId}`. */
export type McpDepartmentUpdateRequest = z.infer<typeof departmentUpdateSchema>;
/** Body of `DELETE /departments/{id}` and `DELETE /groups/{id}`. */
export type McpMembersDeleteRequest = z.infer<typeof membersDeleteSchema>;
/** Body of `POST /groups`. */
export type McpGroupCreateRequest = z.infer<typeof groupCreateSchema>;
/** Body of `PATCH /groups/{groupId}`. */
export type McpGroupUpdateRequest = z.infer<typeof groupUpdateSchema>;

/** Parses untrusted input or rejects it with `invalid_request`. */
function parse<Output>(schema: z.ZodType<Output>, input: unknown): Output {
  const result = schema.safeParse(input);
  if (!result.success) throw new McpUserError("invalid_request");
  return result.data;
}

/**
 * Reads the query of a request as an object of single values.
 *
 * @throws {McpUserError} `invalid_request` for a parameter named twice.
 */
function queryObject(query: URLSearchParams): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [name, value] of query) {
    if (Object.hasOwn(values, name)) throw new McpUserError("invalid_request");
    values[name] = value;
  }
  return values;
}

/**
 * Requires that a profile change names a field and that `expected` holds
 * the read value of every field it changes.
 */
function requireExpectedProfile(
  request: McpUserUpdateRequest,
): McpUserUpdateRequest {
  const fields = ["username", "firstName", "lastName", "email"] as const;
  const changed = fields.filter((field) => request[field] !== undefined);
  if (
    changed.length === 0 ||
    changed.some((field) => request.expected[field] === undefined)
  )
    throw new McpUserError("invalid_request");
  return request;
}

/** Parsers of the queries and bodies of the user management API (PAGE-280). */
export const McpUserRequest = {
  list: (query: URLSearchParams): McpUserListRequest =>
    parse(listSchema, queryObject(query)),
  userList: (query: URLSearchParams): McpUserDirectoryRequest =>
    parse(userListSchema, queryObject(query)),
  createUser: (body: unknown): McpUserCreateRequest =>
    parse(createUserSchema, body),
  updateUser: (body: unknown): McpUserUpdateRequest =>
    requireExpectedProfile(parse(updateUserSchema, body)),
  active: (body: unknown): McpUserActiveRequest => parse(activeSchema, body),
  reset: (body: unknown): McpUserResetRequest => parse(resetSchema, body),
  departments: (body: unknown): McpUserDepartmentsRequest =>
    parse(departmentsSchema, body),
  scope: (body: unknown): McpUserScopeRequest => parse(scopeChangeSchema, body),
  administrator: (body: unknown): McpUserAdministratorRequest =>
    parse(administratorSchema, body),
  assign: (body: unknown): McpRoleAssignRequest => parse(assignSchema, body),
  roleCreate: (body: unknown): McpRoleCreateRequest =>
    parse(roleCreateSchema, body),
  roleUpdate: (body: unknown): McpRoleUpdateRequest =>
    parse(roleUpdateSchema, body),
  roleDelete: (body: unknown): McpRoleDeleteRequest =>
    parse(roleDeleteSchema, body),
  departmentCreate: (body: unknown): McpDepartmentCreateRequest =>
    parse(departmentCreateSchema, body),
  departmentUpdate: (body: unknown): McpDepartmentUpdateRequest =>
    parse(departmentUpdateSchema, body),
  membersDelete: (body: unknown): McpMembersDeleteRequest =>
    parse(membersDeleteSchema, body),
  groupCreate: (body: unknown): McpGroupCreateRequest =>
    parse(groupCreateSchema, body),
  groupUpdate: (body: unknown): McpGroupUpdateRequest =>
    parse(groupUpdateSchema, body),
};
