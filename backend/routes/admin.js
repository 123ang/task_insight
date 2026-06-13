const express = require('express');
const { executeQuery } = require('../config/database');
const { verifyToken, requirePlatformOwner, requireOrgAdmin } = require('../middleware/auth');
const { validatePagination, validateSearch, validateDateRange } = require('../middleware/validation');
const { generateInvitationCode } = require('../utils/helpers');

const router = express.Router();

// Dashboard statistics
router.get('/dashboard/stats', verifyToken, requirePlatformOwner, async (req, res) => {
  try {
    // Get platform overview statistics
    const platformStats = await executeQuery(`
      SELECT 
        (SELECT COUNT(*) FROM organizations WHERE status = 'active') as active_organizations,
        (SELECT COUNT(*) FROM users WHERE status = 'active') as active_users,
        (SELECT COUNT(*) FROM files WHERE status = 'active') as total_files,
        (SELECT COALESCE(SUM(file_size), 0) FROM files WHERE status = 'active') as total_storage_used,
        (SELECT SUM(storage_quota) FROM organizations WHERE status = 'active') as total_storage_quota
    `);

    // Get recent activity (last 7 days)
    const recentActivity = await executeQuery(`
      SELECT action, COUNT(*) as count, DATE(created_at) as date
      FROM audit_logs 
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY action, DATE(created_at)
      ORDER BY date DESC
    `);

    // Get user registrations by day (last 30 days)
    const userRegistrations = await executeQuery(`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM users 
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `);

    // Get organization creation by day (last 30 days)
    const orgCreations = await executeQuery(`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM organizations 
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `);

    // Get top organizations by storage usage
    const topOrgsByStorage = await executeQuery(`
      SELECT o.name, o.id, 
             COALESCE(SUM(f.file_size), 0) as storage_used,
             o.storage_quota as storage_quota,
             ROUND((COALESCE(SUM(f.file_size), 0) / o.storage_quota) * 100, 2) as usage_percentage
      FROM organizations o
      LEFT JOIN files f ON o.id = f.organization_id AND f.status = 'active'
      WHERE o.status = 'active'
      GROUP BY o.id, o.name, o.storage_quota
      ORDER BY storage_used DESC
      LIMIT 10
    `);

    // Get system health metrics
    const systemHealth = await executeQuery(`
      SELECT 
        (SELECT COUNT(*) FROM users WHERE status = 'active' AND last_login >= DATE_SUB(NOW(), INTERVAL 30 DAY)) as active_users_30d,
        (SELECT COUNT(*) FROM files WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)) as files_uploaded_7d,
        (SELECT COUNT(*) FROM organizations WHERE status = 'active') as total_organizations,
        (SELECT COUNT(*) FROM audit_logs WHERE created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)) as daily_activity
    `);

    if (!platformStats.success || !recentActivity.success || !userRegistrations.success || 
        !orgCreations.success || !topOrgsByStorage.success || !systemHealth.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch dashboard statistics'
      });
    }

    res.json({
      success: true,
      data: {
        platformStats: platformStats.data[0],
        recentActivity: recentActivity.data,
        userRegistrations: userRegistrations.data,
        organizationCreations: orgCreations.data,
        topOrganizationsByStorage: topOrgsByStorage.data,
        systemHealth: systemHealth.data[0]
      }
    });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get recent activity timeline
router.get('/activity/timeline', verifyToken, requirePlatformOwner, validatePagination, async (req, res) => {
  try {
    const { page = 1, limit = 20, action, userId, organizationId } = req.query;
    const offset = (page - 1) * limit;

    let whereConditions = [];
    let queryParams = [];

    // Filter by action
    if (action) {
      whereConditions.push('al.action = ?');
      queryParams.push(action);
    }

    // Filter by user
    if (userId) {
      whereConditions.push('al.user_id = ?');
      queryParams.push(userId);
    }

    // Filter by organization
    if (organizationId) {
      whereConditions.push('u.organization_id = ?');
      queryParams.push(organizationId);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const activityQuery = `
      SELECT al.*, u.first_name, u.last_name, u.email, o.name as organization_name
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      LEFT JOIN organizations o ON u.organization_id = o.id
      ${whereClause}
      ORDER BY al.created_at DESC
      LIMIT ${parseInt(limit)} OFFSET ${offset}
    `;

    const activityResult = await executeQuery(activityQuery, queryParams);

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total 
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      ${whereClause}
    `;

    const countResult = await executeQuery(countQuery, queryParams);

    if (!activityResult.success || !countResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch activity timeline'
      });
    }

    res.json({
      success: true,
      data: {
        data: activityResult.data,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: countResult.data[0].total,
          pages: Math.ceil(countResult.data[0].total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get activity timeline error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Generate invitation code
router.post('/invitations/generate', verifyToken, requirePlatformOwner, async (req, res) => {
  try {
    const { organizationId, role = 'member', expiresInDays = 7, maxUses = 1 } = req.body;
    const normalizedExpiresInDays = Math.min(Math.max(parseInt(expiresInDays, 10) || 7, 1), 365);
    const normalizedMaxUses = Math.min(Math.max(parseInt(maxUses, 10) || 1, 1), 100);

    if (!['member', 'organization_admin'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Role must be either member or organization_admin'
      });
    }

    // Validate organization
    const orgResult = await executeQuery(
      'SELECT id, name FROM organizations WHERE id = ? AND status = "active"',
      [organizationId]
    );

    if (!orgResult.success || orgResult.data.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Organization not found'
      });
    }

    let code;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const candidate = generateInvitationCode();
      const codeResult = await executeQuery(
        'SELECT id FROM invitation_codes WHERE code = ?',
        [candidate]
      );
      if (codeResult.success && codeResult.data.length === 0) {
        code = candidate;
        break;
      }
    }

    if (!code) {
      return res.status(500).json({
        success: false,
        message: 'Failed to generate a unique invitation code'
      });
    }

    const expiresAt = new Date(Date.now() + normalizedExpiresInDays * 24 * 60 * 60 * 1000);

    // Keep one active invitation per organization for the current admin UI.
    await executeQuery(
      'UPDATE invitation_codes SET revoked_at = NOW() WHERE organization_id = ? AND revoked_at IS NULL',
      [organizationId]
    );

    const invitationResult = await executeQuery(
      `INSERT INTO invitation_codes
        (code, organization_id, role, expires_at, max_uses, generated_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [code, organizationId, role, expiresAt, normalizedMaxUses, req.user.id]
    );

    if (!invitationResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to generate invitation code'
      });
    }

    // Log invitation creation
    await executeQuery(
      'INSERT INTO audit_logs (user_id, organization_id, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, organizationId, 'CREATE', 'INVITATION', organizationId, JSON.stringify({ code, organizationId, role, expiresAt })]
    );

    res.status(201).json({
      success: true,
      message: 'Invitation code generated successfully',
      data: {
        invitationId: invitationResult.data.insertId,
        code,
        organizationId,
        organizationName: orgResult.data[0].name,
        role,
        expiresAt,
        maxUses: normalizedMaxUses,
        useCount: 0
      }
    });
  } catch (error) {
    console.error('Generate invitation error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get all active invitations.
router.get('/invitations', verifyToken, requirePlatformOwner, validatePagination, validateSearch, async (req, res) => {
  try {
    const { page = 1, limit = 10, q: search, organizationId } = req.query;
    const offset = (page - 1) * limit;

    let whereConditions = ['i.revoked_at IS NULL'];
    let queryParams = [];

    // Search filter
    if (search) {
      whereConditions.push('(i.code LIKE ? OR o.name LIKE ?)');
      const searchPattern = `%${search}%`;
      queryParams.push(searchPattern, searchPattern);
    }

    // Organization filter
    if (organizationId) {
      whereConditions.push('i.organization_id = ?');
      queryParams.push(organizationId);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const invitationsQuery = `
      SELECT i.id, i.organization_id, o.name as organization_name,
             i.code, i.role, i.expires_at, i.max_uses, i.use_count,
             i.generated_by, i.created_at,
             CASE
               WHEN i.expires_at <= NOW() THEN 'expired'
               WHEN i.use_count >= i.max_uses THEN 'used'
               ELSE 'active'
             END AS status,
             u.first_name, u.last_name
      FROM invitation_codes i
      INNER JOIN organizations o ON o.id = i.organization_id
      LEFT JOIN users u ON i.generated_by = u.id
      ${whereClause}
      ORDER BY i.created_at DESC
      LIMIT ${parseInt(limit)} OFFSET ${offset}
    `;

    const invitationsResult = await executeQuery(invitationsQuery, queryParams);

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total 
      FROM invitation_codes i
      INNER JOIN organizations o ON o.id = i.organization_id
      ${whereClause}
    `;

    const countResult = await executeQuery(countQuery, queryParams);

    if (!invitationsResult.success || !countResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch invitations'
      });
    }

    res.json({
      success: true,
      data: {
        data: invitationsResult.data,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: countResult.data[0].total,
          pages: Math.ceil(countResult.data[0].total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get invitations error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Revoke the active invitation for an organization.
router.delete('/invitations/:organizationId', verifyToken, requirePlatformOwner, async (req, res) => {
  try {
    const { organizationId } = req.params;

    const invitationResult = await executeQuery(
      `SELECT i.id, i.code
       FROM invitation_codes i
       WHERE i.organization_id = ? AND i.revoked_at IS NULL
       ORDER BY i.created_at DESC
       LIMIT 1`,
      [organizationId]
    );

    if (!invitationResult.success || invitationResult.data.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Active invitation not found'
      });
    }

    const deleteResult = await executeQuery(
      'UPDATE invitation_codes SET revoked_at = NOW() WHERE organization_id = ? AND revoked_at IS NULL',
      [organizationId]
    );

    if (!deleteResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to delete invitation'
      });
    }

    // Log deletion
    await executeQuery(
      'INSERT INTO audit_logs (user_id, organization_id, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, parseInt(organizationId), 'DELETE', 'INVITATION', invitationResult.data[0].id, JSON.stringify({ code: invitationResult.data[0].code })]
    );

    res.json({
      success: true,
      message: 'Invitation deleted successfully'
    });
  } catch (error) {
    console.error('Delete invitation error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get storage analytics
router.get('/storage/analytics', verifyToken, requirePlatformOwner, async (req, res) => {
  try {
    // Get storage overview
    // Calculate total quota separately to avoid duplication from JOIN
    const storageOverview = await executeQuery(`
      SELECT 
        (SELECT COUNT(DISTINCT id) FROM organizations WHERE status = 'active') as total_organizations,
        (SELECT COALESCE(SUM(storage_quota), 0) FROM organizations WHERE status = 'active') as total_quota_bytes,
        (SELECT COALESCE(SUM(file_size), 0) FROM files WHERE status = 'active') as total_used_bytes,
        ROUND(
          (SELECT COALESCE(SUM(file_size), 0) FROM files WHERE status = 'active') / 
          NULLIF((SELECT COALESCE(SUM(storage_quota), 0) FROM organizations WHERE status = 'active'), 0) * 100, 
          2
        ) as usage_percentage
    `);

    // Get storage by organization
    const storageByOrg = await executeQuery(`
      SELECT o.name, o.id, o.storage_quota,
             COALESCE(SUM(f.file_size), 0) as used_bytes,
             ROUND((COALESCE(SUM(f.file_size), 0) / o.storage_quota) * 100, 2) as usage_percentage,
             COUNT(f.id) as file_count
      FROM organizations o
      LEFT JOIN files f ON o.id = f.organization_id AND f.status = 'active'
      WHERE o.status = 'active'
      GROUP BY o.id, o.name, o.storage_quota
      ORDER BY used_bytes DESC
    `);

    // Get storage by file type
    const storageByType = await executeQuery(`
      SELECT file_type as type, 
             COUNT(*) as file_count,
             SUM(file_size) as total_size,
             ROUND(AVG(file_size), 2) as avg_size
      FROM files 
      WHERE status = 'active'
      GROUP BY file_type
      ORDER BY total_size DESC
    `);

    // Get storage trends (last 30 days)
    const storageTrends = await executeQuery(`
      SELECT DATE(created_at) as date,
             COUNT(*) as files_uploaded,
             SUM(file_size) as daily_storage_added
      FROM files 
      WHERE status = 'active' AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `);

    if (!storageOverview.success || !storageByOrg.success || !storageByType.success || !storageTrends.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch storage analytics'
      });
    }

    res.json({
      success: true,
      data: {
        overview: storageOverview.data[0],
        byOrganization: storageByOrg.data,
        byFileType: storageByType.data,
        trends: storageTrends.data
      }
    });
  } catch (error) {
    console.error('Get storage analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get system settings
router.get('/settings', verifyToken, requirePlatformOwner, async (req, res) => {
  try {
    // This would typically come from a settings table
    // For now, we'll return some default settings
    const settings = {
      maxFileSize: process.env.MAX_FILE_SIZE || 10485760,
      allowedFileTypes: (process.env.ALLOWED_FILE_TYPES || 'pdf,doc,docx,txt,jpg,jpeg,png,gif,mp4,avi,mov').split(','),
      defaultStorageQuota: 5120, // MB (5GB)
      sessionTimeout: process.env.JWT_EXPIRES_IN || '24h',
      registrationEnabled: true,
      invitationRequired: true
    };

    res.json({
      success: true,
      data: settings
    });
  } catch (error) {
    console.error('Get system settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Update system settings
router.put('/settings', verifyToken, requirePlatformOwner, async (req, res) => {
  try {
    const { maxFileSize, allowedFileTypes, defaultStorageQuota, sessionTimeout, registrationEnabled, invitationRequired } = req.body;

    // This would typically update a settings table
    // For now, we'll just log the update attempt
    await executeQuery(
      'INSERT INTO audit_logs (user_id, organization_id, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, req.user.organization_id, 'UPDATE', 'SYSTEM_SETTINGS', 1, JSON.stringify({ 
        maxFileSize, 
        allowedFileTypes, 
        defaultStorageQuota, 
        sessionTimeout, 
        registrationEnabled, 
        invitationRequired 
      })]
    );

    res.json({
      success: true,
      message: 'System settings updated successfully'
    });
  } catch (error) {
    console.error('Update system settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// ============================================
// ORGANIZATION ADMIN ENDPOINTS
// ============================================

// Get organization dashboard statistics (for organization admin)
router.get('/organization/stats', verifyToken, requireOrgAdmin, async (req, res) => {
  try {
    const orgId = req.user.organization_id;

    // Get organization statistics
    const orgStats = await executeQuery(`
      SELECT 
        (SELECT COUNT(*) FROM users WHERE organization_id = ? AND status = 'active') as active_users,
        (SELECT COUNT(*) FROM files WHERE organization_id = ? AND status = 'active') as total_files,
        (SELECT COALESCE(SUM(file_size), 0) FROM files WHERE organization_id = ? AND status = 'active') as total_storage_used,
        (SELECT storage_quota FROM organizations WHERE id = ?) as storage_quota,
        (SELECT name FROM organizations WHERE id = ?) as organization_name
    `, [orgId, orgId, orgId, orgId, orgId]);

    // Get recent activity (last 7 days) for this organization
    const recentActivity = await executeQuery(`
      SELECT action, COUNT(*) as count, DATE(created_at) as date
      FROM audit_logs 
      WHERE organization_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY action, DATE(created_at)
      ORDER BY date DESC
    `, [orgId]);

    // Get user registrations by day (last 30 days) for this organization
    const userRegistrations = await executeQuery(`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM users 
      WHERE organization_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `, [orgId]);

    // Get system health metrics for this organization
    const systemHealth = await executeQuery(`
      SELECT 
        (SELECT COUNT(*) FROM users WHERE organization_id = ? AND status = 'active' AND last_login >= DATE_SUB(NOW(), INTERVAL 30 DAY)) as active_users_30d,
        (SELECT COUNT(*) FROM files WHERE organization_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)) as files_uploaded_7d,
        (SELECT COUNT(*) FROM audit_logs WHERE organization_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)) as daily_activity
    `, [orgId, orgId, orgId]);

    if (!orgStats.success || !recentActivity.success || !userRegistrations.success || !systemHealth.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch organization statistics'
      });
    }

    const stats = orgStats.data[0];
    const quota = stats.storage_quota || 0;
    const used = stats.total_storage_used || 0;
    const usagePercentage = quota > 0 ? ((used / quota) * 100).toFixed(2) : 0;

    res.json({
      success: true,
      data: {
        organizationStats: {
          ...stats,
          usage_percentage: parseFloat(usagePercentage)
        },
        recentActivity: recentActivity.data,
        userRegistrations: userRegistrations.data,
        systemHealth: systemHealth.data[0]
      }
    });
  } catch (error) {
    console.error('Get organization stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get organization storage analytics
router.get('/organization/storage', verifyToken, requireOrgAdmin, async (req, res) => {
  try {
    const orgId = req.user.organization_id;

    // Get organization storage overview
    const orgResult = await executeQuery(
      'SELECT id, name, storage_quota, storage_used FROM organizations WHERE id = ?',
      [orgId]
    );

    if (!orgResult.success || orgResult.data.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Organization not found'
      });
    }

    const org = orgResult.data[0];
    const quota = org.storage_quota || 0;
    const used = org.storage_used || 0;
    const usagePercentage = quota > 0 ? ((used / quota) * 100).toFixed(2) : 0;

    // Get storage by file type for this organization
    const storageByType = await executeQuery(`
      SELECT file_type as type, 
             COUNT(*) as file_count,
             SUM(file_size) as total_size,
             ROUND(AVG(file_size), 2) as avg_size
      FROM files 
      WHERE organization_id = ? AND status = 'active'
      GROUP BY file_type
      ORDER BY total_size DESC
    `, [orgId]);

    // Get storage trends (last 30 days) for this organization
    const storageTrends = await executeQuery(`
      SELECT DATE(created_at) as date,
             COUNT(*) as files_uploaded,
             SUM(file_size) as daily_storage_added
      FROM files 
      WHERE organization_id = ? AND status = 'active' AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `, [orgId]);

    if (!storageByType.success || !storageTrends.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch storage analytics'
      });
    }

    res.json({
      success: true,
      data: {
        overview: {
          organization_id: org.id,
          organization_name: org.name,
          total_quota_bytes: quota,
          total_used_bytes: used,
          usage_percentage: parseFloat(usagePercentage)
        },
        byFileType: storageByType.data,
        trends: storageTrends.data
      }
    });
  } catch (error) {
    console.error('Get organization storage analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

module.exports = router;
