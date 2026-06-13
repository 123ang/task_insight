import { apiService, ApiResponse, FilesPaginationResponse, getAccessToken } from './api';

// Types
export interface FileItem {
  id: number;
  name: string;
  original_name: string;
  storage_path: string; // Changed from 'path' to match database
  file_size: number;    // Changed from 'size' to match database
  file_type: string;    // Changed from 'type' to match database
  description?: string;
  organization_id: number;
  uploaded_by: number;
  folder_id?: number;
  status: string;
  created_at: string;
  updated_at?: string;
  last_accessed_at?: string;
  last_accessed_by?: number;
  last_modified_at?: string;
  last_modified_by?: number;
  deleted_at?: string;
  deleted_by?: number;
  current_version?: number;
  checksum?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  folder_name?: string;
  organization_name?: string;
  is_starred?: boolean;
  permission_level?: 'view' | 'comment' | 'edit';
  shared_at?: string;
  shared_by_first_name?: string;
  shared_by_last_name?: string;
}

export interface FileUploadRequest {
  name?: string;
  description?: string;
  folderId?: number;
}

export interface FileUpdateRequest {
  name?: string;
  description?: string;
  folderId?: number;
}

export interface FileFilters {
  search?: string;
  folderId?: number | null; // null means root files (folder_id IS NULL), number means specific folder, undefined means no filter
  type?: string;
  organizationId?: number;
}

export interface FileVersion {
  id: number | null;
  version_number: number;
  file_size: number;
  storage_path: string;
  created_at: string;
  version_note?: string | null;
  first_name?: string;
  last_name?: string;
  email?: string;
  is_current?: boolean;
}

export interface Folder {
  id: number;
  name: string;
  description?: string;
  organization_id: number;
  created_by: number;
  parent_id?: number;
  status: string;
  created_at: string;
  file_count: number;
  total_size: number;
  first_name?: string;
  last_name?: string;
  is_starred?: boolean;
}

export interface FolderCreateRequest {
  name: string;
  description?: string;
  parentId?: number;
}

export interface FileStats {
  totalFiles: number;
  totalSize: number;
  typeStats: Array<{
    type: string;
    count: number;
    total_size: number;
    avg_size: number;
  }>;
  recentUploads: number;
}

// File Service
export const fileService = {
  // Get all files with pagination and filters
  getFiles: async (
    page: number = 1,
    limit: number = 10,
    filters?: FileFilters
  ): Promise<ApiResponse<FilesPaginationResponse<FileItem>>> => {
    const params: any = {
      page,
      limit,
    };
    
    // Handle filters, explicitly convert null to string "null" for folderId
    if (filters) {
      if (filters.search) params.q = filters.search;
      if (filters.type) params.type = filters.type;
      if (filters.organizationId) params.organizationId = filters.organizationId;
      if (filters.folderId !== undefined) {
        // Convert null to string "null" so backend can distinguish between null (root) and undefined (all files)
        params.folderId = filters.folderId === null ? 'null' : filters.folderId;
      }
    }
    
    return apiService.get<FilesPaginationResponse<FileItem>>('/files', params);
  },

  // Upload file
  uploadFile: async (
    file: File,
    fileData: FileUploadRequest,
    onProgress?: (progress: number) => void
  ): Promise<ApiResponse<{ fileId: number; name: string; size: number; type: string }>> => {
    const formData = new FormData();
    formData.append('file', file);
    
    if (fileData.name) formData.append('name', fileData.name);
    if (fileData.description) formData.append('description', fileData.description);
    if (fileData.folderId) formData.append('folderId', fileData.folderId.toString());

    return apiService.upload<{ fileId: number; name: string; size: number; type: string }>(
      '/files/upload',
      formData,
      onProgress
    );
  },

  // Get file by ID
  getFile: async (fileId: number): Promise<ApiResponse<FileItem>> => {
    return apiService.get<FileItem>(`/files/${fileId}`);
  },

  // Download file
  downloadFile: async (fileId: number, filename?: string): Promise<void> => {
    return apiService.download(`/files/${fileId}/download`, filename);
  },

  // Update file
  updateFile: async (fileId: number, fileData: FileUpdateRequest): Promise<ApiResponse<void>> => {
    return apiService.put<void>(`/files/${fileId}`, fileData);
  },

  // Delete file (soft delete - move to trash)
  deleteFile: async (fileId: number): Promise<ApiResponse<void>> => {
    return apiService.delete<void>(`/files/${fileId}`);
  },

  // Restore file from trash
  restoreFile: async (fileId: number): Promise<ApiResponse<void>> => {
    return apiService.post<void>(`/files/${fileId}/restore`, {});
  },

  // Permanently delete file
  permanentlyDeleteFile: async (fileId: number): Promise<ApiResponse<void>> => {
    return apiService.delete<void>(`/files/${fileId}/permanent`);
  },

  // Get specific folder by ID
  getFolder: async (folderId: number): Promise<ApiResponse<Folder>> => {
    return apiService.get<Folder>(`/files/folders/${folderId}`);
  },

  // Get folders
  getFolders: async (organizationId?: number, parentId?: number | null, search?: string): Promise<ApiResponse<Folder[]>> => {
    const params: any = {};
    if (organizationId) params.organizationId = organizationId;
    // Only include parentId if it's a valid number, or explicitly null/undefined
    // Convert null to string 'null' so backend can distinguish between null (root) and undefined (no filter)
    if (parentId !== undefined) {
      if (parentId === null) {
        params.parentId = 'null';
      } else if (typeof parentId === 'number' && parentId > 0) {
        params.parentId = parentId;
      }
      // If parentId is undefined or invalid, don't include it in params
    }
    if (search) params.q = search;
    return apiService.get<Folder[]>('/files/folders/list', params);
  },

  // Create folder
  createFolder: async (folderData: FolderCreateRequest): Promise<ApiResponse<{ folderId: number; name: string; description?: string; parentId?: number }>> => {
    return apiService.post<{ folderId: number; name: string; description?: string; parentId?: number }>('/files/folders', folderData);
  },

  // Delete folder
  deleteFolder: async (folderId: number): Promise<ApiResponse<void>> => {
    return apiService.delete<void>(`/files/folders/${folderId}`);
  },

  // Get file statistics
  getFileStats: async (organizationId?: number): Promise<ApiResponse<FileStats>> => {
    const params = organizationId ? { organizationId } : {};
    return apiService.get<FileStats>('/files/stats/overview', params);
  },

  // Get deleted files (trash)
  getDeletedFiles: async (
    page: number = 1,
    limit: number = 10
  ): Promise<ApiResponse<FilesPaginationResponse<FileItem>>> => {
    const params = { page, limit };
    return apiService.get<FilesPaginationResponse<FileItem>>('/files/trash/list', params);
  },

  // Toggle star/favorite
  toggleStar: async (itemType: 'file' | 'folder', itemId: number): Promise<ApiResponse<{ starred: boolean }>> => {
    return apiService.post<{ starred: boolean }>(`/files/star/${itemType}/${itemId}`, {});
  },

  // Get starred items
  getStarredItems: async (): Promise<ApiResponse<{ files: FileItem[], folders: Folder[] }>> => {
    return apiService.get<{ files: FileItem[], folders: Folder[] }>('/files/starred/list');
  },

  // Format file size
  formatFileSize: (bytes: number | undefined | null): string => {
    // Handle null, undefined, NaN, or invalid numbers
    if (!bytes || isNaN(bytes) || bytes < 0) {
      return '0 Bytes';
    }
    
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  },

  // Get file icon based on type
  getFileIcon: (fileType: string): string => {
    const type = fileType.toLowerCase();
    
    if (type.includes('pdf')) return 'fas fa-file-pdf';
    if (type.includes('doc') || type.includes('docx')) return 'fas fa-file-word';
    if (type.includes('xls') || type.includes('xlsx')) return 'fas fa-file-excel';
    if (type.includes('ppt') || type.includes('pptx')) return 'fas fa-file-powerpoint';
    if (type.includes('txt')) return 'fas fa-file-alt';
    if (type.includes('jpg') || type.includes('jpeg') || type.includes('png') || type.includes('gif')) return 'fas fa-file-image';
    if (type.includes('mp4') || type.includes('avi') || type.includes('mov')) return 'fas fa-file-video';
    if (type.includes('mp3') || type.includes('wav')) return 'fas fa-file-audio';
    if (type.includes('zip') || type.includes('rar')) return 'fas fa-file-archive';
    
    return 'fas fa-file';
  },

  // File Sharing
  shareFile: async (fileId: number, shareData: {
    email?: string;
    permission: 'view' | 'edit' | 'comment';
    expiresAt?: string;
    password?: string;
  }): Promise<ApiResponse<{ shareLink: string; shareId: number }>> => {
    return apiService.post<{ shareLink: string; shareId: number }>(`/files/${fileId}/share`, shareData);
  },

  // Get file shares
  getFileShares: async (fileId: number): Promise<ApiResponse<Array<{
    id: number;
    email: string;
    permission: string;
    expiresAt: string;
    createdAt: string;
  }>>> => {
    return apiService.get<Array<any>>(`/files/${fileId}/shares`);
  },

  // Revoke file share
  revokeShare: async (fileId: number, shareId: number): Promise<ApiResponse<void>> => {
    return apiService.delete<void>(`/files/${fileId}/shares/${shareId}`);
  },

  // Share a folder
  shareFolder: async (folderId: number, shareData: {
    email?: string;
    permission: 'view' | 'edit' | 'comment';
    expiresAt?: string;
  }): Promise<ApiResponse<{ shareLink: string; shareId: number }>> => {
    return apiService.post<{ shareLink: string; shareId: number }>(`/files/folders/${folderId}/share`, shareData);
  },

  // Get folder shares
  getFolderShares: async (folderId: number): Promise<ApiResponse<Array<{
    id: number;
    email: string;
    permission: string;
    expiresAt: string;
    createdAt: string;
  }>>> => {
    return apiService.get<Array<any>>(`/files/folders/${folderId}/shares`);
  },

  // Revoke folder share
  revokeFolderShare: async (folderId: number, shareId: number): Promise<ApiResponse<void>> => {
    return apiService.delete<void>(`/files/folders/${folderId}/shares/${shareId}`);
  },

  // Get shared with me files
  getSharedWithMe: async (page: number = 1, limit: number = 10): Promise<ApiResponse<FilesPaginationResponse<FileItem>>> => {
    return apiService.get<FilesPaginationResponse<FileItem>>('/files/shared-with-me', { page, limit });
  },


  // Download specific version
  downloadFileVersion: async (fileId: number, versionId: number, filename?: string): Promise<void> => {
    return apiService.download(`/files/${fileId}/versions/${versionId}/download`, filename);
  },

  // Restore file version
  restoreFileVersion: async (fileId: number, versionId: number): Promise<ApiResponse<void>> => {
    return apiService.post<void>(`/files/${fileId}/versions/${versionId}/restore`, {});
  },

  // File Preview
  getFilePreviewUrl: (fileId: number): string => {
    const baseUrl = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000/api';
    return `${baseUrl}/files/${fileId}/preview`;
  },

  // Check if file can be previewed
  canPreview: (fileType: string): boolean => {
    const type = fileType.toLowerCase();
    return type.includes('pdf') || 
           type.includes('jpg') || type.includes('jpeg') || 
           type.includes('png') || type.includes('gif') ||
           type.includes('mp4') || type.includes('avi') || type.includes('mov') ||
           type.includes('txt') || type.includes('doc') || type.includes('docx');
  },

  // Check if file is an image
  isImage: (fileType: string): boolean => {
    const type = fileType.toLowerCase();
    return type.includes('jpg') || type.includes('jpeg') || 
           type.includes('png') || type.includes('gif') ||
           type.includes('webp') || type.includes('bmp') || type.includes('svg');
  },

  // Get thumbnail URL for image files
  getThumbnailUrl: (fileId: number): string => {
    const baseUrl = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000/api';
    return `${baseUrl}/files/${fileId}/preview`;
  },

  // Zip files
  zipFiles: async (fileIds: number[], zipName?: string): Promise<void> => {
    const token = getAccessToken();
    if (!token) throw new Error('Authentication session is not available');
    const baseUrl = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000/api';
    
    const response = await fetch(`${baseUrl}/files/zip`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      credentials: 'include',
      body: JSON.stringify({ fileIds, zipName: zipName || 'archive.zip' })
    });

    if (!response.ok) {
      throw new Error('Failed to create zip file');
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = zipName || 'archive.zip';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  },

  // Unzip file
  unzipFile: async (fileId: number, targetFolderId?: number): Promise<ApiResponse<{ extractedFiles: number }>> => {
    return apiService.post<{ extractedFiles: number }>(`/files/${fileId}/unzip`, {
      targetFolderId
    });
  },

  // Rename file
  renameFile: async (fileId: number, newName: string): Promise<ApiResponse<void>> => {
    return apiService.put<void>(`/files/${fileId}/rename`, { name: newName });
  },

  // Rename folder
  renameFolder: async (folderId: number, newName: string): Promise<ApiResponse<void>> => {
    return apiService.put<void>(`/files/folders/${folderId}/rename`, { name: newName });
  },

  // Move file to folder
  moveFile: async (fileId: number, targetFolderId: number | null): Promise<ApiResponse<void>> => {
    return apiService.put<void>(`/files/${fileId}/move`, { folderId: targetFolderId });
  },

  // Move folder to another folder
  moveFolder: async (folderId: number, targetFolderId: number | null): Promise<ApiResponse<void>> => {
    return apiService.put<void>(`/files/folders/${folderId}/move`, { parentId: targetFolderId });
  },

  // Download folder as zip
  downloadFolder: async (folderId: number, folderName: string): Promise<void> => {
    const token = getAccessToken();
    if (!token) throw new Error('Authentication session is not available');
    const baseUrl = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000/api';
    
    const response = await fetch(`${baseUrl}/files/folders/${folderId}/download`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      credentials: 'include',
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'Failed to download folder' }));
      throw new Error(errorData.message || 'Failed to download folder');
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${folderName.replace(/[^a-zA-Z0-9_-]/g, '_')}.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  },

  // Get file versions
  getFileVersions: async (fileId: number): Promise<ApiResponse<FileVersion[]>> => {
    return apiService.get<FileVersion[]>(`/files/${fileId}/versions`);
  },

  // Upload new version
  uploadNewVersion: async (
    fileId: number,
    file: File,
    onProgress?: (progress: number) => void
  ): Promise<ApiResponse<{ version: number; fileId: number }>> => {
    const formData = new FormData();
    formData.append('file', file);

    const token = getAccessToken();
    if (!token) throw new Error('Authentication session is not available');
    const baseUrl = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000/api';
    
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && onProgress) {
          const progress = Math.round((e.loaded / e.total) * 100);
          onProgress(progress);
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const response = JSON.parse(xhr.responseText);
            resolve(response);
          } catch (error) {
            reject(new Error('Failed to parse response'));
          }
        } else {
          try {
            const error = JSON.parse(xhr.responseText);
            reject(new Error(error.message || 'Upload failed'));
          } catch {
            reject(new Error('Upload failed'));
          }
        }
      });

      xhr.addEventListener('error', () => reject(new Error('Upload failed')));
      xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));

      xhr.open('POST', `${baseUrl}/files/${fileId}/versions`);
      xhr.withCredentials = true;
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.send(formData);
    });
  },

  // Keep version forever
  keepVersionForever: async (fileId: number, versionId: number): Promise<ApiResponse<void>> => {
    return apiService.put<void>(`/files/${fileId}/versions/${versionId}/keep`);
  },
};
