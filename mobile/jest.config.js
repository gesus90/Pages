/** @type {import("jest").Config} */
module.exports = {
  preset: "jest-expo",
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/src/$1" },
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  testMatch: ["<rootDir>/tests/**/*.test.{ts,tsx}"],
  collectCoverageFrom: ["app/**/*.{ts,tsx}", "src/**/*.{ts,tsx}"],
  coverageDirectory: "coverage",
};
