const jwt = require('jsonwebtoken');
const path = require('path');
const { executeQuery } = require('../config/database');
const { getJwtSecret } = require('../config/security');

// Verify JWT token
const verifyToken = async(req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.'
      });
    }

    const decoded = jwt.verify(token, getJwtSecret());

    if (decoded.kind !== 'access' || !decoded.sid || !decoded.userId) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token.'
      });
    }

    // Check both the current user and the server-side session so logout and
    // refresh-token reuse can revoke access immediately.
    const userResult = await executeQuery(
      `SELECT u.id, u.email, u.role, u.status, u.organization_id
       FROM users u
       INNER JOIN auth_sessions s ON s.user_id = u.id
       WHERE u.id = ?
         AND u.status = "active"
         AND s.id = ?
         AND s.revoked_at IS NULL
         AND s.expires_at > NOW()
       LIMIT 1`,
      [decoded.userId, decoded.sid]
    );

    if (!userResult.success || userResult.data.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token. User not found or inactive.'
      });
    }

    req.user = userResult.data[0];
    req.auth = decoded;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired. Please login again.'
      });
    }

    return res.status(401).json({
      success: false,
      message: 'Invalid token.'
    });
  }
};

// Check if user is admin
const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Admin role required.'
    });
  }
  next();
};

// Check if user is platform owner
const requirePlatformOwner = (req, res, next) => {
  if (req.user.role !== 'platform_owner') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Platform owner role required.'
    });
  }
  next();
};

// Check if user is organization admin or platform owner
const requireOrgAdmin = (req, res, next) => {
  if (!['organization_admin', 'platform_owner'].includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Organization admin or platform owner role required.'
    });
  }
  next();
};

// Check if user belongs to organization
const requireOrgAccess = async(req, res, next) => {
  try {
    const orgId = req.params.orgId || req.body.organizationId || req.query.organizationId;

    if (!orgId) {
      return res.status(400).json({
        success: false,
        message: 'Organization ID required.'
      });
    }

    // Platform owner has access to all organizations
    if (req.user.role === 'platform_owner') {
      return next();
    }

    // Check if user belongs to the organization
    const result = await executeQuery(
      'SELECT id FROM users WHERE id = ? AND organization_id = ?',
      [req.user.id, orgId]
    );

    if (!result.success || result.data.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not belong to this organization.'
      });
    }

    next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error checking organization access.'
    });
  }
};

const resolveFilePath = (storagePath) => {
  if (!storagePath) {
    return null;
  }
  if (path.isAbsolute(storagePath)) {
    return storagePath;
  }
  return path.resolve(__dirname, '../uploads', storagePath);
};

const setRequestFile = (req, file) => {
  req.file = {
    ...file,
    path: resolveFilePath(file.storage_path)
  };
};

const roleCanManageOrgFile = (user, file) => {
  if (user.role === 'platform_owner') {
    return true;
  }
  return user.role === 'organization_admin' && file.organization_id === user.organization_id;
};

const userOwnsFile = (user, file) => {
  return file.uploaded_by === user.id && file.organization_id === user.organization_id;
};

const findActiveShare = async(fileId, userId, allowedPermissions) => {
  const placeholders = allowedPermissions.map(() => '?').join(', ');
  const shareResult = await executeQuery(
    `SELECT permission_level
     FROM file_shares
     WHERE file_id = ?
       AND shared_with = ?
       AND status = "active"
       AND (expires_at IS NULL OR expires_at > NOW())
       AND permission_level IN (${placeholders})
     LIMIT 1`,
    [fileId, userId, ...allowedPermissions]
  );

  return shareResult.success && shareResult.data.length > 0;
};

const createFileAccessMiddleware = ({
  allowedStatuses = ['active'],
  ownerOrAdminOnly = false,
  allowedSharePermissions = ['view', 'comment', 'edit']
} = {}) => async(req, res, next) => {
  try {
    const fileId = req.params.fileId || req.params.id;

    if (!fileId) {
      return res.status(400).json({
        success: false,
        message: 'File ID required.'
      });
    }

    // Get file information
    const fileResult = await executeQuery(
      'SELECT * FROM files WHERE id = ?',
      [fileId]
    );

    if (!fileResult.success || fileResult.data.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'File not found.'
      });
    }

    const file = fileResult.data[0];

    if (allowedStatuses && !allowedStatuses.includes(file.status)) {
      return res.status(404).json({
        success: false,
        message: 'File not found.'
      });
    }

    // Platform owner has access to all files
    if (req.user.role === 'platform_owner') {
      setRequestFile(req, file);
      return next();
    }

    if (roleCanManageOrgFile(req.user, file) || userOwnsFile(req.user, file)) {
      setRequestFile(req, file);
      return next();
    }

    if (
      !ownerOrAdminOnly &&
      allowedSharePermissions.length > 0 &&
      await findActiveShare(file.id, req.user.id, allowedSharePermissions)
    ) {
      setRequestFile(req, file);
      return next();
    }

    return res.status(403).json({
      success: false,
      message: 'Access denied. You do not have permission to access this file.'
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error checking file access.'
    });
  }
};

// Read access allows owners, org admins, platform owners, and active user shares.
const requireFileAccess = createFileAccessMiddleware();

// Write access additionally allows explicit edit shares.
const requireFileWriteAccess = createFileAccessMiddleware({
  allowedSharePermissions: ['edit']
});

// Management access is limited to the owner, organization admin, or platform owner.
const requireFileOwnerOrAdmin = createFileAccessMiddleware({
  ownerOrAdminOnly: true,
  allowedSharePermissions: []
});

const requireDeletedFileOwnerOrAdmin = createFileAccessMiddleware({
  allowedStatuses: ['deleted'],
  ownerOrAdminOnly: true,
  allowedSharePermissions: []
});

module.exports = {
  verifyToken,
  requireAdmin,
  requirePlatformOwner,
  requireOrgAdmin,
  requireOrgAccess,
  requireFileAccess,
  requireFileWriteAccess,
  requireFileOwnerOrAdmin,
  requireDeletedFileOwnerOrAdmin
};
