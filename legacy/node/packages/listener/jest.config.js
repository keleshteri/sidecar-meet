/** @type {import('jest').Config} */
module.exports = {
  displayName: '@sidecar-meet/listener',
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.test.ts'],
};
