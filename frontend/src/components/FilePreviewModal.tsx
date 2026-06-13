import React, { useState, useEffect, useCallback } from 'react';
import { fileService, FileItem } from '../services/fileService';
import { getAccessToken } from '../services/api';
import toast from 'react-hot-toast';

interface FilePreviewModalProps {
  file: FileItem | null;
  onClose: () => void;
}

const FilePreviewModal: React.FC<FilePreviewModalProps> = ({ file, onClose }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [previewContent, setPreviewContent] = useState<string>('');

  const loadPreview = useCallback(async () => {
    if (!file) return;

    setIsLoading(true);
    try {
      const fileType = file.file_type.toLowerCase();
      
      // For previewable files, fetch with proper authentication and create blob URL
      if (fileType.includes('jpg') || fileType.includes('jpeg') || fileType.includes('png') || fileType.includes('gif') ||
          fileType.includes('pdf') || fileType.includes('mp4') || fileType.includes('avi') || fileType.includes('mov')) {
        
        const baseUrl = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000/api';
        const token = getAccessToken();
        
        if (!token) {
          throw new Error('Authentication token not found. Please log in again.');
        }
        
        const response = await fetch(`${baseUrl}/files/${file.id}/preview`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`
          },
          credentials: 'include',
        });

        if (!response.ok) {
          if (response.status === 401) {
            throw new Error('Authentication failed. Please log in again.');
          } else if (response.status === 404) {
            throw new Error('File not found on server.');
          } else {
            throw new Error(`Failed to load preview: ${response.status} ${response.statusText}`);
          }
        }

        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        setPreviewContent(blobUrl);
      }
      // For text files
      else if (fileType.includes('txt')) {
        // Would need to fetch text content from API
        setPreviewContent('');
      }
      
      setIsLoading(false);
    } catch (error) {
      console.error('Error loading preview:', error);
      toast.error('Failed to load preview');
      setIsLoading(false);
      setPreviewContent('');
    }
  }, [file]);

  useEffect(() => {
    if (file) {
      loadPreview();
    }
  }, [file, loadPreview]);

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      if (previewContent && previewContent.startsWith('blob:')) {
        URL.revokeObjectURL(previewContent);
      }
    };
  }, [previewContent]);

  if (!file) return null;

  const fileType = file.file_type.toLowerCase();
  const canPreview = fileService.canPreview(file.file_type);

  const renderPreview = () => {
    if (isLoading) {
      return (
        <div className="preview-loading">
          <i className="fas fa-spinner fa-spin"></i>
          <p>Loading preview...</p>
        </div>
      );
    }

    // Image preview
    if (fileType.includes('jpg') || fileType.includes('jpeg') || fileType.includes('png') || fileType.includes('gif')) {
      return (
        <div className="preview-image">
          <img src={previewContent} alt={file.name} onError={() => {
            setIsLoading(false);
            setPreviewContent('');
          }} />
        </div>
      );
    }

    // PDF preview
    if (fileType.includes('pdf')) {
      return (
        <div className="preview-pdf">
          <iframe 
            src={`${previewContent}#toolbar=0`} 
            title={file.name}
            width="100%" 
            height="100%"
            style={{ border: 'none' }}
            onLoad={() => setIsLoading(false)}
            onError={() => {
              console.error('PDF iframe load error');
              setIsLoading(false);
            }}
          />
        </div>
      );
    }

    // Video preview (MP4, AVI, MOV)
    if (fileType.includes('mp4') || fileType.includes('avi') || fileType.includes('mov')) {
      let videoType = 'video/mp4';
      if (fileType.includes('avi')) {
        videoType = 'video/x-msvideo';
      } else if (fileType.includes('mov')) {
        videoType = 'video/quicktime';
      }
      
      return (
        <div className="preview-video">
          <video 
            controls 
            width="100%" 
            style={{ maxHeight: '80vh', maxWidth: '100%' }}
            onError={(e) => {
              console.error('Video load error:', e);
              setIsLoading(false);
            }}
            onLoadedData={() => {
              setIsLoading(false);
            }}
          >
            <source src={previewContent} type={videoType} />
            Your browser does not support the video tag.
          </video>
        </div>
      );
    }

    // Document preview (DOCX, etc.) - Using Office Online Viewer
    if (fileType.includes('doc') || fileType.includes('docx')) {
      const viewerUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(previewContent)}`;
      return (
        <div className="preview-document">
          <iframe 
            src={viewerUrl} 
            title={file.name}
            width="100%" 
            height="600px"
            style={{ border: 'none' }}
          />
        </div>
      );
    }

    // No preview available (Google Drive style)
    return (
      <div className="preview-not-available">
        <div className="preview-not-available-content">
          <div className="preview-file-icon">
            <i className={fileService.getFileIcon(file.file_type)}></i>
          </div>
          <h3>No preview available</h3>
          <button 
            className="btn-download-preview" 
            onClick={() => {
              fileService.downloadFile(file.id, file.name);
              toast.success('Download started');
            }}
          >
            <i className="fas fa-download"></i>
            <span>Download</span>
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="modal-overlay preview-modal-overlay" onClick={onClose}>
      <div className="modal-content modal-large preview-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header preview-header">
          <div className="modal-title">
            <i className={fileService.getFileIcon(file.file_type)}></i>
            <h2>{file.name}</h2>
          </div>
          <div className="preview-header-actions">
            <button 
              className="btn-icon-header" 
              onClick={() => {
                fileService.downloadFile(file.id, file.name);
                toast.success('Download started');
              }}
              title="Download"
            >
              <i className="fas fa-download"></i>
            </button>
            <button className="modal-close" onClick={onClose} title="Close">
              <i className="fas fa-times"></i>
            </button>
          </div>
        </div>
        
        <div className="modal-body preview-modal-body">
          {renderPreview()}
        </div>

        {/* Only show footer for previewable files */}
        {canPreview && !isLoading && previewContent && (
          <div className="modal-footer preview-footer">
            <div className="file-preview-info">
              <span><i className="fas fa-hdd"></i> {fileService.formatFileSize(file.file_size)}</span>
              <span><i className="fas fa-calendar"></i> {new Date(file.created_at).toLocaleDateString()}</span>
              {file.first_name && file.last_name && (
                <span><i className="fas fa-user"></i> {file.first_name} {file.last_name}</span>
              )}
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => {
                fileService.downloadFile(file.id, file.name);
                toast.success('Download started');
              }}>
                <i className="fas fa-download"></i> Download
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default FilePreviewModal;
