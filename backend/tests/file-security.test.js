const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  runMalwareScan,
  validateUploadedFile
} = require('../utils/fileSecurity');

const makeFile = (overrides = {}) => ({
  originalname: 'report.pdf',
  mimetype: 'application/pdf',
  size: 1024,
  path: '/tmp/report.pdf',
  ...overrides
});

describe('file security utilities', () => {
  it('accepts an allowed file extension and matching MIME type', () => {
    const result = validateUploadedFile(makeFile(), {
      allowedFileTypes: 'pdf,txt'
    });

    expect(result.success).toBe(true);
  });

  it('rejects a disallowed file extension', () => {
    const result = validateUploadedFile(makeFile({
      originalname: 'payload.exe',
      mimetype: 'application/x-msdownload'
    }));

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not allowed/i);
  });

  it('rejects a MIME type that does not match the extension', () => {
    const result = validateUploadedFile(makeFile({
      originalname: 'report.pdf',
      mimetype: 'application/x-msdownload'
    }));

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/MIME type/i);
  });

  it('rejects files larger than the policy limit', () => {
    const result = validateUploadedFile(makeFile({ size: 2048 }), {
      maxFileSize: 1024
    });

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/maximum allowed size/i);
  });

  it('skips malware scanning when no scanner is configured', async() => {
    const result = await runMalwareScan('/tmp/report.pdf', {
      malwareScanEnabled: false
    });

    expect(result).toEqual({ success: true, skipped: true });
  });

  it('fails closed when the malware scanner exits non-zero', async() => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => { /* silence */ });
    const filePath = path.join(os.tmpdir(), `scan-${Date.now()}.txt`);
    fs.writeFileSync(filePath, 'sample');

    const result = await runMalwareScan(filePath, {
      malwareScanEnabled: true,
      malwareScanCommand: process.execPath,
      malwareScanArgs: ['-e', 'process.exit(3)']
    });

    fs.unlinkSync(filePath);
    warnSpy.mockRestore();

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/malware scanning/i);
  });
});
