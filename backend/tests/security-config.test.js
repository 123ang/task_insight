describe('security configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('rejects missing or weak JWT secrets outside tests', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET;

    const { getJwtSecret } = require('../config/security');

    expect(() => getJwtSecret()).toThrow(/JWT_SECRET/);

    process.env.JWT_SECRET = 'short';
    expect(() => getJwtSecret()).toThrow(/JWT_SECRET/);
  });

  it('requires explicit CORS origins in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.CORS_ORIGIN;
    delete process.env.CORS_ORIGINS;

    const { getAllowedCorsOrigins } = require('../config/security');

    expect(() => getAllowedCorsOrigins()).toThrow(/CORS/);
  });

  it('allows only configured production origins', () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGINS = 'https://taskinsight.my,https://app.taskinsight.my';

    const { getAllowedCorsOrigins, isOriginAllowed } = require('../config/security');
    const origins = getAllowedCorsOrigins();

    expect(origins).toEqual(['https://taskinsight.my', 'https://app.taskinsight.my']);
    expect(isOriginAllowed('https://taskinsight.my', origins)).toBe(true);
    expect(isOriginAllowed('http://localhost:3000', origins)).toBe(false);
  });
});
