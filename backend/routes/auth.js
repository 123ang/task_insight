const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { executeQuery, getConnection } = require('../config/database');
const { getJwtSecret } = require('../config/security');
const { verifyToken } = require('../middleware/auth');
const { validateUserRegistration, validateUserLogin } = require('../middleware/validation');
const { createSessionTokens, tokenHashesMatch } = require('../utils/authSessions');
const { logger } = require('../utils/logger');

const router = express.Router();
const REFRESH_COOKIE = 'dms_refresh_token';

const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/api/auth'
});

const readCookie = (req, name) => {
  const header = req.headers.cookie;
  if (!header) {
    return null;
  }

  const prefix = `${name}=`;
  const pair = header.split(';').map((value) => value.trim())
    .find((value) => value.startsWith(prefix));

  return pair ? decodeURIComponent(pair.slice(prefix.length)) : null;
};

const clearRefreshCookie = (res) => {
  res.clearCookie(REFRESH_COOKIE, cookieOptions());
};

const setRefreshCookie = (res, token, expiresAt) => {
  res.cookie(REFRESH_COOKIE, token, {
    ...cookieOptions(),
    expires: expiresAt
  });
};

const publicUser = (user) => ({
  id: user.id,
  email: user.email,
  firstName: user.first_name,
  lastName: user.last_name,
  role: user.role,
  organizationId: user.organization_id,
  organizationName: user.organization_name,
  status: user.status
});

const registrationError = (message, status = 400) => {
  const error = new Error(message);
  error.status = status;
  error.isPublic = true;
  return error;
};

router.post('/register', validateUserRegistration, async(req, res) => {
  const { email, password, firstName, lastName, invitationCode } = req.body;

  if (!invitationCode || !invitationCode.trim()) {
    return res.status(400).json({
      success: false,
      message: 'A valid invitation code is required'
    });
  }

  let connection;
  try {
    connection = await getConnection();
    await connection.beginTransaction();

    const [existingUsers] = await connection.execute(
      'SELECT id FROM users WHERE email = ? FOR UPDATE',
      [email]
    );
    if (existingUsers.length > 0) {
      throw registrationError('User with this email already exists');
    }

    const [invitations] = await connection.execute(
      `SELECT i.id, i.organization_id, i.role, i.expires_at, i.max_uses, i.use_count,
              i.revoked_at, o.status AS organization_status
       FROM invitation_codes i
       INNER JOIN organizations o ON o.id = i.organization_id
       WHERE i.code = ?
       LIMIT 1
       FOR UPDATE`,
      [invitationCode.trim().toUpperCase()]
    );

    const invitation = invitations[0];
    if (
      !invitation ||
      invitation.revoked_at ||
      invitation.organization_status !== 'active' ||
      new Date(invitation.expires_at) <= new Date() ||
      Number(invitation.use_count) >= Number(invitation.max_uses)
    ) {
      throw registrationError('Invitation code is invalid, expired, or fully used');
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const [userResult] = await connection.execute(
      `INSERT INTO users
        (email, password_hash, first_name, last_name, organization_id, role, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        email,
        hashedPassword,
        firstName,
        lastName,
        invitation.organization_id,
        invitation.role || 'member',
        'active'
      ]
    );

    const [consumeResult] = await connection.execute(
      `UPDATE invitation_codes
       SET use_count = use_count + 1
       WHERE id = ?
         AND revoked_at IS NULL
         AND use_count < max_uses`,
      [invitation.id]
    );
    if (consumeResult.affectedRows !== 1) {
      throw registrationError('Invitation code is no longer available');
    }

    await connection.execute(
      `INSERT INTO audit_logs
        (user_id, organization_id, action, resource_type, resource_id, details)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        userResult.insertId,
        invitation.organization_id,
        'CREATE',
        'USER',
        userResult.insertId,
        JSON.stringify({
          email,
          organizationId: invitation.organization_id,
          invitationId: invitation.id
        })
      ]
    );

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        userId: userResult.insertId,
        email,
        firstName,
        lastName
      }
    });
  } catch (error) {
    if (connection) {
      await connection.rollback().catch(() => { /* keep the original error */ });
    }

    if (error.isPublic) {
      return res.status(error.status).json({
        success: false,
        message: error.message
      });
    }

    logger.error('Registration error', { error: logger.serializeError(error) });
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  } finally {
    connection?.release();
  }
});

router.post('/login', validateUserLogin, async(req, res) => {
  try {
    const { email, password, adminLogin } = req.body;
    const userResult = await executeQuery(
      `SELECT u.*, o.name AS organization_name
       FROM users u
       LEFT JOIN organizations o ON u.organization_id = o.id
       WHERE u.email = ?`,
      [email]
    );

    if (!userResult.success || userResult.data.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const user = userResult.data[0];
    if (user.status !== 'active') {
      return res.status(401).json({
        success: false,
        message: 'Account is inactive. Please contact support.'
      });
    }

    if (!await bcrypt.compare(password, user.password_hash)) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    if (adminLogin && !['organization_admin', 'platform_owner'].includes(user.role)) {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }

    const tokens = createSessionTokens({ user, secret: getJwtSecret() });
    const sessionResult = await executeQuery(
      `INSERT INTO auth_sessions (id, user_id, token_hash, expires_at)
       VALUES (?, ?, ?, ?)`,
      [
        tokens.session.id,
        tokens.session.userId,
        tokens.session.tokenHash,
        tokens.session.expiresAt
      ]
    );
    if (!sessionResult.success) {
      throw new Error('Failed to create authentication session');
    }

    await executeQuery('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);
    await executeQuery(
      `INSERT INTO audit_logs
        (user_id, organization_id, action, resource_type, resource_id, details)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        user.id,
        user.organization_id,
        'LOGIN',
        'USER',
        user.id,
        JSON.stringify({ email, adminLogin: !!adminLogin })
      ]
    );

    setRefreshCookie(res, tokens.refreshToken, tokens.session.expiresAt);
    return res.json({
      success: true,
      message: 'Login successful',
      data: {
        token: tokens.accessToken,
        user: publicUser(user)
      }
    });
  } catch (error) {
    logger.error('Login error', { error: logger.serializeError(error) });
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

router.post('/refresh', async(req, res) => {
  const refreshToken = readCookie(req, REFRESH_COOKIE);
  if (!refreshToken) {
    clearRefreshCookie(res);
    return res.status(401).json({ success: false, message: 'Refresh session required' });
  }

  try {
    const decoded = jwt.verify(refreshToken, getJwtSecret());
    if (decoded.kind !== 'refresh' || !decoded.sid || !decoded.userId) {
      throw new Error('Invalid refresh token type');
    }

    const sessionResult = await executeQuery(
      `SELECT s.id, s.user_id, s.token_hash, s.expires_at, s.revoked_at,
              s.replaced_by_session_id, u.email, u.first_name, u.last_name, u.role,
              u.organization_id, u.status, o.name AS organization_name
       FROM auth_sessions s
       INNER JOIN users u ON u.id = s.user_id
       LEFT JOIN organizations o ON o.id = u.organization_id
       WHERE s.id = ? AND s.user_id = ?
       LIMIT 1`,
      [decoded.sid, decoded.userId]
    );
    const session = sessionResult.success ? sessionResult.data[0] : null;

    if (
      !session ||
      session.status !== 'active' ||
      session.revoked_at ||
      new Date(session.expires_at) <= new Date() ||
      !tokenHashesMatch(refreshToken, session.token_hash)
    ) {
      if (session?.replaced_by_session_id) {
        await executeQuery(
          'UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, NOW()) WHERE id IN (?, ?)',
          [session.id, session.replaced_by_session_id]
        );
      }
      clearRefreshCookie(res);
      return res.status(401).json({ success: false, message: 'Refresh session is invalid' });
    }

    const user = {
      id: session.user_id,
      email: session.email,
      first_name: session.first_name,
      last_name: session.last_name,
      role: session.role,
      organization_id: session.organization_id,
      organization_name: session.organization_name,
      status: session.status
    };
    const nextTokens = createSessionTokens({ user, secret: getJwtSecret() });
    const connection = await getConnection();

    try {
      await connection.beginTransaction();
      const [revokeResult] = await connection.execute(
        `UPDATE auth_sessions
         SET revoked_at = NOW(), replaced_by_session_id = ?
         WHERE id = ? AND revoked_at IS NULL`,
        [nextTokens.session.id, session.id]
      );
      if (revokeResult.affectedRows !== 1) {
        throw new Error('Refresh session was already rotated');
      }

      await connection.execute(
        `INSERT INTO auth_sessions (id, user_id, token_hash, expires_at)
         VALUES (?, ?, ?, ?)`,
        [
          nextTokens.session.id,
          nextTokens.session.userId,
          nextTokens.session.tokenHash,
          nextTokens.session.expiresAt
        ]
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => { /* keep the original error */ });
      throw error;
    } finally {
      connection.release();
    }

    setRefreshCookie(res, nextTokens.refreshToken, nextTokens.session.expiresAt);
    return res.json({
      success: true,
      message: 'Token refreshed successfully',
      data: {
        token: nextTokens.accessToken,
        user: publicUser(user)
      }
    });
  } catch (error) {
    clearRefreshCookie(res);
    return res.status(401).json({
      success: false,
      message: error.name === 'TokenExpiredError'
        ? 'Refresh session expired'
        : 'Refresh session is invalid'
    });
  }
});

router.post('/logout', async(req, res) => {
  const refreshToken = readCookie(req, REFRESH_COOKIE);

  try {
    if (refreshToken) {
      const decoded = jwt.verify(refreshToken, getJwtSecret());
      if (decoded.kind === 'refresh' && decoded.sid && decoded.userId) {
        await executeQuery(
          `UPDATE auth_sessions
           SET revoked_at = COALESCE(revoked_at, NOW())
           WHERE id = ? AND user_id = ?`,
          [decoded.sid, decoded.userId]
        );
      }
    }
  } catch (error) {
    logger.debug('Logout received an expired or invalid refresh cookie');
  } finally {
    clearRefreshCookie(res);
  }

  return res.json({ success: true, message: 'Logout successful' });
});

router.get('/profile', verifyToken, async(req, res) => {
  try {
    const userResult = await executeQuery(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.status,
              u.created_at, u.last_login, o.name AS organization_name
       FROM users u
       LEFT JOIN organizations o ON u.organization_id = o.id
       WHERE u.id = ?`,
      [req.user.id]
    );

    if (!userResult.success || userResult.data.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    return res.json({ success: true, data: userResult.data[0] });
  } catch (error) {
    logger.error('Profile error', { error: logger.serializeError(error) });
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

router.get('/verify', verifyToken, (req, res) => {
  res.json({
    success: true,
    message: 'Token is valid',
    data: { user: req.user }
  });
});

module.exports = router;
