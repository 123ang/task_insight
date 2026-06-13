const path = require('path');
const { execFile } = require('child_process');
const { executeQuery } = require('../config/database');
const { logger } = require('./logger');

const DEFAULT_ALLOWED_EXTENSIONS = [
  'pdf',
  'doc',
  'docx',
  'txt',
  'jpg',
  'jpeg',
  'png',
  'gif',
  'mp4',
  'avi',
  'mov',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'zip',
  'rar',
];

const EXTENSION_MIME_TYPES = {
  pdf: ['application/pdf'],
  doc: ['application/msword', 'application/octet-stream'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip', 'application/octet-stream'],
  txt: ['text/plain', 'application/octet-stream'],
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  png: ['image/png'],
  gif: ['image/gif'],
  mp4: ['video/mp4'],
  avi: ['video/x-msvideo', 'video/avi', 'application/octet-stream'],
  mov: ['video/quicktime', 'video/mp4', 'application/octet-stream'],
  xls: ['application/vnd.ms-excel', 'application/octet-stream'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip', 'application/octet-stream'],
  ppt: ['application/vnd.ms-powerpoint', 'application/octet-stream'],
  pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/zip', 'application/octet-stream'],
  zip: ['application/zip', 'application/x-zip-compressed', 'multipart/x-zip'],
  rar: ['application/vnd.rar', 'application/x-rar-compressed', 'application/octet-stream'],
};

const parseCsv = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim().toLowerCase()).filter(Boolean);
  }

  if (!value || typeof value !== 'string') {
    return [];
  }

  return value.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
};

const getAllowedExtensions = (policy = {}) => {
  const policyExtensions = parseCsv(policy.allowedFileTypes || policy.allowedExtensions);
  if (policyExtensions.length > 0) {
    return policyExtensions.map((ext) => ext.replace(/^\./, ''));
  }

  const envExtensions = parseCsv(process.env.ALLOWED_FILE_TYPES);
  return envExtensions.length > 0 ? envExtensions : DEFAULT_ALLOWED_EXTENSIONS;
};

const getAllowedMimeTypes = (allowedExtensions, policy = {}) => {
  const policyMimeTypes = parseCsv(policy.allowedMimeTypes);
  if (policyMimeTypes.length > 0) {
    return policyMimeTypes;
  }

  const envMimeTypes = parseCsv(process.env.ALLOWED_MIME_TYPES);
  if (envMimeTypes.length > 0) {
    return envMimeTypes;
  }

  return allowedExtensions.flatMap((ext) => EXTENSION_MIME_TYPES[ext] || []);
};

const getFileExtension = (filename) => {
  return path.extname(filename || '').toLowerCase().replace('.', '');
};

const isGenericMime = (mimeType) => {
  return !mimeType || mimeType === 'application/octet-stream' || mimeType === 'binary/octet-stream';
};

const validateUploadedFile = (file, policy = {}) => {
  if (!file) {
    return { success: false, message: 'No file uploaded. Please select a file to upload.' };
  }

  const allowedExtensions = getAllowedExtensions(policy);
  const allowedMimeTypes = getAllowedMimeTypes(allowedExtensions, policy);
  const extension = getFileExtension(file.originalname);
  const mimeType = String(file.mimetype || '').toLowerCase();
  const maxSize = Number(policy.maxFileSize || process.env.MAX_FILE_SIZE || 100 * 1024 * 1024);

  if (!extension) {
    return { success: false, message: 'Uploaded file must include a file extension.' };
  }

  if (!allowedExtensions.includes(extension)) {
    return { success: false, message: `File type .${extension} is not allowed.` };
  }

  if (Number.isFinite(maxSize) && file.size > maxSize) {
    return { success: false, message: `File exceeds the maximum allowed size of ${maxSize} bytes.` };
  }

  const expectedMimeTypes = EXTENSION_MIME_TYPES[extension] || [];
  if (!isGenericMime(mimeType)) {
    if (allowedMimeTypes.length > 0 && !allowedMimeTypes.includes(mimeType)) {
      return { success: false, message: `File MIME type ${mimeType} is not allowed.` };
    }

    if (expectedMimeTypes.length > 0 && !expectedMimeTypes.includes(mimeType)) {
      return { success: false, message: `File extension .${extension} does not match MIME type ${mimeType}.` };
    }
  }

  return { success: true };
};

const getOrganizationUploadPolicy = async (organizationId) => {
  try {
    const result = await executeQuery(
      'SELECT allowed_file_types, allowed_mime_types, max_file_size, malware_scan_enabled FROM organizations WHERE id = ?',
      [organizationId]
    );

    if (!result.success || !result.data?.[0]) {
      return {};
    }

    const row = result.data[0];
    return {
      allowedFileTypes: row.allowed_file_types,
      allowedMimeTypes: row.allowed_mime_types,
      maxFileSize: row.max_file_size,
      malwareScanEnabled: row.malware_scan_enabled === 1 || row.malware_scan_enabled === true,
    };
  } catch (error) {
    logger.warn('Organization upload policy unavailable; falling back to defaults', {
      organizationId,
      error: logger.serializeError(error),
    });
    return {};
  }
};

const splitArgs = (value) => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'string') return [];
  return value.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((arg) => arg.replace(/^"|"$/g, '')) || [];
};

const runMalwareScan = (filePath, options = {}) => {
  const enabled = options.malwareScanEnabled || process.env.MALWARE_SCAN_ENABLED === 'true';
  const command = options.malwareScanCommand || process.env.MALWARE_SCAN_COMMAND;
  const timeout = Number(options.malwareScanTimeoutMs || process.env.MALWARE_SCAN_TIMEOUT_MS || 30000);

  if (!enabled || !command) {
    return Promise.resolve({ success: true, skipped: true });
  }

  const rawArgs = splitArgs(options.malwareScanArgs || process.env.MALWARE_SCAN_ARGS);
  const hasFilePlaceholder = rawArgs.some((arg) => arg.includes('{filePath}'));
  const args = rawArgs.map((arg) => arg.replace('{filePath}', filePath));
  if (!hasFilePlaceholder) {
    args.push(filePath);
  }

  return new Promise((resolve) => {
    execFile(command, args, { timeout }, (error, stdout, stderr) => {
      if (error) {
        logger.warn('Malware scan rejected upload', {
          filePath: path.basename(filePath),
          exitCode: error.code,
          signal: error.signal,
          stderr: stderr ? String(stderr).slice(0, 500) : undefined,
        });
        resolve({
          success: false,
          message: 'File failed malware scanning and was rejected.',
        });
        return;
      }

      resolve({
        success: true,
        output: stdout ? String(stdout).slice(0, 500) : undefined,
      });
    });
  });
};

module.exports = {
  DEFAULT_ALLOWED_EXTENSIONS,
  EXTENSION_MIME_TYPES,
  getAllowedExtensions,
  getAllowedMimeTypes,
  getOrganizationUploadPolicy,
  runMalwareScan,
  validateUploadedFile,
};
