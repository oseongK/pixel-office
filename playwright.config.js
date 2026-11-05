import { defineConfig } from '@playwright/test';

const PORT = 8799;

export default defineConfig({
  testDir: 'tests',
  testMatch: '*.spec.js',
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: `node dev/mock-server.js`,
    env: { PORT: String(PORT) },
    url: `http://localhost:${PORT}/index.html`,
    reuseExistingServer: false,
  },
});
