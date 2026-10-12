const request = require('supertest');
const app = require('../server');

describe('critical API route authentication', () => {
  const protectedReads = [
    ['/api/users', 'users'],
    ['/api/organizations', 'organizations'],
    ['/api/files', 'files'],
    ['/api/files/folders/list', 'folders'],
    ['/api/audit', 'audit'],
    ['/api/reminders', 'reminders']
  ];

  it.each(protectedReads)(
    'rejects unauthenticated access to %s (%s)',
    async(path) => {
      const response = await request(app).get(path).expect(401);

      expect(response.body).toEqual(expect.objectContaining({
        success: false
      }));
    }
  );
});
