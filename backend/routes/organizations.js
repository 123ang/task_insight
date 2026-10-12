const express = require('express');
const { executeQuery } = require('../config/database');
const { verifyToken, requirePlatformOwner, requireOrgAdmin } = require('../middleware/auth');
const { validateOrganization, validatePagination, validateSearch } = require('../middleware/validation');
const { generateInvitationCode } = require('../utils/helpers');

const router = express.Router();

// Get all organizations
router.get('/', verifyToken, requirePlatformOwner, validatePagination, validateSearch, async(req, res) => {
  try {
    const { page = 1, limit = 10, q: search, status } = req.query;
    const offset = (page - 1) * limit;

    const whereConditions = [];
    const queryParams = [];

    // Search filter
    if (search) {
      whereConditions.push('(name LIKE ? OR description LIKE ?)');
      const searchPattern = `%${search}%`;
      queryParams.push(searchPattern, searchPattern);
    }

    // Status filter
    if (status) {
      whereConditions.push('status = ?');
      queryParams.push(status);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Include the newest active invitation for the platform-owner table.
    const orgsQuery = `
      SELECT o.id, o.name, o.description, o.storage_quota, o.storage_used, o.status,
             MAX(i.id) as invitation_id,
             SUBSTRING_INDEX(GROUP_CONCAT(i.code ORDER BY i.created_at DESC), ',', 1) as invitation_code,
             SUBSTRING_INDEX(GROUP_CONCAT(i.role ORDER BY i.created_at DESC), ',', 1) as invitation_role,
             MAX(i.expires_at) as invitation_expires_at,
             MAX(i.generated_by) as invitation_generated_by,
             o.created_at, o.updated_at,
             COUNT(DISTINCT u.id) as user_count,
             COALESCE(SUM(f.file_size), 0) as calculated_storage_used
      FROM organizations o 
      LEFT JOIN users u ON o.id = u.organization_id AND u.status = 'active'
      LEFT JOIN files f ON o.id = f.organization_id AND f.status = 'active'
      LEFT JOIN invitation_codes i
        ON i.organization_id = o.id
       AND i.revoked_at IS NULL
       AND i.expires_at > NOW()
       AND i.use_count < i.max_uses
      ${whereClause}
      GROUP BY o.id, o.name, o.description, o.storage_quota, o.storage_used, o.status,
               o.created_at, o.updated_at
      ORDER BY o.created_at DESC 
      LIMIT ${parseInt(limit, 10)} OFFSET ${offset}
    `;

    const orgsResult = await executeQuery(orgsQuery, queryParams);

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total 
      FROM organizations o 
      ${whereClause}
    `;

    const countResult = await executeQuery(countQuery, queryParams);

    if (!orgsResult.success) {
      console.error('Organizations query error:', orgsResult.error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch organizations',
        error: process.env.NODE_ENV === 'development' ? orgsResult.error : undefined
      });
    }

    if (!countResult.success) {
      console.error('Count query error:', countResult.error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch organizations count',
        error: process.env.NODE_ENV === 'development' ? countResult.error : undefined
      });
    }

    // Map snake_case to camelCase for frontend
    const mappedOrgs = orgsResult.data.map(org => ({
      id: org.id,
      name: org.name,
      description: org.description,
      storageQuota: org.storage_quota,
      storageUsed: org.calculated_storage_used || org.storage_used || 0,
      status: org.status,
      userCount: org.user_count || 0,
      createdAt: org.created_at,
      updatedAt: org.updated_at,
      invitationId: org.invitation_id || null,
      invitationCode: org.invitation_code || null,
      invitationRole: org.invitation_role || null,
      invitationExpiresAt: org.invitation_expires_at || null,
      invitationGeneratedBy: org.invitation_generated_by || null
    }));

    res.json({
      success: true,
      data: {
        data: mappedOrgs,
        pagination: {
          page: parseInt(page, 10),
          limit: parseInt(limit, 10),
          total: countResult.data[0].total,
          pages: Math.ceil(countResult.data[0].total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get organizations error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get organization by ID
router.get('/:id', verifyToken, async(req, res) => {
  try {
    const { id } = req.params;

    // Check if user has access to this organization
    if (req.user.role === 'organization_admin' && req.user.organization_id !== parseInt(id, 10)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const orgResult = await executeQuery(
      `SELECT o.*, 
              COUNT(DISTINCT u.id) as user_count,
              COALESCE(SUM(f.file_size), 0) as storage_used
       FROM organizations o 
       LEFT JOIN users u ON o.id = u.organization_id AND u.status = 'active'
       LEFT JOIN files f ON o.id = f.organization_id AND f.status = 'active'
       WHERE o.id = ?
       GROUP BY o.id`,
      [id]
    );

    if (!orgResult.success || orgResult.data.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Organization not found'
      });
    }

    res.json({
      success: true,
      data: orgResult.data[0]
    });
  } catch (error) {
    console.error('Get organization error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Create organization
router.post('/', verifyToken, requirePlatformOwner, validateOrganization, async(req, res) => {
  try {
    const { name, description, storageQuota } = req.body;

    // Check if organization name already exists
    const existingOrg = await executeQuery(
      'SELECT id FROM organizations WHERE name = ?',
      [name]
    );

    if (existingOrg.success && existingOrg.data.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Organization with this name already exists'
      });
    }

    // Generate a unique invitation code for the first organization member.
    let invitationCode;
    let isUnique = false;
    let attempts = 0;
    const maxAttempts = 10;

    while (!isUnique && attempts < maxAttempts) {
      invitationCode = generateInvitationCode().toUpperCase();

      // Check if code already exists
      const codeCheck = await executeQuery(
        'SELECT id FROM invitation_codes WHERE code = ?',
        [invitationCode]
      );

      if (codeCheck.success && codeCheck.data.length === 0) {
        isUnique = true;
      }
      attempts++;
    }

    if (!isUnique) {
      return res.status(500).json({
        success: false,
        message: 'Failed to generate unique invitation code. Please try again.'
      });
    }

    // Create the organization, then create its single-use onboarding invitation.
    const orgResult = await executeQuery(
      'INSERT INTO organizations (name, description, storage_quota, status) VALUES (?, ?, ?, ?)',
      [name, description, storageQuota || 5368709120, 'active']
    );

    if (!orgResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to create organization'
      });
    }

    const invitationResult = await executeQuery(
      `INSERT INTO invitation_codes
        (code, organization_id, role, expires_at, max_uses, generated_by)
       VALUES (?, ?, 'member', DATE_ADD(NOW(), INTERVAL 7 DAY), 1, ?)`,
      [invitationCode, orgResult.data.insertId, req.user.id]
    );
    if (!invitationResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Organization created, but its invitation could not be generated'
      });
    }

    // Log organization creation
    await executeQuery(
      'INSERT INTO audit_logs (user_id, organization_id, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, orgResult.data.insertId, 'CREATE', 'ORGANIZATION', orgResult.data.insertId, JSON.stringify({ name, storageQuota })]
    );

    res.status(201).json({
      success: true,
      message: 'Organization created successfully',
      data: {
        organizationId: orgResult.data.insertId,
        name,
        description,
        storageQuota: storageQuota || 5368709120,
        invitationCode,
        invitationId: invitationResult.data.insertId
      }
    });
  } catch (error) {
    console.error('Create organization error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Update organization
router.put('/:id', verifyToken, requirePlatformOwner, validateOrganization, async(req, res) => {
  try {
    const { id } = req.params;
    const { name, description, storageQuota, status } = req.body;

    // Check if organization exists
    const existingOrg = await executeQuery(
      'SELECT * FROM organizations WHERE id = ?',
      [id]
    );

    if (!existingOrg.success || existingOrg.data.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Organization not found'
      });
    }

    // Check if name is already taken by another organization
    if (name && name !== existingOrg.data[0].name) {
      const nameCheck = await executeQuery(
        'SELECT id FROM organizations WHERE name = ? AND id != ?',
        [name, id]
      );

      if (nameCheck.success && nameCheck.data.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Organization name is already taken'
        });
      }
    }

    // Build update query
    const updateFields = [];
    const updateValues = [];

    if (name) {
      updateFields.push('name = ?');
      updateValues.push(name);
    }

    if (description !== undefined) {
      updateFields.push('description = ?');
      updateValues.push(description);
    }

    if (storageQuota !== undefined) {
      updateFields.push('storage_quota = ?');
      updateValues.push(storageQuota);
    }

    if (status) {
      updateFields.push('status = ?');
      updateValues.push(status);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }

    updateValues.push(id);

    const updateResult = await executeQuery(
      `UPDATE organizations SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );

    if (!updateResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to update organization'
      });
    }

    // Log the update
    await executeQuery(
      'INSERT INTO audit_logs (user_id, organization_id, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, id, 'UPDATE', 'ORGANIZATION', id, JSON.stringify({ updatedFields: updateFields })]
    );

    res.json({
      success: true,
      message: 'Organization updated successfully'
    });
  } catch (error) {
    console.error('Update organization error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Delete organization
router.delete('/:id', verifyToken, requirePlatformOwner, async(req, res) => {
  try {
    const { id } = req.params;

    // Check if organization exists
    const orgResult = await executeQuery(
      'SELECT * FROM organizations WHERE id = ?',
      [id]
    );

    if (!orgResult.success || orgResult.data.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Organization not found'
      });
    }

    // Check if organization has active users
    const userCount = await executeQuery(
      'SELECT COUNT(*) as count FROM users WHERE organization_id = ? AND status = "active"',
      [id]
    );

    if (userCount.success && userCount.data[0].count > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete organization with active users. Please deactivate all users first.'
      });
    }

    // Soft delete organization
    const deleteResult = await executeQuery(
      'UPDATE organizations SET status = "deleted", deleted_at = NOW() WHERE id = ?',
      [id]
    );

    if (!deleteResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to delete organization'
      });
    }

    // Log deletion
    await executeQuery(
      'INSERT INTO audit_logs (user_id, organization_id, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, id, 'DELETE', 'ORGANIZATION', id, JSON.stringify({ name: orgResult.data[0].name })]
    );

    res.json({
      success: true,
      message: 'Organization deleted successfully'
    });
  } catch (error) {
    console.error('Delete organization error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get organization users
router.get('/:id/users', verifyToken, requireOrgAdmin, validatePagination, async(req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 10, q: search, role, status } = req.query;
    const offset = (page - 1) * limit;

    // Check access permissions
    if (req.user.role === 'organization_admin' && req.user.organization_id !== parseInt(id, 10)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const whereConditions = ['u.organization_id = ?'];
    const queryParams = [id];

    // Search filter
    if (search) {
      whereConditions.push('(u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ?)');
      const searchPattern = `%${search}%`;
      queryParams.push(searchPattern, searchPattern, searchPattern);
    }

    // Role filter
    if (role) {
      whereConditions.push('u.role = ?');
      queryParams.push(role);
    }

    // Status filter
    if (status) {
      whereConditions.push('u.status = ?');
      queryParams.push(status);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Get users
    const usersQuery = `
      SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.status, 
             u.created_at, u.last_login
      FROM users u 
      ${whereClause}
      ORDER BY u.created_at DESC 
      LIMIT ${parseInt(limit, 10)} OFFSET ${offset}
    `;

    const usersResult = await executeQuery(usersQuery, queryParams);

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total 
      FROM users u 
      ${whereClause}
    `;

    const countResult = await executeQuery(countQuery, queryParams);

    if (!usersResult.success || !countResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch users'
      });
    }

    res.json({
      success: true,
      data: {
        users: usersResult.data,
        pagination: {
          page: parseInt(page, 10),
          limit: parseInt(limit, 10),
          total: countResult.data[0].total,
          pages: Math.ceil(countResult.data[0].total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get organization users error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get organization statistics
router.get('/stats/overview', verifyToken, requirePlatformOwner, async(req, res) => {
  try {
    // Get organization counts by status
    const statusStats = await executeQuery(
      'SELECT status, COUNT(*) as count FROM organizations GROUP BY status'
    );

    // Get total organizations
    const totalOrgs = await executeQuery(
      'SELECT COUNT(*) as total FROM organizations'
    );

    // Get recent organizations (last 30 days)
    const recentOrgs = await executeQuery(
      'SELECT COUNT(*) as count FROM organizations WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)'
    );

    // Get storage statistics
    const storageStats = await executeQuery(
      `SELECT 
        SUM(storage_quota) as total_quota,
        SUM(CASE WHEN status = 'active' THEN storage_quota ELSE 0 END) as active_quota,
        COUNT(*) as total_organizations,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_organizations
       FROM organizations`
    );

    if (!statusStats.success || !totalOrgs.success || !recentOrgs.success || !storageStats.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch organization statistics'
      });
    }

    res.json({
      success: true,
      data: {
        totalOrganizations: totalOrgs.data[0].total,
        statusStats: statusStats.data,
        recentOrganizations: recentOrgs.data[0].count,
        storageStats: storageStats.data[0]
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

module.exports = router;
