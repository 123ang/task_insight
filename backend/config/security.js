const PLACEHOLDER_SECRET_PATTERNS = [
  /change[-_ ]?me/i,
  /your[-_ ]?secret/i,
  /secret[-_ ]?key/i,
  /test[-_ ]?secret/i,
  /^jwt$/i
];

const DEFAULT_DEV_ORIGINS = ['http://localhost:3000'];
const MIN_JWT_SECRET_LENGTH = 32;

const parseList = (value) => (value || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

const isTest = () => process.env.NODE_ENV === 'test';
const isProduction = () => process.env.NODE_ENV === 'production';

const isWeakJwtSecret = (secret) => (
  !secret ||
  secret.length < MIN_JWT_SECRET_LENGTH ||
  PLACEHOLDER_SECRET_PATTERNS.some((pattern) => pattern.test(secret))
);

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;

  if (isTest() && !secret) {
    return 'test-secret';
  }

  if (isWeakJwtSecret(secret)) {
    throw new Error(`JWT_SECRET must be set to a strong non-placeholder value of at least ${MIN_JWT_SECRET_LENGTH} characters`);
  }

  return secret;
};

const getAllowedCorsOrigins = () => {
  const configured = [
    ...parseList(process.env.CORS_ORIGINS),
    ...parseList(process.env.CORS_ORIGIN)
  ];
  const origins = [...new Set(configured)];

  if (origins.length > 0) {
    return origins;
  }

  if (isProduction()) {
    throw new Error('CORS_ORIGINS or CORS_ORIGIN must be set in production');
  }

  return DEFAULT_DEV_ORIGINS;
};

const isOriginAllowed = (origin, allowedOrigins = getAllowedCorsOrigins()) => {
  if (!origin) {
    return true;
  }

  return allowedOrigins.includes(origin);
};

const getFrameAncestors = () => {
  const origins = getAllowedCorsOrigins();
  return ['\'self\'', ...origins];
};

const validateDatabaseEnvironment = () => {
  if (isTest()) {
    return;
  }

  const missing = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']
    .filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required database environment values: ${missing.join(', ')}`);
  }

  if (process.env.DB_USER === 'root' || process.env.DB_PASSWORD === '') {
    throw new Error('Database credentials must not use root or an empty password');
  }
};

const validateRequiredSecurityConfig = () => {
  getJwtSecret();
  getAllowedCorsOrigins();
  validateDatabaseEnvironment();
};

module.exports = {
  getAllowedCorsOrigins,
  getFrameAncestors,
  getJwtSecret,
  isOriginAllowed,
  validateDatabaseEnvironment,
  validateRequiredSecurityConfig
};
