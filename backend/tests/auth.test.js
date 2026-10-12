const request = require('supertest');
const app = require('../server');
const { executeQuery } = require('../config/database');
const describeDb = process.env.RUN_DB_TESTS === 'true' ? describe : describe.skip;

describeDb('Authentication API', () => {
  // Clean up test data before each test
  beforeEach(async() => {
    // Clean up test users
    await executeQuery('DELETE FROM users WHERE email LIKE "test_%"');
    // Clean up test organizations
    await executeQuery('DELETE FROM organizations WHERE name LIKE "Test Org%"');
  });

  describe('POST /api/auth/register', () => {
    it('should register a new user successfully', async() => {
      // First create a test organization
      const orgResult = await executeQuery(
        'INSERT INTO organizations (name, description, storage_quota, status) VALUES (?, ?, ?, ?)',
        ['Test Org', 'Test organization', 1000, 'active']
      );

      const orgId = orgResult.data.insertId;

      const userData = {
        email: 'test_user@example.com',
        password: 'TestPassword123',
        firstName: 'Test',
        lastName: 'User',
        organizationId: orgId
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('User registered successfully');
      expect(response.body.data.email).toBe(userData.email);
    });

    it('should fail to register user with invalid email', async() => {
      const userData = {
        email: 'invalid-email',
        password: 'TestPassword123',
        firstName: 'Test',
        lastName: 'User'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Validation failed');
    });

    it('should fail to register user with weak password', async() => {
      const userData = {
        email: 'test_user@example.com',
        password: '123',
        firstName: 'Test',
        lastName: 'User'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Validation failed');
    });
  });

  describe('POST /api/auth/login', () => {
    let testOrgId;

    beforeEach(async() => {
      // Create test organization
      const orgResult = await executeQuery(
        'INSERT INTO organizations (name, description, storage_quota, status) VALUES (?, ?, ?, ?)',
        ['Test Org', 'Test organization', 1000, 'active']
      );
      testOrgId = orgResult.data.insertId;

      // Create test user
      const bcrypt = require('bcrypt');
      const hashedPassword = await bcrypt.hash('TestPassword123', 12);

      await executeQuery(
        'INSERT INTO users (email, password_hash, first_name, last_name, organization_id, role, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['test_user@example.com', hashedPassword, 'Test', 'User', testOrgId, 'member', 'active']
      );
    });

    it('should login user successfully', async() => {
      const loginData = {
        email: 'test_user@example.com',
        password: 'TestPassword123'
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(loginData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Login successful');
      expect(response.body.data.token).toBeDefined();
      expect(response.body.data.user.email).toBe(loginData.email);
    });

    it('should fail to login with invalid credentials', async() => {
      const loginData = {
        email: 'test_user@example.com',
        password: 'WrongPassword'
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(loginData)
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Invalid email or password');
    });

    it('should fail to login with non-existent user', async() => {
      const loginData = {
        email: 'nonexistent@example.com',
        password: 'TestPassword123'
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(loginData)
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Invalid email or password');
    });
  });

  describe('GET /api/auth/profile', () => {
    let testToken;
    let testOrgId;

    beforeEach(async() => {
      // Create test organization
      const orgResult = await executeQuery(
        'INSERT INTO organizations (name, description, storage_quota, status) VALUES (?, ?, ?, ?)',
        ['Test Org', 'Test organization', 1000, 'active']
      );
      testOrgId = orgResult.data.insertId;

      // Create test user and get token
      const bcrypt = require('bcrypt');
      const jwt = require('jsonwebtoken');
      const hashedPassword = await bcrypt.hash('TestPassword123', 12);

      await executeQuery(
        'INSERT INTO users (email, password_hash, first_name, last_name, organization_id, role, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['test_user@example.com', hashedPassword, 'Test', 'User', testOrgId, 'member', 'active']
      );

      testToken = jwt.sign(
        {
          userId: userResult.data.insertId,
          email: 'test_user@example.com',
          role: 'member',
          organizationId: testOrgId
        },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn: '1h' }
      );
    });

    it('should get user profile successfully', async() => {
      const response = await request(app)
        .get('/api/auth/profile')
        .set('Authorization', `Bearer ${testToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.email).toBe('test_user@example.com');
      expect(response.body.data.first_name).toBe('Test');
      expect(response.body.data.last_name).toBe('User');
    });

    it('should fail to get profile without token', async() => {
      const response = await request(app)
        .get('/api/auth/profile')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Access denied. No token provided.');
    });
  });
});
