/** @type {import('jest').Config} */
module.exports = {
  displayName: '@sidecar-meet/bot-engine',
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.test.ts'],
};
