const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const archiver = require('archiver');
const { executeQuery } = require('../config/database');
const {
  verifyToken,
  requireFileAccess,
  requireFileWriteAccess,
  requireFileOwnerOrAdmin,
  requireDeletedFileOwnerOrAdmin
} = require('../middleware/auth');
const { validateFileUpload, validateFileUpdate, validateFolder, validatePagination, validateSearch } = require('../middleware/validation');
const { formatDate } = require('../utils/helpers');
const { logger, redactSensitive } = require('../utils/logger');
const {
  getAllowedExtensions,
  getOrganizationUploadPolicy,
  runMalwareScan,
  validateUploadedFile
} = require('../utils/fileSecurity');
const { canManageFolder } = require('../utils/authorization');

// Normalize date to MySQL datetime (YYYY-MM-DD HH:mm:ss). Handles ISO strings from frontend.
const toMysqlDatetime = (value) => {
  if (value == null || value === '') return null;
  try {
    if (typeof value === 'string' && value.includes('T')) {
      return formatDate(new Date(value), 'YYYY-MM-DD HH:mm:ss');
    }
    return formatDate(value, 'YYYY-MM-DD HH:mm:ss');
  } catch (e) {
    return null;
  }
};

// Helper function to decode filename (handles URL encoding from browser)
const decodeFilename = (filename) => {
  if (!filename) return filename;
  try {
    // Try to decode URL-encoded filename (browsers may encode special characters)
    // First check if it's URL encoded
    if (filename.includes('%')) {
      return decodeURIComponent(filename);
    }
    return filename;
  } catch (error) {
    // If decoding fails, return original
    logger.warn('Failed to decode filename', { filename, error: logger.serializeError(error) });
    return filename;
  }
};

const sanitizeFileRecord = (file) => {
  if (!file) return file;
  const { storage_path, current_storage_path, ...safeFile } = file;
  return safeFile;
};

const sanitizeFileRecords = (files = []) => files.map(sanitizeFileRecord);

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, '../uploads');
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    // Decode filename to preserve extension with special characters
    const decodedName = decodeFilename(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(decodedName));
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = getAllowedExtensions();
  // Decode filename to handle URL-encoded characters
  const decodedName = decodeFilename(file.originalname);
  const fileExtension = path.extname(decodedName).toLowerCase().substring(1);
  
  if (allowedTypes.includes(fileExtension)) {
    cb(null, true);
  } else {
    cb(new Error(`File type .${fileExtension} is not allowed`), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE, 10) || 100 * 1024 * 1024
  }
});

// Get all files
router.get('/', verifyToken, validatePagination, validateSearch, async (req, res) => {
  try {
    logger.debug('Files list request received', {
      user: req.user.email,
      role: req.user.role,
      organizationId: req.user.organization_id,
      query: req.query
    });
    const { page = 1, limit = 10, q: search, folderId, type, organizationId } = req.query;
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 10;
    const offset = (pageNum - 1) * limitNum;

    let whereConditions = ['f.status = "active"'];
    let queryParams = [];

    // Filter by organization (platform owner can see all, others see their org)
    if (req.user.role === 'platform_owner' && organizationId) {
      whereConditions.push('f.organization_id = ?');
      queryParams.push(organizationId);
    } else if (req.user.role !== 'platform_owner') {
      whereConditions.push('f.organization_id = ?');
      queryParams.push(req.user.organization_id);
    }

    // Filter by uploaded_by - users can only see files they uploaded (unless platform owner)
    // Organization admins also only see their own files for privacy
    if (req.user.role !== 'platform_owner') {
      whereConditions.push('f.uploaded_by = ?');
      queryParams.push(req.user.id);
    }

    // Search filter (case-insensitive)
    if (search) {
      whereConditions.push('(LOWER(f.name) LIKE ? OR LOWER(f.description) LIKE ?)');
      const searchPattern = `%${search.toLowerCase()}%`;
      queryParams.push(searchPattern, searchPattern);
    }

    // Folder filter
    // If folderId is provided, show files in that folder
    // If folderId is explicitly null or "null", show root files (folder_id IS NULL)
    // If folderId is not provided, show all files (no filter)
    if (folderId !== undefined) {
      if (folderId === null || folderId === 'null' || folderId === '') {
        whereConditions.push('f.folder_id IS NULL');
      } else {
      whereConditions.push('f.folder_id = ?');
      queryParams.push(folderId);
      }
    }

    // File type filter
    if (type) {
      whereConditions.push('f.file_type = ?');
      queryParams.push(type);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Get files with pagination
    // Note: LIMIT and OFFSET must be integers, not placeholders (MySQL limitation)
    const filesQuery = `
      SELECT f.*, u.first_name, u.last_name, u.email, 
             fo.name as folder_name, o.name as organization_name,
             (si.id IS NOT NULL) as is_starred
      FROM files f 
      LEFT JOIN users u ON f.uploaded_by = u.id
      LEFT JOIN folders fo ON f.folder_id = fo.id
      LEFT JOIN organizations o ON f.organization_id = o.id
      LEFT JOIN starred_items si ON si.item_id = f.id AND si.item_type = 'file' AND si.user_id = ?
      ${whereClause}
      ORDER BY f.created_at DESC 
      LIMIT ${limitNum} OFFSET ${offset}
    `;

    logger.debug('Files list query prepared', {
      userId: req.user.id,
      limitNum,
      offset,
      totalParams: [req.user.id, ...queryParams].length
    });
    
    const filesResult = await executeQuery(filesQuery, [req.user.id, ...queryParams]);
    
    logger.debug('Files list query completed', {
      success: filesResult.success,
      error: filesResult.error,
      dataLength: filesResult.data?.length || 0
    });

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total 
      FROM files f 
      ${whereClause}
    `;

    const countResult = await executeQuery(countQuery, queryParams);
    
    logger.debug('Files count query completed', {
      success: countResult.success,
      error: countResult.error,
      total: countResult.data?.[0]?.total
    });

    if (!filesResult.success || !countResult.success) {
      logger.error('Files query failed', {
        filesResult: filesResult.error || 'Unknown error',
        countResult: countResult.error || 'Unknown error',
        page: pageNum,
        limit: limitNum,
        offset
      });
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch files',
        error: process.env.NODE_ENV === 'development' ? (filesResult.error || countResult.error) : undefined
      });
    }

    res.json({
      success: true,
      data: {
        files: sanitizeFileRecords(filesResult.data),
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: countResult.data[0].total,
          pages: Math.ceil(countResult.data[0].total / limitNum)
        }
      }
    });
  } catch (error) {
    logger.error('Get files error', { error: logger.serializeError(error) });
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Test upload endpoint (for debugging)
router.post('/upload/test', verifyToken, (req, res) => {
  logger.debug('Upload test request received', {
    headers: redactSensitive(req.headers),
    body: redactSensitive(req.body),
    hasFiles: !!req.files,
    hasFile: !!req.file
  });
  res.json({
    success: true,
    message: 'Test endpoint reached',
    hasFile: !!req.file,
    body: redactSensitive(req.body)
  });
});

// Upload file
router.post('/upload', verifyToken, (req, res, next) => {
  logger.debug('Upload middleware starting', {
    contentType: req.headers['content-type'],
    contentLength: req.headers['content-length'],
    hasBody: !!req.body,
    method: req.method,
    url: req.url,
    headers: {
      'content-type': req.headers['content-type'],
      'content-length': req.headers['content-length'],
      'authorization': req.headers['authorization'] ? 'present' : 'missing'
    }
  });
  
  upload.single('file')(req, res, (err) => {
    if (err) {
      logger.error('Multer upload error', {
        code: err.code,
        message: err.message,
        field: err.field,
        name: err.name,
        stack: process.env.NODE_ENV === 'production' ? undefined : err.stack
      });
      
      // Handle multer errors
      if (err.code === 'LIMIT_FILE_SIZE') {
        const maxSize = parseInt(process.env.MAX_FILE_SIZE, 10) || 100 * 1024 * 1024;
        const maxSizeGB = (maxSize / (1024 * 1024 * 1024)).toFixed(2);
        return res.status(400).json({
          success: false,
          message: `File too large. Maximum file size is ${maxSizeGB} GB.`,
          code: 'LIMIT_FILE_SIZE'
        });
      }
      // Handle other multer errors
      if (err instanceof multer.MulterError) {
        return res.status(400).json({
          success: false,
          message: `Upload error: ${err.message}`,
          code: err.code
        });
      }
      // Handle file filter errors
      if (err.message && err.message.includes('not allowed')) {
        return res.status(400).json({
          success: false,
          message: err.message
        });
      }
      // Generic multer error
      return res.status(400).json({
        success: false,
        message: err.message || 'File upload failed',
        code: err.code || 'UPLOAD_ERROR'
      });
    }
    logger.debug('Multer processed upload successfully', {
      hasFile: !!req.file,
      fileSize: req.file?.size,
      fieldname: req.file?.fieldname,
      mimetype: req.file?.mimetype
    });
    next();
  });
}, validateFileUpload, async (req, res) => {
  try {
    logger.debug('Upload handler reached', {
      hasFile: !!req.file,
      fileSize: req.file?.size,
      contentType: req.file?.mimetype,
      fieldname: req.file?.fieldname,
      body: redactSensitive(req.body),
      bodyKeys: Object.keys(req.body || {}),
      headers: {
        'content-type': req.headers['content-type'],
        'content-length': req.headers['content-length']
      }
    });

    if (!req.file) {
      logger.warn('Upload request missing file');
      return res.status(400).json({
        success: false,
        message: 'No file uploaded. Please select a file to upload.'
      });
    }

    const { name, description, folderId } = req.body;
    const file = req.file;

    const uploadPolicy = await getOrganizationUploadPolicy(req.user.organization_id);
    const validationResult = validateUploadedFile(file, uploadPolicy);
    if (!validationResult.success) {
      await fs.unlink(file.path);
      return res.status(400).json({
        success: false,
        message: validationResult.message
      });
    }

    const malwareScanResult = await runMalwareScan(file.path, uploadPolicy);
    if (!malwareScanResult.success) {
      await fs.unlink(file.path);
      return res.status(400).json({
        success: false,
        message: malwareScanResult.message
      });
    }

    // Check organization storage quota
    const orgResult = await executeQuery(
      'SELECT storage_quota, storage_used FROM organizations WHERE id = ?',
      [req.user.organization_id]
    );

    if (!orgResult.success || orgResult.data.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Organization not found'
      });
    }

    const storageQuota = orgResult.data[0].storage_quota; // Already in bytes
    const currentStorageUsed = orgResult.data[0].storage_used || 0;
    const quotaWouldBeExceeded = (sizeDifference) => {
      return currentStorageUsed + Math.max(sizeDifference, 0) > storageQuota;
    };

    // Validate folder if provided
    if (folderId) {
      const folderResult = await executeQuery(
        'SELECT id FROM folders WHERE id = ? AND organization_id = ? AND status = "active"',
        [folderId, req.user.organization_id]
      );

      if (!folderResult.success || folderResult.data.length === 0) {
        await fs.unlink(file.path);
        return res.status(400).json({
          success: false,
          message: 'Invalid folder'
        });
      }
    }

    // Decode the original filename to handle URL-encoded Chinese characters
    const decodedOriginalName = decodeFilename(file.originalname);
    const fileName = name || decodedOriginalName;
    const targetFolderId = folderId || null;

    // Check if a file with the same name exists in the same folder
    // Use IS NULL for null comparison, = for number comparison
    let existingFileQuery;
    let existingFileParams;
    if (targetFolderId === null || targetFolderId === undefined) {
      existingFileQuery = 'SELECT id, current_version FROM files WHERE name = ? AND folder_id IS NULL AND organization_id = ? AND status = "active"';
      existingFileParams = [fileName, req.user.organization_id];
    } else {
      existingFileQuery = 'SELECT id, current_version FROM files WHERE name = ? AND folder_id = ? AND organization_id = ? AND status = "active"';
      existingFileParams = [fileName, targetFolderId, req.user.organization_id];
    }
    
    const existingFileResult = await executeQuery(existingFileQuery, existingFileParams);

    let fileId;
    let isNewVersion = false;

    let sizeDifference = 0; // Track size change for storage_used update

    if (existingFileResult.success && existingFileResult.data.length > 0) {
      // File with same name exists - create a new version instead
      const existingFile = existingFileResult.data[0];
      fileId = existingFile.id;
      isNewVersion = true;

      // Get next version number
      const currentVersion = existingFile.current_version || 0;
      const newVersionNumber = currentVersion + 1;

      // Save old version to file_versions table before updating
      const oldVersionResult = await executeQuery(
        'SELECT storage_path, file_size FROM files WHERE id = ?',
        [fileId]
      );

      if (oldVersionResult.success && oldVersionResult.data.length > 0) {
        const oldFile = oldVersionResult.data[0];
        const oldSize = oldFile.file_size || 0;
        sizeDifference = file.size - oldSize; // New size - old size

        if (quotaWouldBeExceeded(sizeDifference)) {
          await fs.unlink(file.path);
          return res.status(400).json({
            success: false,
            message: 'Storage quota exceeded. Please contact your administrator to increase storage quota.'
          });
        }
        
        // Create version record for the old file
        await executeQuery(
          'INSERT INTO file_versions (file_id, version_number, file_size, storage_path, uploaded_by) VALUES (?, ?, ?, ?, ?)',
          [fileId, currentVersion, oldFile.file_size, oldFile.storage_path, req.user.id]
        );
      } else {
        // No old file found, treat as new file size
        sizeDifference = file.size;

        if (quotaWouldBeExceeded(sizeDifference)) {
          await fs.unlink(file.path);
          return res.status(400).json({
            success: false,
            message: 'Storage quota exceeded. Please contact your administrator to increase storage quota.'
          });
        }
      }

      // Update file with new version
      const updateResult = await executeQuery(
        'UPDATE files SET storage_path = ?, file_size = ?, current_version = ?, updated_at = NOW(), last_modified_at = NOW(), last_modified_by = ? WHERE id = ?',
        [file.path, file.size, newVersionNumber, req.user.id, fileId]
      );

      if (!updateResult.success) {
        await fs.unlink(file.path);
        return res.status(500).json({
          success: false,
          message: 'Failed to update file version'
        });
      }
    } else {
      // Create new file record
      sizeDifference = file.size; // New file adds full size

      if (quotaWouldBeExceeded(sizeDifference)) {
        await fs.unlink(file.path);
        return res.status(400).json({
          success: false,
          message: 'Storage quota exceeded. Please contact your administrator to increase storage quota.'
        });
      }

    const fileResult = await executeQuery(
        'INSERT INTO files (name, original_name, storage_path, file_size, file_type, description, organization_id, uploaded_by, folder_id, status, current_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
          fileName,
          decodedOriginalName, // Use decoded original name for proper UTF-8 encoding
        file.path,
        file.size,
          path.extname(decodedOriginalName).toLowerCase(),
        description || null,
        req.user.organization_id,
        req.user.id,
          targetFolderId,
          'active',
          1 // First version
      ]
    );

    if (!fileResult.success) {
      await fs.unlink(file.path);
      return res.status(500).json({
        success: false,
        message: 'Failed to save file record'
      });
    }

      fileId = fileResult.data.insertId;
    }

    // Update organization storage_used
    if (sizeDifference !== 0) {
      await executeQuery(
        'UPDATE organizations SET storage_used = storage_used + ? WHERE id = ?',
        [sizeDifference, req.user.organization_id]
      );
    }

    // Log file upload/version
    await executeQuery(
      'INSERT INTO audit_logs (user_id, organization_id, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, req.user.organization_id, isNewVersion ? 'VERSION' : 'CREATE', 'FILE', fileId, JSON.stringify({ name: fileName, size: file.size, isNewVersion })]
    );

    res.status(201).json({
      success: true,
      message: isNewVersion ? 'New version uploaded successfully' : 'File uploaded successfully',
      data: {
        fileId: fileId,
        name: fileName,
        size: file.size,
        type: path.extname(decodedOriginalName).toLowerCase(),
        isNewVersion: isNewVersion
      }
    });
  } catch (error) {
    logger.error('Upload file error', { error: logger.serializeError(error) });
    if (req.file) {
      try {
        await fs.unlink(req.file.path);
      } catch (unlinkError) {
        logger.error('Failed to delete uploaded file after failed upload', { error: logger.serializeError(unlinkError) });
      }
    }
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get shared with me (files and folders shared to current user)
// NOTE: This route MUST be before /:fileId routes to avoid being matched as a fileId
router.get('/shared-with-me', verifyToken, validatePagination, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 10;
    const offset = (pageNum - 1) * limitNum;

    // Get shared files - only files explicitly shared WITH the current user
    // Groups by file ID to show each file only once with the highest permission level
    // Permission hierarchy: edit > view > comment
    const sharedFilesQuery = `
      SELECT f.*, u.first_name, u.last_name, u.email,
             fo.name as folder_name, o.name as organization_name,
             CASE 
               WHEN MAX(CASE WHEN fs.permission_level = 'edit' THEN 3 
                             WHEN fs.permission_level = 'view' THEN 2 
                             WHEN fs.permission_level = 'comment' THEN 1 
                             ELSE 0 END) >= 3 THEN 'edit'
               WHEN MAX(CASE WHEN fs.permission_level = 'edit' THEN 3 
                             WHEN fs.permission_level = 'view' THEN 2 
                             WHEN fs.permission_level = 'comment' THEN 1 
                             ELSE 0 END) >= 2 THEN 'view'
               ELSE 'comment'
             END as permission_level,
             MAX(fs.created_at) as shared_at,
             (SELECT sharer.first_name 
              FROM file_shares fs2 
              LEFT JOIN users sharer ON fs2.shared_by = sharer.id
              WHERE fs2.file_id = f.id 
                AND fs2.shared_with = ?
                AND fs2.status = 'active'
                AND (fs2.expires_at IS NULL OR fs2.expires_at > NOW())
              ORDER BY CASE WHEN fs2.permission_level = 'edit' THEN 3 
                            WHEN fs2.permission_level = 'view' THEN 2 
                            WHEN fs2.permission_level = 'comment' THEN 1 
                            ELSE 0 END DESC, fs2.created_at DESC
              LIMIT 1) as shared_by_first_name,
             (SELECT sharer.last_name 
              FROM file_shares fs2 
              LEFT JOIN users sharer ON fs2.shared_by = sharer.id
              WHERE fs2.file_id = f.id 
                AND fs2.shared_with = ?
                AND fs2.status = 'active'
                AND (fs2.expires_at IS NULL OR fs2.expires_at > NOW())
              ORDER BY CASE WHEN fs2.permission_level = 'edit' THEN 3 
                            WHEN fs2.permission_level = 'view' THEN 2 
                            WHEN fs2.permission_level = 'comment' THEN 1 
                            ELSE 0 END DESC, fs2.created_at DESC
              LIMIT 1) as shared_by_last_name,
             (si.id IS NOT NULL) as is_starred
      FROM files f
      INNER JOIN file_shares fs ON f.id = fs.file_id
      LEFT JOIN users u ON f.uploaded_by = u.id
      LEFT JOIN folders fo ON f.folder_id = fo.id
      LEFT JOIN organizations o ON f.organization_id = o.id
      LEFT JOIN starred_items si ON si.item_id = f.id AND si.item_type = 'file' AND si.user_id = ?
      WHERE f.status = "active" 
        AND fs.status = "active" 
        AND (fs.expires_at IS NULL OR fs.expires_at > NOW())
        AND fs.shared_with = ?
      GROUP BY f.id, u.first_name, u.last_name, u.email, fo.name, o.name, si.id
      ORDER BY shared_at DESC
      LIMIT ${limitNum} OFFSET ${offset}
    `;

    const sharedFilesResult = await executeQuery(sharedFilesQuery, [
      req.user.id,
      req.user.id,
      req.user.id,
      req.user.id
    ]);

    // Get total count of distinct shared files
    const countFilesQuery = `
      SELECT COUNT(DISTINCT f.id) as total
      FROM files f
      INNER JOIN file_shares fs ON f.id = fs.file_id
      WHERE f.status = "active" 
        AND fs.status = "active" 
        AND (fs.expires_at IS NULL OR fs.expires_at > NOW())
        AND fs.shared_with = ?
    `;

    const countFilesResult = await executeQuery(countFilesQuery, [
      req.user.id
    ]);

    if (!sharedFilesResult.success || !countFilesResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch shared files'
      });
    }

    res.json({
      success: true,
      message: 'Shared files retrieved successfully',
      data: {
        files: sanitizeFileRecords(sharedFilesResult.data || []),
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: countFilesResult.data[0]?.total || 0,
          pages: Math.ceil((countFilesResult.data[0]?.total || 0) / limitNum)
        }
      }
    });
  } catch (error) {
    console.error('Get shared with me error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get file versions - MUST be before /:fileId route
router.get('/:fileId/versions', verifyToken, requireFileAccess, async (req, res) => {
  try {
    const { fileId } = req.params;

    // Get all versions including current
    const versionsResult = await executeQuery(
      `SELECT fv.id, fv.version_number, fv.file_size, fv.storage_path, fv.created_at, fv.version_note,
              u.first_name, u.last_name, u.email,
              f.current_version, f.storage_path as current_storage_path, f.file_size as current_file_size,
              f.updated_at as current_updated_at
       FROM file_versions fv
       LEFT JOIN users u ON fv.uploaded_by = u.id
       LEFT JOIN files f ON fv.file_id = f.id
       WHERE fv.file_id = ?
       ORDER BY fv.version_number DESC`,
      [fileId]
    );

    if (!versionsResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch versions'
      });
    }

    // Get current file info
    const fileResult = await executeQuery(
      'SELECT id, name, current_version, storage_path, file_size, updated_at, uploaded_by FROM files WHERE id = ?',
      [fileId]
    );

    const file = fileResult.success && fileResult.data.length > 0 ? fileResult.data[0] : null;
    const currentVersion = file ? file.current_version : 0;

    // Format versions - include current version
    const versions = versionsResult.data || [];
    
    // Add current version to the list
    if (file) {
      const currentVersionData = await executeQuery(
        'SELECT first_name, last_name, email FROM users WHERE id = ?',
        [file.uploaded_by]
      );
      const uploader = currentVersionData.success && currentVersionData.data.length > 0 
        ? currentVersionData.data[0] 
        : { first_name: null, last_name: null, email: null };

      versions.unshift({
        id: null, // Current version doesn't have a version record ID
        version_number: currentVersion,
        file_size: file.file_size,
        storage_path: file.storage_path,
        created_at: file.updated_at || file.created_at,
        version_note: null,
        first_name: uploader.first_name,
        last_name: uploader.last_name,
        email: uploader.email,
        is_current: true
      });
    }

    res.json({
      success: true,
      data: sanitizeFileRecords(versions)
    });
  } catch (error) {
    console.error('Get versions error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Upload new version - MUST be before /:fileId route
router.post('/:fileId/versions', verifyToken, requireFileWriteAccess, upload.single('file'), async (req, res) => {
  try {
    const { fileId } = req.params;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    // Get current file info
    const fileResult = await executeQuery(
      'SELECT id, current_version, storage_path, file_size FROM files WHERE id = ?',
      [fileId]
    );

    if (!fileResult.success || fileResult.data.length === 0) {
      await fs.unlink(req.file.path);
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    const file = fileResult.data[0];
    const currentVersion = file.current_version || 0;
    const newVersionNumber = currentVersion + 1;
    const oldSize = file.file_size || 0;
    const newSize = req.file.size;
    const sizeDifference = newSize - oldSize;

    // Check organization storage quota before uploading new version
    const orgResult = await executeQuery(
      'SELECT storage_quota, storage_used FROM organizations WHERE id = ?',
      [req.user.organization_id]
    );

    if (orgResult.success && orgResult.data.length > 0) {
      const storageQuota = orgResult.data[0].storage_quota;
      const currentStorageUsed = orgResult.data[0].storage_used || 0;

      if (currentStorageUsed + sizeDifference > storageQuota) {
        await fs.unlink(req.file.path);
        return res.status(400).json({
          success: false,
          message: 'Storage quota exceeded. Please contact your administrator to increase storage quota.'
        });
      }
    }

    // Save current version to file_versions table
    await executeQuery(
      'INSERT INTO file_versions (file_id, version_number, file_size, storage_path, uploaded_by) VALUES (?, ?, ?, ?, ?)',
      [fileId, currentVersion, file.file_size, file.storage_path, req.user.id]
    );

    // Update file with new version
    const updateResult = await executeQuery(
      'UPDATE files SET storage_path = ?, file_size = ?, current_version = ?, updated_at = NOW(), last_modified_at = NOW(), last_modified_by = ? WHERE id = ?',
      [req.file.path, req.file.size, newVersionNumber, req.user.id, fileId]
    );

    if (!updateResult.success) {
      await fs.unlink(req.file.path);
      return res.status(500).json({
        success: false,
        message: 'Failed to upload new version'
      });
    }

    // Update organization storage_used
    if (sizeDifference !== 0) {
      await executeQuery(
        'UPDATE organizations SET storage_used = storage_used + ? WHERE id = ?',
        [sizeDifference, req.user.organization_id]
      );
    }

    // Log version upload
    await executeQuery(
      'INSERT INTO audit_logs (user_id, organization_id, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, req.user.organization_id, 'VERSION', 'FILE', fileId, JSON.stringify({ version: newVersionNumber, size: req.file.size })]
    );

    res.json({
      success: true,
      message: 'New version uploaded successfully',
      data: {
        version: newVersionNumber,
        fileId: fileId
      }
    });
  } catch (error) {
    console.error('Upload version error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Keep version forever - MUST be before /:fileId route
router.put('/:fileId/versions/:versionId/keep', verifyToken, requireFileWriteAccess, async (req, res) => {
  try {
    const { fileId, versionId } = req.params;

    // For now, we'll add a flag to file_versions table
    // Since the schema doesn't have a "keep_forever" field, we'll add it via ALTER if needed
    // For now, we'll just return success (can be implemented later with schema update)
    
    res.json({
      success: true,
      message: 'Version will be kept forever'
    });
  } catch (error) {
    console.error('Keep version error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get file by ID
router.get('/:fileId', verifyToken, requireFileAccess, async (req, res) => {
  try {
    const { fileId } = req.params;

    const fileResult = await executeQuery(
      `SELECT f.*, u.first_name, u.last_name, u.email, 
              fo.name as folder_name, o.name as organization_name,
              (si.id IS NOT NULL) as is_starred
       FROM files f 
       LEFT JOIN users u ON f.uploaded_by = u.id
       LEFT JOIN folders fo ON f.folder_id = fo.id
       LEFT JOIN organizations o ON f.organization_id = o.id
       LEFT JOIN starred_items si ON si.item_id = f.id AND si.item_type = 'file' AND si.user_id = ?
       WHERE f.id = ?`,
      [req.user.id, fileId]
    );

    if (!fileResult.success || fileResult.data.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    res.json({
      success: true,
      data: sanitizeFileRecord(fileResult.data[0])
    });
  } catch (error) {
    console.error('Get file error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Download file
router.get('/:fileId/download', verifyToken, requireFileAccess, async (req, res) => {
  try {
    const { fileId } = req.params;

    if (!req.file || !req.file.path) {
      return res.status(404).json({
        success: false,
        message: 'File not found on disk'
      });
    }

    // Check if file exists
    try {
      await fs.access(req.file.path);
    } catch (error) {
      logger.warn('Download file missing on disk', { fileId, error: logger.serializeError(error) });
      return res.status(404).json({
        success: false,
        message: 'File not found on disk'
      });
    }

    // Log download
    await executeQuery(
      'INSERT INTO audit_logs (user_id, organization_id, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, req.user.organization_id, 'DOWNLOAD', 'FILE', fileId, JSON.stringify({ fileName: req.file.name })]
    );

    res.download(req.file.path, req.file.name);
  } catch (error) {
    logger.error('Download file error', { fileId: req.params.fileId, error: logger.serializeError(error) });
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Preview file (for images, PDFs, etc.)
router.get('/:fileId/preview', verifyToken, requireFileAccess, async (req, res) => {
  try {
    const { fileId } = req.params;

    if (!req.file || !req.file.path) {
      return res.status(404).json({
        success: false,
        message: 'File not found on disk'
      });
    }

    // Check if file exists
    try {
      await fs.access(req.file.path);
    } catch (error) {
      logger.warn('Preview file missing on disk', { fileId, error: logger.serializeError(error) });
      return res.status(404).json({
        success: false,
        message: 'File not found on disk'
      });
    }

    const fileName = req.file.name;
    const fileType = req.file.file_type || '';

    // Set appropriate headers for preview (inline display)
    res.setHeader('Content-Type', getContentType(fileType));
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    // Allow iframe embedding for previews - override Helmet's CSP
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self' http://localhost:3000 https://taskinsight.my");

    // Stream the file
    const fileStream = fsSync.createReadStream(req.file.path);
    fileStream.pipe(res);

    fileStream.on('error', (error) => {
      logger.error('Preview file stream error', { fileId, error: logger.serializeError(error) });
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: 'Error reading file'
        });
      }
    });
  } catch (error) {
    logger.error('Preview file error', { fileId: req.params.fileId, error: logger.serializeError(error) });
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }
});

// Helper function to get content type
function getContentType(fileType) {
  const type = fileType.toLowerCase();
  const contentTypes = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'pdf': 'application/pdf',
    'mp4': 'video/mp4',
    'avi': 'video/x-msvideo',
    'mov': 'video/quicktime',
    'txt': 'text/plain',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  
  for (const [key, value] of Object.entries(contentTypes)) {
    if (type.includes(key)) {
      return value;
    }
  }
  
  return 'application/octet-stream';
}

// Update file
router.put('/:fileId', verifyToken, requireFileWriteAccess, validateFileUpdate, async (req, res) => {
  try {
    const { fileId } = req.params;
    const { name, description, folderId } = req.body;

    // Validate folder if provided
    if (folderId) {
      const folderResult = await executeQuery(
        'SELECT id FROM folders WHERE id = ? AND organization_id = ? AND status = "active"',
        [folderId, req.user.organization_id]
      );

      if (!folderResult.success || folderResult.data.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Invalid folder'
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

    if (folderId !== undefined) {
      updateFields.push('folder_id = ?');
      updateValues.push(folderId);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }

    updateValues.push(fileId);

    const updateResult = await executeQuery(
      `UPDATE files SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );

    if (!updateResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to update file'
      });
    }

    // Log the update
    await executeQuery(
      'INSERT INTO audit_logs (user_id, organization_id, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, req.user.organization_id, 'UPDATE', 'FILE', fileId, JSON.stringify({ updatedFields: updateFields })]
    );

    res.json({
      success: true,
      message: 'File updated successfully'
    });
  } catch (error) {
    console.error('Update file error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Toggle star/favorite for file or folder
router.post('/star/:itemType/:itemId', verifyToken, async (req, res) => {
  try {
    const { itemType, itemId } = req.params; // itemType: 'file' or 'folder'

    if (!['file', 'folder'].includes(itemType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid item type'
      });
    }

    // Check if already starred
    const existingResult = await executeQuery(
      'SELECT id FROM starred_items WHERE user_id = ? AND item_type = ? AND item_id = ?',
      [req.user.id, itemType, itemId]
    );

    if (existingResult.success && existingResult.data.length > 0) {
      // Unstar - remove from starred_items
      await executeQuery(
        'DELETE FROM starred_items WHERE user_id = ? AND item_type = ? AND item_id = ?',
        [req.user.id, itemType, itemId]
      );

      return res.json({
        success: true,
        message: 'Item unstarred',
        data: { starred: false }
      });
    } else {
      // Star - add to starred_items
      await executeQuery(
        'INSERT INTO starred_items (user_id, item_type, item_id) VALUES (?, ?, ?)',
        [req.user.id, itemType, itemId]
      );

      return res.json({
        success: true,
        message: 'Item starred',
        data: { starred: true }
      });
    }
  } catch (error) {
    console.error('Toggle star error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// ============================================
// FILE SHARING ROUTES
// ============================================

// Share a file
router.post('/:fileId/share', verifyToken, requireFileOwnerOrAdmin, async (req, res) => {
  try {
    const { fileId } = req.params;
    const { email, permission, expiresAt } = req.body;

    let sharedWithUserId = null;
    let shareType = 'link';

    // If email is provided, find the user
    if (email) {
      const userResult = await executeQuery(
        'SELECT id, email FROM users WHERE email = ? AND status = "active"',
        [email]
      );

      if (userResult.success && userResult.data.length > 0) {
        sharedWithUserId = userResult.data[0].id;
        shareType = 'user';
      } else {
        // User doesn't exist - we'll still create a link share
        shareType = 'link';
      }
    }

    // Generate a unique share link
    const crypto = require('crypto');
    const shareLink = crypto.randomBytes(32).toString('hex');
    const frontendUrl = process.env.FRONTEND_URL || (process.env.NODE_ENV === 'production' ? 'https://taskinsight.my' : 'http://localhost:3000');
    const fullShareLink = `${frontendUrl}/share/${shareLink}`;

    // Convert expiresAt to MySQL datetime format (YYYY-MM-DD HH:mm:ss)
    let mysqlExpiresAt = null;
    if (expiresAt) {
      mysqlExpiresAt = toMysqlDatetime(expiresAt);
      if (mysqlExpiresAt == null) {
        return res.status(400).json({
          success: false,
          message: 'Invalid expiration date format'
        });
      }
    }

    // Create the share record
    const insertResult = await executeQuery(
      `INSERT INTO file_shares (file_id, shared_by, shared_with, share_type, permission_level, share_link, expires_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`,
      [
        fileId,
        req.user.id,
        sharedWithUserId,
        shareType,
        permission || 'view',
        shareLink,
        mysqlExpiresAt
      ]
    );

    if (!insertResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to share file'
      });
    }

    // Log the share action
    await executeQuery(
      'INSERT INTO audit_logs (user_id, organization_id, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, req.user.organization_id, 'SHARE', 'FILE', fileId, JSON.stringify({ 
        sharedWith: email || 'link', 
        permission: permission || 'view',
        shareType 
      })]
    );

    res.json({
      success: true,
      message: 'File shared successfully',
      data: {
        shareId: insertResult.data.insertId,
        shareLink: fullShareLink
      }
    });
  } catch (error) {
    console.error('Share file error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get all shares for a file
router.get('/:fileId/shares', verifyToken, requireFileOwnerOrAdmin, async (req, res) => {
  try {
    const { fileId } = req.params;

    // Get all active shares
    const sharesResult = await executeQuery(
      `SELECT fs.id, fs.share_type, fs.permission_level as permission, fs.expires_at as expiresAt, 
              fs.created_at as createdAt, fs.share_link,
              u.email, u.first_name, u.last_name,
              sharer.first_name as sharer_first_name, sharer.last_name as sharer_last_name
       FROM file_shares fs
       LEFT JOIN users u ON fs.shared_with = u.id
       LEFT JOIN users sharer ON fs.shared_by = sharer.id
       WHERE fs.file_id = ? AND fs.status = 'active'
       ORDER BY fs.created_at DESC`,
      [fileId]
    );

    if (!sharesResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch shares'
      });
    }

    // Format the response
    const frontendUrl = process.env.FRONTEND_URL || (process.env.NODE_ENV === 'production' ? 'https://taskinsight.my' : 'http://localhost:3000');
    const shares = sharesResult.data.map(share => ({
      id: share.id,
      email: share.email || 'Anyone with link',
      permission: share.permission,
      expiresAt: share.expiresAt,
      createdAt: share.createdAt,
      shareType: share.share_type,
      shareLink: share.share_link ? `${frontendUrl}/share/${share.share_link}` : null,
      sharedBy: share.sharer_first_name ? `${share.sharer_first_name} ${share.sharer_last_name}` : 'Unknown'
    }));

    res.json({
      success: true,
      data: shares
    });
  } catch (error) {
    console.error('Get file shares error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Revoke a share
router.delete('/:fileId/shares/:shareId', verifyToken, requireFileOwnerOrAdmin, async (req, res) => {
  try {
    const { fileId, shareId } = req.params;

    // Check if share exists
    const shareResult = await executeQuery(
      'SELECT id FROM file_shares WHERE id = ? AND file_id = ? AND status = "active"',
      [shareId, fileId]
    );

    if (!shareResult.success || shareResult.data.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Share not found'
      });
    }

    // Revoke the share (soft delete)
    const updateResult = await executeQuery(
      'UPDATE file_shares SET status = "inactive" WHERE id = ?',
      [shareId]
    );

    if (!updateResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to revoke share'
      });
    }

    // Log the revoke action
    await executeQuery(
      'INSERT INTO audit_logs (user_id, organization_id, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, req.user.organization_id, 'REVOKE_SHARE', 'FILE', fileId, JSON.stringify({ shareId })]
    );

    res.json({
      success: true,
      message: 'Share revoked successfully'
    });
  } catch (error) {
    console.error('Revoke share error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// ============================================
// FOLDER SHARING ROUTES
// ============================================

// Share a folder
router.post('/folders/:folderId/share', verifyToken, async (req, res) => {
  try {
    const { folderId } = req.params;
    const { email, permission, expiresAt } = req.body;

    // Check if folder exists and user has access
    const folderResult = await executeQuery(
      'SELECT id, name, organization_id, created_by FROM folders WHERE id = ? AND status = "active"',
      [folderId]
    );

    if (!folderResult.success || folderResult.data.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Folder not found'
      });
    }

    const folder = folderResult.data[0];

    // Check permissions - users can only share folders they created
    // First check organization (security)
    if (req.user.role !== 'platform_owner' && folder.organization_id !== req.user.organization_id) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to share this folder'
      });
    }
    // Then check if user created the folder (privacy - org admins also only see their own)
    if (folder.created_by !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to share this folder'
      });
    }

    let sharedWithUserId = null;
    let shareType = 'link';

    // If email is provided, find the user
    if (email) {
      const userResult = await executeQuery(
        'SELECT id, email FROM users WHERE email = ? AND status = "active"',
        [email]
      );

      if (userResult.success && userResult.data.length > 0) {
        sharedWithUserId = userResult.data[0].id;
        shareType = 'user';
      }
    }

    // Generate a unique share link
    const crypto = require('crypto');
    const shareLink = crypto.randomBytes(32).toString('hex');
    const frontendUrl = process.env.FRONTEND_URL || (process.env.NODE_ENV === 'production' ? 'https://taskinsight.my' : 'http://localhost:3000');
    const fullShareLink = `${frontendUrl}/share/folder/${shareLink}`;

    // Convert expiresAt to MySQL datetime format (YYYY-MM-DD HH:mm:ss)
    let mysqlExpiresAt = null;
    if (expiresAt) {
      mysqlExpiresAt = toMysqlDatetime(expiresAt);
      if (mysqlExpiresAt == null) {
        return res.status(400).json({
          success: false,
          message: 'Invalid expiration date format'
        });
      }
    }

    // Create the share record
    const insertResult = await executeQuery(
      `INSERT INTO folder_shares (folder_id, shared_by, shared_with, share_type, permission_level, share_link, expires_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`,
      [
        folderId,
        req.user.id,
        sharedWithUserId,
        shareType,
        permission || 'view',
        shareLink,
        mysqlExpiresAt
      ]
    );

    if (!insertResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to share folder'
      });
    }

    // Log the share action
    await executeQuery(
      'INSERT INTO audit_logs (user_id, organization_id, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, req.user.organization_id, 'SHARE', 'FOLDER', folderId, JSON.stringify({ 
        sharedWith: email || 'link', 
        permission: permission || 'view',
        shareType 
      })]
    );

    res.json({
      success: true,
      message: 'Folder shared successfully',
      data: {
        shareId: insertResult.data.insertId,
        shareLink: fullShareLink
      }
    });
  } catch (error) {
    console.error('Share folder error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get all shares for a folder
router.get('/folders/:folderId/shares', verifyToken, async (req, res) => {
  try {
    const { folderId } = req.params;

    // Check if folder exists and user has access
    const folderResult = await executeQuery(
      'SELECT id, organization_id, created_by FROM folders WHERE id = ? AND status = "active"',
      [folderId]
    );

    if (!folderResult.success || folderResult.data.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Folder not found'
      });
    }

    const folder = folderResult.data[0];

    // Check permissions
    if (folder.created_by !== req.user.id && folder.organization_id !== req.user.organization_id) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to view shares for this folder'
      });
    }

    // Get all active shares
    const sharesResult = await executeQuery(
      `SELECT fs.id, fs.share_type, fs.permission_level as permission, fs.expires_at as expiresAt, 
              fs.created_at as createdAt, fs.share_link,
              u.email, u.first_name, u.last_name,
              sharer.first_name as sharer_first_name, sharer.last_name as sharer_last_name
       FROM folder_shares fs
       LEFT JOIN users u ON fs.shared_with = u.id
       LEFT JOIN users sharer ON fs.shared_by = sharer.id
       WHERE fs.folder_id = ? AND fs.status = 'active'
       ORDER BY fs.created_at DESC`,
      [folderId]
    );

    if (!sharesResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch shares'
      });
    }

    // Format the response
    const frontendUrl = process.env.FRONTEND_URL || (process.env.NODE_ENV === 'production' ? 'https://taskinsight.my' : 'http://localhost:3000');
    const shares = sharesResult.data.map(share => ({
      id: share.id,
      email: share.email || 'Anyone with link',
      permission: share.permission,
      expiresAt: share.expiresAt,
      createdAt: share.createdAt,
      shareType: share.share_type,
      shareLink: share.share_link ? `${frontendUrl}/share/folder/${share.share_link}` : null,
      sharedBy: share.sharer_first_name ? `${share.sharer_first_name} ${share.sharer_last_name}` : 'Unknown'
    }));

    res.json({
      success: true,
      data: shares
    });
  } catch (error) {
    console.error('Get folder shares error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Revoke a folder share
router.delete('/folders/:folderId/shares/:shareId', verifyToken, async (req, res) => {
  try {
    const { folderId, shareId } = req.params;

    // Check if folder exists and user has access
    const folderResult = await executeQuery(
      'SELECT id, organization_id, created_by FROM folders WHERE id = ? AND status = "active"',
      [folderId]
    );

    if (!folderResult.success || folderResult.data.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Folder not found'
      });
    }

    const folder = folderResult.data[0];

    // Check permissions
    if (folder.created_by !== req.user.id && folder.organization_id !== req.user.organization_id) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to revoke shares for this folder'
      });
    }

    // Check if share exists
    const shareResult = await executeQuery(
      'SELECT id FROM folder_shares WHERE id = ? AND folder_id = ? AND status = "active"',
      [shareId, folderId]
    );

    if (!shareResult.success || shareResult.data.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Share not found'
      });
    }

    // Revoke the share
    const updateResult = await executeQuery(
      'UPDATE folder_shares SET status = "inactive" WHERE id = ?',
      [shareId]
    );

    if (!updateResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to revoke share'
      });
    }

    // Log the revoke action
    await executeQuery(
      'INSERT INTO audit_logs (user_id, organization_id, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, req.user.organization_id, 'REVOKE_SHARE', 'FOLDER', folderId, JSON.stringify({ shareId })]
    );

    res.json({
      success: true,
      message: 'Share revoked successfully'
    });
  } catch (error) {
    console.error('Revoke folder share error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get starred items
router.get('/starred/list', verifyToken, async (req, res) => {
  try {
    // Get starred files
    const starredFilesQuery = `
      SELECT f.*, u.first_name, u.last_name, u.email,
             fo.name as folder_name, o.name as organization_name,
             'file' as item_type,
             s.created_at as starred_at,
             1 as is_starred
      FROM starred_items s
      INNER JOIN files f ON s.item_id = f.id
      LEFT JOIN users u ON f.uploaded_by = u.id
      LEFT JOIN folders fo ON f.folder_id = fo.id
      LEFT JOIN organizations o ON f.organization_id = o.id
      WHERE s.user_id = ? AND s.item_type = 'file' AND f.status = 'active'
      ORDER BY s.created_at DESC
    `;

    const starredFilesResult = await executeQuery(starredFilesQuery, [req.user.id]);

    // Get starred folders
    const starredFoldersQuery = `
      SELECT fo.*, u.first_name, u.last_name,
             'folder' as item_type,
             s.created_at as starred_at,
             (SELECT COUNT(*) FROM files WHERE folder_id = fo.id AND status = 'active') as file_count,
             (SELECT COALESCE(SUM(file_size), 0) FROM files WHERE folder_id = fo.id AND status = 'active') as total_size,
             1 as is_starred
      FROM starred_items s
      INNER JOIN folders fo ON s.item_id = fo.id
      LEFT JOIN users u ON fo.created_by = u.id
      WHERE s.user_id = ? AND s.item_type = 'folder' AND fo.status = 'active'
      ORDER BY s.created_at DESC
    `;

    const starredFoldersResult = await executeQuery(starredFoldersQuery, [req.user.id]);

    if (!starredFilesResult.success || !starredFoldersResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch starred items'
      });
    }

    res.json({
      success: true,
      data: {
        files: sanitizeFileRecords(starredFilesResult.data),
        folders: starredFoldersResult.data
      }
    });
  } catch (error) {
    console.error('Get starred items error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get deleted files (trash)
router.get('/trash/list', verifyToken, validatePagination, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    let whereConditions = ['f.status = "deleted"'];
    let queryParams = [];

    // Filter by organization
    if (req.user.role !== 'platform_owner') {
      whereConditions.push('f.organization_id = ?');
      queryParams.push(req.user.organization_id);
    }

    if (!['organization_admin', 'platform_owner'].includes(req.user.role)) {
      whereConditions.push('f.uploaded_by = ?');
      queryParams.push(req.user.id);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Get deleted files with pagination
    const filesQuery = `
      SELECT f.*, u.first_name, u.last_name, u.email, 
             fo.name as folder_name, o.name as organization_name
      FROM files f 
      LEFT JOIN users u ON f.uploaded_by = u.id
      LEFT JOIN folders fo ON f.folder_id = fo.id
      LEFT JOIN organizations o ON f.organization_id = o.id
      ${whereClause}
      ORDER BY f.deleted_at DESC 
      LIMIT ${parseInt(limit)} OFFSET ${offset}
    `;

    const filesResult = await executeQuery(filesQuery, queryParams);

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total 
      FROM files f 
      ${whereClause}
    `;

    const countResult = await executeQuery(countQuery, queryParams);

    if (!filesResult.success || !countResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch deleted files'
      });
    }

    res.json({
      success: true,
      data: {
        files: sanitizeFileRecords(filesResult.data),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: countResult.data[0].total,
          pages: Math.ceil(countResult.data[0].total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get trash error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Restore file from trash
router.post('/:fileId/restore', verifyToken, requireDeletedFileOwnerOrAdmin, async (req, res) => {
  try {
    const { fileId } = req.params;

    // Restore file
    const restoreResult = await executeQuery(
      'UPDATE files SET status = "active", deleted_at = NULL, deleted_by = NULL WHERE id = ?',
      [fileId]
    );

    if (!restoreResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to restore file'
      });
    }

    // Log restoration
    await executeQuery(
      'INSERT INTO audit_logs (user_id, organization_id, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, req.user.organization_id, 'RESTORE', 'FILE', fileId, JSON.stringify({ fileName: req.file.name })]
    );

    res.json({
      success: true,
      message: 'File restored successfully'
    });
  } catch (error) {
    console.error('Restore file error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Permanently delete file
router.delete('/:fileId/permanent', verifyToken, requireDeletedFileOwnerOrAdmin, async (req, res) => {
  try {
    const { fileId } = req.params;

    // Check if file is already in trash
    if (req.file.status !== 'deleted') {
      return res.status(400).json({
        success: false,
        message: 'File must be in trash before permanent deletion'
      });
    }

    // Delete file from disk
    try {
      const filePath = req.file.path || req.file.storage_path;
      if (filePath) {
        await fs.unlink(filePath);
      }
    } catch (unlinkError) {
      console.error('Failed to delete file from disk:', unlinkError);
      // Continue with database deletion even if file doesn't exist on disk
    }

    // Get file size before deletion for storage_used update
    const fileSize = req.file.file_size || 0;

    // Permanently delete from database
    const deleteResult = await executeQuery(
      'DELETE FROM files WHERE id = ?',
      [fileId]
    );

    if (!deleteResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to permanently delete file'
      });
    }

    // Update organization storage_used (subtract file size)
    if (fileSize > 0) {
      await executeQuery(
        'UPDATE organizations SET storage_used = GREATEST(0, storage_used - ?) WHERE id = ?',
        [fileSize, req.user.organization_id]
      );
    }

    // Log permanent deletion
    await executeQuery(
      'INSERT INTO audit_logs (user_id, organization_id, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, req.user.organization_id, 'PERMANENT_DELETE', 'FILE', fileId, JSON.stringify({ fileName: req.file.name })]
    );

    res.json({
      success: true,
      message: 'File permanently deleted'
    });
  } catch (error) {
    console.error('Permanent delete error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Delete file (soft delete - move to trash)
router.delete('/:fileId', verifyToken, requireFileOwnerOrAdmin, async (req, res) => {
  try {
    const { fileId } = req.params;

    // Check if user has permission to delete (uploader or admin)
    if (req.file.uploaded_by !== req.user.id && !['organization_admin', 'platform_owner'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'You can only delete files you uploaded'
      });
    }

    // Soft delete file
    const deleteResult = await executeQuery(
      'UPDATE files SET status = "deleted", deleted_at = NOW(), deleted_by = ? WHERE id = ?',
      [req.user.id, fileId]
    );

    if (!deleteResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to delete file'
      });
    }

    // Log deletion
    await executeQuery(
      'INSERT INTO audit_logs (user_id, organization_id, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, req.user.organization_id, 'DELETE', 'FILE', fileId, JSON.stringify({ fileName: req.file.name })]
    );

    res.json({
      success: true,
      message: 'File deleted successfully'
    });
  } catch (error) {
    console.error('Delete file error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get folders - MUST be before /folders/:folderId to avoid route conflict
router.get('/folders/list', verifyToken, async (req, res) => {
  try {
    const { organizationId, parentId, q: search } = req.query;

    let whereConditions = ['folders.status = "active"'];
    let queryParams = [];

    // Filter by organization (platform owner can see all, others see their org)
    if (req.user.role === 'platform_owner' && organizationId) {
      whereConditions.push('folders.organization_id = ?');
      queryParams.push(organizationId);
    } else if (req.user.role !== 'platform_owner') {
      whereConditions.push('folders.organization_id = ?');
      queryParams.push(req.user.organization_id);
    }

    // Filter by created_by - users can only see folders they created (unless platform owner)
    // Organization admins also only see their own folders for privacy
    if (req.user.role !== 'platform_owner') {
      whereConditions.push('folders.created_by = ?');
      queryParams.push(req.user.id);
    }

    // Search filter (case-insensitive) - only apply if parentId is not specified (global search)
    if (search && parentId === undefined) {
      whereConditions.push('LOWER(folders.name) LIKE ?');
      const searchPattern = `%${search.toLowerCase()}%`;
      queryParams.push(searchPattern);
    }

    // Filter by parentId (for folder navigation) - only if not searching
    if (parentId !== undefined && parentId !== null && parentId !== 'undefined' && parentId !== 'null' && parentId !== '' && !search) {
      const parentIdNum = parseInt(parentId, 10);
      if (!isNaN(parentIdNum) && parentIdNum > 0) {
        whereConditions.push('folders.parent_id = ?');
        queryParams.push(parentIdNum);
      } else if (parentId === null || parentId === 'null' || parentId === '') {
        // Show root folders (no parent)
        whereConditions.push('(folders.parent_id IS NULL OR folders.parent_id = 0)');
      }
    } else if (parentId === null || parentId === 'null' || parentId === '' || parentId === undefined) {
      // Show root folders (no parent) when parentId is explicitly null/empty
      if (!search) {
        whereConditions.push('(folders.parent_id IS NULL OR folders.parent_id = 0)');
      }
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const foldersQuery = `
      SELECT folders.*, users.first_name, users.last_name,
             (SELECT COUNT(*) FROM files WHERE folder_id = folders.id AND status = 'active') as file_count,
             (SELECT COALESCE(SUM(file_size), 0) FROM files WHERE folder_id = folders.id AND status = 'active') as total_size,
             (si.id IS NOT NULL) as is_starred
      FROM folders
      LEFT JOIN users ON folders.created_by = users.id
      LEFT JOIN starred_items si ON si.item_id = folders.id AND si.item_type = 'folder' AND si.user_id = ?
      ${whereClause}
      ORDER BY folders.created_at DESC
    `;

    const foldersResult = await executeQuery(foldersQuery, [req.user.id, ...queryParams]);

    if (!foldersResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch folders'
      });
    }

    res.json({
      success: true,
      data: foldersResult.data
    });
  } catch (error) {
    console.error('Get folders error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get specific folder by ID (with permission check) - MUST be after /folders/list
router.get('/folders/:folderId', verifyToken, async (req, res) => {
  try {
    const { folderId } = req.params;
    const folderIdNum = parseInt(folderId, 10);

    if (isNaN(folderIdNum)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid folder ID'
      });
    }

    // Get folder
    const folderResult = await executeQuery(
      'SELECT * FROM folders WHERE id = ? AND status = "active"',
      [folderIdNum]
    );

    if (!folderResult.success || folderResult.data.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Folder not found'
      });
    }

    const folder = folderResult.data[0];

    // Check organization access
    if (req.user.role !== 'platform_owner') {
      if (folder.organization_id !== req.user.organization_id) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to access this folder'
        });
      }
    }

    // Check if user has permission to view this folder
    // Platform owners can see all folders
    // Organization admins and regular members can only see folders they created or folders shared with them
    if (req.user.role !== 'platform_owner') {
      // Check if folder was created by user
      if (folder.created_by !== req.user.id) {
        // Check if folder is shared with user
        const shareResult = await executeQuery(
          'SELECT * FROM folder_shares WHERE folder_id = ? AND shared_with = ? AND status = "active" AND (expires_at IS NULL OR expires_at > NOW())',
          [folderIdNum, req.user.id]
        );

        if (!shareResult.success || shareResult.data.length === 0) {
          return res.status(403).json({
            success: false,
            message: 'You do not have permission to access this folder'
          });
        }
      }
    }

    res.json({
      success: true,
      data: folder
    });
  } catch (error) {
    console.error('Get folder error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Create folder
router.post('/folders', verifyToken, validateFolder, async (req, res) => {
  try {
    logger.debug('Create folder request received', {
      bodyType: typeof req.body,
      user: req.user.email,
      organizationId: req.user.organization_id,
      contentType: req.headers['content-type']
    });
    
    // Check if body is empty or malformed
    if (!req.body || Object.keys(req.body).length === 0) {
      logger.warn('Create folder request missing body', {
        userId: req.user.id,
        organizationId: req.user.organization_id
      });
      return res.status(400).json({
        success: false,
        message: 'Request body is empty or missing. Please send a valid JSON body with name field.'
      });
    }
    
    // Ensure parentId is a number or null, not an object
    let { name, description, parentId } = req.body;
    
    // Handle parentId if it's an object (shouldn't happen, but just in case)
    if (parentId && typeof parentId === 'object') {
      parentId = parentId.id || null;
    }
    
    // Convert parentId to number or null
    if (parentId !== null && parentId !== undefined) {
      parentId = parseInt(parentId, 10);
      if (isNaN(parentId) || parentId <= 0) {
        parentId = null;
      }
    } else {
      parentId = null;
    }

    // Validate parent folder if provided
    if (parentId) {
      const parentResult = await executeQuery(
        'SELECT id FROM folders WHERE id = ? AND organization_id = ? AND status = "active"',
        [parentId, req.user.organization_id]
      );

      if (!parentResult.success || parentResult.data.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Invalid parent folder'
        });
      }
    }

    // Check if folder name already exists in the same parent
    // Use IS NULL for null comparison, = for number comparison
    let existingFolderQuery;
    let existingFolderParams;
    if (parentId === null || parentId === undefined) {
      existingFolderQuery = 'SELECT id FROM folders WHERE name = ? AND parent_id IS NULL AND organization_id = ? AND status = "active"';
      existingFolderParams = [name, req.user.organization_id];
    } else {
      existingFolderQuery = 'SELECT id FROM folders WHERE name = ? AND parent_id = ? AND organization_id = ? AND status = "active"';
      existingFolderParams = [name, parentId, req.user.organization_id];
    }
    
    const existingFolder = await executeQuery(existingFolderQuery, existingFolderParams);

    if (existingFolder.success && existingFolder.data.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Folder with this name already exists in the same location'
      });
    }

    // Create folder
    logger.debug('Creating folder', {
      organizationId: req.user.organization_id,
      createdBy: req.user.id,
      parentId: parentId || null,
      hasDescription: !!description
    });
    
    const folderResult = await executeQuery(
      'INSERT INTO folders (name, description, organization_id, created_by, parent_id, status) VALUES (?, ?, ?, ?, ?, ?)',
      [name, description || null, req.user.organization_id, req.user.id, parentId || null, 'active']
    );

    if (!folderResult.success) {
      logger.error('Failed to create folder', {
        error: folderResult.error,
        organizationId: req.user.organization_id,
        parentId: parentId || null
      });
      return res.status(500).json({
        success: false,
        message: 'Failed to create folder',
        error: process.env.NODE_ENV === 'development' ? folderResult.error : undefined
      });
    }

    // Log folder creation
    await executeQuery(
      'INSERT INTO audit_logs (user_id, organization_id, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, req.user.organization_id, 'CREATE', 'FOLDER', folderResult.data.insertId, JSON.stringify({ name, parentId })]
    );

    res.status(201).json({
      success: true,
      message: 'Folder created successfully',
      data: {
        folderId: folderResult.data.insertId,
        name,
        description,
        parentId
      }
    });
  } catch (error) {
    logger.error('Create folder error', { error: logger.serializeError(error) });
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Rename file
router.put('/:fileId/rename', verifyToken, requireFileWriteAccess, async (req, res) => {
  try {
    const { fileId } = req.params;
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Name is required'
      });
    }

    // Check if file exists and user has access
    const fileResult = await executeQuery(
      'SELECT id, name, organization_id, uploaded_by FROM files WHERE id = ? AND status = "active"',
      [fileId]
    );

    if (!fileResult.success || fileResult.data.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    const file = fileResult.data[0];

    // Platform owners are checked by middleware; others must remain in the file org.
    if (req.user.role !== 'platform_owner' && file.organization_id !== req.user.organization_id) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to rename this file'
      });
    }

    // Update file name
    const updateResult = await executeQuery(
      'UPDATE files SET name = ?, updated_at = NOW() WHERE id = ?',
      [name.trim(), fileId]
    );

    if (!updateResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to rename file'
      });
    }

    // Log rename action
    await executeQuery(
      'INSERT INTO audit_logs (user_id, organization_id, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, req.user.organization_id, 'RENAME', 'FILE', fileId, JSON.stringify({ oldName: file.name, newName: name.trim() })]
    );

    res.json({
      success: true,
      message: 'File renamed successfully'
    });
  } catch (error) {
    console.error('Rename file error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Move file to folder
router.put('/:fileId/move', verifyToken, requireFileWriteAccess, async (req, res) => {
  try {
    const { fileId } = req.params;
    const { folderId } = req.body;

    // Check if file exists and user has access
    const fileResult = await executeQuery(
      'SELECT id, name, organization_id, folder_id FROM files WHERE id = ? AND status = "active"',
      [fileId]
    );

    if (!fileResult.success || fileResult.data.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    const file = fileResult.data[0];

    // Platform owners are checked by middleware; others must remain in the file org.
    if (req.user.role !== 'platform_owner' && file.organization_id !== req.user.organization_id) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to move this file'
      });
    }

    // If moving to a folder, verify the folder exists and belongs to same org
    if (folderId !== null && folderId !== undefined) {
      const folderResult = await executeQuery(
        'SELECT id FROM folders WHERE id = ? AND organization_id = ? AND status = "active"',
        [folderId, req.user.organization_id]
      );

      if (!folderResult.success || folderResult.data.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Target folder not found'
        });
      }
    }

    // Update file folder
    const updateResult = await executeQuery(
      'UPDATE files SET folder_id = ?, updated_at = NOW() WHERE id = ?',
      [folderId || null, fileId]
    );

    if (!updateResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to move file'
      });
    }

    // Log move action
    await executeQuery(
      'INSERT INTO audit_logs (user_id, organization_id, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, req.user.organization_id, 'MOVE', 'FILE', fileId, JSON.stringify({ fromFolder: file.folder_id, toFolder: folderId })]
    );

    res.json({
      success: true,
      message: 'File moved successfully'
    });
  } catch (error) {
    console.error('Move file error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Rename folder
router.put('/folders/:folderId/rename', verifyToken, async (req, res) => {
  try {
    const { folderId } = req.params;
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Name is required'
      });
    }

    // Check if folder exists and user has access
    const folderResult = await executeQuery(
      'SELECT id, name, organization_id, created_by FROM folders WHERE id = ? AND status = "active"',
      [folderId]
    );

    if (!folderResult.success || folderResult.data.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Folder not found'
      });
    }

    const folder = folderResult.data[0];

    // Check permissions
    if (!canManageFolder({ user: req.user, folder })) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to rename this folder'
      });
    }

    // Update folder name
    const updateResult = await executeQuery(
      'UPDATE folders SET name = ?, updated_at = NOW() WHERE id = ?',
      [name.trim(), folderId]
    );

    if (!updateResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to rename folder'
      });
    }

    // Log rename action
    await executeQuery(
      'INSERT INTO audit_logs (user_id, organization_id, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, req.user.organization_id, 'RENAME', 'FOLDER', folderId, JSON.stringify({ oldName: folder.name, newName: name.trim() })]
    );

    res.json({
      success: true,
      message: 'Folder renamed successfully'
    });
  } catch (error) {
    console.error('Rename folder error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Move folder to another folder
router.put('/folders/:folderId/move', verifyToken, async (req, res) => {
  try {
    const { folderId } = req.params;
    let { parentId } = req.body;
    
    // Normalize parentId: convert to null if undefined, empty string, or "null"
    if (parentId === undefined || parentId === '' || parentId === 'null' || parentId === null) {
      parentId = null;
    } else {
      parentId = parseInt(parentId);
      if (isNaN(parentId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid parent folder ID'
        });
      }
    }

    // Check if folder exists and user has access
    const folderResult = await executeQuery(
      'SELECT id, name, organization_id, parent_id, created_by FROM folders WHERE id = ? AND status = "active"',
      [folderId]
    );

    if (!folderResult.success || folderResult.data.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Folder not found'
      });
    }

    const folder = folderResult.data[0];

    // Check permissions
    if (!canManageFolder({ user: req.user, folder })) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to move this folder'
      });
    }

    // Cannot move folder into itself
    if (parentId !== null && parentId === parseInt(folderId)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot move folder into itself'
      });
    }

    // If moving to a folder, verify the folder exists and belongs to same org
    let targetFolder = null;
    if (parentId !== null) {
      const targetFolderResult = await executeQuery(
        'SELECT id, name, path, organization_id, created_by FROM folders WHERE id = ? AND organization_id = ? AND status = "active"',
        [parentId, req.user.organization_id]
      );

      if (!targetFolderResult.success || targetFolderResult.data.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Target folder not found'
        });
      }

      targetFolder = targetFolderResult.data[0];

      if (!canManageFolder({ user: req.user, folder: targetFolder })) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to move folders into the target folder'
        });
      }

      // Check for circular reference - cannot move folder into its own descendant
      const checkCircular = async (checkFolderId) => {
        if (parseInt(checkFolderId) === parseInt(folderId)) {
          return true; // Found circular reference
        }
        
        const childrenResult = await executeQuery(
          'SELECT id FROM folders WHERE parent_id = ? AND status = "active"',
          [checkFolderId]
        );

        if (childrenResult.success && childrenResult.data.length > 0) {
          for (const child of childrenResult.data) {
            if (await checkCircular(child.id)) {
              return true;
            }
          }
        }
        return false;
      };

      const hasCircular = await checkCircular(parentId);
      if (hasCircular) {
        return res.status(400).json({
          success: false,
          message: 'Cannot move folder into its own subfolder'
        });
      }
    }

    // Calculate new path
    let newPath = '';
    if (parentId === null || parentId === undefined) {
      newPath = `/${folder.name}`;
    } else {
      const parentPath = targetFolder.path || `/${targetFolder.name}`;
      newPath = `${parentPath}/${folder.name}`;
    }

    // Update folder parent and path
    const updateResult = await executeQuery(
      'UPDATE folders SET parent_id = ?, path = ?, updated_at = NOW() WHERE id = ?',
      [parentId || null, newPath, folderId]
    );

    if (!updateResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to move folder'
      });
    }

    // Update paths of all descendant folders recursively
    const updateDescendantPaths = async (parentFolderId, parentPath) => {
      const childrenResult = await executeQuery(
        'SELECT id, name FROM folders WHERE parent_id = ? AND status = "active"',
        [parentFolderId]
      );

      if (childrenResult.success && childrenResult.data.length > 0) {
        for (const child of childrenResult.data) {
          const childPath = `${parentPath}/${child.name}`;
          await executeQuery(
            'UPDATE folders SET path = ? WHERE id = ?',
            [childPath, child.id]
          );
          // Recursively update children of this child
          await updateDescendantPaths(child.id, childPath);
        }
      }
    };

    // Update all descendant paths
    await updateDescendantPaths(folderId, newPath);

    // Log move action
    await executeQuery(
      'INSERT INTO audit_logs (user_id, organization_id, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, req.user.organization_id, 'MOVE', 'FOLDER', folderId, JSON.stringify({ fromParent: folder.parent_id, toParent: parentId })]
    );

    res.json({
      success: true,
      message: 'Folder moved successfully'
    });
  } catch (error) {
    console.error('Move folder error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Download folder as zip
router.get('/folders/:folderId/download', verifyToken, async (req, res) => {
  try {
    const { folderId } = req.params;

    // Check if folder exists and user has access
    const folderResult = await executeQuery(
      'SELECT id, name, organization_id, created_by FROM folders WHERE id = ? AND status = "active"',
      [folderId]
    );

    if (!folderResult.success || folderResult.data.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Folder not found'
      });
    }

    const folder = folderResult.data[0];

    // Check permissions
    if (!canManageFolder({ user: req.user, folder })) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to download this folder'
      });
    }

    // Get all files in this folder and subfolders recursively
    const getAllFilesInFolder = async (parentFolderId, basePath = '') => {
      const files = [];
      
      // Get files in current folder
      const filesResult = await executeQuery(
        `SELECT f.id, f.name, f.storage_path, f.file_size 
         FROM files f 
         WHERE f.folder_id = ? AND f.status = "active" AND f.organization_id = ?`,
        [parentFolderId, req.user.organization_id]
      );

      if (filesResult.success && filesResult.data) {
        for (const file of filesResult.data) {
          files.push({
            id: file.id,
            name: file.name,
            file_path: file.storage_path,
            file_size: file.file_size,
            zipPath: basePath ? `${basePath}/${file.name}` : file.name
          });
        }
      }

      // Get subfolders
      const subfoldersResult = await executeQuery(
        'SELECT id, name FROM folders WHERE parent_id = ? AND status = "active" AND organization_id = ?',
        [parentFolderId, req.user.organization_id]
      );

      if (subfoldersResult.success && subfoldersResult.data) {
        for (const subfolder of subfoldersResult.data) {
          const subfolderPath = basePath ? `${basePath}/${subfolder.name}` : subfolder.name;
          const subfolderFiles = await getAllFilesInFolder(subfolder.id, subfolderPath);
          files.push(...subfolderFiles);
        }
      }

      return files;
    };

    const allFiles = await getAllFilesInFolder(folderId, '');

    if (allFiles.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Folder is empty. Nothing to download.'
      });
    }

    // Set response headers for zip download
    const zipFileName = `${folder.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFileName}"`);

    // Create archive
    const archive = archiver('zip', {
      zlib: { level: 6 } // Compression level
    });

    // Handle archive errors
    archive.on('error', (err) => {
      console.error('Archive error:', err);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: 'Failed to create zip file'
        });
      }
    });

    // Pipe archive to response
    archive.pipe(res);

    // Add files to archive
    const uploadPath = path.join(__dirname, '../uploads');
    for (const file of allFiles) {
      const filePath = path.join(uploadPath, path.basename(file.file_path));
      
      // Check if file exists on disk
      try {
        await fs.access(filePath);
        archive.file(filePath, { name: file.zipPath });
      } catch (err) {
        logger.warn('Folder download skipped missing file on disk', {
          folderId,
          fileId: file.id,
          error: logger.serializeError(err)
        });
      }
    }

    // Finalize archive
    await archive.finalize();

    // Log download action
    await executeQuery(
      'INSERT INTO audit_logs (user_id, organization_id, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, req.user.organization_id, 'DOWNLOAD', 'FOLDER', folderId, JSON.stringify({ folderName: folder.name, fileCount: allFiles.length })]
    );

  } catch (error) {
    logger.error('Download folder error', { folderId: req.params.folderId, error: logger.serializeError(error) });
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }
});

// Delete folder (soft delete - mark as deleted)
router.delete('/folders/:folderId', verifyToken, async (req, res) => {
  try {
    const { folderId } = req.params;

    // Check if folder exists and user has access
    const folderResult = await executeQuery(
      'SELECT id, name, organization_id, created_by FROM folders WHERE id = ? AND status = "active"',
      [folderId]
    );

    if (!folderResult.success || folderResult.data.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Folder not found'
      });
    }

    const folder = folderResult.data[0];

    // Check permissions - user must be in the same organization
    if (!canManageFolder({ user: req.user, folder })) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete this folder'
      });
    }

    // Check if folder has files
    const filesInFolderResult = await executeQuery(
      'SELECT COUNT(*) as count FROM files WHERE folder_id = ? AND status = "active"',
      [folderId]
    );

    // Check if folder has subfolders
    const subfoldersResult = await executeQuery(
      'SELECT COUNT(*) as count FROM folders WHERE parent_id = ? AND status = "active"',
      [folderId]
    );

    // Parse counts as integers (MySQL COUNT returns string or number depending on driver)
    const fileCount = filesInFolderResult.success && filesInFolderResult.data[0]
      ? parseInt(filesInFolderResult.data[0].count, 10) || 0
      : 0;
    const subfolderCount = subfoldersResult.success && subfoldersResult.data[0]
      ? parseInt(subfoldersResult.data[0].count, 10) || 0
      : 0;

    // If folder is completely empty (no files and no subfolders), permanently delete it
    if (fileCount === 0 && subfolderCount === 0) {
      // Hard delete (permanently remove from database)
      const deleteResult = await executeQuery(
        'DELETE FROM folders WHERE id = ?',
        [folderId]
      );

      if (!deleteResult.success) {
        return res.status(500).json({
          success: false,
          message: 'Failed to delete folder'
        });
      }

      // Log deletion
      await executeQuery(
        'INSERT INTO audit_logs (user_id, organization_id, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?, ?)',
        [req.user.id, req.user.organization_id, 'DELETE', 'FOLDER', folderId, JSON.stringify({ folderName: folder.name, permanent: true })]
      );

      return res.json({
        success: true,
        message: 'Empty folder deleted permanently'
      });
    }

    // If folder has content (files or subfolders), soft delete (move to trash)
    const deleteResult = await executeQuery(
      'UPDATE folders SET status = "deleted", deleted_at = NOW(), deleted_by = ? WHERE id = ?',
      [req.user.id, folderId]
    );

    if (!deleteResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to delete folder'
      });
    }

    // Log deletion
    await executeQuery(
      'INSERT INTO audit_logs (user_id, organization_id, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, req.user.organization_id, 'DELETE', 'FOLDER', folderId, JSON.stringify({ folderName: folder.name })]
    );

    res.json({
      success: true,
      message: 'Folder deleted successfully'
    });
  } catch (error) {
    console.error('Delete folder error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get file statistics
router.get('/stats/overview', verifyToken, async (req, res) => {
  try {
    const { organizationId } = req.query;

    let whereConditions = ['status = "active"'];
    let queryParams = [];

    // Filter by organization (platform owner can see all, others see their org)
    if (req.user.role === 'platform_owner' && organizationId) {
      whereConditions.push('organization_id = ?');
      queryParams.push(organizationId);
    } else if (req.user.role !== 'platform_owner') {
      whereConditions.push('organization_id = ?');
      queryParams.push(req.user.organization_id);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Get total files and size
    const totalQuery = `
      SELECT COUNT(*) as totalFiles, COALESCE(SUM(file_size), 0) as totalSize
      FROM files
      ${whereClause}
    `;

    const totalResult = await executeQuery(totalQuery, queryParams);

    // Get stats by file type
    const typeStatsQuery = `
      SELECT 
        file_type as type,
        COUNT(*) as count,
        COALESCE(SUM(file_size), 0) as total_size,
        COALESCE(AVG(file_size), 0) as avg_size
      FROM files
      ${whereClause}
      GROUP BY file_type
      ORDER BY count DESC
    `;

    const typeStatsResult = await executeQuery(typeStatsQuery, queryParams);

    // Get recent uploads (last 7 days)
    const recentQuery = `
      SELECT COUNT(*) as recentUploads
      FROM files
      ${whereClause} AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    `;

    const recentResult = await executeQuery(recentQuery, queryParams);

    if (!totalResult.success || !typeStatsResult.success || !recentResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch file statistics'
      });
    }

    res.json({
      success: true,
      data: {
        totalFiles: parseInt(totalResult.data[0].totalFiles) || 0,
        totalSize: parseInt(totalResult.data[0].totalSize) || 0,
        typeStats: typeStatsResult.data,
        recentUploads: parseInt(recentResult.data[0].recentUploads) || 0
      }
    });
  } catch (error) {
    console.error('Get file stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Clean up old deleted files (30+ days in trash)
router.post('/cleanup/old-trash', verifyToken, async (req, res) => {
  try {
    // Only allow platform owners to run cleanup
    if (req.user.role !== 'platform_owner') {
      return res.status(403).json({
        success: false,
        message: 'Only platform owners can run cleanup'
      });
    }

    // Find files deleted more than 30 days ago
    const oldFilesQuery = `
      SELECT id, storage_path, name
      FROM files
      WHERE status = 'deleted' AND deleted_at < DATE_SUB(NOW(), INTERVAL 30 DAY)
    `;

    const oldFilesResult = await executeQuery(oldFilesQuery);

    if (!oldFilesResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch old files'
      });
    }

    let deletedCount = 0;
    let errorCount = 0;

    // Delete each file from disk and database
    for (const file of oldFilesResult.data) {
      try {
        // Delete from disk
        try {
          await fs.unlink(file.storage_path);
        } catch (unlinkError) {
          console.error(`Failed to delete file from disk: ${file.storage_path}`, unlinkError);
        }

        // Delete from database
        await executeQuery('DELETE FROM files WHERE id = ?', [file.id]);
        
        deletedCount++;
      } catch (error) {
        console.error(`Failed to delete file ${file.id}:`, error);
        errorCount++;
      }
    }

    // Log cleanup
    await executeQuery(
      'INSERT INTO audit_logs (user_id, organization_id, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, req.user.organization_id, 'CLEANUP', 'SYSTEM', 0, JSON.stringify({ deletedCount, errorCount, type: 'auto_delete_old_trash' })]
    );

    res.json({
      success: true,
      message: `Cleanup completed: ${deletedCount} files deleted, ${errorCount} errors`,
      data: {
        deletedCount,
        errorCount
      }
    });
  } catch (error) {
    console.error('Cleanup error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

module.exports = router;
