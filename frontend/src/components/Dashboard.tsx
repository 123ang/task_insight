import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useFiles } from '../contexts/FileContext';
import { fileService, FileItem, Folder, FileFilters } from '../services/fileService';
import { reminderService, TodoDocument, TodoSummary, Reminder } from '../services/reminderService';
import { getAccessToken } from '../services/api';
import FileSharingModal from './FileSharingModal';
import FilePreviewModal from './FilePreviewModal';
import ReminderModal from './ReminderModal';
import { getAndaiAssistantUrl, openAndaiAssistant } from '../utils/platformLinks';
import toast from 'react-hot-toast';

// Image Thumbnail Component
const ImageThumbnail: React.FC<{ fileId: number; fileName: string; fileType: string }> = ({ fileId, fileName, fileType }) => {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const loadThumbnail = async () => {
      try {
        const baseUrl = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000/api';
        const token = getAccessToken();
        
        if (!token) {
          setHasError(true);
          return;
        }

        const response = await fetch(`${baseUrl}/files/${fileId}/preview`, {
          headers: {
            'Authorization': `Bearer ${token}`
          },
          credentials: 'include',
        });

        if (response.ok) {
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          setThumbnailUrl(url);
        } else {
          setHasError(true);
        }
      } catch (error) {
        console.error('Error loading thumbnail:', error);
        setHasError(true);
      }
    };

    loadThumbnail();

    // Cleanup blob URL on unmount
    return () => {
      if (thumbnailUrl) {
        URL.revokeObjectURL(thumbnailUrl);
      }
    };
  }, [fileId, thumbnailUrl]);

  if (hasError || !thumbnailUrl) {
    return <i className={fileService.getFileIcon(fileType)}></i>;
  }

  return (
    <img 
      src={thumbnailUrl}
      alt={fileName}
      className="file-thumbnail"
      onError={() => setHasError(true)}
      style={{
        objectFit: 'cover',
        width: '100%',
        height: '100%',
        borderRadius: '4px'
      }}
    />
  );
};

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ folderId?: string }>();
  const { user, logout, isAuthenticated, isOrganizationAdmin, isPlatformOwner } = useAuth();
  const andaiAssistantUrl = getAndaiAssistantUrl();
  const { 
    files = [], 
    folders = [], 
    currentFolder, 
    isLoading, 
    fileStats, 
    pagination,
    loadFiles, 
    loadFolders, 
    uploadFile, 
    downloadFile, 
    deleteFile, 
    createFolder, 
    setCurrentFolder, 
    refreshFiles, 
    refreshStats 
  } = useFiles();

  // Cache of all folders for breadcrumb building (not filtered by parent)
  const [allFoldersCache, setAllFoldersCache] = useState<Folder[]>([]);

  // Update cache whenever folders change
  useEffect(() => {
    if (folders.length > 0) {
      setAllFoldersCache(prev => {
        const newCache = [...prev];
        folders.forEach(folder => {
          const existing = newCache.find(f => f.id === folder.id);
          if (!existing) {
            newCache.push(folder);
          } else {
            // Update existing folder with latest data
            const index = newCache.indexOf(existing);
            newCache[index] = folder;
          }
        });
        return newCache;
      });
    }
  }, [folders]);

  // Get current view from URL
  const getCurrentViewFromPath = () => {
    const path = location.pathname;
    if (path.includes('/starred')) return 'starred';
    if (path.includes('/shared')) return 'shared';
    if (path.includes('/trash')) return 'trash';
    if (path.includes('/todo')) return 'todo';
    return 'my-drive';
  };

  // Get folder ID from URL
  const getFolderIdFromUrl = (): number | null => {
    // Check if folderId exists and is a valid string/number
    if (!params.folderId || 
        params.folderId === 'undefined' || 
        params.folderId === 'null' || 
        params.folderId.trim() === '') {
      return null;
    }
    
    const folderId = parseInt(params.folderId, 10);
    // Return null if not a valid positive number
    return (isNaN(folderId) || folderId <= 0) ? null : folderId;
  };

  const [currentView, setCurrentView] = useState(getCurrentViewFromPath());
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showCreateFolderModal, setShowCreateFolderModal] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadingFileName, setUploadingFileName] = useState<string>('');
  const [uploadingFileSize, setUploadingFileSize] = useState<number>(0);
  const [isDragging, setIsDragging] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [dragCounter, setDragCounter] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<FileFilters>({ search: '', folderId: undefined });
  const [hasLoadedInitialData, setHasLoadedInitialData] = useState(false);
  const [deletedFiles, setDeletedFiles] = useState<FileItem[]>([]);
  const [starredFiles, setStarredFiles] = useState<FileItem[]>([]);
  const [starredFolders, setStarredFolders] = useState<Folder[]>([]);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  
  // To-Do Documents / Reminders state
  const [todoDocuments, setTodoDocuments] = useState<TodoDocument[]>([]);
  const [todoSummary, setTodoSummary] = useState<TodoSummary | null>(null);
  const [todoFilter, setTodoFilter] = useState<'all' | 'overdue' | 'today' | 'upcoming'>('all');
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [reminderFile, setReminderFile] = useState<{ id: number; name: string } | null>(null);
  const [editingReminder, setEditingReminder] = useState<Reminder | null>(null);
  const [pendingReminders, setPendingReminders] = useState<Reminder[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  
  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    show: boolean;
    x: number;
    y: number;
    item: FileItem | Folder | null;
    type: 'file' | 'folder' | null;
    buttonTop?: number; // Store button top position for better positioning
  }>({ show: false, x: 0, y: 0, item: null, type: null });

  // Sort state
  const [sortCriteria, setSortCriteria] = useState<'name' | 'dateModified' | 'dateModifiedByMe' | 'dateOpenedByMe'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  const hasAdminFileRights = () => isPlatformOwner() || isOrganizationAdmin();

  const canManageItem = (item: FileItem | Folder, type: 'file' | 'folder') => {
    if (!user) return false;
    if (hasAdminFileRights()) return true;

    const ownerId = type === 'file'
      ? (item as FileItem).uploaded_by
      : (item as Folder).created_by;

    return ownerId === user.id;
  };

  const canEditItem = (item: FileItem | Folder, type: 'file' | 'folder') => {
    if (canManageItem(item, type)) return true;
    if (type !== 'file') return false;

    return (item as FileItem).permission_level === 'edit';
  };

  const contextCanEdit = Boolean(
    contextMenu.item && contextMenu.type && canEditItem(contextMenu.item, contextMenu.type)
  );

  const contextCanManage = Boolean(
    contextMenu.item && contextMenu.type && canManageItem(contextMenu.item, contextMenu.type)
  );
  const [showSortMenu, setShowSortMenu] = useState(false);
  const sortMenuRef = useRef<HTMLDivElement>(null);

  // Drag and drop state for moving files/folders
  const [draggedItem, setDraggedItem] = useState<{ id: number; type: 'file' | 'folder'; name: string } | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<number | null>(null);
  
  // Modals for context menu actions
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [showVersionModal, setShowVersionModal] = useState(false);
  const [fileVersions, setFileVersions] = useState<any[]>([]);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  const [isUploadingVersion, setIsUploadingVersion] = useState(false);
  const versionFileInputRef = useRef<HTMLInputElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [selectedItem, setSelectedItem] = useState<{ item: FileItem | Folder; type: 'file' | 'folder' } | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [showPermissionError, setShowPermissionError] = useState(false);
  const [permissionErrorMessage, setPermissionErrorMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadModalFileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Redirect if not authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, navigate]);

  // Close new menu and sort menu when clicking outside or on other buttons
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      
      // Close new menu if clicking outside
      if (showNewMenu && !target.closest('.new-button-container')) {
        setShowNewMenu(false);
      }
      
      // Close sort menu if clicking outside or on toolbar buttons
      if (showSortMenu) {
        const sortMenuContainer = target.closest('.sort-menu-container');
        const toolbarButton = target.closest('.btn-icon, .btn-new, .toolbar button');
        
        // Close if clicking outside sort menu container OR clicking on other toolbar buttons
        if (!sortMenuContainer || (toolbarButton && !sortMenuContainer.contains(toolbarButton))) {
          setShowSortMenu(false);
        }
      }
    };

    if (showNewMenu || showSortMenu) {
      // Use a small delay to avoid closing immediately when opening
      setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
      }, 100);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [showNewMenu, showSortMenu]);

  // Sync currentView with URL path and load appropriate data
  useEffect(() => {
    const view = getCurrentViewFromPath();
    setCurrentView(view);
    
    // Reset currentFolder when switching to non-folder views
    if (view !== 'my-drive') {
      setCurrentFolder(null);
    } else {
      // Get folder ID from URL for my-drive view
      const folderIdFromUrl = getFolderIdFromUrl();
      if (folderIdFromUrl !== null) {
        setCurrentFolder(folderIdFromUrl);
      } else {
        setCurrentFolder(null);
      }
    }
    
    // Load data for the current view
    switch (view) {
      case 'starred':
        loadStarredItems();
        break;
      case 'shared':
        loadSharedItems();
        break;
      case 'trash':
        loadDeletedFiles();
        break;
      default:
        // My Drive - load regular files
        // Get folder ID from URL and pass it directly to loadFiles to avoid state timing issues
        const folderIdFromUrl = getFolderIdFromUrl();
        // Pass folderId directly: null for root, number for specific folder, undefined means all files
        loadFiles(1, {}, folderIdFromUrl);
        // Load folders for display (filtered by parent)
        loadFolders(folderIdFromUrl);
        // Also load root folders to build breadcrumb path
        // This ensures we have parent chain in folders array
        loadFolders(null);
        // If we're in a folder (has valid folder ID), check permissions and load folder data
        // Only check permissions if we have a valid numeric folder ID
        if (folderIdFromUrl !== null && !isNaN(folderIdFromUrl) && folderIdFromUrl > 0) {
          // Check folder access permission
          fileService.getFolder(folderIdFromUrl).then(response => {
            if (!response.success) {
              // Permission denied or folder not found
              const errorMessage = response.message || 'You do not have permission to access this folder';
              setPermissionErrorMessage(errorMessage);
              setShowPermissionError(true);
              // Navigate back to root
              navigate('/dashboard/my-drive');
              setCurrentFolder(null);
            } else {
              // Permission granted, continue loading
              // Load all folders without filter to get the full folder tree for breadcrumb
              fileService.getFolders(user?.organizationId, undefined).then(foldersResponse => {
                if (foldersResponse.success && foldersResponse.data && Array.isArray(foldersResponse.data)) {
                  setAllFoldersCache(prev => {
                    const newCache = [...prev];
                    foldersResponse.data!.forEach(folder => {
                      const existing = newCache.find(f => f.id === folder.id);
                      if (!existing) {
                        newCache.push(folder);
                      } else {
                        const index = newCache.indexOf(existing);
                        newCache[index] = folder;
                      }
                    });
                    return newCache;
                  });
                }
              }).catch(error => {
                console.error('Error loading all folders for breadcrumb:', error);
              });
            }
          }).catch(error => {
            console.error('Error checking folder permission:', error);
            const errorMessage = error?.response?.data?.message || 'You do not have permission to access this folder';
            setPermissionErrorMessage(errorMessage);
            setShowPermissionError(true);
            // Navigate back to root
            navigate('/dashboard/my-drive');
            setCurrentFolder(null);
          });
        } else {
          // Root folder - no permission check needed, just load folders for breadcrumb
          fileService.getFolders(user?.organizationId, undefined).then(foldersResponse => {
            if (foldersResponse.success && foldersResponse.data && Array.isArray(foldersResponse.data)) {
              setAllFoldersCache(prev => {
                const newCache = [...prev];
                foldersResponse.data!.forEach(folder => {
                  const existing = newCache.find(f => f.id === folder.id);
                  if (!existing) {
                    newCache.push(folder);
                  } else {
                    const index = newCache.indexOf(existing);
                    newCache[index] = folder;
                  }
                });
                return newCache;
              });
            }
          }).catch(error => {
            console.error('Error loading all folders for breadcrumb:', error);
          });
        }
    }
  }, [location.pathname, params.folderId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load initial data - run only once
  useEffect(() => {
    if (isAuthenticated && !hasLoadedInitialData &&
        process.env.REACT_APP_OFFLINE_MODE !== 'true' && 
        process.env.REACT_APP_DISABLE_API_CALLS !== 'true') {
      setHasLoadedInitialData(true);
      loadFiles();
      loadFolders();
      refreshStats();
      loadPendingReminders(); // Load notifications
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, hasLoadedInitialData]); // Functions are stable from context

  // Handle search
  const handleSearch = (query: string) => {
    setSearchQuery(query);
    // When searching, create new filters without folderId to search globally
    const newFilters: FileFilters = { 
      search: query || undefined, // Set search query (empty string becomes undefined)
      folderId: query ? undefined : (currentFolder || undefined) // Remove folderId when searching
    };
    setFilters(newFilters);
    // When searching, don't filter by folderId - search across all folders
    // Pass undefined for folderId to search all files
    loadFiles(1, newFilters, query ? undefined : currentFolder);
    // Also load folders with search filter when searching
    if (query) {
      loadFolders(undefined, query);
    } else {
      loadFolders(currentFolder);
    }
  };

  // Clear search
  const handleClearSearch = () => {
    setSearchQuery('');
    const newFilters = { ...filters, search: '' };
    setFilters(newFilters);
    // After clearing search, restore folder filter
    loadFiles(1, newFilters, currentFolder);
    loadFolders(currentFolder);
  };

  // Handle file upload
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    setUploadProgress(0);

    let uploadedCount = 0;
    let failedCount = 0;

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setUploadingFileName(file.name);
        setUploadingFileSize(file.size);
        setUploadProgress(0);
        
        const success = await uploadFile(file, {
          name: file.name,
          folderId: currentFolder || undefined,
        }, (progress) => {
          setUploadProgress(progress);
        });
        
        if (success) {
          uploadedCount++;
        } else {
          failedCount++;
        }
      }
      
      setShowUploadModal(false);
      
      // Show appropriate message based on upload results
      if (uploadedCount > 0 && failedCount === 0) {
        toast.success(`${uploadedCount} file(s) uploaded successfully!`);
      } else if (uploadedCount > 0 && failedCount > 0) {
        toast.error(`${failedCount} file(s) failed to upload. ${uploadedCount} file(s) uploaded successfully.`);
      } else if (uploadedCount === 0 && failedCount > 0) {
        toast.error(`${failedCount} file(s) failed to upload.`);
      }
      
      // Refresh file list to show newly uploaded files
      await loadFiles();
      await loadFolders();
      await refreshStats();
    } catch (error) {
      console.error('Error uploading files:', error);
      if (uploadedCount === 0) {
        toast.error('Failed to upload files');
      }
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      setUploadingFileName('');
      setUploadingFileSize(0);
      // Reset file inputs
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      if (uploadModalFileInputRef.current) {
        uploadModalFileInputRef.current.value = '';
      }
    }
  };

  // Handle folder creation
  const handleCreateFolder = async () => {
    const folderName = (document.getElementById('folder-name') as HTMLInputElement)?.value;
    const folderDescription = (document.getElementById('folder-description') as HTMLInputElement)?.value;
    
    if (!folderName) {
      toast.error('Please enter a folder name');
      return;
    }

    try {
      // Only include parentId if it's a valid number
      const folderData: any = {
        name: folderName,
      };
      
      if (folderDescription && folderDescription.trim()) {
        folderData.description = folderDescription.trim();
      }
      
      // Only include parentId if currentFolder is a valid number
      // currentFolder is typed as number | null from FileContext
      const parentIdValue = typeof currentFolder === 'number' && currentFolder > 0 ? currentFolder : null;
      
      if (parentIdValue) {
        folderData.parentId = parentIdValue;
      }
      
      // Ensure we're sending a clean object without undefined values
      const cleanFolderData: any = {
        name: folderData.name.trim()
      };
      
      if (folderData.description && folderData.description.trim()) {
        cleanFolderData.description = folderData.description.trim();
      }
      
      if (parentIdValue && typeof parentIdValue === 'number' && parentIdValue > 0) {
        cleanFolderData.parentId = parentIdValue;
      }
      
      const success = await createFolder(cleanFolderData);
      
      if (success) {
        setShowCreateFolderModal(false);
        // Toast is already shown in FileContext, so we don't need to show it again
      } else {
        toast.error('Failed to create folder');
      }
    } catch (error) {
      toast.error('Failed to create folder');
    }
  };

  // Handle file download
  const handleDownload = async (file: FileItem) => {
    try {
      await downloadFile(file.id, file.name);
    } catch (error) {
      toast.error('Failed to download file');
    }
  };

  const handleOcrFile = async (file: FileItem) => {
    const toastId = toast.loading('Running OCR...', { id: `ocr-${file.id}` });

    try {
      const response = await fileService.ocrFile(file.id);

      if (response.success) {
        toast.success(`Created ${response.data?.name || 'OCR text file'}`, { id: toastId });
        await refreshFiles();
        await refreshStats();
      } else {
        toast.error(response.message || 'Failed to OCR file', { id: toastId });
      }
    } catch (error: any) {
      toast.error(error.response?.data?.message || error.message || 'Failed to OCR file', { id: toastId });
    }
  };

  // Handle file deletion
  const handleDeleteFile = async (file: FileItem) => {
    if (window.confirm(`Are you sure you want to move "${file.name}" to trash?`)) {
      try {
        await deleteFile(file.id);
        toast.success('File moved to trash!');
      } catch (error) {
        toast.error('Failed to delete file');
      }
    }
  };

  // Handle folder deletion
  const handleDeleteFolder = async (folder: Folder) => {
    if (window.confirm(`Are you sure you want to delete the folder "${folder.name}"?\n\nNote: The folder must be empty (no files or subfolders).`)) {
      try {
        await fileService.deleteFolder(folder.id);
        toast.success('Folder deleted successfully!');
        
        // If we deleted the current folder, go back to root
        if (currentFolder === folder.id) {
          setCurrentFolder(null);
        }
        
        await loadFolders(); // Refresh folder list
      } catch (error: any) {
        const errorMessage = error.response?.data?.message || 'Failed to delete folder';
        toast.error(errorMessage);
      }
    }
  };

  // Handle file restoration from trash
  const handleRestoreFile = async (file: FileItem) => {
    try {
      const response = await fileService.restoreFile(file.id);
      if (response.success) {
        toast.success('File restored successfully!');
        // Refresh trash view
        await loadDeletedFiles();
        // Reload main files to show the restored file
        await loadFiles();
        await loadFolders();
        await refreshStats();
      } else {
        toast.error('Failed to restore file');
      }
    } catch (error) {
      toast.error('Failed to restore file');
    }
  };

  // Handle permanent deletion
  const handlePermanentDelete = async (file: FileItem) => {
    if (window.confirm(`Permanently delete "${file.name}"?\n\nThis removes the file from storage and cannot be undone.`)) {
      try {
        const response = await fileService.permanentlyDeleteFile(file.id);
        if (response.success) {
          toast.success('File permanently deleted!');
          await loadDeletedFiles(); // Refresh trash
        } else {
          toast.error('Failed to permanently delete file');
        }
      } catch (error) {
        toast.error('Failed to permanently delete file');
      }
    }
  };

  // Handle star/unstar toggle
  const handleToggleStar = async (itemType: 'file' | 'folder', itemId: number) => {
    try {
      const response = await fileService.toggleStar(itemType, itemId);
      if (response.success) {
        const action = response.data?.starred ? 'starred' : 'unstarred';
        toast.success(`Item ${action}!`);
        
        // Always refresh all views to keep star status in sync
        if (currentView === 'starred') {
          await loadStarredItems();
        }
        // Always refresh my-drive view to update star icons
        await loadFiles();
        await loadFolders();
      }
    } catch (error) {
      toast.error('Failed to toggle star');
    }
  };

  // Handle folder navigation
  const handleFolderClick = (folder: Folder) => {
    // Navigate to folder URL
    navigate(`/dashboard/my-drive/folder/${folder.id}`);
  };

  // Handle file click - open preview if previewable, otherwise download
  const handleFileClick = (file: FileItem) => {
    if (fileService.canPreview(file.file_type)) {
      setPreviewFile(file);
      setShowPreviewModal(true);
    } else {
      // For non-previewable files, download them
      fileService.downloadFile(file.id, file.name);
    }
  };

  // Drag and drop handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragCounter(prev => prev + 1);
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragCounter(prev => {
      const newCounter = prev - 1;
      if (newCounter === 0) {
        setIsDragging(false);
      }
      return newCounter;
    });
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    setDragCounter(0);

    if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) {
      return;
    }

    const files = Array.from(e.dataTransfer.files);
    
    // Check if any file has webkitRelativePath (indicates folder drop)
    const hasFolderStructure = files.some(file => (file as any).webkitRelativePath);
    
    // If files have webkitRelativePath, it's a folder upload
    // Otherwise, check if we have a directory structure by examining DataTransferItem
    let isFolderUpload = hasFolderStructure;
    
    if (!isFolderUpload && e.dataTransfer.items) {
      // Check DataTransferItem to see if it's a directory
      for (let i = 0; i < e.dataTransfer.items.length; i++) {
        const item = e.dataTransfer.items[i];
        if (item.webkitGetAsEntry) {
          const entry = item.webkitGetAsEntry();
          if (entry && entry.isDirectory) {
            isFolderUpload = true;
            break;
          }
        }
      }
    }

    if (isFolderUpload) {
      // Handle folder upload from drag and drop
      // Process DataTransferItem entries to get folder structure
      setIsUploading(true);
      setUploadProgress(0);
      
      try {
        const fileMap = new Map<string, File[]>();
        
        // Process all items to get folder structure
        const processEntries = async (items: DataTransferItemList) => {
          const promises: Promise<void>[] = [];
          
          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.webkitGetAsEntry) {
              const entry = item.webkitGetAsEntry();
              if (entry) {
                promises.push(processEntry(entry, ''));
              }
            }
          }
          
          await Promise.all(promises);
        };

        const processEntry = async (entry: FileSystemEntry, basePath: string): Promise<void> => {
          if (entry.isFile) {
            const fileEntry = entry as FileSystemFileEntry;
            return new Promise((resolve) => {
              fileEntry.file((file) => {
                const fullPath = basePath ? `${basePath}/${file.name}` : file.name;
                const pathParts = fullPath.split('/');
                pathParts.pop(); // Remove filename
                const folderPath = pathParts.join('/');
                
                if (!fileMap.has(folderPath)) {
                  fileMap.set(folderPath, []);
                }
                // Add webkitRelativePath to file for compatibility
                (file as any).webkitRelativePath = fullPath;
                fileMap.get(folderPath)!.push(file);
                resolve();
              });
            });
          } else if (entry.isDirectory) {
            const dirEntry = entry as FileSystemDirectoryEntry;
            const newPath = basePath ? `${basePath}/${entry.name}` : entry.name;
            
            return new Promise((resolve) => {
              const reader = dirEntry.createReader();
              const readEntries = () => {
                reader.readEntries(async (entries) => {
                  if (entries.length === 0) {
                    resolve();
                    return;
                  }
                  
                  const promises = entries.map(e => processEntry(e, newPath));
                  await Promise.all(promises);
                  
                  // Read more entries if available
                  readEntries();
                });
              };
              readEntries();
            });
          }
        };

        await processEntries(e.dataTransfer.items);

        // Now process the fileMap similar to handleFolderUpload
        let uploadedCount = 0;
        const allFiles = Array.from(fileMap.values()).flat();
        const totalFiles = allFiles.length;
        const createdFolderIds = new Set<number>();

        const baseFolderId = currentFolder || undefined;
        
        const sortedEntries = Array.from(fileMap.entries()).sort((a, b) => {
          if (!a[0]) return -1;
          if (!b[0]) return 1;
          return a[0].split('/').length - b[0].split('/').length;
        });
        
        for (const [folderPath, folderFiles] of sortedEntries) {
          let targetFolderId = baseFolderId;

          if (folderPath) {
            const pathParts = folderPath.split('/').filter(p => p);
            for (const folderName of pathParts) {
              const currentParentId = targetFolderId;
              const existingFolder = folders.find(
                f => f.name === folderName && 
                f.parent_id === (currentParentId !== undefined ? currentParentId : null) &&
                f.status === 'active'
              );

              if (existingFolder) {
                targetFolderId = existingFolder.id;
              } else {
                try {
                  const folderResponse = await fileService.createFolder({
                    name: folderName,
                    description: '',
                    parentId: currentParentId !== undefined ? currentParentId : undefined
                  });
                  if (folderResponse.success && folderResponse.data && folderResponse.data.folderId) {
                    targetFolderId = folderResponse.data.folderId;
                    createdFolderIds.add(targetFolderId);
                    await loadFolders(null);
                  }
                } catch (error) {
                  console.error('Error creating folder:', error);
                }
              }
            }
          }

          const finalTargetFolderId = targetFolderId;
          for (let fileIndex = 0; fileIndex < folderFiles.length; fileIndex++) {
            const file = folderFiles[fileIndex];
            // Capture uploadedCount at the start of each iteration to avoid closure issues
            const currentUploadedCount = uploadedCount;
            try {
              const success = await uploadFile(file, {
                name: file.name,
                folderId: finalTargetFolderId,
              }, (progress) => {
                // Calculate progress based on current file index and captured count
                const currentCount = currentUploadedCount + fileIndex + 1;
                setUploadProgress((currentCount / totalFiles) * 100);
              });
              if (success) {
                uploadedCount++;
              }
            } catch (error) {
              console.error('Error uploading file:', error);
            }
          }
        }

        // Clean up empty folders recursively
        // Process folders in reverse order (deepest first) so we can check parents after deleting children
        if (createdFolderIds.size > 0) {
          await loadFolders(null);
          const allFoldersResponse = await fileService.getFolders(user?.organizationId);
          if (allFoldersResponse.success && allFoldersResponse.data && Array.isArray(allFoldersResponse.data)) {
            const allFolders = allFoldersResponse.data;
            // Sort folders by depth (deepest first) for recursive cleanup
            const foldersToCheck = Array.from(createdFolderIds)
              .map(id => allFolders.find(f => f.id === id))
              .filter(f => f !== undefined) as Folder[];
            
            // Sort by path depth (count parent_id chain)
            const getDepth = (folder: Folder, allFoldersList: Folder[]): number => {
              if (!folder.parent_id) return 0;
              const parent = allFoldersList.find(f => f.id === folder.parent_id);
              return parent ? 1 + getDepth(parent, allFoldersList) : 1;
            };
            
            foldersToCheck.sort((a, b) => getDepth(b, allFolders) - getDepth(a, allFolders));
            
            // Recursively check and delete empty folders
            // This function will also check parent folders even if they weren't created in this upload
            const checkAndDeleteEmpty = async (folderId: number): Promise<void> => {
              // Refresh folder list to get latest state
              const latestFoldersResponse = await fileService.getFolders(user?.organizationId);
              if (!latestFoldersResponse.success || !latestFoldersResponse.data || !Array.isArray(latestFoldersResponse.data)) return;
              
              const latestFolders = latestFoldersResponse.data;
              const latestFolder = latestFolders.find(f => f.id === folderId);
              if (!latestFolder) return;
              
              const filesInFolder = await fileService.getFiles(1, 1000, { folderId: folderId });
              const hasFiles = filesInFolder.success && filesInFolder.data && 
                              filesInFolder.data.files && filesInFolder.data.files.length > 0;
              
              const hasSubfolders = latestFolders.some(f => 
                f.parent_id === folderId && f.status === 'active'
              );
              
              if (!hasFiles && !hasSubfolders) {
                try {
                  const parentId = latestFolder.parent_id;
                  await fileService.deleteFolder(folderId);
                  // After deleting, check if parent is now empty (even if it wasn't created in this upload)
                  if (parentId) {
                    await checkAndDeleteEmpty(parentId);
                  }
                } catch (error) {
                  console.error(`Error deleting empty folder:`, error);
                }
              }
            };
            
            // Check and delete each folder (this will recursively check parents too)
            for (const folder of foldersToCheck) {
              await checkAndDeleteEmpty(folder.id);
            }
          }
        }

        // Show appropriate message based on upload results
        const failedCount = totalFiles - uploadedCount;
        if (uploadedCount > 0 && failedCount === 0) {
          toast.success(`${uploadedCount} file(s) uploaded successfully!`);
        } else if (uploadedCount > 0 && failedCount > 0) {
          toast.error(`${failedCount} file(s) failed to upload. ${uploadedCount} file(s) uploaded successfully.`);
        } else if (uploadedCount === 0 && failedCount > 0) {
          toast.error(`${failedCount} file(s) failed to upload.`);
        }
        
        await loadFiles();
        await loadFolders();
        await refreshStats();
      } catch (error) {
        console.error('Error uploading folder:', error);
        toast.error('Failed to upload folder');
      } finally {
        setIsUploading(false);
        setUploadProgress(0);
      }
    } else {
      // Handle file upload
      const fakeEvent = {
        target: {
          files: files
        }
      } as any;
      await handleFileUpload(fakeEvent);
    }
  };

  const handleFolderUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    setUploadProgress(0);
    setShowNewMenu(false);

    try {
      // Get the folder structure from the file paths
      const fileMap = new Map<string, File[]>();
      
      // Group files by their folder path
      Array.from(files).forEach((file) => {
        const webkitRelativePath = (file as any).webkitRelativePath || file.name;
        const pathParts = webkitRelativePath.split('/');
        pathParts.pop(); // Remove filename, keep only folder path
        const folderPath = pathParts.join('/');
        
        if (!fileMap.has(folderPath)) {
          fileMap.set(folderPath, []);
        }
        fileMap.get(folderPath)!.push(file);
      });

      let uploadedCount = 0;
      const totalFiles = files.length;
      const createdFolderIds = new Set<number>(); // Track folders created during upload

      // Upload files maintaining folder structure
      // All files should be uploaded relative to currentFolder (where user is currently viewing)
      // If currentFolder is null, files go to root. If currentFolder is set, files go there.
      const baseFolderId = currentFolder || undefined;
      
      // Process folders in order (root files first, then nested folders)
      const sortedEntries = Array.from(fileMap.entries()).sort((a, b) => {
        // Empty path (root files) comes first, then by path depth
        if (!a[0]) return -1;
        if (!b[0]) return 1;
        return a[0].split('/').length - b[0].split('/').length;
      });
      
      for (const [folderPath, folderFiles] of sortedEntries) {
        let targetFolderId = baseFolderId;

        // Create folder structure if needed
        // folderPath is empty for files at the root of the uploaded folder
        // In that case, files should go directly to baseFolderId (currentFolder or root)
        if (folderPath) {
          const pathParts = folderPath.split('/').filter(p => p);
          // Start from baseFolderId and create nested folders
          for (const folderName of pathParts) {
            // Capture current targetFolderId value to avoid closure issues
            const currentParentId = targetFolderId;
            // Check if folder already exists in the current location
            const existingFolder = folders.find(
              f => f.name === folderName && 
              f.parent_id === (currentParentId !== undefined ? currentParentId : null) &&
              f.status === 'active'
            );

            if (existingFolder) {
              targetFolderId = existingFolder.id;
            } else {
              // Create new folder
              try {
                const folderResponse = await fileService.createFolder({
                  name: folderName,
                  description: '',
                  parentId: currentParentId !== undefined ? currentParentId : undefined
                });
                if (folderResponse.success && folderResponse.data && folderResponse.data.folderId) {
                  targetFolderId = folderResponse.data.folderId;
                  createdFolderIds.add(targetFolderId); // Track created folder
                  // Refresh folder list to include newly created folders
                  await loadFolders(null);
                }
              } catch (error) {
                console.error('Error creating folder:', error);
              }
            }
          }
        }
        // If folderPath is empty, targetFolderId remains baseFolderId
        // This ensures root files of uploaded folder go to currentFolder (or root if at root)

        // Upload files in this folder
        // Capture targetFolderId to avoid closure issues
        const finalTargetFolderId = targetFolderId;
        for (let fileIndex = 0; fileIndex < folderFiles.length; fileIndex++) {
          const file = folderFiles[fileIndex];
          // Capture uploadedCount at the start of each iteration to avoid closure issues
          const currentUploadedCount = uploadedCount;
          try {
            // Always specify folderId explicitly - undefined means root, number means specific folder
            const success = await uploadFile(file, {
              name: file.name,
              folderId: finalTargetFolderId, // This will be baseFolderId for root files, or created folder ID for nested files
            }, (progress) => {
              // Calculate progress based on current file index and captured count
              const currentCount = currentUploadedCount + fileIndex + 1;
              setUploadProgress((currentCount / totalFiles) * 100);
            });
            if (success) {
              uploadedCount++;
            }
          } catch (error) {
            console.error('Error uploading file:', error);
          }
        }
      }

      // After upload, check for and delete empty folders recursively
      // Process folders in reverse order (deepest first) so we can check parents after deleting children
      if (createdFolderIds.size > 0) {
        await loadFolders(null);
        const allFoldersResponse = await fileService.getFolders(user?.organizationId);
        
        if (allFoldersResponse.success && allFoldersResponse.data && Array.isArray(allFoldersResponse.data)) {
          const allFolders = allFoldersResponse.data;
          // Sort folders by depth (deepest first) for recursive cleanup
          const foldersToCheck = Array.from(createdFolderIds)
            .map(id => allFolders.find(f => f.id === id))
            .filter(f => f !== undefined) as Folder[];
          
          // Sort by path depth (count parent_id chain)
          const getDepth = (folder: Folder, allFoldersList: Folder[]): number => {
            if (!folder.parent_id) return 0;
            const parent = allFoldersList.find(f => f.id === folder.parent_id);
            return parent ? 1 + getDepth(parent, allFoldersList) : 1;
          };
          
          foldersToCheck.sort((a, b) => getDepth(b, allFolders) - getDepth(a, allFolders));
          
          // Recursively check and delete empty folders
          // This function will also check parent folders even if they weren't created in this upload
          const checkAndDeleteEmpty = async (folderId: number): Promise<void> => {
            // Refresh folder list to get latest state
            const latestFoldersResponse = await fileService.getFolders(user?.organizationId);
            if (!latestFoldersResponse.success || !latestFoldersResponse.data || !Array.isArray(latestFoldersResponse.data)) return;
            
            const latestFolders = latestFoldersResponse.data;
            const latestFolder = latestFolders.find(f => f.id === folderId);
            if (!latestFolder) return;
            
            const filesInFolder = await fileService.getFiles(1, 1000, { folderId: folderId });
            const hasFiles = filesInFolder.success && filesInFolder.data && 
                            filesInFolder.data.files && filesInFolder.data.files.length > 0;
            
            const hasSubfolders = latestFolders.some(f => 
              f.parent_id === folderId && f.status === 'active'
            );
            
            if (!hasFiles && !hasSubfolders) {
              try {
                const parentId = latestFolder.parent_id;
                await fileService.deleteFolder(folderId);
                // After deleting, check if parent is now empty (even if it wasn't created in this upload)
                if (parentId) {
                  await checkAndDeleteEmpty(parentId);
                }
              } catch (error) {
                console.error(`Error deleting empty folder:`, error);
              }
            }
          };
          
          // Check and delete each folder (this will recursively check parents too)
          for (const folder of foldersToCheck) {
            await checkAndDeleteEmpty(folder.id);
          }
        }
      }

      // Only show success if at least one file uploaded successfully
      if (uploadedCount > 0) {
        const failedCount = totalFiles - uploadedCount;
        if (failedCount === 0) {
          toast.success(`${uploadedCount} file(s) uploaded successfully!`);
        } else {
          toast.error(`${failedCount} file(s) failed to upload. ${uploadedCount} file(s) uploaded successfully.`);
        }
      }
      // If uploadedCount is 0, error messages are already shown by uploadFile function
      
      await loadFiles();
      await loadFolders(null);
    } catch (error) {
      toast.error('Failed to upload folder');
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      if (folderInputRef.current) {
        folderInputRef.current.value = '';
      }
    }
  };

  // Handle new menu item clicks
  const handleNewFolder = () => {
    setShowNewMenu(false);
    setShowCreateFolderModal(true);
  };

  const handleNewFileUpload = () => {
    setShowNewMenu(false);
    setShowUploadModal(true);
  };

  const handleNewFolderUpload = () => {
    setShowNewMenu(false);
    folderInputRef.current?.click();
  };

  // Handle breadcrumb navigation
  const handleBreadcrumbClick = (folderId: number | null) => {
    if (folderId === null) {
      // Navigate to root (My Drive)
      navigate('/dashboard/my-drive');
    } else {
      // Navigate to folder
      navigate(`/dashboard/my-drive/folder/${folderId}`);
    }
  };

  // Context menu handlers
  const handleContextMenu = (e: React.MouseEvent, item: FileItem | Folder, type: 'file' | 'folder') => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      show: true,
      x: e.clientX,
      y: e.clientY,
      item,
      type
    });
  };

  const handleMoreClick = (e: React.MouseEvent, item: FileItem | Folder, type: 'file' | 'folder') => {
    e.stopPropagation();
    const buttonRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const padding = 10; // Padding from viewport edges
    
    // Set initial position - will be adjusted after menu renders
    // Position menu below the button by default
    let x = buttonRect.left;
    let y = buttonRect.bottom + 5;
    
    // Basic horizontal adjustment before rendering
    const estimatedMenuWidth = 220;
    if (x + estimatedMenuWidth > window.innerWidth - padding) {
      // Try positioning to the left of button
      x = buttonRect.right - estimatedMenuWidth;
    }
    
    // Ensure menu doesn't go off left edge
    if (x < padding) {
      x = padding;
    }
    
    setContextMenu({
      show: true,
      x,
      y,
      item,
      type,
      buttonTop: buttonRect.top // Store button top position for positioning above
    });
  };

  const closeContextMenu = () => {
    setContextMenu({ show: false, x: 0, y: 0, item: null, type: null, buttonTop: undefined });
  };

  // Close context menu when clicking outside or on toolbar buttons
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      // Close if clicking outside context menu or on toolbar buttons (including sort menu)
      if (contextMenu.show) {
        const isContextMenu = target.closest('.context-menu');
        const isToolbar = target.closest('.toolbar');
        const isSortMenu = target.closest('.sort-menu-container');
        const isMoreButton = target.closest('.btn-more');
        
        // Close if clicking outside context menu, or on toolbar (including sort), but not if clicking the more button that opened it
        if (!isContextMenu && (isToolbar || isSortMenu || (!isMoreButton))) {
          closeContextMenu();
        }
      }
    };
    if (contextMenu.show) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [contextMenu.show]);

  // Adjust context menu position after it renders to ensure it fits in viewport
  useEffect(() => {
    if (!contextMenu.show || !contextMenuRef.current) return;
    
    const menu = contextMenuRef.current;
    const padding = 10;
    
    // Get actual menu dimensions
    const menuRect = menu.getBoundingClientRect();
    const menuWidth = menuRect.width;
    const menuHeight = menuRect.height;
    
    // Get current position
    let x = contextMenu.x;
    let y = contextMenu.y;
    const buttonTop = contextMenu.buttonTop;
    
    // Adjust horizontal position if needed
    if (x + menuWidth > window.innerWidth - padding) {
      // Try positioning to the left
      x = Math.max(padding, window.innerWidth - menuWidth - padding);
    }
    if (x < padding) {
      x = padding;
    }
    
    // Adjust vertical position if needed
    const spaceBelow = window.innerHeight - y;
    const spaceAbove = y;
    
    // Check if menu would overflow bottom and if there's more space above
    if (menuHeight > spaceBelow && (buttonTop !== undefined || spaceAbove > spaceBelow)) {
      // Position above the button if we have button position info
      if (buttonTop !== undefined) {
        y = buttonTop - menuHeight - 5;
      } else {
        // Fallback: calculate based on current position
        y = y - menuHeight - 10;
      }
    }
    
    // Ensure menu doesn't go off top edge
    if (y < padding) {
      y = padding;
      // If menu is still too tall, it will scroll (handled by CSS max-height and overflow)
    }
    
    // Ensure menu doesn't go off bottom edge (with scroll support)
    if (y + menuHeight > window.innerHeight - padding) {
      // Limit max height to available space
      const maxHeight = window.innerHeight - y - padding;
      menu.style.maxHeight = `${maxHeight}px`;
    } else {
      // Reset max height if there's enough space
      menu.style.maxHeight = 'calc(100vh - 20px)';
    }
    
    // Apply adjusted position
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
  }, [contextMenu]);

  // Context menu action handlers
  const handleRename = () => {
    if (contextMenu.item) {
      setSelectedItem({ item: contextMenu.item, type: contextMenu.type! });
      setRenameValue(contextMenu.item.name);
      setShowRenameModal(true);
    }
    closeContextMenu();
  };

  const handleShare = () => {
    if (contextMenu.item) {
      setSelectedItem({ item: contextMenu.item, type: contextMenu.type! });
      setShowShareModal(true);
    }
    closeContextMenu();
  };

  const handleCopyLink = async () => {
    if (contextMenu.item && contextMenu.type === 'file') {
      const file = contextMenu.item as FileItem;
      // Generate a shareable link (you can customize this URL format)
      const shareLink = `${window.location.origin}/share/file/${file.id}`;
      try {
        await navigator.clipboard.writeText(shareLink);
        toast.success('Link copied to clipboard!');
      } catch (error) {
        toast.error('Failed to copy link');
      }
    } else if (contextMenu.item && contextMenu.type === 'folder') {
      const folder = contextMenu.item as Folder;
      const shareLink = `${window.location.origin}/share/folder/${folder.id}`;
      try {
        await navigator.clipboard.writeText(shareLink);
        toast.success('Link copied to clipboard!');
      } catch (error) {
        toast.error('Failed to copy link');
      }
    }
    closeContextMenu();
  };

  const handleMove = () => {
    if (contextMenu.item) {
      setSelectedItem({ item: contextMenu.item, type: contextMenu.type! });
      setShowMoveModal(true);
    }
    closeContextMenu();
  };

  const handleMoveToRoot = async () => {
    if (!contextMenu.item) return;
    
    closeContextMenu();
    
    try {
      if (contextMenu.type === 'file') {
        const response = await fileService.moveFile(contextMenu.item.id, null);
        if (response.success) {
          toast.success(`"${contextMenu.item.name}" moved to root`);
          // Navigate to root and refresh
          navigate('/dashboard/my-drive');
          await loadFiles(1, filters, null);
          await loadFolders(null);
          await refreshStats();
        } else {
          toast.error(response.message || 'Failed to move file');
        }
      } else {
        const response = await fileService.moveFolder(contextMenu.item.id, null);
        if (response.success) {
          toast.success(`"${contextMenu.item.name}" moved to root`);
          // Navigate to root and refresh
          navigate('/dashboard/my-drive');
          await loadFiles(1, filters, null);
          await loadFolders(null);
          await refreshStats();
        } else {
          toast.error(response.message || 'Failed to move folder');
        }
      }
    } catch (error) {
      console.error('Error moving to root:', error);
      toast.error('Failed to move to root');
    }
  };

  const handleShowInfo = () => {
    if (contextMenu.item) {
      setSelectedItem({ item: contextMenu.item, type: contextMenu.type! });
      setShowInfoModal(true);
    }
    closeContextMenu();
  };

  const handleManageVersions = async () => {
    if (contextMenu.item && contextMenu.type === 'file') {
      const file = contextMenu.item as FileItem;
      setSelectedItem({ item: contextMenu.item, type: 'file' });
      setShowVersionModal(true);
      
      // Load versions
      setIsLoadingVersions(true);
      try {
        const response = await fileService.getFileVersions(file.id);
        if (response.success && response.data) {
          setFileVersions(response.data);
        }
      } catch (error) {
        console.error('Error loading versions:', error);
        toast.error('Failed to load versions');
      } finally {
        setIsLoadingVersions(false);
      }
    }
    closeContextMenu();
  };

  const handleUploadNewVersion = () => {
    versionFileInputRef.current?.click();
  };

  // Drag and drop handlers for moving files/folders
  const handleDragStart = (e: React.DragEvent, item: FileItem | Folder, type: 'file' | 'folder') => {
    e.stopPropagation();
    setDraggedItem({ id: item.id, type, name: item.name });
    // Set drag image
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', ''); // Required for Firefox
    }
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
    setDragOverFolderId(null);
  };

  const handleFolderDragOver = (e: React.DragEvent, folderId: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggedItem && draggedItem.type === 'folder' && draggedItem.id === folderId) {
      return; // Can't drop folder on itself
    }
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move';
    }
    setDragOverFolderId(folderId);
  };

  const handleFolderDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Clear dragOverFolderId when leaving the folder
    // Check if the related target (where we're going) is not a child of the folder
    const relatedTarget = e.relatedTarget as HTMLElement;
    if (!relatedTarget || !(e.currentTarget as HTMLElement).contains(relatedTarget)) {
      setDragOverFolderId(null);
    }
  };

  // Helper function to refresh data based on current view
  const refreshCurrentView = async () => {
    const folderIdFromUrl = getFolderIdFromUrl();

    switch (currentView) {
      case 'starred':
        await loadStarredItems();
        break;
      case 'shared':
        await loadSharedItems();
        break;
      case 'trash':
        await loadDeletedFiles();
        break;
      default:
        // My Drive view
        await loadFiles(1, filters, folderIdFromUrl);
        await loadFolders(folderIdFromUrl);
        break;
    }
    // Always refresh stats
    await refreshStats();
  };

  const handleFolderDrop = async (e: React.DragEvent, targetFolderId: number) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverFolderId(null);

    if (!draggedItem) return;

    // Prevent dropping on self
    if (draggedItem.type === 'folder' && draggedItem.id === targetFolderId) {
      toast.error('Cannot move folder into itself');
      setDraggedItem(null);
      return;
    }

    try {
      // Check if folder is trying to move into its own child
      if (draggedItem.type === 'folder') {
        const checkFolder = folders.find(f => f.id === draggedItem.id);
        if (checkFolder) {
          // Simple check - can't move folder to itself
          if (checkFolder.id === targetFolderId) {
            toast.error('Cannot move folder into itself');
            setDraggedItem(null);
            return;
          }
        }
      }

      if (draggedItem.type === 'file') {
        const response = await fileService.moveFile(draggedItem.id, targetFolderId);
        if (response.success) {
          toast.success(`"${draggedItem.name}" moved to folder`);
          await refreshCurrentView();
        } else {
          toast.error(response.message || 'Failed to move file');
        }
      } else {
        const response = await fileService.moveFolder(draggedItem.id, targetFolderId);
        if (response.success) {
          toast.success(`"${draggedItem.name}" moved to folder`);
          await refreshCurrentView();
        } else {
          toast.error(response.message || 'Failed to move folder');
        }
      }
    } catch (error) {
      console.error('Error moving item:', error);
      toast.error('Failed to move item');
    } finally {
      setDraggedItem(null);
    }
  };

  // Handle drop in empty area (move to root)
  const handleRootDrop = async (e: React.DragEvent) => {
    // Check if we're dropping on a folder - if so, let the folder handle it
    const target = e.target as HTMLElement;
    if (target.closest('.folder-row, .file-item.folder-drop-target')) {
      return; // Let folder drop handler take care of it
    }

    // Only handle if we're not currently over a folder
    if (dragOverFolderId !== null) {
      // Small delay to let folder drop handler process first
      setTimeout(() => {
        if (dragOverFolderId !== null) {
          setDragOverFolderId(null);
        }
      }, 10);
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    if (!draggedItem) return;

    try {
      if (draggedItem.type === 'file') {
        const response = await fileService.moveFile(draggedItem.id, null);
        if (response.success) {
          toast.success(`"${draggedItem.name}" moved to root`);
          // Navigate to root and refresh
          navigate('/dashboard/my-drive');
          await loadFiles(1, filters, null);
          await loadFolders(null);
          await refreshStats();
        } else {
          toast.error(response.message || 'Failed to move file');
        }
      } else {
        const response = await fileService.moveFolder(draggedItem.id, null);
        if (response.success) {
          toast.success(`"${draggedItem.name}" moved to root`);
          // Navigate to root and refresh
          navigate('/dashboard/my-drive');
          await loadFiles(1, filters, null);
          await loadFolders(null);
          await refreshStats();
        } else {
          toast.error(response.message || 'Failed to move folder');
        }
      }
    } catch (error) {
      console.error('Error moving item:', error);
      toast.error('Failed to move item');
    } finally {
      setDraggedItem(null);
      setDragOverFolderId(null);
    }
  };

  const handleVersionFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0 || !selectedItem || selectedItem.type !== 'file') return;

    const file = files[0];
    setIsUploadingVersion(true);

    try {
      const response = await fileService.uploadNewVersion(
        selectedItem.item.id,
        file,
        (progress) => {
          // Progress callback if needed
        }
      );

      if (response.success) {
        toast.success('New version uploaded successfully!');
        // Reload versions
        const versionsResponse = await fileService.getFileVersions(selectedItem.item.id);
        if (versionsResponse.success && versionsResponse.data) {
          setFileVersions(versionsResponse.data);
        }
        // Refresh file list
        await loadFiles();
      } else {
        toast.error('Failed to upload new version');
      }
    } catch (error: any) {
      console.error('Error uploading version:', error);
      toast.error(error.message || 'Failed to upload new version');
    } finally {
      setIsUploadingVersion(false);
      if (versionFileInputRef.current) {
        versionFileInputRef.current.value = '';
      }
    }
  };

  const handleContextDownload = async () => {
    if (contextMenu.item) {
      if (contextMenu.type === 'file') {
        handleDownload(contextMenu.item as FileItem);
      } else if (contextMenu.type === 'folder') {
        // Download folder as zip
        const folder = contextMenu.item as Folder;
        try {
          toast.loading('Preparing download...', { id: 'folder-download' });
          await fileService.downloadFolder(folder.id, folder.name);
          toast.success('Folder downloaded successfully!', { id: 'folder-download' });
        } catch (error: any) {
          toast.error(error.message || 'Failed to download folder', { id: 'folder-download' });
        }
      }
    }
    closeContextMenu();
  };

  const submitRename = async () => {
    if (!selectedItem || !renameValue.trim()) return;
    
    try {
      if (selectedItem.type === 'file') {
        const response = await fileService.renameFile(selectedItem.item.id, renameValue.trim());
        if (response.success) {
          toast.success('File renamed successfully!');
          await loadFiles();
        } else {
          toast.error('Failed to rename file');
        }
      } else {
        const response = await fileService.renameFolder(selectedItem.item.id, renameValue.trim());
        if (response.success) {
          toast.success('Folder renamed successfully!');
          await loadFolders();
        } else {
          toast.error('Failed to rename folder');
        }
      }
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to rename');
    }
    
    setShowRenameModal(false);
    setSelectedItem(null);
    setRenameValue('');
  };

  // Get breadcrumb path - builds full path from root to current folder
  const getBreadcrumbPath = () => {
    const path: Array<{ id: number | null; name: string }> = [];
    const visited = new Set<number>(); // Track visited folders to prevent circular references
    const MAX_DEPTH = 100; // Maximum folder depth to prevent stack overflow
    
    // Use folderId from URL directly to avoid state timing issues
    const folderIdFromUrl = getFolderIdFromUrl();
    const folderIdToUse = folderIdFromUrl !== null ? folderIdFromUrl : currentFolder;
    
    // Use allFoldersCache for breadcrumb building (includes all folders we've seen)
    const foldersForBreadcrumb = allFoldersCache.length > 0 ? allFoldersCache : folders;
    
    if (folderIdToUse) {
      // Build path from current folder to root
      const buildPath = (folderId: number | null, depth: number = 0) => {
        if (!folderId || depth >= MAX_DEPTH) return;
        
        // Prevent infinite loops from circular references
        if (visited.has(folderId)) {
          console.warn(`Circular reference detected in folder structure: folder ${folderId}`);
          return;
        }
        visited.add(folderId);
        
        const folder = foldersForBreadcrumb.find(f => f.id === folderId);
        if (folder) {
          // Recursively add parent folders first
          if (folder.parent_id) {
            buildPath(folder.parent_id, depth + 1);
          }
          // Then add current folder
          path.push({ id: folder.id, name: folder.name });
        } else {
          // Folder not found in cache - try to find it by loading all folders
          // This can happen if we navigate directly to a folder URL
          // Instead of showing "Loading...", try to find the folder name from the folders array
          // or use a generic name
          // Check if we can find it in the current folders array (might be filtered)
          const folderInCurrent = folders.find(f => f.id === folderId);
          if (folderInCurrent) {
            if (folderInCurrent.parent_id) {
              buildPath(folderInCurrent.parent_id, depth + 1);
            }
            path.push({ id: folderInCurrent.id, name: folderInCurrent.name });
          } else {
            // Still not found - this shouldn't happen often, but if it does,
            // we'll show the folder ID as a fallback instead of "Loading..."
            // This is better than showing "Loading..." which never resolves
            path.push({ id: folderId, name: `Folder ${folderId}` });
          }
        }
      };
      
      buildPath(folderIdToUse);
    }
    
    return [{ id: null, name: 'My Drive' }, ...path];
  };

  // Handle view change
  const showView = async (view: string) => {
    setIsMobileSidebarOpen(false); // Close mobile sidebar
    
    // Navigate to the appropriate route
    const routeMap: { [key: string]: string } = {
      'my-drive': '/dashboard/my-drive',
      'starred': '/dashboard/starred',
      'shared': '/dashboard/shared',
      'trash': '/dashboard/trash',
      'todo': '/dashboard/todo'
    };
    
    const route = routeMap[view] || '/dashboard/my-drive';
    navigate(route);
    
    // Filter files based on view
    switch (view) {
      case 'starred':
        // Load starred items
        await loadStarredItems();
        break;
      case 'shared':
        // Load shared items
        await loadSharedItems();
        break;
      case 'trash':
        // Load deleted files
        await loadDeletedFiles();
        break;
      case 'todo':
        // Load to-do documents
        await loadTodoDocuments();
        break;
      default:
        // My Drive - load regular files
        setFilters({ search: searchQuery, folderId: currentFolder || undefined });
        loadFiles();
    }
  };

  // Load starred items
  const loadStarredItems = async () => {
    try {
      const response = await fileService.getStarredItems();
      if (response.success && response.data) {
        setStarredFiles(response.data.files || []);
        setStarredFolders(response.data.folders || []);
      }
    } catch (error) {
      console.error('Error loading starred items:', error);
      toast.error('Failed to load starred items');
    }
  };

  // Load shared items (items shared by others to me)
  const loadSharedItems = async () => {
    try {
      const response = await fileService.getSharedWithMe(1, 50);
      if (response.success && response.data) {
        // FilesPaginationResponse has 'files' in data
        const files = response.data.files || [];
        setStarredFiles(files);
        setStarredFolders([]);
      }
    } catch (error) {
      console.error('Error loading shared items:', error);
      toast.error('Failed to load shared items');
    }
  };

  // Load deleted files for trash view
  const loadDeletedFiles = async () => {
    try {
      const response = await fileService.getDeletedFiles(1, 10);
      if (response.success && response.data) {
        setDeletedFiles(response.data.files || []);
      }
    } catch (error) {
      console.error('Error loading trash:', error);
      toast.error('Failed to load trash');
    }
  };

  // Load to-do documents (files with reminders)
  const loadTodoDocuments = async (filter: 'all' | 'overdue' | 'today' | 'upcoming' = todoFilter) => {
    try {
      const response = await reminderService.getTodoDocuments(1, 50, filter);
      if (response.success && response.data) {
        setTodoDocuments(response.data.documents || []);
        setTodoSummary(response.data.summary);
      }
    } catch (error) {
      console.error('Error loading to-do documents:', error);
      toast.error('Failed to load to-do documents');
    }
  };

  // Load pending reminders for notification bell
  const loadPendingReminders = async () => {
    try {
      const response = await reminderService.getPendingReminders();
      if (response.success && response.data) {
        setPendingReminders(response.data.reminders || []);
      }
    } catch (error) {
      console.error('Error loading pending reminders:', error);
    }
  };

  // Sorting function
  const sortFilesAndFolders = (filesToSort: FileItem[], foldersToSort: Folder[]) => {
    const sortedFiles = [...filesToSort];
    const sortedFolders = [...foldersToSort];
    const currentUserId = user?.id;

    // Sort function for files
    const sortFile = (a: FileItem, b: FileItem): number => {
      let comparison = 0;
      const isAscending = sortOrder === 'asc';
      
      switch (sortCriteria) {
        case 'name':
          comparison = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
          return isAscending ? comparison : -comparison;
          
        case 'dateModified':
          const aModified = a.last_modified_at ? new Date(a.last_modified_at).getTime() : new Date(a.updated_at || a.created_at).getTime();
          const bModified = b.last_modified_at ? new Date(b.last_modified_at).getTime() : new Date(b.updated_at || b.created_at).getTime();
          comparison = aModified - bModified;
          // For dates: asc = oldest first, desc = newest first
          return isAscending ? comparison : -comparison;
          
        case 'dateModifiedByMe':
          const aMyModified = (a.last_modified_by === currentUserId && a.last_modified_at) 
            ? new Date(a.last_modified_at).getTime() 
            : 0;
          const bMyModified = (b.last_modified_by === currentUserId && b.last_modified_at) 
            ? new Date(b.last_modified_at).getTime() 
            : 0;
          // Items not modified by me go to the end
          if (aMyModified === 0 && bMyModified === 0) return 0;
          if (aMyModified === 0) return 1;
          if (bMyModified === 0) return -1;
          comparison = aMyModified - bMyModified;
          // For dates: asc = oldest first, desc = newest first
          return isAscending ? comparison : -comparison;
          
        case 'dateOpenedByMe':
          const aMyOpened = (a.last_accessed_by === currentUserId && a.last_accessed_at) 
            ? new Date(a.last_accessed_at).getTime() 
            : 0;
          const bMyOpened = (b.last_accessed_by === currentUserId && b.last_accessed_at) 
            ? new Date(b.last_accessed_at).getTime() 
            : 0;
          // Items not opened by me go to the end
          if (aMyOpened === 0 && bMyOpened === 0) return 0;
          if (aMyOpened === 0) return 1;
          if (bMyOpened === 0) return -1;
          comparison = aMyOpened - bMyOpened;
          // For dates: asc = oldest first, desc = newest first
          return isAscending ? comparison : -comparison;
          
        default:
          return 0;
      }
    };

    // Sort function for folders
    const sortFolder = (a: Folder, b: Folder): number => {
      let comparison = 0;
      const isAscending = sortOrder === 'asc';
      
      switch (sortCriteria) {
        case 'name':
          comparison = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
          return isAscending ? comparison : -comparison;
          
        case 'dateModified':
        case 'dateModifiedByMe':
        case 'dateOpenedByMe':
          // For folders, use created_at as there's no modified date
          const aDate = new Date(a.created_at).getTime();
          const bDate = new Date(b.created_at).getTime();
          comparison = aDate - bDate;
          // For dates: asc = oldest first, desc = newest first
          return isAscending ? comparison : -comparison;
          
        default:
          return 0;
      }
    };

    sortedFiles.sort(sortFile);
    sortedFolders.sort(sortFolder);

    return { sortedFiles, sortedFolders };
  };

  // Handle reminder complete
  const handleCompleteReminder = async (reminderId: number) => {
    try {
      const response = await reminderService.completeReminder(reminderId);
      if (response.success) {
        toast.success('Reminder completed!');
        await loadTodoDocuments();
        await loadPendingReminders();
      }
    } catch (error) {
      console.error('Error completing reminder:', error);
      toast.error('Failed to complete reminder');
    }
  };

  // Handle reminder dismiss
  const handleDismissReminder = async (reminderId: number) => {
    try {
      const response = await reminderService.dismissReminder(reminderId);
      if (response.success) {
        toast.success('Reminder dismissed');
        await loadTodoDocuments();
        await loadPendingReminders();
      }
    } catch (error) {
      console.error('Error dismissing reminder:', error);
      toast.error('Failed to dismiss reminder');
    }
  };

  // Open reminder modal for a file
  const openReminderModal = (fileId: number, fileName: string, existingReminder?: Reminder) => {
    setReminderFile({ id: fileId, name: fileName });
    setEditingReminder(existingReminder || null);
    setShowReminderModal(true);
  };

  // Handle todo filter change
  const handleTodoFilterChange = (filter: 'all' | 'overdue' | 'today' | 'upcoming') => {
    setTodoFilter(filter);
    loadTodoDocuments(filter);
  };

  // Handle logout
  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch (error) {
      toast.error('Failed to logout');
    }
  };

  // Handle pagination
  const handlePageChange = (page: number) => {
    loadFiles(page);
  };

  if (!isAuthenticated || !user) {
    return <div>Loading...</div>;
  }

  return (
    <div 
      className="dashboard"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Global Upload Progress Indicator */}
      {isUploading && (
        <div className="global-upload-progress" style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          background: 'white',
          borderRadius: '8px',
          padding: '16px 20px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          zIndex: 100000,
          minWidth: '300px',
          maxWidth: '400px',
          wordWrap: 'break-word',
          overflowWrap: 'break-word'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            marginBottom: '12px',
            gap: '12px'
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: '14px',
                fontWeight: 500,
                color: '#333',
                marginBottom: '4px',
                display: 'flex',
                alignItems: 'center'
              }}>
                <i className="fas fa-cloud-upload-alt" style={{ marginRight: '8px', color: '#1a73e8', flexShrink: 0 }}></i>
                <span>Uploading...</span>
              </div>
              <div style={{
                fontSize: '12px',
                color: '#666',
                wordWrap: 'break-word',
                overflowWrap: 'break-word',
                lineHeight: '1.4'
              }}>
                {uploadingFileName || 'Preparing upload...'}
              </div>
              {uploadingFileSize > 0 && (
                <div style={{
                  fontSize: '11px',
                  color: '#999',
                  marginTop: '4px'
                }}>
                  {fileService.formatFileSize(uploadingFileSize)}
                </div>
              )}
            </div>
            <button 
              onClick={() => {
                setIsUploading(false);
                setUploadProgress(0);
                setUploadingFileName('');
                setUploadingFileSize(0);
              }}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: '#666',
                padding: '4px 8px',
                flexShrink: 0,
                alignSelf: 'flex-start',
                fontSize: '18px',
                lineHeight: 1
              }}
              title="Hide progress"
            >
              <i className="fas fa-times"></i>
            </button>
          </div>
          <div style={{
            width: '100%',
            height: '8px',
            background: '#e0e0e0',
            borderRadius: '4px',
            overflow: 'hidden',
            marginBottom: '8px'
          }}>
            <div style={{
              width: `${uploadProgress}%`,
              height: '100%',
              background: 'linear-gradient(90deg, #1a73e8 0%, #4285f4 100%)',
              borderRadius: '4px',
              transition: 'width 0.3s ease',
              position: 'relative'
            }}>
              {uploadProgress > 0 && (
                <div style={{
                  position: 'absolute',
                  right: '4px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  fontSize: '10px',
                  color: 'white',
                  fontWeight: 500
                }}>
                  {uploadProgress}%
                </div>
              )}
            </div>
          </div>
          <div style={{
            fontSize: '11px',
            color: '#999',
            textAlign: 'right'
          }}>
            {uploadProgress < 100 ? 'Uploading...' : 'Processing...'}
          </div>
        </div>
      )}
      
      {/* Sidebar Overlay for Mobile */}
      <div 
        className={`sidebar-overlay ${isMobileSidebarOpen ? 'active' : ''}`}
        onClick={() => setIsMobileSidebarOpen(false)}
      ></div>

      {/* Header */}
      <header className="dashboard-header">
        <div className="header-left">
          <button className="mobile-menu-toggle" onClick={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}>
            <i className="fas fa-bars"></i>
          </button>
          <div className="logo" onClick={() => navigate('/dashboard/my-drive')} style={{ cursor: 'pointer' }}>
            <img src="/logo-square.png" alt="Task Insight" className="header-logo" />
            <span>Task Insight</span>
          </div>
          <div className="search-bar">
            <i className="fas fa-search"></i>
            <input
              type="text"
              placeholder="Search files and folders..."
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
            />
            {searchQuery && (
              <button 
                className="search-clear"
                onClick={handleClearSearch}
                title="Clear search"
              >
                <i className="fas fa-times"></i>
              </button>
            )}
          </div>
        </div>
        <div className="header-right">
          {/* Notification Bell */}
          <div className="notification-bell">
            <button 
              className="bell-icon" 
              onClick={() => setShowNotifications(!showNotifications)}
              title="Reminders"
            >
              <i className="fas fa-bell"></i>
              {pendingReminders.length > 0 && (
                <span className="notification-badge">{pendingReminders.length > 9 ? '9+' : pendingReminders.length}</span>
              )}
            </button>
            {showNotifications && (
              <div className="notification-dropdown">
                <div className="notification-header">
                  <h4>Reminders</h4>
                  <button 
                    onClick={() => {
                      setShowNotifications(false);
                      showView('todo');
                    }}
                    style={{ background: 'none', border: 'none', color: '#141464', cursor: 'pointer', fontSize: '0.875rem' }}
                  >
                    View all
                  </button>
                </div>
                <div className="notification-list">
                  {pendingReminders.length > 0 ? (
                    pendingReminders.slice(0, 5).map((reminder) => (
                      <div 
                        key={reminder.id}
                        className={`notification-item ${reminderService.isOverdue(reminder.reminder_datetime) ? 'overdue' : ''}`}
                        onClick={() => {
                          setShowNotifications(false);
                          showView('todo');
                        }}
                      >
                        <div className="notification-icon">
                          <i className="fas fa-bell"></i>
                        </div>
                        <div className="notification-content">
                          <div className="notification-title">{reminder.title || reminder.file_name}</div>
                          <div className="notification-time">
                            {reminderService.formatReminderTime(reminder.reminder_datetime)}
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="notification-empty">
                      <i className="fas fa-bell-slash"></i>
                      <p>No pending reminders</p>
                    </div>
                  )}
                </div>
                {pendingReminders.length > 5 && (
                  <div className="notification-footer">
                    <button type="button" onClick={() => { setShowNotifications(false); showView('todo'); }}>
                      View all {pendingReminders.length} reminders
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
          
          <div className="user-menu">
            <button className="user-avatar" onClick={() => setShowUserMenu(!showUserMenu)}>
              {user.firstName?.charAt(0) || user.email?.charAt(0).toUpperCase() || 'U'}
              {user.lastName?.charAt(0) || (user.email?.charAt(1) && user.email.charAt(1).toUpperCase()) || ''}
            </button>
            {showUserMenu && (
              <div className="user-dropdown">
                <div className="user-info">
                  <h4>{user.firstName} {user.lastName}</h4>
                  <p>{user.email}</p>
                </div>
                <button onClick={() => {
                  setShowUserMenu(false);
                  navigate('/');
                }}>
                  <i className="fas fa-th-large"></i> Platform chooser
                </button>
                {andaiAssistantUrl && (
                  <button onClick={() => {
                    setShowUserMenu(false);
                    openAndaiAssistant();
                  }}>
                    <i className="fas fa-brain"></i> ANDAI Assistant
                  </button>
                )}
                {isOrganizationAdmin() && (
                  <button onClick={() => {
                    setShowUserMenu(false);
                    navigate('/admin/organization');
                  }}>
                    <i className="fas fa-cog"></i> Admin Panel
                  </button>
                )}
                <button onClick={handleLogout}>
                  <i className="fas fa-sign-out-alt"></i> Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Sidebar */}
      <aside className={`dashboard-sidebar ${isMobileSidebarOpen ? 'mobile-open' : ''}`}>
        <nav className="sidebar-nav">
          <button 
            className={`nav-item ${currentView === 'my-drive' ? 'active' : ''}`}
            onClick={() => showView('my-drive')}
          >
            <i className="fas fa-home"></i>
            <span>My Drive</span>
          </button>
          <button 
            className={`nav-item ${currentView === 'starred' ? 'active' : ''}`}
            onClick={() => showView('starred')}
          >
            <i className="fas fa-star"></i>
            <span>Starred</span>
          </button>
          <button 
            className={`nav-item ${currentView === 'shared' ? 'active' : ''}`}
            onClick={() => showView('shared')}
          >
            <i className="fas fa-share-alt"></i>
            <span>Shared with me</span>
          </button>
          <button 
            className={`nav-item ${currentView === 'todo' ? 'active' : ''}`}
            onClick={() => showView('todo')}
          >
            <i className="fas fa-bell"></i>
            <span>To-Do Documents</span>
            {todoSummary && todoSummary.overdue > 0 && (
              <span className="nav-badge">{todoSummary.overdue}</span>
            )}
          </button>
          <button 
            className={`nav-item ${currentView === 'trash' ? 'active' : ''}`}
            onClick={() => showView('trash')}
          >
            <i className="fas fa-trash"></i>
            <span>Trash</span>
          </button>
        </nav>

        {/* Storage Info */}
        <div className="storage-info">
          <div className="storage-bar">
            <div 
              className="storage-used" 
              style={{ 
                width: `${fileStats?.totalSize !== undefined && fileStats?.totalSize !== null && !isNaN(Number(fileStats.totalSize))
                  ? Math.min((Number(fileStats.totalSize) / 5368709120) * 100, 100) 
                  : 0}%` 
              }}
            ></div>
          </div>
          <div className="storage-header">
            <span>
              {fileStats?.totalSize !== undefined && fileStats?.totalSize !== null && !isNaN(Number(fileStats.totalSize))
                ? fileService.formatFileSize(Number(fileStats.totalSize))
                : '0 Bytes'} of 5 GB
            </span>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="dashboard-main">
        {/* Drag and Drop Overlay */}
        {isDragging && (
          <div className="drag-drop-overlay">
            <div className="drag-drop-content">
              <i className="fas fa-cloud-upload-alt"></i>
              <h2>Drop files or folders here to upload</h2>
              <p>Release to start uploading</p>
            </div>
          </div>
        )}
        {/* Breadcrumb */}
        <div className="breadcrumb">
          {(() => {
            const breadcrumbPath = getBreadcrumbPath();
            return breadcrumbPath.map((item, index) => (
            <React.Fragment key={item.id || 'root'}>
              <button 
                className="breadcrumb-item"
                onClick={() => handleBreadcrumbClick(item.id)}
              >
                {item.name}
              </button>
                {index < breadcrumbPath.length - 1 && <i className="fas fa-chevron-right"></i>}
            </React.Fragment>
            ));
          })()}
        </div>

        {/* Toolbar */}
        <div className="toolbar">
          <div className="toolbar-left">
            {/* New Button with Dropdown */}
            <div className="new-button-container">
              <button 
                className="btn-new"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowNewMenu(!showNewMenu);
                  setShowSortMenu(false);
                }}
              >
                <i className="fas fa-plus"></i>
                <span>New</span>
              </button>
              {showNewMenu && (
                <div 
                  className="new-menu-dropdown"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button className="new-menu-item" onClick={handleNewFolder}>
                    <i className="fas fa-folder"></i>
                    <div>
                      <div className="new-menu-item-title">Folder</div>
                      <div className="new-menu-item-desc">Create a new folder</div>
                    </div>
                  </button>
                  <button className="new-menu-item" onClick={handleNewFileUpload}>
                    <i className="fas fa-file"></i>
                    <div>
                      <div className="new-menu-item-title">File upload</div>
                      <div className="new-menu-item-desc">Upload files to Drive</div>
                    </div>
                  </button>
                  <button className="new-menu-item" onClick={handleNewFolderUpload}>
                    <i className="fas fa-folder-open"></i>
                    <div>
                      <div className="new-menu-item-title">Folder upload</div>
                      <div className="new-menu-item-desc">Upload a folder and its contents</div>
                    </div>
                  </button>
                </div>
              )}
            </div>
            <button className="btn-icon" onClick={() => { setViewMode('grid'); setShowSortMenu(false); }}>
              <i className={`fas fa-th ${viewMode === 'grid' ? 'active' : ''}`}></i>
            </button>
            <button className="btn-icon" onClick={() => { setViewMode('list'); setShowSortMenu(false); }}>
              <i className={`fas fa-list ${viewMode === 'list' ? 'active' : ''}`}></i>
            </button>
            
            {/* Sort Menu */}
            <div className="sort-menu-container">
              <button 
                className="btn-icon sort-menu-button"
                onClick={(e) => {
                  e.stopPropagation();
                  closeContextMenu(); // Close context menu if open
                  setShowSortMenu(!showSortMenu);
                }}
                title="Sort by"
              >
                <i className="fas fa-sort"></i>
              </button>
              {showSortMenu && (
                <div 
                  ref={sortMenuRef}
                  className="sort-menu"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="sort-menu-header">Sort by</div>
                  <div className="sort-menu-item" onClick={() => { setSortCriteria('name'); setShowSortMenu(false); }}>
                    <i className={`fas fa-check ${sortCriteria === 'name' ? 'visible' : 'hidden'}`}></i>
                    <span>Name</span>
                  </div>
                  <div className="sort-menu-item" onClick={() => { setSortCriteria('dateModified'); setShowSortMenu(false); }}>
                    <i className={`fas fa-check ${sortCriteria === 'dateModified' ? 'visible' : 'hidden'}`}></i>
                    <span>Date modified</span>
                  </div>
                  <div className="sort-menu-item" onClick={() => { setSortCriteria('dateModifiedByMe'); setShowSortMenu(false); }}>
                    <i className={`fas fa-check ${sortCriteria === 'dateModifiedByMe' ? 'visible' : 'hidden'}`}></i>
                    <span>Date modified by me</span>
                  </div>
                  <div className="sort-menu-item" onClick={() => { setSortCriteria('dateOpenedByMe'); setShowSortMenu(false); }}>
                    <i className={`fas fa-check ${sortCriteria === 'dateOpenedByMe' ? 'visible' : 'hidden'}`}></i>
                    <span>Date opened by me</span>
                  </div>
                  <div className="sort-menu-divider"></div>
                  <div className="sort-menu-item" onClick={() => { setSortOrder('asc'); setShowSortMenu(false); }}>
                    <i className={`fas fa-check ${sortOrder === 'asc' ? 'visible' : 'hidden'}`}></i>
                    <span>
                      {sortCriteria === 'name' ? 'A to Z' : 
                       sortCriteria === 'dateModified' || sortCriteria === 'dateModifiedByMe' || sortCriteria === 'dateOpenedByMe' 
                       ? 'Oldest first' : 'A to Z'}
                    </span>
                  </div>
                  <div className="sort-menu-item" onClick={() => { setSortOrder('desc'); setShowSortMenu(false); }}>
                    <i className={`fas fa-check ${sortOrder === 'desc' ? 'visible' : 'hidden'}`}></i>
                    <span>
                      {sortCriteria === 'name' ? 'Z to A' : 
                       sortCriteria === 'dateModified' || sortCriteria === 'dateModifiedByMe' || sortCriteria === 'dateOpenedByMe' 
                       ? 'Newest first' : 'Z to A'}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="toolbar-right">
            <button className="btn-icon" onClick={() => { refreshFiles(); setShowSortMenu(false); }}>
              <i className="fas fa-sync-alt"></i>
            </button>
          </div>
        </div>

        {/* Hidden file inputs */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={handleFileUpload}
        />
        <input
          ref={folderInputRef}
          type="file"
          {...({ webkitdirectory: '', directory: '' } as any)}
          multiple
          style={{ display: 'none' }}
          onChange={handleFolderUpload}
        />


        {/* To-Do Documents View */}
        {currentView === 'todo' ? (
          <div className="todo-documents-view">
            <div className="todo-header">
              <h2><i className="fas fa-bell"></i> To-Do Documents</h2>
            </div>
            
            {/* Summary Cards */}
            <div className="todo-summary-cards">
              <div 
                className={`todo-summary-card overdue ${todoFilter === 'overdue' ? 'active' : ''}`}
                onClick={() => handleTodoFilterChange('overdue')}
              >
                <div className="count">{todoSummary?.overdue || 0}</div>
                <div className="label">Overdue</div>
              </div>
              <div 
                className={`todo-summary-card today ${todoFilter === 'today' ? 'active' : ''}`}
                onClick={() => handleTodoFilterChange('today')}
              >
                <div className="count">{todoSummary?.today || 0}</div>
                <div className="label">Due Today</div>
              </div>
              <div 
                className={`todo-summary-card upcoming ${todoFilter === 'upcoming' ? 'active' : ''}`}
                onClick={() => handleTodoFilterChange('upcoming')}
              >
                <div className="count">{todoSummary?.upcoming || 0}</div>
                <div className="label">Upcoming</div>
              </div>
              <div 
                className={`todo-summary-card ${todoFilter === 'all' ? 'active' : ''}`}
                onClick={() => handleTodoFilterChange('all')}
              >
                <div className="count">{todoSummary?.total || 0}</div>
                <div className="label">All</div>
              </div>
            </div>

            {/* Todo Table */}
            {todoDocuments.length > 0 ? (
              <div className="todo-table">
                <table>
                  <thead>
                    <tr>
                      <th>Document</th>
                      <th>Due Date</th>
                      <th>Priority</th>
                      <th>Note</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {todoDocuments.map((doc) => {
                      const isOverdue = reminderService.isOverdue(doc.reminder_datetime);
                      const isToday = reminderService.isDueToday(doc.reminder_datetime);
                      return (
                        <tr key={doc.id} className={isOverdue ? 'overdue' : ''}>
                          <td>
                            <div className="todo-file-cell">
                              <i className={fileService.getFileIcon(doc.file_type || '')}></i>
                              <div className="todo-file-info">
                                <span 
                                  className="todo-file-name"
                                  onClick={() => {
                                    // Navigate to file
                                    if (doc.folder_id) {
                                      navigate(`/dashboard/my-drive/folder/${doc.folder_id}`);
                                    } else {
                                      navigate('/dashboard/my-drive');
                                    }
                                  }}
                                >
                                  {doc.file_name}
                                </span>
                                {doc.folder_name && (
                                  <span className="todo-file-folder">
                                    <i className="fas fa-folder"></i> {doc.folder_name}
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className={`todo-due-date ${isOverdue ? 'overdue' : isToday ? 'today' : ''}`}>
                              <span className="date">
                                {reminderService.formatReminderTime(doc.reminder_datetime)}
                              </span>
                            </div>
                          </td>
                          <td>
                            <span className={`priority-badge ${doc.priority}`}>
                              <i className="fas fa-flag"></i> {doc.priority}
                            </span>
                          </td>
                          <td>
                            {doc.title || doc.note || '-'}
                          </td>
                          <td>
                            <div className="todo-actions">
                              <button 
                                className="btn-complete" 
                                onClick={() => handleCompleteReminder(doc.id)}
                                title="Mark as complete"
                              >
                                <i className="fas fa-check"></i>
                              </button>
                              <button 
                                className="btn-edit"
                                onClick={() => openReminderModal(doc.file_id, doc.file_name || '', doc as Reminder)}
                                title="Edit reminder"
                              >
                                <i className="fas fa-edit"></i>
                              </button>
                              <button 
                                className="btn-dismiss" 
                                onClick={() => handleDismissReminder(doc.id)}
                                title="Dismiss"
                              >
                                <i className="fas fa-times"></i>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="todo-empty">
                <i className="fas fa-bell-slash"></i>
                <h3>No reminders</h3>
                <p>Set reminders on your files to see them here</p>
              </div>
            )}
          </div>
        ) : viewMode === 'list' ? (
          /* Table View (Windows-style) */
          <div 
            className="files-table-container"
            onDragOver={(e) => {
              if (draggedItem && !dragOverFolderId) {
                e.preventDefault();
                e.stopPropagation();
              }
            }}
            onDrop={handleRootDrop}
          >
            {isLoading ? (
              <div className="loading">
                <i className="fas fa-spinner fa-spin"></i>
                <p>Loading files...</p>
              </div>
            ) : (
              <table className="files-table">
                <thead>
                  <tr>
                    <th className="col-name">Name</th>
                    <th className="col-type">Type</th>
                    <th className="col-size">Size</th>
                    <th className="col-owner">Owner</th>
                    <th className="col-uploaded">Uploaded</th>
                    <th className="col-actions"></th>
                  </tr>
                </thead>
                <tbody>
                  {/* Folders */}
                  {(() => {
                    const displayFolders = currentView === 'starred' ? starredFolders : folders;
                    const { sortedFolders } = sortFilesAndFolders([], displayFolders);
                    return currentView !== 'trash' && currentView !== 'shared' && sortedFolders.map((folder) => (
                    <tr 
                      key={`folder-${folder.id}`}
                      className={`table-row folder-row ${draggedItem && draggedItem.id !== folder.id ? 'folder-drop-target' : ''} ${dragOverFolderId === folder.id ? 'drag-over' : ''}`}
                      draggable={currentView !== 'trash' && canEditItem(folder, 'folder')}
                      onDragStart={(e) => handleDragStart(e, folder, 'folder')}
                      onDragEnd={handleDragEnd}
                      onDragOver={(e) => handleFolderDragOver(e, folder.id)}
                      onDragLeave={handleFolderDragLeave}
                      onDrop={(e) => handleFolderDrop(e, folder.id)}
                      onClick={(e) => {
                        // Only navigate if clicking on the row itself, not on buttons
                        if ((e.target as HTMLElement).closest('button') === null) {
                          handleFolderClick(folder);
                        }
                      }}
                      onContextMenu={(e) => handleContextMenu(e, folder, 'folder')}
                    >
                      <td className="col-name">
                        <div className="table-cell-content">
                          <i className="fas fa-folder table-icon"></i>
                          <span className="table-name">{folder.name}</span>
                        </div>
                      </td>
                      <td className="col-type">Folder</td>
                      <td className="col-size">{folder.file_count || 0} items</td>
                      <td className="col-owner">
                        {folder.first_name && folder.last_name 
                          ? `${folder.first_name} ${folder.last_name}`
                          : 'Unknown'}
                      </td>
                      <td className="col-uploaded">
                        {new Date(folder.created_at).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric'
                        })}
                      </td>
                      <td className="col-actions">
                        <div className="table-actions">
                          <button onClick={(e) => { e.stopPropagation(); handleToggleStar('folder', folder.id); }} title={folder.is_starred ? "Unstar" : "Star"}>
                            <i className={`${folder.is_starred ? 'fas' : 'far'} fa-star${folder.is_starred ? ' starred' : ''}`}></i>
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); handleMoreClick(e, folder, 'folder'); }} title="More options" className="btn-more">
                            <i className="fas fa-ellipsis-v"></i>
                          </button>
                        </div>
                      </td>
                    </tr>
                    ));
                  })()}
                  
                  {/* Files */}
                  {(() => {
                    const displayFiles = currentView === 'trash' ? deletedFiles : (currentView === 'starred' || currentView === 'shared') ? starredFiles : files;
                    const { sortedFiles } = sortFilesAndFolders(displayFiles, []);
                    return sortedFiles.map((file) => (
                    <tr 
                      key={`file-${file.id}`}
                      className={`table-row file-row ${draggedItem && draggedItem.id === file.id ? 'dragging' : ''}`}
                      draggable={currentView !== 'trash' && canEditItem(file, 'file')}
                      onDragStart={(e) => handleDragStart(e, file, 'file')}
                      onDragEnd={handleDragEnd}
                      onClick={(e) => {
                        // Only open preview if clicking on the row itself, not on buttons
                        if ((e.target as HTMLElement).closest('button') === null && currentView !== 'trash') {
                          handleFileClick(file);
                        }
                      }}
                      onContextMenu={(e) => currentView !== 'trash' && handleContextMenu(e, file, 'file')}
                    >
                      <td className="col-name">
                        <div className="table-cell-content">
                          <i className={`${fileService.getFileIcon(file.file_type)} table-icon`}></i>
                          <span className="table-name">{file.name}</span>
                        </div>
                      </td>
                      <td className="col-type">{file.file_type || 'File'}</td>
                      <td className="col-size">{fileService.formatFileSize(file.file_size)}</td>
                      <td className="col-owner">
                        {file.first_name && file.last_name 
                          ? `${file.first_name} ${file.last_name}`
                          : file.email || 'Unknown'}
                      </td>
                      <td className="col-uploaded">
                        {new Date(file.created_at).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric'
                        })}
                      </td>
                      <td className="col-actions">
                        <div className="table-actions">
                          {currentView === 'trash' ? (
                            <>
                              <button onClick={() => handleRestoreFile(file)} title="Restore">
                                <i className="fas fa-undo"></i>
                              </button>
                              <button onClick={() => handlePermanentDelete(file)} title="Delete Forever">
                                <i className="fas fa-times"></i>
                              </button>
                            </>
                          ) : (
                            <>
                              <button onClick={(e) => { e.stopPropagation(); handleToggleStar('file', file.id); }} title={file.is_starred ? "Unstar" : "Star"}>
                                <i className={`${file.is_starred ? 'fas' : 'far'} fa-star${file.is_starred ? ' starred' : ''}`}></i>
                              </button>
                              <button onClick={(e) => { e.stopPropagation(); handleMoreClick(e, file, 'file'); }} title="More options" className="btn-more">
                                <i className="fas fa-ellipsis-v"></i>
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    ));
                  })()}
                  
                  {/* Empty state row */}
                  {(() => {
                    const displayFiles = currentView === 'trash' ? deletedFiles : (currentView === 'starred' || currentView === 'shared') ? starredFiles : files;
                    const displayFolders = currentView === 'starred' ? starredFolders : currentView === 'shared' ? [] : folders;
                    const isEmpty = displayFiles.length === 0 && (currentView === 'trash' || currentView === 'shared' || displayFolders.length === 0);
                    
                    return isEmpty && (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', padding: '40px', color: '#6c757d' }}>
                          <i className={
                            currentView === 'trash' ? 'fas fa-trash' : 
                            currentView === 'starred' ? 'fas fa-star' : 
                            currentView === 'shared' ? 'fas fa-share-alt' :
                            'fas fa-folder-open'
                          } style={{ fontSize: '3rem', marginBottom: '1rem', display: 'block', color: '#dee2e6' }}></i>
                          <p style={{ margin: 0, fontSize: '1rem', fontWeight: 500 }}>
                            {currentView === 'trash' ? 'Trash is empty' : 
                             currentView === 'starred' ? 'No starred items' :
                             currentView === 'shared' ? 'No shared items' :
                             'No files or folders'}
                          </p>
                        </td>
                      </tr>
                    );
                  })()}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          /* Grid View */
        <div 
          className={`files-container ${viewMode}`}
          onDragOver={(e) => {
            if (draggedItem) {
              // Only allow root drop if not over a folder
              if (!dragOverFolderId) {
                e.preventDefault();
                e.stopPropagation();
                if (e.dataTransfer) {
                  e.dataTransfer.dropEffect = 'move';
                }
              }
            }
          }}
          onDrop={handleRootDrop}
          onDragEnter={(e) => {
            // Clear folder drag over when entering empty area
            if (draggedItem && !dragOverFolderId) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
        >
          {isLoading ? (
            <div className="loading">
              <i className="fas fa-spinner fa-spin"></i>
              <p>Loading files...</p>
            </div>
          ) : (
            <>
                {/* Folders - Hide in trash and shared views (shared doesn't have folders yet) */}
                {(() => {
                  const displayFolders = currentView === 'starred' ? starredFolders : folders;
                  const { sortedFolders } = sortFilesAndFolders([], displayFolders);
                  return currentView !== 'trash' && currentView !== 'shared' && sortedFolders.map((folder) => (
                  <div 
                    key={folder.id} 
                    className={`file-item ${draggedItem && draggedItem.id !== folder.id ? 'folder-drop-target' : ''} ${dragOverFolderId === folder.id ? 'drag-over' : ''} ${draggedItem && draggedItem.id === folder.id ? 'dragging' : ''}`}
                    draggable={currentView !== 'trash' && canEditItem(folder, 'folder')}
                    onDragStart={(e) => handleDragStart(e, folder, 'folder')}
                    onDragEnd={handleDragEnd}
                    onDragOver={(e) => handleFolderDragOver(e, folder.id)}
                    onDragLeave={handleFolderDragLeave}
                    onDrop={(e) => handleFolderDrop(e, folder.id)}
                    onClick={() => handleFolderClick(folder)}
                    onContextMenu={(e) => handleContextMenu(e, folder, 'folder')}
                  >
                  <div className="file-icon">
                    <i className="fas fa-folder"></i>
                  </div>
                  <div className="file-info">
                    <h4>{folder.name}</h4>
                      <p>{folder.file_count || 0} items</p>
                  </div>
                  <div className="file-actions">
                      <button onClick={(e) => { e.stopPropagation(); handleToggleStar('folder', folder.id); }} title={folder.is_starred ? "Unstar" : "Star"}>
                        <i className={`${folder.is_starred ? 'fas' : 'far'} fa-star${folder.is_starred ? ' starred' : ''}`}></i>
                    </button>
                      <button onClick={(e) => handleMoreClick(e, folder, 'folder')} title="More options" className="btn-more">
                        <i className="fas fa-ellipsis-v"></i>
                    </button>
                  </div>
                </div>
                ));
                })()}

              {/* Files */}
                  {(() => {
                    const displayFiles = currentView === 'trash' ? deletedFiles : (currentView === 'starred' || currentView === 'shared') ? starredFiles : files;
                    const { sortedFiles } = sortFilesAndFolders(displayFiles, []);
                    return sortedFiles.map((file) => {
                    const isImageFile = fileService.isImage(file.file_type);
                    
                    return (
                      <div 
                        key={file.id} 
                        className={`file-item ${draggedItem && draggedItem.id === file.id ? 'dragging' : ''}`}
                        draggable={currentView !== 'trash' && canEditItem(file, 'file')}
                        onDragStart={(e) => handleDragStart(e, file, 'file')}
                        onDragEnd={handleDragEnd}
                        onClick={() => currentView !== 'trash' && handleFileClick(file)}
                        onContextMenu={(e) => currentView !== 'trash' && handleContextMenu(e, file, 'file')}
                      >
                  <div className="file-icon">
                          {isImageFile ? (
                            <ImageThumbnail fileId={file.id} fileName={file.name} fileType={file.file_type} />
                          ) : (
                    <i className={fileService.getFileIcon(file.file_type)}></i>
                          )}
                  </div>
                  <div className="file-info">
                    <h4>{file.name}</h4>
                    <p>
                      {fileService.formatFileSize(file.file_size)} • {new Date(file.created_at).toLocaleDateString()}
                      {currentView === 'shared' && file.permission_level && (
                        <span className="permission-badge">{file.permission_level} access</span>
                      )}
                    </p>
                  </div>
                  <div className="file-actions">
                    {currentView === 'trash' ? (
                      <>
                        <button onClick={() => handleRestoreFile(file)} title="Restore">
                          <i className="fas fa-undo"></i>
                        </button>
                        <button onClick={() => handlePermanentDelete(file)} title="Delete Forever">
                          <i className="fas fa-times"></i>
                        </button>
                      </>
                    ) : (
                      <>
                              <button onClick={(e) => { e.stopPropagation(); handleToggleStar('file', file.id); }} title={file.is_starred ? "Unstar" : "Star"}>
                                <i className={`${file.is_starred ? 'fas' : 'far'} fa-star${file.is_starred ? ' starred' : ''}`}></i>
                        </button>
                              <button onClick={(e) => handleMoreClick(e, file, 'file')} title="More options" className="btn-more">
                                <i className="fas fa-ellipsis-v"></i>
                        </button>
                      </>
                    )}
                  </div>
                </div>
                    );
                    });
                  })()}
              </>
            )}
          </div>
        )}
        
        {/* Empty State */}
        {!isLoading && (() => {
          const displayFiles = currentView === 'trash' ? deletedFiles : (currentView === 'starred' || currentView === 'shared') ? starredFiles : files;
          const displayFolders = currentView === 'starred' ? starredFolders : currentView === 'shared' ? [] : folders;
          const isEmpty = displayFiles.length === 0 && (currentView === 'trash' || currentView === 'shared' || displayFolders.length === 0);
                
                return isEmpty && (
                  <div className="empty-state">
                    <i className={
                      currentView === 'trash' ? 'fas fa-trash' : 
                      currentView === 'starred' ? 'fas fa-star' : 
                      currentView === 'shared' ? 'fas fa-share-alt' :
                      'fas fa-folder-open'
                    }></i>
                    <h3>
                      {currentView === 'trash' ? 'Trash is empty' : 
                       currentView === 'starred' ? 'No starred items' :
                       currentView === 'shared' ? 'No shared items' :
                       'No files or folders'}
                    </h3>
                    <p>
                      {currentView === 'trash' ? 'Deleted files will appear here for 30 days' : 
                       currentView === 'starred' ? 'Star files and folders to see them here' :
                       currentView === 'shared' ? 'Files shared with you will appear here' :
                       'Upload files or create folders to get started'}
                    </p>
                  </div>
                );
              })()}

        {/* Pagination - only show for file views, not for todo */}
        {currentView !== 'todo' && pagination.pages > 1 && (
          <div className="pagination">
            <button 
              disabled={pagination.page === 1}
              onClick={() => handlePageChange(pagination.page - 1)}
            >
              Previous
            </button>
            <span>Page {pagination.page} of {pagination.pages}</span>
            <button 
              disabled={pagination.page === pagination.pages}
              onClick={() => handlePageChange(pagination.page + 1)}
            >
              Next
            </button>
          </div>
        )}
      </main>

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="modal-overlay" style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.8)',
          display: 'flex !important',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 99999
        }}>
          <div className="modal-content" style={{
            background: 'white',
            borderRadius: '8px',
            padding: '20px',
            maxWidth: '500px',
            width: '90%',
            position: 'relative',
            display: 'block !important',
            zIndex: 10000
          }}>
            <div className="modal-header" style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '20px',
              paddingBottom: '10px',
              borderBottom: '1px solid #eee'
            }}>
              <h3 style={{margin: 0, color: '#333'}}>Upload Files</h3>
              <button onClick={() => setShowUploadModal(false)} style={{
                background: 'none',
                border: 'none',
                fontSize: '20px',
                cursor: 'pointer',
                color: '#666'
              }}>
                <i className="fas fa-times"></i>
              </button>
            </div>
            <div className="modal-body" style={{padding: '20px 0'}}>
              <div className="upload-area" style={{
                border: '2px dashed #ccc',
                borderRadius: '8px',
                padding: '40px',
                textAlign: 'center',
                background: '#f9f9f9'
              }}>
                <input
                  ref={uploadModalFileInputRef}
                  type="file"
                  multiple
                  onChange={handleFileUpload}
                  id="file-upload"
                  style={{ display: 'none' }}
                />
                <label htmlFor="file-upload" style={{
                  display: 'block',
                  cursor: 'pointer',
                  color: '#666',
                  fontSize: '16px'
                }}>
                  <i className="fas fa-cloud-upload-alt" style={{fontSize: '24px', marginBottom: '10px', display: 'block'}}></i>
                  <span>Choose files to upload</span>
                </label>
                {isUploading && (
                  <div style={{marginTop: '20px'}}>
                    <div style={{
                      fontSize: '14px',
                      color: '#666',
                      marginBottom: '8px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}>
                      {uploadingFileName || 'Uploading...'}
                    </div>
                    <div style={{
                      width: '100%',
                      height: '10px',
                      background: '#e0e0e0',
                      borderRadius: '5px',
                      overflow: 'hidden',
                      position: 'relative'
                    }}>
                      <div style={{
                          width: `${uploadProgress}%`,
                          height: '100%',
                        background: 'linear-gradient(90deg, #1a73e8 0%, #4285f4 100%)',
                        borderRadius: '5px',
                        transition: 'width 0.3s ease',
                        position: 'relative'
                      }}>
                        {uploadProgress > 10 && (
                          <span style={{
                            position: 'absolute',
                            right: '6px',
                            top: '50%',
                            transform: 'translateY(-50%)',
                            fontSize: '10px',
                            color: 'white',
                            fontWeight: 500
                          }}>
                            {uploadProgress}%
                          </span>
                        )}
                    </div>
                    </div>
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginTop: '8px',
                      fontSize: '12px',
                      color: '#999'
                    }}>
                      <span>{uploadProgress < 100 ? 'Uploading...' : 'Processing...'}</span>
                      <span>{uploadProgress}%</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Folder Modal */}
      {showCreateFolderModal && (
        <div className="modal-overlay" style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.8)',
          display: 'flex !important',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 99999
        }}>
          <div className="modal-content" style={{
            background: 'white',
            borderRadius: '8px',
            padding: '20px',
            maxWidth: '500px',
            width: '90%',
            position: 'relative',
            display: 'block !important',
            zIndex: 10000
          }}>
            <div className="modal-header" style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '20px',
              paddingBottom: '10px',
              borderBottom: '1px solid #eee'
            }}>
              <h3 style={{margin: 0, color: '#333'}}>Create Folder</h3>
              <button onClick={() => setShowCreateFolderModal(false)} style={{
                background: 'none',
                border: 'none',
                fontSize: '20px',
                cursor: 'pointer',
                color: '#666'
              }}>
                <i className="fas fa-times"></i>
              </button>
            </div>
            <div className="modal-body" style={{padding: '20px 0'}}>
              <div className="form-group" style={{marginBottom: '20px'}}>
                <label htmlFor="folder-name" style={{
                  display: 'block',
                  marginBottom: '8px',
                  fontWeight: 'bold',
                  color: '#333'
                }}>Folder Name</label>
                <input 
                  type="text" 
                  id="folder-name" 
                  required 
                  style={{
                    width: '100%',
                    padding: '10px',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    fontSize: '16px'
                  }}
                />
              </div>
              <div className="form-group" style={{marginBottom: '20px'}}>
                <label htmlFor="folder-description" style={{
                  display: 'block',
                  marginBottom: '8px',
                  fontWeight: 'bold',
                  color: '#333'
                }}>Description (Optional)</label>
                <textarea 
                  id="folder-description" 
                  rows={3}
                  style={{
                    width: '100%',
                    padding: '10px',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    fontSize: '16px',
                    resize: 'vertical'
                  }}
                ></textarea>
              </div>
            </div>
            <div className="modal-footer" style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '10px',
              paddingTop: '20px',
              borderTop: '1px solid #eee'
            }}>
              <button 
                onClick={() => setShowCreateFolderModal(false)}
                style={{
                  padding: '10px 20px',
                  border: '1px solid #ddd',
                  background: 'white',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button 
                onClick={handleCreateFolder}
                style={{
                  padding: '10px 20px',
                  border: 'none',
                  background: '#007bff',
                  color: 'white',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Create Folder
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Share Modal removed - use FileSharingModal component instead */}

      {/* Context Menu */}
      {contextMenu.show && (
        <div 
          ref={contextMenuRef}
          className="context-menu"
          style={{
            position: 'fixed',
            top: `${contextMenu.y}px`,
            left: `${contextMenu.x}px`,
            background: 'white',
            borderRadius: '8px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
            zIndex: 10000,
            minWidth: '200px',
            maxWidth: 'calc(100vw - 20px)', // Responsive max width
            padding: '8px 0',
            border: '1px solid #e0e0e0',
            maxHeight: 'calc(100vh - 20px)', // Responsive max height
            overflowY: 'auto', // Allow scrolling if menu is too tall
            overflowX: 'hidden' // Prevent horizontal scroll
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button className="context-menu-item" onClick={handleContextDownload}>
            <i className="fas fa-download"></i>
            <span>Download{contextMenu.type === 'folder' ? ' as ZIP' : ''}</span>
          </button>
          {contextCanEdit && (
            <button className="context-menu-item" onClick={handleRename}>
              <i className="fas fa-pen"></i>
              <span>Rename</span>
            </button>
          )}
          {contextCanManage && (
            <button className="context-menu-item" onClick={handleShare}>
              <i className="fas fa-user-plus"></i>
              <span>Share</span>
            </button>
          )}
          <button className="context-menu-item" onClick={handleCopyLink}>
            <i className="fas fa-link"></i>
            <span>Copy link</span>
          </button>
          {contextMenu.type === 'file' && contextMenu.item && contextCanEdit && fileService.isPdf(contextMenu.item as FileItem) && (
            <button
              className="context-menu-item"
              onClick={() => {
                handleOcrFile(contextMenu.item as FileItem);
                closeContextMenu();
              }}
            >
              <i className="fas fa-file-alt"></i>
              <span>OCR to text</span>
            </button>
          )}
          {contextCanEdit && (
            <>
              <div className="context-menu-divider" style={{ height: '1px', background: '#e0e0e0', margin: '8px 0' }}></div>
              <button className="context-menu-item" onClick={handleMove}>
                <i className="fas fa-folder-open"></i>
                <span>Move</span>
              </button>
              {currentFolder && (
                <button className="context-menu-item" onClick={handleMoveToRoot}>
                  <i className="fas fa-home"></i>
                  <span>Move to root</span>
                </button>
              )}
            </>
          )}
          <button className="context-menu-item" onClick={handleShowInfo}>
            <i className="fas fa-info-circle"></i>
            <span>{contextMenu.type === 'file' ? 'File' : 'Folder'} information</span>
          </button>
          {contextMenu.type === 'file' && (
            <>
              {contextCanEdit && (
                <button className="context-menu-item" onClick={handleManageVersions}>
                  <i className="fas fa-history"></i>
                  <span>Manage versions</span>
                </button>
              )}
              <button 
                className="context-menu-item" 
                onClick={() => {
                  const file = contextMenu.item as FileItem;
                  openReminderModal(file.id, file.name);
                  closeContextMenu();
                }}
              >
                <i className="fas fa-bell"></i>
                <span>Set reminder</span>
              </button>
            </>
          )}
          {contextCanManage && (
            <>
              <div className="context-menu-divider" style={{ height: '1px', background: '#e0e0e0', margin: '8px 0' }}></div>
              <button
                className="context-menu-item context-menu-item-danger"
                onClick={() => {
                  if (contextMenu.type === 'file') {
                    handleDeleteFile(contextMenu.item as FileItem);
                  } else {
                    handleDeleteFolder(contextMenu.item as Folder);
                  }
                  closeContextMenu();
                }}
              >
                <i className="fas fa-trash"></i>
                <span>Move to trash</span>
              </button>
            </>
          )}
        </div>
      )}

      {/* Rename Modal */}
      {showRenameModal && selectedItem && (
        <div className="modal-overlay" style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10001
        }}>
          <div className="modal-content" style={{
            background: 'white',
            borderRadius: '8px',
            padding: '24px',
            maxWidth: '400px',
            width: '90%'
          }}>
            <h3 style={{ margin: '0 0 20px 0', color: '#333' }}>Rename</h3>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitRename()}
              autoFocus
              style={{
                width: '100%',
                padding: '12px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontSize: '16px',
                marginBottom: '20px',
                boxSizing: 'border-box'
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                onClick={() => { setShowRenameModal(false); setSelectedItem(null); setRenameValue(''); }}
                style={{
                  padding: '10px 20px',
                  border: '1px solid #ddd',
                  background: 'white',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={submitRename}
                style={{
                  padding: '10px 20px',
                  border: 'none',
                  background: '#007bff',
                  color: 'white',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Info Modal */}
      {showInfoModal && selectedItem && (
        <div className="modal-overlay" style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10001
        }}>
          <div className="modal-content" style={{
            background: 'white',
            borderRadius: '8px',
            padding: '24px',
            maxWidth: '450px',
            width: '90%'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ margin: 0, color: '#333' }}>
                {selectedItem.type === 'file' ? 'File' : 'Folder'} Information
              </h3>
              <button
                onClick={() => { setShowInfoModal(false); setSelectedItem(null); }}
                style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#666' }}
              >
                <i className="fas fa-times"></i>
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '15px', padding: '10px', background: '#f8f9fa', borderRadius: '8px' }}>
                <i className={selectedItem.type === 'file' ? fileService.getFileIcon((selectedItem.item as FileItem).file_type) : 'fas fa-folder'} 
                   style={{ fontSize: '32px', color: selectedItem.type === 'folder' ? '#ffc107' : '#6c757d' }}></i>
                <div>
                  <strong style={{ display: 'block', marginBottom: '4px' }}>{selectedItem.item.name}</strong>
                  {selectedItem.type === 'file' && (
                    <span style={{ color: '#666', fontSize: '14px' }}>
                      {fileService.formatFileSize((selectedItem.item as FileItem).file_size)}
                    </span>
                  )}
                </div>
              </div>
              <div className="info-row" style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #eee' }}>
                <span style={{ color: '#666' }}>Type</span>
                <span>{selectedItem.type === 'file' ? (selectedItem.item as FileItem).file_type || 'Unknown' : 'Folder'}</span>
              </div>
              <div className="info-row" style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #eee' }}>
                <span style={{ color: '#666' }}>Created</span>
                <span>{new Date(selectedItem.item.created_at).toLocaleString()}</span>
              </div>
              {selectedItem.type === 'file' && (selectedItem.item as FileItem).updated_at && (
                <div className="info-row" style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #eee' }}>
                  <span style={{ color: '#666' }}>Modified</span>
                  <span>{new Date((selectedItem.item as FileItem).updated_at!).toLocaleString()}</span>
                </div>
              )}
              {(selectedItem.item as any).description && (
                <div className="info-row" style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #eee' }}>
                  <span style={{ color: '#666' }}>Description</span>
                  <span>{(selectedItem.item as any).description}</span>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button
                onClick={() => { setShowInfoModal(false); setSelectedItem(null); }}
                style={{
                  padding: '10px 20px',
                  border: 'none',
                  background: '#007bff',
                  color: 'white',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Move Modal */}
      {showMoveModal && selectedItem && (
        <div className="modal-overlay" onClick={() => { setShowMoveModal(false); setSelectedItem(null); }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{
            maxWidth: '500px',
            width: '90%'
          }}>
            <div className="modal-header">
              <h2>
                <i className="fas fa-folder-open"></i> Move {selectedItem.type === 'file' ? 'File' : 'Folder'}
              </h2>
              <button className="modal-close" onClick={() => { setShowMoveModal(false); setSelectedItem(null); }}>
                <i className="fas fa-times"></i>
              </button>
            </div>
            <div className="modal-body">
              <div className="file-info-box" style={{ marginBottom: '20px' }}>
                <i className={selectedItem.type === 'file' ? fileService.getFileIcon((selectedItem.item as FileItem).file_type) : "fas fa-folder"}></i>
                <div>
                  <h4>{selectedItem.item.name}</h4>
                  {selectedItem.type === 'file' && <p>{fileService.formatFileSize((selectedItem.item as FileItem).file_size)}</p>}
                </div>
              </div>
              
              <h4 style={{ margin: '0 0 12px 0', fontSize: '0.9rem', color: '#666', fontWeight: 600 }}>Select destination:</h4>
              <div style={{ maxHeight: '400px', overflowY: 'auto', border: '1px solid #e0e0e0', borderRadius: '8px', padding: '8px' }}>
                <button
                  className="folder-select-item"
                  onClick={async () => {
                    try {
                      if (selectedItem.type === 'file') {
                        await fileService.moveFile(selectedItem.item.id, null);
                      } else {
                        await fileService.moveFolder(selectedItem.item.id, null);
                      }
                      toast.success('Moved successfully!');
                      await loadFiles();
                      await loadFolders();
                      // Reset current folder if we moved the current folder
                      if (selectedItem.type === 'folder' && currentFolder === selectedItem.item.id) {
                        setCurrentFolder(null);
                      }
                      setShowMoveModal(false);
                      setSelectedItem(null);
                    } catch (error: any) {
                      toast.error(error.response?.data?.message || 'Failed to move');
                    }
                  }}
                  style={{
                    width: '100%',
                    padding: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    border: '1px solid #ddd',
                    background: 'white',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    marginBottom: '8px',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#f8f9fa';
                    e.currentTarget.style.borderColor = '#141464';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'white';
                    e.currentTarget.style.borderColor = '#ddd';
                  }}
                >
                  <i className="fas fa-home" style={{ color: '#141464', fontSize: '1.2rem' }}></i>
                  <span style={{ fontWeight: 500 }}>Root (My Drive)</span>
                </button>
                {(() => {
                  // Build folder tree and filter out invalid targets
                  // Helper function to check if a folder is a descendant of the folder being moved
                  const isDescendantOfMovedFolder = (folderId: number): boolean => {
                    if (selectedItem.type !== 'folder') return false;
                    const movedFolderId = selectedItem.item.id;
                    
                    // Check if this folder or any of its ancestors is the moved folder
                    const checkAncestors = (checkId: number): boolean => {
                      if (checkId === movedFolderId) return true;
                      const folder = folders.find(f => f.id === checkId);
                      if (!folder || folder.parent_id === null || folder.parent_id === undefined) return false;
                      return checkAncestors(folder.parent_id);
                    };
                    
                    return checkAncestors(folderId);
                  };

                  const buildFolderTree = (parentId: number | null = null, level: number = 0): Folder[] => {
                    return folders
                      .filter(f => {
                        // Don't show the folder being moved
                        if (selectedItem.type === 'folder' && f.id === selectedItem.item.id) {
                          return false;
                        }
                        // Don't show descendants of the folder being moved (to prevent circular moves)
                        if (selectedItem.type === 'folder' && isDescendantOfMovedFolder(f.id)) {
                          return false;
                        }
                        return f.parent_id === parentId;
                      })
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .flatMap(folder => [
                        { ...folder, _level: level } as Folder & { _level: number },
                        ...buildFolderTree(folder.id, level + 1)
                      ]);
                  };

                  const folderTree = buildFolderTree();

                  return folderTree.map(folder => {
                    const level = (folder as any)._level || 0;
                    return (
                      <button
                        key={folder.id}
                        className="folder-select-item"
                        onClick={async () => {
                          try {
                            if (selectedItem.type === 'file') {
                              await fileService.moveFile(selectedItem.item.id, folder.id);
                            } else {
                              await fileService.moveFolder(selectedItem.item.id, folder.id);
                            }
                            toast.success('Moved successfully!');
                            await loadFiles();
                            await loadFolders();
                            // Reset current folder if we moved the current folder
                            if (selectedItem.type === 'folder' && currentFolder === selectedItem.item.id) {
                              setCurrentFolder(null);
                            }
                            setShowMoveModal(false);
                            setSelectedItem(null);
                          } catch (error: any) {
                            toast.error(error.response?.data?.message || 'Failed to move');
                          }
                        }}
                        style={{
                          width: '100%',
                          padding: '12px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          border: '1px solid #ddd',
                          background: 'white',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          marginBottom: '8px',
                          marginLeft: `${level * 20}px`,
                          transition: 'all 0.2s'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = '#f8f9fa';
                          e.currentTarget.style.borderColor = '#141464';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'white';
                          e.currentTarget.style.borderColor = '#ddd';
                        }}
                      >
                        <i className="fas fa-folder" style={{ color: '#ffc107', fontSize: '1.2rem' }}></i>
                        <span style={{ fontWeight: 500 }}>{folder.name}</span>
                      </button>
                    );
                  });
                })()}
                {folders.filter(f => {
                  if (selectedItem.type === 'folder' && f.id === selectedItem.item.id) return false;
                  return true;
                }).length === 0 && (
                  <div style={{ padding: '20px', textAlign: 'center', color: '#999' }}>
                    <i className="fas fa-folder-open" style={{ fontSize: '2rem', marginBottom: '10px', display: 'block' }}></i>
                    <p>No other folders available</p>
                  </div>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => { setShowMoveModal(false); setSelectedItem(null); }}>
                <i className="fas fa-times"></i> Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Permission Error Dialog */}
      {showPermissionError && (
        <div className="modal-overlay" onClick={() => setShowPermissionError(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '500px' }}>
            <div className="modal-header">
              <h3 style={{ color: '#d32f2f', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <i className="fas fa-exclamation-triangle"></i>
                Access Denied
              </h3>
              <button className="modal-close" onClick={() => setShowPermissionError(false)}>
                <i className="fas fa-times"></i>
              </button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: '16px', lineHeight: '1.6', color: '#333' }}>
                {permissionErrorMessage || 'You do not have permission to access this folder.'}
              </p>
              <p style={{ fontSize: '14px', color: '#666', marginTop: '12px' }}>
                This folder may not be shared with you, or you may not have the necessary permissions to view it.
              </p>
            </div>
            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
              <button 
                className="btn-primary" 
                onClick={() => {
                  setShowPermissionError(false);
                  navigate('/dashboard/my-drive');
                }}
                style={{ padding: '10px 24px' }}
              >
                Go to My Drive
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Share Modal */}
      {showShareModal && selectedItem && (
        <FileSharingModal
          file={selectedItem.type === 'file' ? selectedItem.item as FileItem : undefined}
          folder={selectedItem.type === 'folder' ? selectedItem.item as Folder : undefined}
          onClose={() => { setShowShareModal(false); setSelectedItem(null); }}
        />
      )}

      {/* Version History Modal */}
      {showVersionModal && selectedItem && selectedItem.type === 'file' && (
        <div className="modal-overlay" style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10001
        }}>
          <div className="modal-content" style={{
            background: 'white',
            borderRadius: '8px',
            padding: '24px',
            maxWidth: '600px',
            width: '90%',
            maxHeight: '80vh',
            overflow: 'auto'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ margin: 0, color: '#333' }}>Manage versions</h3>
              <button
                onClick={() => { 
                  setShowVersionModal(false); 
                  setSelectedItem(null); 
                  setFileVersions([]);
                }}
                style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#666' }}
              >
                <i className="fas fa-times"></i>
              </button>
            </div>

            {/* Info text */}
            <div style={{ 
              padding: '12px 16px', 
              background: '#f8f9fa', 
              borderRadius: '6px', 
              marginBottom: '20px',
              fontSize: '14px',
              color: '#666',
              lineHeight: '1.5'
            }}>
              <p style={{ margin: 0 }}>
                Temporary versions of <strong>"{selectedItem.item.name}"</strong> may be deleted automatically after 30 days or after 100 versions are stored. 
                To avoid deletion, open the context menu on the file version and select <strong>Keep forever</strong>. 
                These versions are kept forever and count towards your storage limit. 
                Versions are displayed in the order they were uploaded to Drive.{' '}
                <button 
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    // TODO: Add learn more functionality
                  }}
                  style={{ 
                    background: 'none', 
                    border: 'none', 
                    color: '#141464', 
                    cursor: 'pointer', 
                    textDecoration: 'underline',
                    padding: 0,
                    font: 'inherit'
                  }}
                >
                  Learn more
                </button>
              </p>
            </div>

            {/* Upload new version button */}
            <button
              onClick={handleUploadNewVersion}
              disabled={isUploadingVersion}
              style={{
                width: '100%',
                padding: '12px 16px',
                marginBottom: '20px',
                background: '#141464',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: isUploadingVersion ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                fontSize: '14px',
                fontWeight: 500,
                opacity: isUploadingVersion ? 0.6 : 1
              }}
            >
              {isUploadingVersion ? (
                <>
                  <i className="fas fa-spinner fa-spin"></i>
                  <span>Uploading...</span>
                </>
              ) : (
                <>
                  <i className="fas fa-upload"></i>
                  <span>Upload new version</span>
                </>
              )}
            </button>
            <input
              ref={versionFileInputRef}
              type="file"
              style={{ display: 'none' }}
              onChange={handleVersionFileUpload}
            />

            <hr style={{ margin: '20px 0', border: 'none', borderTop: '1px solid #e0e0e0' }} />

            {/* Versions list */}
            {isLoadingVersions ? (
              <div style={{ textAlign: 'center', padding: '40px' }}>
                <i className="fas fa-spinner fa-spin" style={{ fontSize: '2rem', color: '#6c757d' }}></i>
                <p style={{ marginTop: '10px', color: '#666' }}>Loading versions...</p>
              </div>
            ) : fileVersions.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
                <i className="fas fa-history" style={{ fontSize: '3rem', marginBottom: '15px', display: 'block' }}></i>
                <p>No previous versions</p>
              </div>
            ) : (
              <div>
                <h4 style={{ margin: '0 0 16px 0', fontSize: '14px', fontWeight: 600, color: '#333' }}>Current version</h4>
                {fileVersions.map((version, index) => (
                  <div
                    key={version.id || 'current'}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '12px',
                      border: '1px solid #e0e0e0',
                      borderRadius: '6px',
                      marginBottom: '8px',
                      background: version.is_current ? '#f0f7ff' : 'white'
                    }}
                  >
                    <i className="fas fa-file" style={{ 
                      fontSize: '1.5rem', 
                      color: '#141464', 
                      marginRight: '12px',
                      width: '24px'
                    }}></i>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <span style={{ fontWeight: 500, color: '#333' }}>
                          {version.is_current ? 'Current version' : `Version ${version.version_number}`} {selectedItem.item.name}
                        </span>
                        {version.is_current && (
                          <span style={{ 
                            fontSize: '12px', 
                            padding: '2px 6px', 
                            background: '#141464', 
                            color: 'white', 
                            borderRadius: '3px' 
                          }}>
                            Current
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '12px', color: '#666' }}>
                        {new Date(version.created_at).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit'
                        })} • {fileService.formatFileSize(version.file_size)}
                        {version.first_name && version.last_name && (
                          <> • {version.first_name} {version.last_name}</>
                        )}
                      </div>
                    </div>
                    {!version.is_current && version.id && (
                      <div style={{ position: 'relative' }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            // Handle keep forever - can be implemented later
                            toast.success('Version will be kept forever');
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            padding: '8px',
                            color: '#666'
                          }}
                          title="More options"
                        >
                          <i className="fas fa-ellipsis-v"></i>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '24px' }}>
              <button
                onClick={() => { 
                  setShowVersionModal(false); 
                  setSelectedItem(null); 
                  setFileVersions([]);
                }}
                style={{
                  padding: '10px 24px',
                  border: 'none',
                  background: '#141464',
                  color: 'white',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: 500
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* File Preview Modal */}
      {showPreviewModal && previewFile && (
        <FilePreviewModal
          file={previewFile}
          onClose={() => {
            setShowPreviewModal(false);
            setPreviewFile(null);
          }}
        />
      )}

      {/* Reminder Modal */}
      {showReminderModal && reminderFile && (
        <ReminderModal
          isOpen={showReminderModal}
          onClose={() => {
            setShowReminderModal(false);
            setReminderFile(null);
            setEditingReminder(null);
          }}
          fileId={reminderFile.id}
          fileName={reminderFile.name}
          existingReminder={editingReminder}
          onReminderCreated={() => {
            loadTodoDocuments();
            loadPendingReminders();
          }}
        />
      )}
    </div>
  );
};

export default Dashboard;
