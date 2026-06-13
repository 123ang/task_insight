const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const DEFAULT_ACCESS_LIFETIME = '1h';
const DEFAULT_REFRESH_LIFETIME = '7d';

const parseDurationMs = (value, fallback) => {
  const input = String(value || fallback).trim().toLowerCase();
  const match = input.match(/^(\d+)(ms|s|m|h|d)$/);

  if (!match) {
    throw new Error(`Unsupported token lifetime: ${input}`);
  }

  const amount = Number(match[1]);
  const multipliers = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return amount * multipliers[match[2]];
};

const hashRefreshToken = (token) => (
  crypto.createHash('sha256').update(token).digest('hex')
);

const tokenHashesMatch = (token, expectedHash) => {
  if (!token || !expectedHash) return false;

  const actual = Buffer.from(hashRefreshToken(token), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');

  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
};

const createSessionTokens = ({
  user,
  secret,
  accessLifetime = process.env.JWT_EXPIRES_IN || DEFAULT_ACCESS_LIFETIME,
  refreshLifetime = process.env.JWT_REFRESH_EXPIRES_IN || DEFAULT_REFRESH_LIFETIME,
  sessionId = crypto.randomUUID(),
}) => {
  const accessToken = jwt.sign(
    {
      kind: 'access',
      sid: sessionId,
      userId: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organization_id,
    },
    secret,
    { expiresIn: accessLifetime }
  );
  const refreshToken = jwt.sign(
    {
      kind: 'refresh',
      sid: sessionId,
      userId: user.id,
    },
    secret,
    { expiresIn: refreshLifetime }
  );

  return {
    accessToken,
    refreshToken,
    session: {
      id: sessionId,
      userId: user.id,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: new Date(Date.now() + parseDurationMs(refreshLifetime, DEFAULT_REFRESH_LIFETIME)),
    },
  };
};

module.exports = {
  createSessionTokens,
  hashRefreshToken,
  parseDurationMs,
  tokenHashesMatch,
};
