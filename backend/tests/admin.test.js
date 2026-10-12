const request = require('supertest');
const app = require('../server');
const { executeQuery } = require('../config/database');
const describeDb = process.env.RUN_DB_TESTS === 'true' ? describe : describe.skip;

describeDb('Admin API', () => {
  let adminToken;
  let adminUserId;
  let testOrgId;

  // Set up test data before all tests
  beforeAll(async() => {
    // Create test organization
    const orgResult = await executeQuery(
      'INSERT INTO organizations (name, description, storage_quota, status) VALUES (?, ?, ?, ?)',
      ['Admin Test Org', 'Test organization for admin', 10000000000, 'active']
    );
    testOrgId = orgResult.data.insertId;

    // Create admin user and get token
    const bcrypt = require('bcrypt');
    const jwt = require('jsonwebtoken');
    const hashedPassword = await bcrypt.hash('AdminPassword123', 12);

    const adminResult = await executeQuery(
      'INSERT INTO users (email, password_hash, first_name, last_name, role, status) VALUES (?, ?, ?, ?, ?, ?)',
      ['admin@taskinsight.com', hashedPassword, 'Admin', 'User', 'platform_owner', 'active']
    );
    adminUserId = adminResult.data.insertId;

    adminToken = jwt.sign(
      {
        userId: adminUserId,
        email: 'admin@taskinsight.com',
        role: 'platform_owner'
      },
      process.env.JWT_SECRET || 'test-secret',
      { expiresIn: '1h' }
    );
  });

  // Clean up after all tests
  afterAll(async() => {
    await executeQuery('DELETE FROM users WHERE id = ?', [adminUserId]);
    await executeQuery('DELETE FROM organizations WHERE id = ?', [testOrgId]);
  });

  describe('GET /api/admin/stats', () => {
    it('should get dashboard statistics', async() => {
      const response = await request(app)
        .get('/api/admin/stats')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('totalUsers');
      expect(response.body.data).toHaveProperty('totalOrganizations');
      expect(response.body.data).toHaveProperty('totalFiles');
      expect(response.body.data).toHaveProperty('totalStorage');
    });

    it('should fail without admin authentication', async() => {
      const response = await request(app)
        .get('/api/admin/stats')
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/admin/organizations', () => {
    it('should get list of organizations', async() => {
      const response = await request(app)
        .get('/api/admin/organizations')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data.data || response.body.data)).toBe(true);
    });

    it('should support pagination', async() => {
      const response = await request(app)
        .get('/api/admin/organizations?page=1&limit=10')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      if (response.body.data.pagination) {
        expect(response.body.data.pagination).toHaveProperty('page');
        expect(response.body.data.pagination).toHaveProperty('limit');
      }
    });
  });

  describe('POST /api/admin/organizations', () => {
    it('should create a new organization', async() => {
      const orgData = {
        name: 'New Test Organization',
        description: 'Test description',
        contactEmail: 'contact@neworg.com',
        storageQuota: 10000000000,
        status: 'active'
      };

      const response = await request(app)
        .post('/api/admin/organizations')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(orgData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBe(orgData.name);

      // Clean up
      await executeQuery('DELETE FROM organizations WHERE id = ?', [response.body.data.id]);
    });

    it('should fail to create organization without required fields', async() => {
      const orgData = {
        description: 'Test description'
      };

      const response = await request(app)
        .post('/api/admin/organizations')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(orgData)
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/admin/users', () => {
    it('should get list of users', async() => {
      const response = await request(app)
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data.data || response.body.data)).toBe(true);
    });

    it('should filter users by organization', async() => {
      const response = await request(app)
        .get(`/api/admin/users?organizationId=${testOrgId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });

  describe('POST /api/admin/invitations', () => {
    it('should generate invitation codes', async() => {
      const invitationData = {
        organizationId: testOrgId,
        role: 'member',
        count: 5,
        expiresIn: 30
      };

      const response = await request(app)
        .post('/api/admin/invitations')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(invitationData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data.codes)).toBe(true);
      expect(response.body.data.codes.length).toBe(5);

      // Clean up
      for (const code of response.body.data.codes) {
        await executeQuery('DELETE FROM invitation_codes WHERE code = ?', [code]);
      }
    });

    it('should fail without organization ID', async() => {
      const invitationData = {
        role: 'member',
        count: 5
      };

      const response = await request(app)
        .post('/api/admin/invitations')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(invitationData)
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/admin/invitations', () => {
    it('should get list of invitation codes', async() => {
      const response = await request(app)
        .get('/api/admin/invitations')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data.data || response.body.data)).toBe(true);
    });
  });

  describe('GET /api/admin/activity', () => {
    it('should get recent activity logs', async() => {
      const response = await request(app)
        .get('/api/admin/activity')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should support date range filtering', async() => {
      const startDate = '2024-01-01';
      const endDate = '2024-12-31';

      const response = await request(app)
        .get(`/api/admin/activity?startDate=${startDate}&endDate=${endDate}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });

  describe('GET /api/admin/storage', () => {
    it('should get storage statistics', async() => {
      const response = await request(app)
        .get('/api/admin/storage')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('totalStorage');
      expect(response.body.data).toHaveProperty('usedStorage');
    });
  });

  describe('PUT /api/admin/organizations/:id', () => {
    it('should update an organization', async() => {
      const updateData = {
        description: 'Updated description',
        status: 'active'
      };

      const response = await request(app)
        .put(`/api/admin/organizations/${testOrgId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should fail to update non-existent organization', async() => {
      const updateData = {
        description: 'Updated description'
      };

      const response = await request(app)
        .put('/api/admin/organizations/999999')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(updateData)
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe('PUT /api/admin/users/:id/status', () => {
    let testUserId;

    beforeAll(async() => {
      // Create a test user
      const bcrypt = require('bcrypt');
      const hashedPassword = await bcrypt.hash('TestPassword123', 12);

      const userResult = await executeQuery(
        'INSERT INTO users (email, password_hash, first_name, last_name, organization_id, role, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['testuser@example.com', hashedPassword, 'Test', 'User', testOrgId, 'member', 'active']
      );
      testUserId = userResult.data.insertId;
    });

    afterAll(async() => {
      await executeQuery('DELETE FROM users WHERE id = ?', [testUserId]);
    });

    it('should update user status', async() => {
      const response = await request(app)
        .put(`/api/admin/users/${testUserId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'inactive' })
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should fail with invalid status', async() => {
      const response = await request(app)
        .put(`/api/admin/users/${testUserId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'invalid' })
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe('Authorization', () => {
    let memberToken;

    beforeAll(async() => {
      // Create a regular member user
      const bcrypt = require('bcrypt');
      const jwt = require('jsonwebtoken');
      const hashedPassword = await bcrypt.hash('MemberPassword123', 12);

      const memberResult = await executeQuery(
        'INSERT INTO users (email, password_hash, first_name, last_name, organization_id, role, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['member@example.com', hashedPassword, 'Member', 'User', testOrgId, 'member', 'active']
      );

      memberToken = jwt.sign(
        {
          userId: memberResult.data.insertId,
          email: 'member@example.com',
          role: 'member',
          organizationId: testOrgId
        },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn: '1h' }
      );

      // Clean up after test
      setTimeout(async() => {
        await executeQuery('DELETE FROM users WHERE email = ?', ['member@example.com']);
      }, 5000);
    });

    it('should deny access to admin routes for non-admin users', async() => {
      const response = await request(app)
        .get('/api/admin/stats')
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toMatch(/permission|access denied/i);
    });
  });
});
