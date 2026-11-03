import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL || 'http://172.30.20.51';

/**
 * 权限 E2E 配置。
 *
 * 全部用例默认只读：目标环境是带真实数据的租户（华夏基金），创建/删除类断言
 * 走「界面可见性 + 接口拒绝」而不是真的写数据。需要跑写操作用例时显式打开
 * E2E_ALLOW_WRITE=1，并在用例里先建后删（见 PLAN.md 的「可写用例」一节）。
 */
export default defineConfig({
  testDir: './specs',
  globalSetup: './support/global-setup.ts',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'report', open: 'never' }],
    ['json', { outputFile: 'report/results.json' }],
  ],
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1600, height: 1000 },
    locale: 'zh-CN',
    ignoreHTTPSErrors: true,
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
