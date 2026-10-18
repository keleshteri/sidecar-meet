/** @type {import('jest').Config} */
module.exports = {
  displayName: '@sidecar-meet/api',
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.test.ts'],
};
