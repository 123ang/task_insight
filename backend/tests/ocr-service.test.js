const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  createOcrTextFile,
  extractPdfText,
  getOcrTextFileName,
  isPdfFile
} = require('../utils/ocrService');

const makeTempFile = (extension, contents = 'sample') => {
  const filePath = path.join(os.tmpdir(), `ocr-test-${Date.now()}-${Math.random().toString(16).slice(2)}.${extension}`);
  fs.writeFileSync(filePath, contents);
  return filePath;
};

describe('ocrService', () => {
  it('detects PDF files by type or name', () => {
    expect(isPdfFile({ file_type: '.pdf', name: 'document.bin' })).toBe(true);
    expect(isPdfFile({ file_type: 'application/pdf', name: 'document.bin' })).toBe(true);
    expect(isPdfFile({ file_type: 'application/octet-stream', name: 'document.pdf' })).toBe(true);
    expect(isPdfFile({ file_type: '.docx', name: 'document.docx' })).toBe(false);
  });

  it('creates the sidecar text filename from the PDF name', () => {
    expect(getOcrTextFileName({ name: 'Contract.PDF' })).toBe('Contract.txt');
    expect(getOcrTextFileName({ original_name: 'scan.pdf' })).toBe('scan.txt');
  });

  it('runs the configured command and reads the generated text output', async() => {
    const inputPath = makeTempFile('pdf', '%PDF-1.4');
    const script = 'require(\'fs\').writeFileSync(process.argv[1], \'Recognized text\\n\')';

    const result = await extractPdfText(inputPath, {
      command: process.execPath,
      args: ['-e', script, '{output}'],
      timeoutMs: 5000
    });

    fs.unlinkSync(inputPath);

    expect(result.success).toBe(true);
    expect(result.text).toBe('Recognized text\n');
  });

  it('falls back to image OCR when a PDF has no embedded text', async() => {
    const inputPath = makeTempFile('pdf', '%PDF-1.4');
    const emptyTextScript = 'require(\'fs\').writeFileSync(process.argv[1], \'\')';
    const renderImageScript = 'require(\'fs\').writeFileSync(`${process.argv[2]}-1.png`, \'page image\')';
    const ocrImageScript = 'process.stdout.write(\'Fallback OCR\\n\')';

    const result = await extractPdfText(inputPath, {
      command: process.execPath,
      args: ['-e', emptyTextScript, '{output}'],
      imageOcrEnabled: true,
      imageConvertCommand: process.execPath,
      imageConvertArgs: ['-e', renderImageScript, '{input}', '{prefix}'],
      imageTextCommand: process.execPath,
      imageTextArgs: ['-e', ocrImageScript, '{image}'],
      timeoutMs: 5000
    });

    fs.unlinkSync(inputPath);

    expect(result.success).toBe(true);
    expect(result.text).toBe('Fallback OCR\n');
  });

  it('fails cleanly when the OCR command is unavailable', async() => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const inputPath = makeTempFile('pdf', '%PDF-1.4');

    const result = await extractPdfText(inputPath, {
      command: '/not/a/real/ocr-command',
      args: ['{input}', '{output}'],
      imageOcrEnabled: false,
      timeoutMs: 5000
    });

    fs.unlinkSync(inputPath);
    warnSpy.mockRestore();

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/OCR command is not available/i);
  });

  it('creates a text sidecar file in the same folder as the source PDF', async() => {
    const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-sidecar-'));
    const calls = [];
    const executeQuery = jest.fn(async(query, params = []) => {
      calls.push({ query, params });
      if (query.includes('SELECT storage_quota')) {
        return { success: true, data: [{ storage_quota: 1000, storage_used: 10 }] };
      }
      if (query.includes('SELECT id FROM files')) {
        return { success: true, data: [] };
      }
      if (query.includes('INSERT INTO files')) {
        return { success: true, data: { insertId: 44 } };
      }
      return { success: true, data: [] };
    });

    const result = await createOcrTextFile({
      sourceFile: {
        id: 7,
        name: 'scan.pdf',
        original_name: 'scan.pdf',
        organization_id: 3,
        folder_id: 9
      },
      user: {
        id: 5,
        organization_id: 3
      },
      text: 'Recognized text\n',
      uploadDir,
      executeQuery
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      fileId: 44,
      name: 'scan.txt',
      size: Buffer.byteLength('Recognized text\n'),
      type: '.txt',
      folderId: 9
    });

    const insertCall = calls.find((call) => call.query.includes('INSERT INTO files'));
    expect(insertCall.params).toEqual(expect.arrayContaining(['scan.txt', '.txt', 3, 5, 9]));
    expect(fs.existsSync(result.data.storagePath)).toBe(true);

    fs.rmSync(uploadDir, { recursive: true, force: true });
  });

  it('refuses to create OCR text when organization storage quota would be exceeded', async() => {
    const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-sidecar-'));
    const executeQuery = jest.fn(async(query) => {
      if (query.includes('SELECT storage_quota')) {
        return { success: true, data: [{ storage_quota: 20, storage_used: 19 }] };
      }
      return { success: true, data: [] };
    });

    const result = await createOcrTextFile({
      sourceFile: {
        id: 7,
        name: 'scan.pdf',
        original_name: 'scan.pdf',
        organization_id: 3,
        folder_id: 9
      },
      user: {
        id: 5,
        organization_id: 3
      },
      text: 'Recognized text\n',
      uploadDir,
      executeQuery
    });

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/Storage quota exceeded/i);
    expect(executeQuery).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO files'), expect.any(Array));
    expect(fs.readdirSync(uploadDir)).toHaveLength(0);

    fs.rmSync(uploadDir, { recursive: true, force: true });
  });
});
