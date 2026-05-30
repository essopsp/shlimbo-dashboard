describe('Config', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  test('loads default values when no env vars set', () => {
    delete process.env.PORT;
    delete process.env.DASHBOARD_SECRET;
    const config = require('../src/config');
    expect(config.port).toBe(3000);
    // NODE_ENV defaults to 'test' when Jest runs
    expect(config.nodeEnv).toBe('test');
    expect(config.dashboardSecret).toBe('');
  });

  test('reads PORT from environment', () => {
    process.env.PORT = '4000';
    const config = require('../src/config');
    expect(config.port).toBe(4000);
  });

  test('reads DASHBOARD_SECRET from environment', () => {
    process.env.DASHBOARD_SECRET = 'my-secret';
    const config = require('../src/config');
    expect(config.dashboardSecret).toBe('my-secret');
    expect(config.jwtSecret).toBe('my-secret');
  });

  test('has default alert thresholds', () => {
    const config = require('../src/config');
    expect(config.alertThresholds.cpu).toBe(80);
    expect(config.alertThresholds.memory).toBe(80);
    expect(config.alertThresholds.disk).toBe(85);
  });

  test('default sample interval is 2000ms', () => {
    const config = require('../src/config');
    expect(config.sampleInterval).toBe(2000);
  });
});
