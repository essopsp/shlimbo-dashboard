const OLD_ENV = process.env;

beforeEach(() => {
  process.env = { ...OLD_ENV };
});

afterAll(() => {
  process.env = OLD_ENV;
});

describe('Auth Service', () => {
  test('authenticateSecret returns null when DASHBOARD_SECRET not configured', () => {
    delete process.env.DASHBOARD_SECRET;
    delete process.env.JWT_SECRET;
    const auth = require('../src/services/auth');
    expect(auth.authenticateSecret('any-secret')).toBeNull();
    expect(auth.isAuthConfigured()).toBe(false);
  });

  test('authenticateSecret returns null for wrong secret', () => {
    process.env.DASHBOARD_SECRET = 'correct-secret';
    jest.resetModules();
    const auth = require('../src/services/auth');
    expect(auth.authenticateSecret('wrong-secret')).toBeNull();
  });

  test('authenticateSecret returns token for correct secret', () => {
    process.env.DASHBOARD_SECRET = 'correct-secret';
    jest.resetModules();
    const auth = require('../src/services/auth');
    const token = auth.authenticateSecret('correct-secret');
    expect(token).toBeTruthy();
    expect(typeof token).toBe('string');
    // JWT has 3 parts separated by dots
    expect(token.split('.')).toHaveLength(3);
  });

  test('verifyToken returns decoded payload', () => {
    process.env.DASHBOARD_SECRET = 'test-secret';
    jest.resetModules();
    const auth = require('../src/services/auth');
    const token = auth.authenticateSecret('test-secret');
    const decoded = auth.verifyToken(token);
    expect(decoded).toBeTruthy();
    expect(decoded.role).toBe('admin');
  });

  test('verifyToken returns null for invalid token', () => {
    process.env.DASHBOARD_SECRET = 'test-secret';
    jest.resetModules();
    const auth = require('../src/services/auth');
    expect(auth.verifyToken('invalid-token')).toBeNull();
    expect(auth.verifyToken('')).toBeNull();
  });

  test('isAuthConfigured returns true when secret set', () => {
    process.env.DASHBOARD_SECRET = 'anything';
    jest.resetModules();
    const auth = require('../src/services/auth');
    expect(auth.isAuthConfigured()).toBe(true);
  });
});
