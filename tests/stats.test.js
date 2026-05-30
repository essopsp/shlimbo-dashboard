const os = require('os');

// Mock child_process.exec
jest.mock('child_process', () => ({
  exec: jest.fn((cmd, cb) => {
    if (cmd.includes('df -h')) {
      cb(null, { stdout: '10G  50G  20%\n', stderr: '' });
    } else {
      cb(new Error('Unknown command'), null);
    }
  }),
}));

// Mock fs.readFileSync for /proc/net/dev
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  readFileSync: jest.fn((path) => {
    if (path === '/proc/net/dev') {
      return `Inter-|   Receive                        |  Transmit
 face |bytes    packets errs drop fifo frame|bytes    packets errs drop fifo
  eth0:  1000000       0    0    0    0     0   500000       0    0    0    0
    lo:  200000       0    0    0    0     0   200000       0    0    0    0
`;
    }
    return '';
  }),
}));

describe('Stats Service', () => {
  test('getCpuUsage returns a number', () => {
    const stats = require('../src/services/stats');
    const cpu = stats.getCpuUsage();
    expect(typeof cpu).toBe('number');
    expect(cpu).toBeGreaterThanOrEqual(0);
    expect(cpu).toBeLessThanOrEqual(100);
  });

  test('formatBytes formats correctly', () => {
    const stats = require('../src/services/stats');
    expect(stats.formatBytes(0)).toBe('0 B');
    expect(stats.formatBytes(1024)).toBe('1 KB');
    expect(stats.formatBytes(1048576)).toBe('1 MB');
    expect(stats.formatBytes(1073741824)).toBe('1 GB');
  });

  test('getStats returns expected shape', async () => {
    const stats = require('../src/services/stats');
    const result = await stats.getStats();

    expect(result).toHaveProperty('timestamp');
    expect(result).toHaveProperty('cpu');
    expect(result).toHaveProperty('memory');
    expect(result).toHaveProperty('disk');
    expect(result).toHaveProperty('network');
    expect(result).toHaveProperty('uptime');
    expect(result).toHaveProperty('hostname');
    expect(result.hostname).toBe(os.hostname());
    expect(result.cpu).toHaveProperty('usage');
    expect(result.cpu).toHaveProperty('cores');
    expect(result.memory).toHaveProperty('percent');
    expect(result.disk).toHaveProperty('percent');
  });
});
