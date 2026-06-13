import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import AdminPanel from '../AdminPanel';
import { AuthProvider } from '../../contexts/AuthContext';
import { authService } from '../../services/authService';
import { adminService } from '../../services/adminService';
import { organizationService } from '../../services/organizationService';
import { userService } from '../../services/userService';

const adminUser = {
  id: 1,
  email: 'admin@taskinsight.com',
  firstName: 'Admin',
  lastName: 'User',
  role: 'platform_owner',
  status: 'active',
};

const testOrganization = {
  id: 1,
  name: 'Test Organization',
  description: 'Primary test org',
  storageQuota: 10737418240,
  storageUsed: 5368709120,
  status: 'active',
  userCount: 3,
  createdAt: '2024-01-01T00:00:00.000Z',
  invitationCode: 'TEST123',
  invitationExpiresAt: '2024-02-01T00:00:00.000Z',
};

const testMember = {
  id: 2,
  email: 'john@example.com',
  firstName: 'John',
  lastName: 'Doe',
  role: 'member',
  status: 'active',
  organizationId: 1,
  organizationName: 'Test Organization',
};

jest.mock('../../services/adminService', () => ({
  adminService: {
    getDashboardStats: jest.fn(),
    getStorageAnalytics: jest.fn(),
  },
}));

jest.mock('../../services/organizationService', () => ({
  organizationService: {
    getOrganizations: jest.fn(),
  },
}));

jest.mock('../../services/userService', () => ({
  userService: {
    getUsers: jest.fn(),
  },
}));

jest.mock('../../services/auditService', () => ({
  auditService: {
    getAuditLogs: jest.fn(() => Promise.resolve({
      success: true,
      data: { data: [], pagination: { page: 1, limit: 20, total: 0, pages: 0 } },
    })),
  },
}));

jest.mock('../../services/authService', () => ({
  authService: {
    setAuthData: jest.fn(),
    getAuthData: jest.fn(),
    verifyToken: jest.fn(),
    clearAuthData: jest.fn(),
    refreshToken: jest.fn(),
    logout: jest.fn(),
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
    <AuthProvider>{children}</AuthProvider>
  </BrowserRouter>
);

const renderAdminPanel = (path = '/admin') => {
  window.history.pushState({}, '', path);
  return render(
    <TestWrapper>
      <AdminPanel />
    </TestWrapper>
  );
};

describe('AdminPanel Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (authService.getAuthData as jest.Mock).mockReturnValue({
      token: 'mock-token',
      user: adminUser,
      refreshToken: 'mock-refresh-token',
    });
    (authService.verifyToken as jest.Mock).mockResolvedValue({ success: true, data: { user: adminUser } });
    (authService.logout as jest.Mock).mockResolvedValue({ success: true });

    (adminService.getDashboardStats as jest.Mock).mockResolvedValue({
      success: true,
      data: {
        platformStats: {
          active_organizations: 25,
          active_users: 120,
          total_files: 5000,
          total_storage_used: 10737418240,
          total_storage_quota: 21474836480,
        },
        recentActivity: [],
        userRegistrations: [],
        organizationCreations: [],
        topOrganizationsByStorage: [
          {
            id: 1,
            name: 'Test Organization',
            storage_used: 5368709120,
            storage_quota: 10737418240,
            usage_percentage: 50,
          },
        ],
        systemHealth: {
          active_users_30d: 120,
          files_uploaded_7d: 42,
          total_organizations: 25,
          daily_activity: 18,
        },
      },
    });
    (adminService.getStorageAnalytics as jest.Mock).mockResolvedValue({
      success: true,
      data: {
        overview: {
          total_organizations: 25,
          total_quota_mb: 20480,
          total_quota_bytes: 21474836480,
          total_used_bytes: 10737418240,
          usage_percentage: 50,
        },
        byOrganization: [],
        byFileType: [],
        trends: [],
      },
    });
    (organizationService.getOrganizations as jest.Mock).mockResolvedValue({
      success: true,
      data: {
        data: [testOrganization],
        pagination: { page: 1, limit: 100, total: 1, pages: 1 },
      },
    });
    (userService.getUsers as jest.Mock).mockResolvedValue({
      success: true,
      data: {
        data: [testMember],
        pagination: { page: 1, limit: 100, total: 1, pages: 1 },
      },
    });
  });

  it('renders admin panel with statistics', async () => {
    renderAdminPanel();

    expect(await screen.findByText('Platform Overview')).toBeInTheDocument();
    expect(screen.getAllByText('25').length).toBeGreaterThan(0);
    expect(screen.getAllByText('120').length).toBeGreaterThan(0);
    expect(screen.getByText('5000')).toBeInTheDocument();
  });

  it('displays admin user information', async () => {
    const user = userEvent.setup();
    renderAdminPanel();

    expect(await screen.findByText('AU')).toBeInTheDocument();
    await user.click(screen.getByText('AU'));

    expect(screen.getByText('Admin User')).toBeInTheDocument();
    expect(screen.getByText('admin@taskinsight.com')).toBeInTheDocument();
  });

  it('navigates to organizations view', async () => {
    const user = userEvent.setup();
    renderAdminPanel();

    await screen.findByText('Platform Overview');
    await user.click(screen.getByRole('button', { name: /organizations/i }));

    expect(await screen.findByText('Organizations & Invitations')).toBeInTheDocument();
    expect(screen.getByText('Test Organization')).toBeInTheDocument();
  });

  it('navigates to users view', async () => {
    const user = userEvent.setup();
    renderAdminPanel();

    await screen.findByText('Platform Overview');
    await user.click(screen.getByRole('button', { name: /^users$/i }));

    expect(await screen.findByText('john@example.com')).toBeInTheDocument();
    expect(screen.getByText('John Doe')).toBeInTheDocument();
  });

  it('displays system health metrics', async () => {
    renderAdminPanel();

    expect(await screen.findByText('System Health')).toBeInTheDocument();
    expect(screen.getByText('Files Uploaded (7 days)')).toBeInTheDocument();
    expect(screen.getByText('Daily Activity')).toBeInTheDocument();
  });

  it('handles admin logout', async () => {
    const user = userEvent.setup();
    renderAdminPanel();

    await screen.findByText('AU');
    await user.click(screen.getByText('AU'));
    await user.click(within(screen.getByText('admin@taskinsight.com').closest('.user-dropdown') as HTMLElement).getByText('Logout'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login');
    });
  });
});
