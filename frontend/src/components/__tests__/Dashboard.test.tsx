import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import Dashboard from '../Dashboard';
import { AuthProvider } from '../../contexts/AuthContext';
import { FileProvider } from '../../contexts/FileContext';
import { authService } from '../../services/authService';
import { fileService } from '../../services/fileService';
import { reminderService } from '../../services/reminderService';

const testUser = {
  id: 1,
  email: 'test@example.com',
  firstName: 'John',
  lastName: 'Doe',
  role: 'member',
  organizationId: 1,
  organizationName: 'Test Organization',
  status: 'active',
};

const testFile = {
  id: 1,
  name: 'test-document.pdf',
  original_name: 'test-document.pdf',
  storage_path: 'documents/test-document.pdf',
  file_size: 1024000,
  file_type: 'application/pdf',
  organization_id: 1,
  uploaded_by: 1,
  folder_id: undefined,
  status: 'active',
  created_at: '2024-01-01T00:00:00.000Z',
  first_name: 'John',
  last_name: 'Doe',
  email: 'test@example.com',
};

const testFolder = {
  id: 1,
  name: 'Test Folder',
  organization_id: 1,
  created_by: 1,
  parent_id: undefined,
  status: 'active',
  created_at: '2024-01-01T00:00:00.000Z',
  file_count: 0,
  total_size: 0,
  first_name: 'John',
  last_name: 'Doe',
};

jest.mock('../../services/fileService', () => ({
  fileService: {
    getFiles: jest.fn(),
    getFolders: jest.fn(),
    getFileStats: jest.fn(),
    getFolder: jest.fn(),
    getStarredItems: jest.fn(),
    getSharedWithMe: jest.fn(),
    getDeletedFiles: jest.fn(),
    uploadFile: jest.fn(),
    downloadFile: jest.fn(),
    updateFile: jest.fn(),
    deleteFile: jest.fn(),
    createFolder: jest.fn(),
    deleteFolder: jest.fn(),
    toggleStar: jest.fn(),
    getFileIcon: jest.fn(() => 'fas fa-file-pdf'),
    formatFileSize: jest.fn((bytes: number) => {
      if (bytes === 10240000) return '9.77 MB';
      if (bytes === 1024000) return '1000 KB';
      return '0 Bytes';
    }),
    isImage: jest.fn(() => false),
  },
}));

jest.mock('../../services/authService', () => ({
  authService: {
    setAuthData: jest.fn(),
    getAuthData: jest.fn(),
    clearAuthData: jest.fn(),
    verifyToken: jest.fn(),
    refreshToken: jest.fn(),
    logout: jest.fn(),
  },
}));

jest.mock('../../services/reminderService', () => ({
  reminderService: {
    getPendingReminders: jest.fn(() => Promise.resolve({ success: true, data: [] })),
    getTodoDocuments: jest.fn(() => Promise.resolve({
      success: true,
      data: {
        data: [],
        summary: { overdue: 0, today: 0, upcoming: 0, total: 0 },
        pagination: { page: 1, limit: 50, total: 0, pages: 0 },
      },
    })),
    completeReminder: jest.fn(() => Promise.resolve({ success: true })),
    dismissReminder: jest.fn(() => Promise.resolve({ success: true })),
    isOverdue: jest.fn(() => false),
    isDueToday: jest.fn(() => false),
    formatReminderTime: jest.fn(() => 'Today'),
  },
}));

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

jest.mock('react-hot-toast', () => {
  const toastMock = {
    success: jest.fn(),
    error: jest.fn(),
    promise: jest.fn((promise) => promise),
  };

  return {
    __esModule: true,
    default: toastMock,
    toast: toastMock,
  };
});

const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <BrowserRouter>
    <AuthProvider>
      <FileProvider>
        {children}
      </FileProvider>
    </AuthProvider>
  </BrowserRouter>
);

const renderDashboard = () => {
  window.history.pushState({}, '', '/dashboard/my-drive');
  return render(
    <TestWrapper>
      <Dashboard />
    </TestWrapper>
  );
};

describe('Dashboard Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (authService.getAuthData as jest.Mock).mockReturnValue({
      token: 'mock-token',
      user: testUser,
      refreshToken: 'mock-refresh-token',
    });
    (authService.verifyToken as jest.Mock).mockResolvedValue({ success: true, data: { user: testUser } });
    (authService.logout as jest.Mock).mockResolvedValue({ success: true });

    (fileService.getFiles as jest.Mock).mockResolvedValue({
      success: true,
      data: {
        files: [testFile],
        pagination: { page: 1, limit: 10, total: 1, pages: 1 },
      },
    });
    (fileService.getFolders as jest.Mock).mockResolvedValue({ success: true, data: [testFolder] });
    (fileService.getFileStats as jest.Mock).mockResolvedValue({
      success: true,
      data: {
        totalFiles: 10,
        totalSize: 10240000,
        typeStats: [
          { type: 'application/pdf', count: 5, total_size: 5120000, avg_size: 1024000 },
        ],
        recentUploads: 5,
      },
    });
    (fileService.getFolder as jest.Mock).mockResolvedValue({ success: true, data: testFolder });
    (fileService.getStarredItems as jest.Mock).mockResolvedValue({ success: true, data: { files: [], folders: [] } });
    (fileService.getSharedWithMe as jest.Mock).mockResolvedValue({
      success: true,
      data: { files: [], pagination: { page: 1, limit: 50, total: 0, pages: 0 } },
    });
    (fileService.getDeletedFiles as jest.Mock).mockResolvedValue({
      success: true,
      data: { files: [], pagination: { page: 1, limit: 10, total: 0, pages: 0 } },
    });
    (fileService.getFileIcon as jest.Mock).mockReturnValue('fas fa-file-pdf');
    (fileService.formatFileSize as jest.Mock).mockImplementation((bytes: number) => {
      if (bytes === 10240000) return '9.77 MB';
      if (bytes === 1024000) return '1000 KB';
      return '0 Bytes';
    });
    (fileService.isImage as jest.Mock).mockReturnValue(false);
    (fileService.createFolder as jest.Mock).mockResolvedValue({
      success: true,
      data: { folderId: 2, name: 'New Folder' },
    });

    (reminderService.getPendingReminders as jest.Mock).mockResolvedValue({ success: true, data: [] });
    (reminderService.getTodoDocuments as jest.Mock).mockResolvedValue({
      success: true,
      data: {
        data: [],
        summary: { overdue: 0, today: 0, upcoming: 0, total: 0 },
        pagination: { page: 1, limit: 50, total: 0, pages: 0 },
      },
    });
    (reminderService.isOverdue as jest.Mock).mockReturnValue(false);
    (reminderService.isDueToday as jest.Mock).mockReturnValue(false);
    (reminderService.formatReminderTime as jest.Mock).mockReturnValue('Today');
  });

  it('renders dashboard with user initials', async () => {
    renderDashboard();

    expect(await screen.findByText('JD')).toBeInTheDocument();
  });

  it('loads and displays files', async () => {
    renderDashboard();

    expect(await screen.findByText('test-document.pdf')).toBeInTheDocument();
  });

  it('loads and displays folders', async () => {
    renderDashboard();

    expect(await screen.findByText('Test Folder')).toBeInTheDocument();
  });

  it('displays file statistics', async () => {
    renderDashboard();

    await waitFor(() => {
      expect(fileService.getFileStats).toHaveBeenCalledWith(1);
    });
    expect(await screen.findByText(/9\.77 MB of 5 GB/i)).toBeInTheDocument();
  });

  it('opens file upload modal from the new menu', async () => {
    const user = userEvent.setup();
    renderDashboard();

    await screen.findByText('test-document.pdf');
    await user.click(screen.getByRole('button', { name: /new/i }));
    await user.click(screen.getByText('File upload'));

    expect(await screen.findByText('Upload Files')).toBeInTheDocument();
  });

  it('opens create folder modal from the new menu', async () => {
    const user = userEvent.setup();
    renderDashboard();

    await screen.findByText('test-document.pdf');
    await user.click(screen.getByRole('button', { name: /new/i }));
    await user.click(screen.getByText('Folder'));

    expect(await screen.findByRole('heading', { name: 'Create Folder' })).toBeInTheDocument();
  });

  it('handles file search', async () => {
    const user = userEvent.setup();
    renderDashboard();

    await screen.findByText('test-document.pdf');

    const searchInput = screen.getByPlaceholderText(/search files and folders/i);
    await user.type(searchInput, 'test');

    expect(searchInput).toHaveValue('test');
  });

  it('handles user logout', async () => {
    const user = userEvent.setup();
    renderDashboard();

    await screen.findByText('JD');
    await user.click(screen.getByText('JD'));
    await user.click(within(screen.getByText('test@example.com').closest('.user-dropdown') as HTMLElement).getByText('Logout'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login');
    });
  });
});
