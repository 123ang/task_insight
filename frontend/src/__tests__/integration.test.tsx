import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { authService } from '../services/authService';
import { fileService } from '../services/fileService';
import { reminderService } from '../services/reminderService';
import { toast } from 'react-hot-toast';

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

jest.mock('../services/authService', () => ({
  authService: {
    login: jest.fn(),
    register: jest.fn(),
    setAuthData: jest.fn(),
    getAuthData: jest.fn(),
    clearAuthData: jest.fn(),
    verifyToken: jest.fn(),
    refreshToken: jest.fn(),
    logout: jest.fn(),
  },
}));

jest.mock('../services/fileService', () => ({
  fileService: {
    getFiles: jest.fn(() => Promise.resolve({
      success: true,
      data: {
        files: [],
        pagination: { page: 1, limit: 10, total: 0, pages: 0 },
      },
    })),
    getFolders: jest.fn(() => Promise.resolve({ success: true, data: [] })),
    getFileStats: jest.fn(() => Promise.resolve({
      success: true,
      data: { totalFiles: 0, totalSize: 0, typeStats: [], recentUploads: 0 },
    })),
    getStarredItems: jest.fn(() => Promise.resolve({ success: true, data: { files: [], folders: [] } })),
    getSharedWithMe: jest.fn(() => Promise.resolve({
      success: true,
      data: { files: [], pagination: { page: 1, limit: 50, total: 0, pages: 0 } },
    })),
    getDeletedFiles: jest.fn(() => Promise.resolve({
      success: true,
      data: { files: [], pagination: { page: 1, limit: 10, total: 0, pages: 0 } },
    })),
    ocrFile: jest.fn(() => Promise.resolve({ success: true, data: { fileId: 1, name: 'ocr.txt', size: 0, type: '.txt' } })),
    getFileIcon: jest.fn(() => 'fas fa-file-alt'),
    formatFileSize: jest.fn(() => '0 Bytes'),
    isImage: jest.fn(() => false),
    isPdf: jest.fn(() => true),
  },
}));

jest.mock('../services/reminderService', () => ({
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
    loading: jest.fn(() => 'toast-id'),
  };

  return {
    __esModule: true,
    default: toastMock,
    toast: toastMock,
    Toaster: () => null,
  };
});

const getInputById = (id: string) => document.getElementById(id) as HTMLInputElement;
const getPanelById = (id: string) => document.getElementById(id) as HTMLElement;

const renderLoginRoute = () => {
  window.history.pushState({}, '', '/login');
  return render(<App />);
};

const clickCreateAccountOption = async (user: ReturnType<typeof userEvent.setup>, optionText: string) => {
  await user.click(screen.getByRole('button', { name: /create account/i }));
  await user.click(within(getPanelById('create-account-options')).getByText(optionText));
};

describe('Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (authService.getAuthData as jest.Mock).mockReturnValue({ token: null, user: null, refreshToken: null });
    (authService.verifyToken as jest.Mock).mockResolvedValue({ success: true, data: { user: testUser } });
    (authService.login as jest.Mock).mockResolvedValue({
      success: true,
      data: {
        token: 'mock-token',
        refreshToken: 'mock-refresh-token',
        user: testUser,
      },
    });
    (authService.register as jest.Mock).mockResolvedValue({
      success: true,
      data: {
        userId: testUser.id,
        email: testUser.email,
        firstName: testUser.firstName,
        lastName: testUser.lastName,
      },
    });

    (fileService.getFiles as jest.Mock).mockResolvedValue({
      success: true,
      data: {
        files: [],
        pagination: { page: 1, limit: 10, total: 0, pages: 0 },
      },
    });
    (fileService.getFolders as jest.Mock).mockResolvedValue({ success: true, data: [] });
    (fileService.getFileStats as jest.Mock).mockResolvedValue({
      success: true,
      data: { totalFiles: 0, totalSize: 0, typeStats: [], recentUploads: 0 },
    });
    (fileService.getStarredItems as jest.Mock).mockResolvedValue({ success: true, data: { files: [], folders: [] } });
    (fileService.getSharedWithMe as jest.Mock).mockResolvedValue({
      success: true,
      data: { files: [], pagination: { page: 1, limit: 50, total: 0, pages: 0 } },
    });
    (fileService.getDeletedFiles as jest.Mock).mockResolvedValue({
      success: true,
      data: { files: [], pagination: { page: 1, limit: 10, total: 0, pages: 0 } },
    });
    (fileService.getFileIcon as jest.Mock).mockReturnValue('fas fa-file-alt');
    (fileService.formatFileSize as jest.Mock).mockReturnValue('0 Bytes');
    (fileService.isImage as jest.Mock).mockReturnValue(false);
    (fileService.isPdf as jest.Mock).mockReturnValue(true);
    (fileService.ocrFile as jest.Mock).mockResolvedValue({
      success: true,
      data: { fileId: 1, name: 'ocr.txt', size: 0, type: '.txt' },
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

  describe('Authentication Flow', () => {
    it('renders the login page by default', () => {
      renderLoginRoute();

      expect(screen.getByAltText('Task Insight')).toBeInTheDocument();
      expect(getInputById('login-email')).toBeInTheDocument();
      expect(getInputById('login-password')).toBeInTheDocument();
    });

    it('handles successful login and redirects to the dashboard', async () => {
      const user = userEvent.setup();
      renderLoginRoute();

      await user.type(getInputById('login-email'), 'test@example.com');
      await user.type(getInputById('login-password'), 'password123');
      await user.click(within(getPanelById('login-form')).getByRole('button', { name: /^sign in$/i }));

      await waitFor(() => {
        expect(authService.setAuthData).toHaveBeenCalledWith('mock-token', testUser);
        expect(mockNavigate).toHaveBeenCalledWith('/');
      });
    });

    it('handles successful registration and switches to login', async () => {
      const user = userEvent.setup();
      renderLoginRoute();

      await clickCreateAccountOption(user, 'Join Organization');

      await user.type(getInputById('invitation-code'), 'TEST123');
      await user.type(getInputById('register-firstname'), 'John');
      await user.type(getInputById('register-lastname'), 'Doe');
      await user.type(getInputById('register-email'), 'john@example.com');
      await user.type(getInputById('register-password'), 'Password12345');
      await user.type(getInputById('register-confirm'), 'Password12345');
      await user.click(within(getPanelById('register-form')).getByRole('button', { name: /join organization/i }));

      await waitFor(() => {
        expect(getPanelById('login-form')).toHaveClass('active');
      });
    });
  });

  describe('Navigation Flow', () => {
    it('navigates between login and create account tabs', async () => {
      const user = userEvent.setup();
      renderLoginRoute();

      expect(getPanelById('login-form')).toHaveClass('active');

      await user.click(screen.getByRole('button', { name: /create account/i }));
      expect(getPanelById('create-account-options')).toHaveClass('active');

      await user.click(screen.getByRole('button', { name: /login/i }));
      expect(getPanelById('login-form')).toHaveClass('active');
    });

    it('navigates between registration options', async () => {
      const user = userEvent.setup();
      renderLoginRoute();

      await clickCreateAccountOption(user, 'Join Organization');
      expect(getPanelById('register-form')).toHaveClass('active');
      expect(getInputById('invitation-code')).toBeInTheDocument();

      await user.click(within(getPanelById('register-form')).getByRole('button', { name: /back to options/i }));
      expect(getPanelById('create-account-options')).toHaveClass('active');

      await user.click(within(getPanelById('create-account-options')).getByText('Task Insight Admin'));
      expect(getPanelById('admin-form')).toHaveClass('active');
      expect(getInputById('admin-email')).toBeInTheDocument();
    });
  });

  describe('Form Validation', () => {
    it('validates email format in login form', async () => {
      const user = userEvent.setup();
      renderLoginRoute();

      await user.type(getInputById('login-email'), 'invalid-email');
      await user.type(getInputById('login-password'), 'password123');
      await user.click(within(getPanelById('login-form')).getByRole('button', { name: /^sign in$/i }));

      expect(getInputById('login-email').validity.valid).toBe(false);
      expect(authService.login).not.toHaveBeenCalled();
    });

    it('validates password length in registration form', async () => {
      const user = userEvent.setup();
      renderLoginRoute();

      await clickCreateAccountOption(user, 'Join Organization');

      await user.type(getInputById('invitation-code'), 'TEST123');
      await user.type(getInputById('register-firstname'), 'John');
      await user.type(getInputById('register-lastname'), 'Doe');
      await user.type(getInputById('register-email'), 'john@example.com');
      await user.type(getInputById('register-password'), '123');
      await user.type(getInputById('register-confirm'), '123');
      await user.click(within(getPanelById('register-form')).getByRole('button', { name: /join organization/i }));

      expect(toast.error).toHaveBeenCalledWith('Password must be at least 12 characters long');
      expect(authService.register).not.toHaveBeenCalled();
    });
  });

  describe('Loading States', () => {
    it('shows loading state during login', async () => {
      const user = userEvent.setup();
      (authService.login as jest.Mock).mockReturnValue(new Promise(() => {}));
      renderLoginRoute();

      await user.type(getInputById('login-email'), 'test@example.com');
      await user.type(getInputById('login-password'), 'password123');
      await user.click(within(getPanelById('login-form')).getByRole('button', { name: /^sign in$/i }));

      expect(await screen.findByText(/logging in/i)).toBeInTheDocument();
    });

    it('shows loading state during registration', async () => {
      const user = userEvent.setup();
      (authService.register as jest.Mock).mockReturnValue(new Promise(() => {}));
      renderLoginRoute();

      await clickCreateAccountOption(user, 'Join Organization');
      await user.type(getInputById('invitation-code'), 'TEST123');
      await user.type(getInputById('register-firstname'), 'John');
      await user.type(getInputById('register-lastname'), 'Doe');
      await user.type(getInputById('register-email'), 'john@example.com');
      await user.type(getInputById('register-password'), 'Password12345');
      await user.type(getInputById('register-confirm'), 'Password12345');
      await user.click(within(getPanelById('register-form')).getByRole('button', { name: /join organization/i }));

      expect(await screen.findByText(/registering/i)).toBeInTheDocument();
    });
  });
});
