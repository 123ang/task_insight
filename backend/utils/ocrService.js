const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { logger } = require('./logger');

const UPLOAD_DIR = path.join(__dirname, '../uploads');
const DEFAULT_COMMAND = process.env.OCR_TEXT_COMMAND || 'pdftotext';
const DEFAULT_ARGS = ['-layout', '{input}', '{output}'];
const DEFAULT_IMAGE_CONVERT_COMMAND = process.env.OCR_PDF_IMAGE_COMMAND || 'pdftoppm';
const DEFAULT_IMAGE_CONVERT_ARGS = ['-r', '300', '-png', '{input}', '{prefix}'];
const DEFAULT_IMAGE_TEXT_COMMAND = process.env.OCR_IMAGE_TEXT_COMMAND || 'tesseract';
const DEFAULT_IMAGE_TEXT_ARGS = ['{image}', 'stdout', '-l', process.env.OCR_IMAGE_LANG || 'eng'];
const ignoreCleanupError = () => undefined;

const isPdfFile = (file = {}) => {
  const fileType = String(file.file_type || '').toLowerCase();
  const fileName = String(file.name || file.original_name || '').toLowerCase();

  return fileType.includes('pdf') || fileName.endsWith('.pdf');
};

const getOcrTextFileName = (file = {}) => {
  const sourceName = file.name || file.original_name || `ocr-${Date.now()}.pdf`;
  const parsed = path.parse(sourceName);
  return `${parsed.name || sourceName}.txt`;
};

const getUniqueOcrTextFileName = async(sourceFile, executeQuery) => {
  const baseName = getOcrTextFileName(sourceFile);
  const folderId = sourceFile.folder_id || null;
  const query = folderId
    ? 'SELECT id FROM files WHERE name = ? AND folder_id = ? AND organization_id = ? AND status = "active" LIMIT 1'
    : 'SELECT id FROM files WHERE name = ? AND folder_id IS NULL AND organization_id = ? AND status = "active" LIMIT 1';
  const params = folderId
    ? [baseName, folderId, sourceFile.organization_id]
    : [baseName, sourceFile.organization_id];
  const existingResult = await executeQuery(query, params);

  if (!existingResult.success || existingResult.data.length === 0) {
    return baseName;
  }

  const parsed = path.parse(baseName);
  return `${parsed.name}-ocr-${Date.now()}.txt`;
};

const splitArgs = (value, fallbackArgs = DEFAULT_ARGS) => {
  if (Array.isArray(value)) {
    return value;
  }
  if (!value || typeof value !== 'string') {
    return fallbackArgs;
  }

  return value.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((arg) => arg.replace(/^"|"$/g, '')) || fallbackArgs;
};

const replacePlaceholders = (args, inputPath, outputPath, ocrPdfOutputPath) => {
  return args.map((arg) => arg
    .replace('{input}', inputPath)
    .replace('{output}', outputPath)
    .replace('{ocrPdfOutput}', ocrPdfOutputPath));
};

const replaceNamedPlaceholders = (args, replacements) => {
  return args.map((arg) => Object.entries(replacements).reduce((value, [key, replacement]) => {
    return value.replaceAll(`{${key}}`, replacement);
  }, arg));
};

const runCommand = (command, args, timeoutMs) => {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        resolve({
          success: false,
          error,
          stdout,
          stderr
        });
        return;
      }

      resolve({
        success: true,
        stdout,
        stderr
      });
    });
  });
};

const isImageOcrEnabled = (options) => {
  if (typeof options.imageOcrEnabled === 'boolean') {
    return options.imageOcrEnabled;
  }
  return process.env.OCR_IMAGE_FALLBACK_ENABLED !== 'false';
};

const extractPdfImageText = async(inputPath, options = {}) => {
  if (!isImageOcrEnabled(options)) {
    return {
      success: false,
      message: 'No text was detected in this PDF.'
    };
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ocr-pages-'));
  const prefix = path.join(tempDir, 'page');
  const timeoutMs = Number(options.timeoutMs || process.env.OCR_TIMEOUT_MS || 120000);
  const convertCommand = options.imageConvertCommand || DEFAULT_IMAGE_CONVERT_COMMAND;
  const convertArgs = replaceNamedPlaceholders(
    splitArgs(options.imageConvertArgs || process.env.OCR_PDF_IMAGE_ARGS, DEFAULT_IMAGE_CONVERT_ARGS),
    { input: inputPath, prefix }
  );
  const textCommand = options.imageTextCommand || DEFAULT_IMAGE_TEXT_COMMAND;
  const textArgsTemplate = splitArgs(options.imageTextArgs || process.env.OCR_IMAGE_TEXT_ARGS, DEFAULT_IMAGE_TEXT_ARGS);

  try {
    const convertResult = await runCommand(convertCommand, convertArgs, timeoutMs);
    if (!convertResult.success) {
      const unavailable = convertResult.error?.code === 'ENOENT';
      logger.warn('PDF page render command failed', {
        command: convertCommand,
        code: convertResult.error?.code,
        signal: convertResult.error?.signal,
        stderr: convertResult.stderr ? String(convertResult.stderr).slice(0, 500) : undefined
      });

      return {
        success: false,
        message: unavailable
          ? 'OCR image conversion command is not available on this server.'
          : 'OCR image conversion failed while processing the PDF.'
      };
    }

    const imageNames = (await fs.readdir(tempDir))
      .filter((fileName) => /\.(png|jpe?g|tiff?|pbm|pgm|ppm)$/i.test(fileName))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    if (imageNames.length === 0) {
      return {
        success: false,
        message: 'No text was detected in this PDF.'
      };
    }

    const pages = [];
    for (const imageName of imageNames) {
      const imagePath = path.join(tempDir, imageName);
      const textArgs = replaceNamedPlaceholders(textArgsTemplate, { image: imagePath });
      const textResult = await runCommand(textCommand, textArgs, timeoutMs);

      if (!textResult.success) {
        const unavailable = textResult.error?.code === 'ENOENT';
        logger.warn('PDF image OCR command failed', {
          command: textCommand,
          code: textResult.error?.code,
          signal: textResult.error?.signal,
          stderr: textResult.stderr ? String(textResult.stderr).slice(0, 500) : undefined
        });

        return {
          success: false,
          message: unavailable
            ? 'OCR image text command is not available on this server.'
            : 'OCR image text command failed while processing the PDF.'
        };
      }

      pages.push(textResult.stdout || '');
    }

    const text = pages.join('\n').trim();
    if (!text) {
      return {
        success: false,
        message: 'No text was detected in this PDF.'
      };
    }

    return {
      success: true,
      text: `${text}\n`
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(ignoreCleanupError);
  }
};

const extractPdfText = async(inputPath, options = {}) => {
  const command = options.command || DEFAULT_COMMAND;
  const rawArgs = splitArgs(options.args || process.env.OCR_TEXT_ARGS, DEFAULT_ARGS);
  const timeoutMs = Number(options.timeoutMs || process.env.OCR_TIMEOUT_MS || 120000);
  const outputPath = path.join(os.tmpdir(), `ocr-text-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);
  const ocrPdfOutputPath = path.join(os.tmpdir(), `ocr-output-${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`);
  const args = replacePlaceholders(rawArgs, inputPath, outputPath, ocrPdfOutputPath);

  try {
    const commandResult = await runCommand(command, args, timeoutMs);
    if (!commandResult.success) {
      const unavailable = commandResult.error?.code === 'ENOENT';
      if (!options.command && isImageOcrEnabled(options)) {
        const imageOcrResult = await extractPdfImageText(inputPath, options);
        if (imageOcrResult.success) {
          return imageOcrResult;
        }
      }

      logger.warn('PDF OCR/text command failed', {
        command,
        code: commandResult.error?.code,
        signal: commandResult.error?.signal,
        stderr: commandResult.stderr ? String(commandResult.stderr).slice(0, 500) : undefined
      });

      return {
        success: false,
        message: unavailable
          ? 'OCR command is not available on this server.'
          : 'OCR command failed while processing the PDF.'
      };
    }

    const text = await fs.readFile(outputPath, 'utf8').catch(() => '');
    if (!text.trim()) {
      return extractPdfImageText(inputPath, options);
    }

    return {
      success: true,
      text
    };
  } finally {
    await fs.unlink(outputPath).catch(ignoreCleanupError);
    await fs.unlink(ocrPdfOutputPath).catch(ignoreCleanupError);
  }
};

const createOcrTextFile = async({
  sourceFile,
  user,
  text,
  uploadDir = UPLOAD_DIR,
  executeQuery
}) => {
  if (!sourceFile || !user || typeof executeQuery !== 'function') {
    return {
      success: false,
      message: 'Missing OCR file creation context.'
    };
  }

  const outputName = await getUniqueOcrTextFileName(sourceFile, executeQuery);
  const storagePath = path.join(uploadDir, `ocr-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.txt`);
  const fileSize = Buffer.byteLength(text, 'utf8');
  const folderId = sourceFile.folder_id || null;
  const orgResult = await executeQuery(
    'SELECT storage_quota, storage_used FROM organizations WHERE id = ?',
    [sourceFile.organization_id]
  );

  if (!orgResult.success || orgResult.data.length === 0) {
    return {
      success: false,
      message: 'Organization not found.'
    };
  }

  const storageQuota = Number(orgResult.data[0].storage_quota);
  const storageUsed = Number(orgResult.data[0].storage_used || 0);
  if (Number.isFinite(storageQuota) && storageUsed + fileSize > storageQuota) {
    return {
      success: false,
      message: 'Storage quota exceeded. Please contact your administrator to increase storage quota.'
    };
  }

  await fs.mkdir(uploadDir, { recursive: true });
  await fs.writeFile(storagePath, text, 'utf8');

  const fileResult = await executeQuery(
    'INSERT INTO files (name, original_name, storage_path, file_size, file_type, description, organization_id, uploaded_by, folder_id, status, current_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      outputName,
      outputName,
      storagePath,
      fileSize,
      '.txt',
      `OCR text extracted from ${sourceFile.name || sourceFile.original_name || 'PDF'}`,
      sourceFile.organization_id,
      user.id,
      folderId,
      'active',
      1
    ]
  );

  if (!fileResult.success) {
    await fs.unlink(storagePath).catch(ignoreCleanupError);
    return {
      success: false,
      message: 'Failed to save OCR text file.'
    };
  }

  const fileId = fileResult.data.insertId;

  await executeQuery(
    'UPDATE organizations SET storage_used = storage_used + ? WHERE id = ?',
    [fileSize, sourceFile.organization_id]
  );

  await executeQuery(
    'INSERT INTO audit_logs (user_id, organization_id, action, resource_type, resource_id, details) VALUES (?, ?, ?, ?, ?, ?)',
    [
      user.id,
      sourceFile.organization_id,
      'OCR',
      'FILE',
      fileId,
      JSON.stringify({
        sourceFileId: sourceFile.id,
        sourceFileName: sourceFile.name,
        outputName,
        size: fileSize
      })
    ]
  );

  return {
    success: true,
    data: {
      fileId,
      name: outputName,
      size: fileSize,
      type: '.txt',
      folderId,
      storagePath
    }
  };
};

module.exports = {
  createOcrTextFile,
  extractPdfText,
  getOcrTextFileName,
  isPdfFile
};
