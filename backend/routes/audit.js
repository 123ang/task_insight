const express = require('express');
const { executeQuery } = require('../config/database');
const { verifyToken, requirePlatformOwner, requireOrgAdmin } = require('../middleware/auth');
const { validatePagination, validateSearch, validateDateRange } = require('../middleware/validation');

const router = express.Router();

// Get audit logs (platform owner or org admin)
router.get('/', verifyToken, validatePagination, validateSearch, validateDateRange, async(req, res) => {
  // Check permissions manually
  if (req.user.role !== 'platform_owner' && req.user.role !== 'organization_admin') {
    return res.status(403).json({
      success: false,
      message: 'Access denied'
    });
  }
  try {
    const { page = 1, limit = 20, q: search, action, resourceType, startDate, endDate, userId, organizationId } = req.query;
    const offset = (page - 1) * limit;

    const whereConditions = [];
    const queryParams = [];

    // Platform owner can see all logs, org admin only sees their org logs
    if (req.user.role === 'organization_admin') {
      whereConditions.push('al.organization_id = ?');
      queryParams.push(req.user.organization_id);
    }

    // Search filter
    if (search) {
      whereConditions.push('(al.action LIKE ? OR al.resource_type LIKE ? OR al.details LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ?)');
      const searchPattern = `%${search}%`;
      queryParams.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern, searchPattern);
    }

    // Action filter
    if (action) {
      whereConditions.push('al.action = ?');
      queryParams.push(action);
    }

    // Resource type filter
    if (resourceType) {
      whereConditions.push('al.resource_type = ?');
      queryParams.push(resourceType);
    }

    // Date range filter
    if (startDate) {
      whereConditions.push('al.created_at >= ?');
      queryParams.push(startDate);
    }

    if (endDate) {
      whereConditions.push('al.created_at <= ?');
      queryParams.push(endDate);
    }

    // User filter
    if (userId) {
      whereConditions.push('al.user_id = ?');
      queryParams.push(userId);
    }

    // Organization filter (for platform owner)
    if (organizationId && req.user.role === 'platform_owner') {
      whereConditions.push('al.organization_id = ?');
      queryParams.push(organizationId);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Get audit logs
    const logsQuery = `
      SELECT al.*, u.first_name, u.last_name, u.email, u.role, o.name as organization_name
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      LEFT JOIN organizations o ON al.organization_id = o.id
      ${whereClause}
      ORDER BY al.created_at DESC
      LIMIT ${parseInt(limit, 10)} OFFSET ${offset}
    `;

    const logsResult = await executeQuery(logsQuery, queryParams);

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total 
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      LEFT JOIN organizations o ON al.organization_id = o.id
      ${whereClause}
    `;

    const countResult = await executeQuery(countQuery, queryParams);

    if (!logsResult.success || !countResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch audit logs'
      });
    }

    res.json({
      success: true,
      data: {
        data: logsResult.data, // Changed from 'logs' to 'data' to match PaginationResponse format
        pagination: {
          page: parseInt(page, 10),
          limit: parseInt(limit, 10),
          total: countResult.data[0].total,
          pages: Math.ceil(countResult.data[0].total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get audit logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get audit log by ID
router.get('/:id', verifyToken, requireOrgAdmin, async(req, res) => {
  try {
    const { id } = req.params;

    const logResult = await executeQuery(
      `SELECT al.*, u.first_name, u.last_name, u.email, u.role, o.name as organization_name
       FROM audit_logs al
       LEFT JOIN users u ON al.user_id = u.id
       LEFT JOIN organizations o ON u.organization_id = o.id
       WHERE al.id = ?`,
      [id]
    );

    if (!logResult.success || logResult.data.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Audit log not found'
      });
    }

    const log = logResult.data[0];

    // Check access permissions
    if (req.user.role === 'organization_admin' && log.organization_id !== req.user.organization_id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.json({
      success: true,
      data: log
    });
  } catch (error) {
    console.error('Get audit log error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get audit statistics
router.get('/stats/overview', verifyToken, requireOrgAdmin, async(req, res) => {
  try {
    const { organizationId, startDate, endDate } = req.query;

    const whereConditions = [];
    const queryParams = [];

    // Platform owner can see all stats, org admin only sees their org stats
    if (req.user.role === 'organization_admin') {
      whereConditions.push('u.organization_id = ?');
      queryParams.push(req.user.organization_id);
    } else if (organizationId && req.user.role === 'platform_owner') {
      whereConditions.push('u.organization_id = ?');
      queryParams.push(organizationId);
    }

    // Date range filter
    if (startDate) {
      whereConditions.push('al.created_at >= ?');
      queryParams.push(startDate);
    }

    if (endDate) {
      whereConditions.push('al.created_at <= ?');
      queryParams.push(endDate);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Get action statistics
    const actionStats = await executeQuery(
      `SELECT action, COUNT(*) as count 
       FROM audit_logs al
       LEFT JOIN users u ON al.user_id = u.id
       ${whereClause}
       GROUP BY action
       ORDER BY count DESC`,
      queryParams
    );

    // Get resource type statistics
    const resourceTypeStats = await executeQuery(
      `SELECT resource_type, COUNT(*) as count 
       FROM audit_logs al
       LEFT JOIN users u ON al.user_id = u.id
       ${whereClause}
       GROUP BY resource_type
       ORDER BY count DESC`,
      queryParams
    );

    // Get daily activity (last 30 days)
    const dailyActivity = await executeQuery(
      `SELECT DATE(created_at) as date, COUNT(*) as count 
       FROM audit_logs al
       LEFT JOIN users u ON al.user_id = u.id
       ${whereClause}
       AND al.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
       GROUP BY DATE(created_at)
       ORDER BY date DESC`,
      queryParams
    );

    // Get top active users
    const topActiveUsers = await executeQuery(
      `SELECT u.first_name, u.last_name, u.email, COUNT(*) as activity_count
       FROM audit_logs al
       LEFT JOIN users u ON al.user_id = u.id
       ${whereClause}
       GROUP BY al.user_id, u.first_name, u.last_name, u.email
       ORDER BY activity_count DESC
       LIMIT 10`,
      queryParams
    );

    // Get total activity count
    const totalActivity = await executeQuery(
      `SELECT COUNT(*) as total 
       FROM audit_logs al
       LEFT JOIN users u ON al.user_id = u.id
       ${whereClause}`,
      queryParams
    );

    if (!actionStats.success || !resourceTypeStats.success || !dailyActivity.success ||
        !topActiveUsers.success || !totalActivity.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch audit statistics'
      });
    }

    res.json({
      success: true,
      data: {
        totalActivity: totalActivity.data[0].total,
        actionStats: actionStats.data,
        resourceTypeStats: resourceTypeStats.data,
        dailyActivity: dailyActivity.data,
        topActiveUsers: topActiveUsers.data
      }
    });
  } catch (error) {
    console.error('Get audit stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Export audit logs
router.get('/export/csv', verifyToken, requirePlatformOwner, validateDateRange, async(req, res) => {
  try {
    const { startDate, endDate, organizationId } = req.query;

    const whereConditions = [];
    const queryParams = [];

    // Organization filter
    if (organizationId) {
      whereConditions.push('u.organization_id = ?');
      queryParams.push(organizationId);
    }

    // Date range filter
    if (startDate) {
      whereConditions.push('al.created_at >= ?');
      queryParams.push(startDate);
    }

    if (endDate) {
      whereConditions.push('al.created_at <= ?');
      queryParams.push(endDate);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Get all audit logs for export
    const logsResult = await executeQuery(
      `SELECT al.id, al.created_at, al.action, al.resource_type, al.resource_id, 
              al.details, u.first_name, u.last_name, u.email, o.name as organization_name
       FROM audit_logs al
       LEFT JOIN users u ON al.user_id = u.id
       LEFT JOIN organizations o ON u.organization_id = o.id
       ${whereClause}
       ORDER BY al.created_at DESC`,
      queryParams
    );

    if (!logsResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch audit logs for export'
      });
    }

    // Generate CSV content
    const headers = ['ID', 'Date', 'Action', 'Resource Type', 'Resource ID', 'Details', 'User', 'Organization'];
    const csvContent = [
      headers.join(','),
      ...logsResult.data.map(log => [
        log.id,
        log.created_at,
        log.action,
        log.resource_type,
        log.resource_id,
        `"${(log.details || '').replace(/"/g, '""')}"`,
        `"${log.first_name} ${log.last_name} (${log.email})"`,
        `"${log.organization_name || ''}"`
      ].join(','))
    ].join('\n');

    // Log export action
    await executeQuery(
      'INSERT INTO audit_logs (user_id, organization_id, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, req.user.organization_id, 'EXPORT', 'AUDIT_LOGS', 0, JSON.stringify({ startDate, endDate, organizationId, recordCount: logsResult.data.length })]
    );

    // Set response headers for CSV download
    const filename = `audit_logs_${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvContent);
  } catch (error) {
    console.error('Export audit logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get available filter options for audit logs
router.get('/filters/options', verifyToken, requireOrgAdmin, async(req, res) => {
  try {
    const whereConditions = [];
    const queryParams = [];

    // Platform owner can see all options, org admin only sees their org options
    if (req.user.role === 'organization_admin') {
      whereConditions.push('u.organization_id = ?');
      queryParams.push(req.user.organization_id);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Get unique actions
    const actionsResult = await executeQuery(
      `SELECT DISTINCT action FROM audit_logs al
       LEFT JOIN users u ON al.user_id = u.id
       ${whereClause}
       ORDER BY action`,
      queryParams
    );

    // Get unique resource types
    const resourceTypesResult = await executeQuery(
      `SELECT DISTINCT resource_type FROM audit_logs al
       LEFT JOIN users u ON al.user_id = u.id
       ${whereClause}
       ORDER BY resource_type`,
      queryParams
    );

    // Get unique users (for platform owner)
    let usersResult = { success: true, data: [] };
    if (req.user.role === 'platform_owner') {
      usersResult = await executeQuery(
        `SELECT DISTINCT u.id, u.first_name, u.last_name, u.email, o.name as organization_name
         FROM audit_logs al
         LEFT JOIN users u ON al.user_id = u.id
         LEFT JOIN organizations o ON u.organization_id = o.id
         WHERE u.id IS NOT NULL
         ORDER BY u.first_name, u.last_name`,
        []
      );
    }

    // Get unique organizations (for platform owner)
    let organizationsResult = { success: true, data: [] };
    if (req.user.role === 'platform_owner') {
      organizationsResult = await executeQuery(
        `SELECT DISTINCT o.id, o.name
         FROM audit_logs al
         LEFT JOIN users u ON al.user_id = u.id
         LEFT JOIN organizations o ON u.organization_id = o.id
         WHERE o.id IS NOT NULL
         ORDER BY o.name`,
        []
      );
    }

    if (!actionsResult.success || !resourceTypesResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch filter options'
      });
    }

    res.json({
      success: true,
      data: {
        actions: actionsResult.data.map(row => row.action),
        resourceTypes: resourceTypesResult.data.map(row => row.resource_type),
        users: usersResult.data,
        organizations: organizationsResult.data
      }
    });
  } catch (error) {
    console.error('Get filter options error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

module.exports = router;
