const request = require('supertest');
const app = require('../server');
const { executeQuery } = require('../config/database');
const fs = require('fs');
const path = require('path');
const describeDb = process.env.RUN_DB_TESTS === 'true' ? describe : describe.skip;

describeDb('Files API', () => {
  let testToken;
  let testOrgId;
  let testUserId;

  // Set up test data before all tests
  beforeAll(async() => {
    // Create test organization
    const orgResult = await executeQuery(
      'INSERT INTO organizations (name, description, storage_quota, status) VALUES (?, ?, ?, ?)',
      ['Test Org Files', 'Test organization for files', 10000000000, 'active']
    );
    testOrgId = orgResult.data.insertId;

    // Create test user and get token
    const bcrypt = require('bcrypt');
    const jwt = require('jsonwebtoken');
    const hashedPassword = await bcrypt.hash('TestPassword123', 12);

    const userResult = await executeQuery(
      'INSERT INTO users (email, password_hash, first_name, last_name, organization_id, role, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['test_files@example.com', hashedPassword, 'Test', 'Files', testOrgId, 'member', 'active']
    );
    testUserId = userResult.data.insertId;

    testToken = jwt.sign(
      {
        userId: testUserId,
        email: 'test_files@example.com',
        role: 'member',
        organizationId: testOrgId
      },
      process.env.JWT_SECRET || 'test-secret',
      { expiresIn: '1h' }
    );
  });

  // Clean up after all tests
  afterAll(async() => {
    await executeQuery('DELETE FROM files WHERE organization_id = ?', [testOrgId]);
    await executeQuery('DELETE FROM folders WHERE organization_id = ?', [testOrgId]);
    await executeQuery('DELETE FROM users WHERE id = ?', [testUserId]);
    await executeQuery('DELETE FROM organizations WHERE id = ?', [testOrgId]);
  });

  describe('POST /api/files/upload', () => {
    it('should upload a file successfully', async() => {
      const testFilePath = path.join(__dirname, 'test-file.txt');
      fs.writeFileSync(testFilePath, 'Test file content');

      const response = await request(app)
        .post('/api/files/upload')
        .set('Authorization', `Bearer ${testToken}`)
        .attach('file', testFilePath)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('File uploaded successfully');
      expect(response.body.data.file_name).toBe('test-file.txt');

      // Clean up
      fs.unlinkSync(testFilePath);
      if (response.body.data.file_path) {
        const uploadedFilePath = path.join(__dirname, '..', response.body.data.file_path);
        if (fs.existsSync(uploadedFilePath)) {
          fs.unlinkSync(uploadedFilePath);
        }
      }
    });

    it('should fail to upload without authentication', async() => {
      const testFilePath = path.join(__dirname, 'test-file.txt');
      fs.writeFileSync(testFilePath, 'Test file content');

      const response = await request(app)
        .post('/api/files/upload')
        .attach('file', testFilePath)
        .expect(401);

      expect(response.body.success).toBe(false);

      // Clean up
      fs.unlinkSync(testFilePath);
    });

    it('should fail to upload without file', async() => {
      const response = await request(app)
        .post('/api/files/upload')
        .set('Authorization', `Bearer ${testToken}`)
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/files', () => {
    let testFileId;

    beforeAll(async() => {
      // Create a test file entry
      const fileResult = await executeQuery(
        'INSERT INTO files (file_name, file_type, file_size, file_path, organization_id, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)',
        ['test-document.pdf', 'pdf', 1024, '/uploads/test.pdf', testOrgId, testUserId]
      );
      testFileId = fileResult.data.insertId;
    });

    afterAll(async() => {
      await executeQuery('DELETE FROM files WHERE id = ?', [testFileId]);
    });

    it('should get list of files', async() => {
      const response = await request(app)
        .get('/api/files')
        .set('Authorization', `Bearer ${testToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data.files || response.body.data.data)).toBe(true);
    });

    it('should fail to get files without authentication', async() => {
      const response = await request(app)
        .get('/api/files')
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/files/stats', () => {
    it('should get file statistics', async() => {
      const response = await request(app)
        .get('/api/files/stats')
        .set('Authorization', `Bearer ${testToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('totalFiles');
      expect(response.body.data).toHaveProperty('totalSize');
    });
  });

  describe('POST /api/files/folders', () => {
    it('should create a new folder', async() => {
      const folderData = {
        folderName: 'Test Folder',
        parentId: null
      };

      const response = await request(app)
        .post('/api/files/folders')
        .set('Authorization', `Bearer ${testToken}`)
        .send(folderData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.folder_name).toBe('Test Folder');

      // Clean up
      await executeQuery('DELETE FROM folders WHERE id = ?', [response.body.data.id]);
    });

    it('should fail to create folder without name', async() => {
      const folderData = {
        parentId: null
      };

      const response = await request(app)
        .post('/api/files/folders')
        .set('Authorization', `Bearer ${testToken}`)
        .send(folderData)
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/files/folders', () => {
    it('should get list of folders', async() => {
      const response = await request(app)
        .get('/api/files/folders')
        .set('Authorization', `Bearer ${testToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });
  });

  describe('DELETE /api/files/:id', () => {
    let testFileId;

    beforeEach(async() => {
      // Create a test file entry
      const fileResult = await executeQuery(
        'INSERT INTO files (file_name, file_type, file_size, file_path, organization_id, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)',
        ['delete-test.pdf', 'pdf', 1024, '/uploads/delete-test.pdf', testOrgId, testUserId]
      );
      testFileId = fileResult.data.insertId;
    });

    it('should delete a file successfully', async() => {
      const response = await request(app)
        .delete(`/api/files/${testFileId}`)
        .set('Authorization', `Bearer ${testToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should fail to delete non-existent file', async() => {
      const response = await request(app)
        .delete('/api/files/999999')
        .set('Authorization', `Bearer ${testToken}`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe('PUT /api/files/:id/rename', () => {
    let testFileId;

    beforeAll(async() => {
      // Create a test file entry
      const fileResult = await executeQuery(
        'INSERT INTO files (file_name, file_type, file_size, file_path, organization_id, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)',
        ['rename-test.pdf', 'pdf', 1024, '/uploads/rename-test.pdf', testOrgId, testUserId]
      );
      testFileId = fileResult.data.insertId;
    });

    afterAll(async() => {
      await executeQuery('DELETE FROM files WHERE id = ?', [testFileId]);
    });

    it('should rename a file successfully', async() => {
      const response = await request(app)
        .put(`/api/files/${testFileId}/rename`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({ fileName: 'renamed-file.pdf' })
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should fail to rename without new name', async() => {
      const response = await request(app)
        .put(`/api/files/${testFileId}/rename`)
        .set('Authorization', `Bearer ${testToken}`)
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });
});
