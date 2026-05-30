const request = require('supertest');

describe('API Routes', () => {
  let app;
  let token;

  beforeAll(() => {
    process.env.DASHBOARD_SECRET = 'test-secret';
    process.env.PORT = '3099';

    // Clear module cache to get fresh config
    jest.resetModules();
    const serverModule = require('../src/server');
    app = serverModule.app; // supertest needs just the Express app
  });

  afterAll(() => {
    const serverModule = require('../src/server');
    if (serverModule.server) {
      serverModule.server.close();
    }
  });

  test('GET /health returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body).toHaveProperty('time');
  });

  test('POST /api/auth with wrong secret returns 401', async () => {
    const res = await request(app)
      .post('/api/auth')
      .send({ secret: 'wrong-secret' });
    expect(res.status).toBe(401);
  });

  test('POST /api/auth with correct secret returns token', async () => {
    const res = await request(app)
      .post('/api/auth')
      .send({ secret: 'test-secret' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    token = res.body.token;
  });

  test('GET /api/auth/status returns configured status', async () => {
    const res = await request(app).get('/api/auth/status');
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
  });

  test('GET /api/stats without auth returns 401', async () => {
    const res = await request(app).get('/api/stats');
    expect(res.status).toBe(401);
  });

  test('GET /api/stats with auth returns stats', async () => {
    const res = await request(app)
      .get('/api/stats')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('cpu');
    expect(res.body).toHaveProperty('memory');
    expect(res.body).toHaveProperty('disk');
  });

  test('GET /api/auth/check with valid token returns valid', async () => {
    const res = await request(app)
      .get('/api/auth/check')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
  });
});
