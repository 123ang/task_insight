import { fileService } from '../fileService';
import { apiService } from '../api';

// Mock the apiService
jest.mock('../api', () => ({
  apiService: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    upload: jest.fn(),
    download: jest.fn(),
  },
}));

describe('fileService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getFiles', () => {
    it('fetches files with pagination', async () => {
      const mockResponse = {
        success: true,
        data: {
          files: [
            { id: 1, fileName: 'test.pdf', fileSize: 1024 },
          ],
          pagination: {
            page: 1,
            limit: 10,
            total: 1,
            pages: 1,
          },
        },
      };

      (apiService.get as jest.Mock).mockResolvedValue(mockResponse);

      const result = await fileService.getFiles(1, 10);

      expect(apiService.get).toHaveBeenCalledWith('/files', { page: 1, limit: 10 });
      expect(result).toEqual(mockResponse);
    });

    it('fetches files with folder filter', async () => {
      const mockResponse = {
        success: true,
        data: {
          files: [
            { id: 1, fileName: 'test.pdf', folderId: 5 },
          ],
          pagination: {
            page: 1,
            limit: 10,
            total: 1,
            pages: 1,
          },
        },
      };

      (apiService.get as jest.Mock).mockResolvedValue(mockResponse);

      await fileService.getFiles(1, 10, { folderId: 5 });

      expect(apiService.get).toHaveBeenCalledWith('/files', {
        page: 1,
        limit: 10,
        folderId: 5,
      });
    });

    it('fetches files with search query', async () => {
      const mockResponse = {
        success: true,
        data: {
          files: [],
          pagination: {
            page: 1,
            limit: 10,
            total: 0,
            pages: 0,
          },
        },
      };

      (apiService.get as jest.Mock).mockResolvedValue(mockResponse);

      await fileService.getFiles(1, 10, { folderId: null, search: 'test search' });

      expect(apiService.get).toHaveBeenCalledWith('/files', {
        page: 1,
        limit: 10,
        folderId: 'null',
        q: 'test search',
      });
    });
  });

  describe('uploadFile', () => {
    it('uploads a file with progress tracking', async () => {
      const mockFile = new File(['test content'], 'test.pdf', { type: 'application/pdf' });
      const mockResponse = {
        success: true,
        data: { id: 1, fileName: 'test.pdf' },
      };

      (apiService.upload as jest.Mock).mockResolvedValue(mockResponse);

      const onProgress = jest.fn();
      const result = await fileService.uploadFile(mockFile, {}, onProgress);

      expect(apiService.upload).toHaveBeenCalledWith(
        '/files/upload',
        expect.any(FormData),
        onProgress
      );
      expect(result).toEqual(mockResponse);
    });

    it('uploads a file to a specific folder', async () => {
      const mockFile = new File(['test content'], 'test.pdf', { type: 'application/pdf' });
      const mockResponse = {
        success: true,
        data: { id: 1, fileName: 'test.pdf', folderId: 5 },
      };

      (apiService.upload as jest.Mock).mockResolvedValue(mockResponse);

      await fileService.uploadFile(mockFile, { folderId: 5 });

      const formData = (apiService.upload as jest.Mock).mock.calls[0][1];
      expect(formData.get('folderId')).toBe('5');
    });
  });

  describe('deleteFile', () => {
    it('deletes a file by ID', async () => {
      const mockResponse = {
        success: true,
        message: 'File deleted successfully',
      };

      (apiService.delete as jest.Mock).mockResolvedValue(mockResponse);

      const result = await fileService.deleteFile(1);

      expect(apiService.delete).toHaveBeenCalledWith('/files/1');
      expect(result).toEqual(mockResponse);
    });
  });

  describe('downloadFile', () => {
    it('downloads a file by ID', async () => {
      await fileService.downloadFile(1, 'test.pdf');

      expect(apiService.download).toHaveBeenCalledWith('/files/1/download', 'test.pdf');
    });
  });

  describe('ocrFile', () => {
    it('requests OCR text creation for a PDF', async () => {
      const mockResponse = {
        success: true,
        data: { fileId: 2, name: 'test.txt', size: 12, type: '.txt', folderId: null },
      };

      (apiService.post as jest.Mock).mockResolvedValue(mockResponse);

      const result = await fileService.ocrFile(1);

      expect(apiService.post).toHaveBeenCalledWith('/files/1/ocr', {});
      expect(result).toEqual(mockResponse);
    });
  });

  describe('renameFile', () => {
    it('renames a file', async () => {
      const mockResponse = {
        success: true,
        message: 'File renamed successfully',
      };

      (apiService.put as jest.Mock).mockResolvedValue(mockResponse);

      const result = await fileService.renameFile(1, 'new-name.pdf');

      expect(apiService.put).toHaveBeenCalledWith('/files/1/rename', {
        name: 'new-name.pdf',
      });
      expect(result).toEqual(mockResponse);
    });
  });

  describe('getFolders', () => {
    it('fetches all folders', async () => {
      const mockResponse = {
        success: true,
        data: [
          { id: 1, folderName: 'Documents', parentId: null },
          { id: 2, folderName: 'Images', parentId: null },
        ],
      };

      (apiService.get as jest.Mock).mockResolvedValue(mockResponse);

      const result = await fileService.getFolders();

      expect(apiService.get).toHaveBeenCalledWith('/files/folders/list', {});
      expect(result).toEqual(mockResponse);
    });
  });

  describe('createFolder', () => {
    it('creates a new folder', async () => {
      const mockResponse = {
        success: true,
        data: { id: 1, folderName: 'New Folder', parentId: null },
      };

      (apiService.post as jest.Mock).mockResolvedValue(mockResponse);

      const result = await fileService.createFolder({ name: 'New Folder' });

      expect(apiService.post).toHaveBeenCalledWith('/files/folders', {
        name: 'New Folder',
      });
      expect(result).toEqual(mockResponse);
    });

    it('creates a subfolder', async () => {
      const mockResponse = {
        success: true,
        data: { id: 2, folderName: 'Subfolder', parentId: 1 },
      };

      (apiService.post as jest.Mock).mockResolvedValue(mockResponse);

      await fileService.createFolder({ name: 'Subfolder', parentId: 1 });

      expect(apiService.post).toHaveBeenCalledWith('/files/folders', {
        name: 'Subfolder',
        parentId: 1,
      });
    });
  });

  describe('getFileStats', () => {
    it('fetches file statistics', async () => {
      const mockResponse = {
        success: true,
        data: {
          totalFiles: 100,
          totalSize: 10485760,
          typeStats: [
            { fileType: 'pdf', count: 50 },
            { fileType: 'docx', count: 30 },
            { fileType: 'xlsx', count: 20 },
          ],
          recentUploads: 10,
        },
      };

      (apiService.get as jest.Mock).mockResolvedValue(mockResponse);

      const result = await fileService.getFileStats();

      expect(apiService.get).toHaveBeenCalledWith('/files/stats/overview', {});
      expect(result).toEqual(mockResponse);
    });
  });

  describe('shareFile', () => {
    it('creates a share link for a file', async () => {
      const mockResponse = {
        success: true,
        data: {
          shareLink: 'https://example.com/share/abc123',
          expiresAt: '2024-12-31T23:59:59.000Z',
        },
      };

      (apiService.post as jest.Mock).mockResolvedValue(mockResponse);

      const shareData = {
        permission: 'view' as const,
        expiresAt: '2024-12-31',
      };

      const result = await fileService.shareFile(1, shareData);

      expect(apiService.post).toHaveBeenCalledWith('/files/1/share', shareData);
      expect(result).toEqual(mockResponse);
    });
  });
});
