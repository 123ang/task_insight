const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');

jest.mock('../config/database', () => ({
  executeQuery: jest.fn(),
  getConnection: jest.fn()
}));

jest.mock('bcrypt', () => ({
  compare: jest.fn(async() => true),
  hash: jest.fn(async() => 'hashed-password')
}));

const { executeQuery, getConnection } = require('../config/database');
const bcrypt = require('bcrypt');
const authRouter = require('../routes/auth');

const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);

const user = {
  id: 7,
  email: 'member@example.com',
  password_hash: '$2b$12$VzpoUn7kI16.wtnXK6w3oOtCb8FKjSKFGqD3z57VbFDt0CaXNpNfG',
  first_name: 'Test',
  last_name: 'Member',
  role: 'member',
  organization_id: 12,
  organization_name: 'Example Org',
  status: 'active'
};

const success = (data = []) => ({ success: true, data });

const createConnection = (handler) => ({
  beginTransaction: jest.fn(async() => { /* no-op */ }),
  commit: jest.fn(async() => { /* no-op */ }),
  rollback: jest.fn(async() => { /* no-op */ }),
  release: jest.fn(),
  execute: jest.fn(async(sql, params = []) => {
    const result = await handler(sql, params);
    return [result.data || result, []];
  })
});

describe('authentication security routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    bcrypt.compare.mockResolvedValue(true);
    bcrypt.hash.mockResolvedValue('hashed-password');
  });

  it('issues the refresh token only as a secure HttpOnly cookie and stores the session', async() => {
    executeQuery.mockImplementation(async(sql) => {
      if (sql.includes('FROM users u')) {
        return success([user]);
      }
      return success({ insertId: 1, affectedRows: 1 });
    });

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: 'TestPassword123' });

    expect(response.status).toBe(200);

    expect(response.body.data.token).toEqual(expect.any(String));
    expect(response.body.data.refreshToken).toBeUndefined();
    expect(response.headers['set-cookie']?.[0]).toEqual(expect.stringContaining('HttpOnly'));
    expect(response.headers['set-cookie']?.[0]).toEqual(expect.stringContaining('SameSite=Strict'));
    expect(executeQuery.mock.calls.some(([sql]) => sql.includes('INSERT INTO auth_sessions'))).toBe(true);
  });

  it('rejects public registration that supplies only an organization ID', async() => {
    executeQuery.mockResolvedValue(success({ insertId: 44, affectedRows: 1 }));

    const response = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'new@example.com',
        password: 'TestPassword123',
        firstName: 'New',
        lastName: 'Member',
        organizationId: 12
      })
      .expect(400);

    expect(response.body.message).toMatch(/invitation/i);
  });

  it('consumes a valid invitation atomically when registration succeeds', async() => {
    const handler = async(sql) => {
      if (sql.includes('FROM users WHERE email')) {
        return success([]);
      }
      if (sql.includes('FROM invitation_codes')) {
        return success([{
          id: 30,
          organization_id: 12,
          role: 'member',
          expires_at: new Date(Date.now() + 60_000),
          max_uses: 1,
          use_count: 0,
          revoked_at: null,
          organization_status: 'active'
        }]);
      }
      if (sql.includes('INSERT INTO users')) {
        return success({ insertId: 44, affectedRows: 1 });
      }
      return success({ affectedRows: 1 });
    };
    const connection = createConnection(handler);

    executeQuery.mockImplementation(handler);
    getConnection.mockResolvedValue(connection);

    await request(app)
      .post('/api/auth/register')
      .send({
        email: 'new@example.com',
        password: 'TestPassword123',
        firstName: 'New',
        lastName: 'Member',
        invitationCode: 'INVITE123456'
      })
      .expect(201);

    const allSql = [
      ...executeQuery.mock.calls.map(([sql]) => sql),
      ...connection.execute.mock.calls.map(([sql]) => sql)
    ];
    expect(allSql.some((sql) => (
      sql.includes('UPDATE invitation_codes') && sql.includes('use_count')
    ))).toBe(true);
    expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  it('revokes the refresh session when logging out with only the cookie', async() => {
    const refreshToken = jwt.sign(
      { userId: user.id, sid: 'session-123', kind: 'refresh' },
      'test-secret',
      { expiresIn: '7d' }
    );
    executeQuery.mockResolvedValue(success({ affectedRows: 1 }));

    const response = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', `dms_refresh_token=${refreshToken}`)
      .expect(200);

    expect(response.headers['set-cookie']?.[0]).toEqual(expect.stringContaining('Expires=Thu, 01 Jan 1970'));
    expect(executeQuery.mock.calls.some(([sql]) => (
      sql.includes('UPDATE auth_sessions') && sql.includes('revoked_at')
    ))).toBe(true);
  });
});
