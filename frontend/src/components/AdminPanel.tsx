import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { adminService, DashboardStats, StorageAnalytics } from '../services/adminService';
import { organizationService, Organization } from '../services/organizationService';
import { userService } from '../services/userService';
import { User } from '../services/authService';
import { auditService, AuditLog } from '../services/auditService';
import { getAndaiAssistantUrl, openAndaiAssistant } from '../utils/platformLinks';
import toast from 'react-hot-toast';
import '../styles/admin.css';

const AdminPanel: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ tab?: string }>();
  const { user, logout, isPlatformOwner } = useAuth();
  const andaiAssistantUrl = getAndaiAssistantUrl();
  
  // Get current view from URL or default to 'overview'
  const getCurrentView = () => {
    if (params.tab) return params.tab;
    if (location.pathname === '/admin') return 'overview';
    return 'overview';
  };
  
  const [currentView, setCurrentView] = useState(getCurrentView());
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showAddOrgModal, setShowAddOrgModal] = useState(false);
  const [showEditOrgModal, setShowEditOrgModal] = useState(false);
  const [selectedOrg, setSelectedOrg] = useState<any>(null);
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [showEditUserModal, setShowEditUserModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  
  const [isLoading, setIsLoading] = useState(true);
  
  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [storageAnalytics, setStorageAnalytics] = useState<StorageAnalytics | null>(null);
  const [hasLoadedInitialData, setHasLoadedInitialData] = useState(false);
  
  // User filters
  const [userFilters, setUserFilters] = useState<{
    search?: string;
    organizationId?: number;
    role?: string;
    status?: string;
  }>({});
  

  // Check if user is platform owner
  const isOwner = isPlatformOwner();

  // Redirect if not platform owner
  useEffect(() => {
    if (!isOwner) {
      navigate('/dashboard');
    }
  }, [isOwner, navigate]);

  // Load initial data - run only once
  useEffect(() => {
    if (isOwner && !hasLoadedInitialData &&
        process.env.REACT_APP_OFFLINE_MODE !== 'true' && 
        process.env.REACT_APP_DISABLE_API_CALLS !== 'true') {
      setHasLoadedInitialData(true);
      loadDashboardData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner, hasLoadedInitialData]); // loadDashboardData is stable

  const loadDashboardData = async () => {
    setIsLoading(true);
    try {
      const [statsRes, orgsRes, storageRes] = await Promise.all([
        adminService.getDashboardStats(),
        organizationService.getOrganizations(1, 100), // Load all for filter dropdown
        adminService.getStorageAnalytics(),
      ]);

      // Handle dashboard stats
      if (statsRes.success && statsRes.data) {
        setDashboardStats(statsRes.data);
      } else {
        console.error('Dashboard stats error:', statsRes);
      }

      // Handle organizations - PaginationResponse has 'data' property
      if (orgsRes.success && orgsRes.data) {
        const orgsData = orgsRes.data.data || [];
        setOrganizations(Array.isArray(orgsData) ? orgsData : []);
      } else {
        console.error('Organizations error:', orgsRes);
        setOrganizations([]);
      }


      // Handle storage analytics
      if (storageRes.success && storageRes.data) {
        setStorageAnalytics(storageRes.data);
      } else {
        console.error('Storage analytics error:', storageRes);
      }
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
      toast.error('Failed to load dashboard data');
    } finally {
      setIsLoading(false);
    }
  };

  const loadAuditLogs = async () => {
    try {
      const response = await auditService.getAuditLogs(1, 20);
      if (response.success && response.data) {
        const logsData = response.data.data || [];
        setAuditLogs(Array.isArray(logsData) ? logsData : []);
      } else {
        console.error('Audit logs error:', response);
        setAuditLogs([]);
      }
    } catch (error) {
      console.error('Failed to load audit logs:', error);
      toast.error('Failed to load audit logs');
      setAuditLogs([]);
    }
  };

  // Load users when filters change
  useEffect(() => {
    if (currentView === 'users') {
      loadUsers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userFilters, currentView]);

  // Sync currentView with URL
  useEffect(() => {
    const view = getCurrentView();
    setCurrentView(view);
    if (view === 'audit-logs') {
      loadAuditLogs();
    } else if (view === 'users') {
      loadUsers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, params.tab]);

  const handleViewChange = (view: string) => {
    navigate(`/admin/${view}`);
    setCurrentView(view);
    if (view === 'audit-logs') {
      loadAuditLogs();
    }
  };

  const handleCreateOrganization = async () => {
    const orgName = (document.getElementById('org-name') as HTMLInputElement)?.value;
    const orgDescription = (document.getElementById('org-description') as HTMLTextAreaElement)?.value;
    const storageQuotaGB = parseFloat((document.getElementById('storage-quota') as HTMLInputElement)?.value || '5');
    const storageQuota = Math.round(storageQuotaGB * 1024 * 1024 * 1024); // Convert GB to bytes

    if (!orgName) {
      toast.error('Please enter organization name');
      return;
    }

    if (storageQuotaGB < 1) {
      toast.error('Storage quota must be at least 1 GB');
      return;
    }

    try {
      const response = await organizationService.createOrganization({
        name: orgName,
        description: orgDescription || undefined,
        storageQuota,
      });

      if (response.success) {
        toast.success('Organization created successfully!');
        setShowAddOrgModal(false);
        loadDashboardData();
      } else {
        toast.error(response.message || 'Failed to create organization');
    }
    } catch (error: any) {
      console.error('Create organization error:', error);
      toast.error(error.response?.data?.message || 'Failed to create organization');
    }
  };

  const handleGenerateInvitationForOrg = async (orgId: number) => {
    try {
      const response = await adminService.generateInvitation({
        organizationId: orgId,
        role: 'member',
        expiresInDays: 365, // 1 year expiration
      });

      if (response.success && response.data) {
        toast.success(`Invitation code generated: ${response.data.code}`);
        loadDashboardData();
      } else {
        toast.error(response.message || 'Failed to generate invitation');
      }
    } catch (error: any) {
      console.error('Generate invitation error:', error);
      toast.error(error.response?.data?.message || 'Failed to generate invitation');
    }
  };


  const handleUpdateOrganization = async () => {
    const orgName = (document.getElementById('edit-org-name') as HTMLInputElement)?.value;
    const orgDescription = (document.getElementById('edit-org-description') as HTMLTextAreaElement)?.value;
    const storageQuotaGB = parseFloat((document.getElementById('edit-storage-quota') as HTMLInputElement)?.value || '0');
    const storageQuota = Math.round(storageQuotaGB * 1024 * 1024 * 1024); // Convert GB to bytes

    if (!orgName) {
      toast.error('Please enter organization name');
      return;
    }

    if (!selectedOrg) {
      toast.error('No organization selected');
      return;
    }

    if (storageQuotaGB < 1) {
      toast.error('Storage quota must be at least 1 GB');
      return;
    }

    try {
      const response = await organizationService.updateOrganization(selectedOrg.id, {
        name: orgName,
        description: orgDescription || undefined,
        storageQuota,
      });

      if (response.success) {
        toast.success('Organization updated successfully!');
        setShowEditOrgModal(false);
        setSelectedOrg(null);
        loadDashboardData();
      } else {
        toast.error(response.message || 'Failed to update organization');
      }
    } catch (error: any) {
      console.error('Update organization error:', error);
      toast.error(error.response?.data?.message || 'Failed to update organization');
    }
  };

  const handleDeleteOrganization = async (orgId: number) => {
    if (window.confirm('Are you sure you want to delete this organization? This action cannot be undone.')) {
      try {
        await organizationService.deleteOrganization(orgId);
        toast.success('Organization deleted successfully!');
        loadDashboardData();
      } catch (error) {
        toast.error('Failed to delete organization');
      }
    }
  };

  // Load users with filters
  const loadUsers = async () => {
    try {
      const response = await userService.getUsers(1, 100, userFilters);
      if (response.success && response.data) {
        const usersData = response.data.data || [];
        setUsers(Array.isArray(usersData) ? usersData : []);
      } else {
        setUsers([]);
      }
    } catch (error) {
      console.error('Error loading users:', error);
      setUsers([]);
    }
  };

  // Handle user filter changes
  const handleUserFilterChange = (key: string, value: string | number | undefined) => {
    setUserFilters(prev => {
      const newFilters = { ...prev };
      if (value === '' || value === undefined || value === null) {
        delete newFilters[key as keyof typeof newFilters];
      } else {
        (newFilters as any)[key] = value;
      }
      return newFilters;
    });
  };

  // Clear user filters
  const handleClearUserFilters = () => {
    setUserFilters({});
  };

  // Handle create user
  const handleCreateUser = async () => {
    const email = (document.getElementById('user-email') as HTMLInputElement)?.value;
    const password = (document.getElementById('user-password') as HTMLInputElement)?.value;
    const firstName = (document.getElementById('user-first-name') as HTMLInputElement)?.value;
    const lastName = (document.getElementById('user-last-name') as HTMLInputElement)?.value;
    const organizationId = parseInt((document.getElementById('user-organization') as HTMLSelectElement)?.value || '0');
    const role = (document.getElementById('user-role') as HTMLSelectElement)?.value;
    const status = (document.getElementById('user-status') as HTMLSelectElement)?.value;

    if (!email || !password || !firstName || !lastName || !organizationId) {
      toast.error('Please fill in all required fields');
      return;
    }

    try {
      const response = await userService.createUser({
        email,
        password,
        firstName,
        lastName,
        organizationId,
        role: role || 'member',
        status: status || 'active',
      });

      if (response.success) {
        toast.success('User created successfully!');
        setShowAddUserModal(false);
        loadUsers();
      } else {
        toast.error(response.message || 'Failed to create user');
      }
    } catch (error: any) {
      console.error('Create user error:', error);
      toast.error(error.response?.data?.message || 'Failed to create user');
    }
  };

  // Handle update user
  const handleUpdateUser = async () => {
    if (!selectedUser) return;

    const firstName = (document.getElementById('edit-user-first-name') as HTMLInputElement)?.value;
    const lastName = (document.getElementById('edit-user-last-name') as HTMLInputElement)?.value;
    const email = (document.getElementById('edit-user-email') as HTMLInputElement)?.value;
    const organizationId = parseInt((document.getElementById('edit-user-organization') as HTMLSelectElement)?.value || '0');
    const role = (document.getElementById('edit-user-role') as HTMLSelectElement)?.value;
    const status = (document.getElementById('edit-user-status') as HTMLSelectElement)?.value;

    if (!email || !firstName || !lastName) {
      toast.error('Please fill in all required fields');
      return;
    }

    try {
      const updateData: any = {
        firstName,
        lastName,
        email,
        role,
        status,
      };

      // Only include organizationId if it's different and user is platform owner
      if (isOwner && organizationId && organizationId !== selectedUser.organizationId) {
        updateData.organizationId = organizationId;
      }

      const response = await userService.updateUser(selectedUser.id, updateData);

      if (response.success) {
        toast.success('User updated successfully!');
        setShowEditUserModal(false);
        setSelectedUser(null);
        loadUsers();
      } else {
        toast.error(response.message || 'Failed to update user');
      }
    } catch (error: any) {
      console.error('Update user error:', error);
      toast.error(error.response?.data?.message || 'Failed to update user');
    }
  };

  // Handle delete user
  const handleDeleteUser = async (userId: number) => {
    if (window.confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
      try {
        const response = await userService.deleteUser(userId);
        if (response.success) {
          toast.success('User deleted successfully!');
          loadUsers();
        } else {
          toast.error(response.message || 'Failed to delete user');
        }
      } catch (error: any) {
        console.error('Delete user error:', error);
        toast.error(error.response?.data?.message || 'Failed to delete user');
      }
    }
  };

  const handleExportAuditLogs = async () => {
    try {
      await auditService.exportAuditLogs();
      toast.success('Audit logs exported successfully!');
    } catch (error) {
      toast.error('Failed to export audit logs');
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch (error) {
      toast.error('Failed to logout');
    }
  };

  // Helper function to format audit log details
  const formatAuditDetails = (details: any): string => {
    if (!details) return '-';
    if (typeof details === 'string') {
      try {
        const parsed = JSON.parse(details);
        return typeof parsed === 'object' ? JSON.stringify(parsed, null, 2) : String(parsed);
      } catch {
        return details;
      }
    }
    return JSON.stringify(details, null, 2);
  };

  if (!isPlatformOwner()) {
    return <div>Access denied. You must be a platform owner to access this panel.</div>;
  }

  return (
    <div className="admin-panel" style={{ position: 'relative' }}>
      {/* Header */}
      <header className="admin-header">
        <div className="header-left">
          <div className="logo" onClick={() => navigate('/admin/overview')} style={{ cursor: 'pointer' }}>
            <img src="/logo-square.png" alt="Task Insight Admin" className="header-logo" />
            <span>Task Insight Admin</span>
          </div>
        </div>
        <div className="header-right">
          <div className="user-menu">
            <button className="user-avatar" onClick={() => setShowUserMenu(!showUserMenu)}>
              {user?.firstName?.charAt(0) || user?.email?.charAt(0).toUpperCase() || 'U'}
              {user?.lastName?.charAt(0) || (user?.email?.charAt(1) && user.email.charAt(1).toUpperCase()) || ''}
            </button>
            {showUserMenu && (
              <div className="user-dropdown">
                <div className="user-info">
                  <h4>{user?.firstName} {user?.lastName}</h4>
                  <p>{user?.email}</p>
                </div>
                <button onClick={() => {
                  setShowUserMenu(false);
                  navigate('/');
                }}>
                  <i className="fas fa-th-large"></i> Platform chooser
                </button>
                <button onClick={() => {
                  setShowUserMenu(false);
                  navigate('/dashboard/my-drive');
                }}>
                  <i className="fas fa-home"></i> Dashboard
                </button>
                {andaiAssistantUrl && (
                  <button onClick={() => {
                    setShowUserMenu(false);
                    openAndaiAssistant();
                  }}>
                    <i className="fas fa-brain"></i> ANDAI Assistant
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

      <div className="admin-content">
        {/* Sidebar */}
        <aside className="admin-sidebar">
          <nav className="admin-nav">
            <button 
              className={`nav-item ${currentView === 'overview' ? 'active' : ''}`}
              onClick={() => handleViewChange('overview')}
            >
              <i className="fas fa-tachometer-alt"></i>
              <span>Overview</span>
            </button>
            <button 
              className={`nav-item ${currentView === 'organizations' ? 'active' : ''}`}
              onClick={() => handleViewChange('organizations')}
            >
              <i className="fas fa-building"></i>
              <span>Organizations</span>
            </button>
            <button 
              className={`nav-item ${currentView === 'users' ? 'active' : ''}`}
              onClick={() => handleViewChange('users')}
            >
              <i className="fas fa-users"></i>
              <span>Users</span>
            </button>
            <button 
              className={`nav-item ${currentView === 'audit-logs' ? 'active' : ''}`}
              onClick={() => handleViewChange('audit-logs')}
            >
              <i className="fas fa-clipboard-list"></i>
              <span>Audit Logs</span>
            </button>
            <button 
              className={`nav-item ${currentView === 'storage' ? 'active' : ''}`}
              onClick={() => handleViewChange('storage')}
            >
              <i className="fas fa-hdd"></i>
              <span>Storage</span>
            </button>
          </nav>
        </aside>

        {/* Main Content */}
        <main className="admin-main">
          {isLoading ? (
            <div className="loading">
              <i className="fas fa-spinner fa-spin"></i>
              <p>Loading...</p>
            </div>
          ) : (
            <>
              {/* Overview */}
              {currentView === 'overview' && (
                <div className="overview-section">
                  <h2>Platform Overview</h2>
                  {dashboardStats ? (
                    <>
                  <div className="stats-grid">
                    <div className="stat-card">
                      <div className="stat-icon">
                        <i className="fas fa-building"></i>
                      </div>
                      <div className="stat-content">
                            <h3>{dashboardStats.platformStats?.active_organizations || 0}</h3>
                        <p>Active Organizations</p>
                      </div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-icon">
                        <i className="fas fa-users"></i>
                      </div>
                      <div className="stat-content">
                            <h3>{dashboardStats.platformStats?.active_users || 0}</h3>
                        <p>Active Users</p>
                      </div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-icon">
                        <i className="fas fa-file"></i>
                      </div>
                      <div className="stat-content">
                            <h3>{dashboardStats.platformStats?.total_files || 0}</h3>
                        <p>Total Files</p>
                      </div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-icon">
                        <i className="fas fa-hdd"></i>
                      </div>
                      <div className="stat-content">
                            <h3>{dashboardStats.platformStats?.total_storage_used ? Math.round(dashboardStats.platformStats.total_storage_used / 1024 / 1024 / 1024) : 0} GB</h3>
                        <p>Storage Used</p>
                      </div>
                    </div>
                  </div>

                      <div className="stats-grid-secondary">
                        <div className="stat-card">
                          <div className="stat-icon">
                            <i className="fas fa-chart-line"></i>
                          </div>
                          <div className="stat-content">
                            <h3>{dashboardStats.platformStats?.total_storage_quota ? Math.round(dashboardStats.platformStats.total_storage_quota / 1024 / 1024 / 1024) : 0} GB</h3>
                            <p>Total Storage Quota</p>
                          </div>
                        </div>
                        <div className="stat-card">
                          <div className="stat-icon">
                            <i className="fas fa-percentage"></i>
                          </div>
                          <div className="stat-content">
                            <h3>
                              {dashboardStats.platformStats?.total_storage_quota && dashboardStats.platformStats?.total_storage_used
                                ? Math.round((dashboardStats.platformStats.total_storage_used / dashboardStats.platformStats.total_storage_quota) * 100)
                                : 0}%
                            </h3>
                            <p>Storage Usage</p>
                          </div>
                        </div>
                        <div className="stat-card">
                          <div className="stat-icon">
                            <i className="fas fa-folder"></i>
                          </div>
                          <div className="stat-content">
                            <h3>{organizations.length}</h3>
                            <p>Total Organizations</p>
                          </div>
                        </div>
                        <div className="stat-card">
                          <div className="stat-icon">
                            <i className="fas fa-user-friends"></i>
                          </div>
                          <div className="stat-content">
                            <h3>{dashboardStats.platformStats?.active_users || 0}</h3>
                            <p>Total Users</p>
                          </div>
                        </div>
                      </div>

                      {dashboardStats.systemHealth && (
                        <div className="system-health">
                          <h3>System Health</h3>
                          <div className="health-stats">
                            <div className="health-item">
                              <span className="health-label">Active Users (30 days)</span>
                              <span className="health-value">{dashboardStats.systemHealth.active_users_30d || 0}</span>
                            </div>
                            <div className="health-item">
                              <span className="health-label">Files Uploaded (7 days)</span>
                              <span className="health-value">{dashboardStats.systemHealth.files_uploaded_7d || 0}</span>
                            </div>
                            <div className="health-item">
                              <span className="health-label">Total Organizations</span>
                              <span className="health-value">{dashboardStats.systemHealth.total_organizations || 0}</span>
                            </div>
                            <div className="health-item">
                              <span className="health-label">Daily Activity</span>
                              <span className="health-value">{dashboardStats.systemHealth.daily_activity || 0}</span>
                    </div>
                  </div>
                        </div>
                      )}

                      {dashboardStats.topOrganizationsByStorage && dashboardStats.topOrganizationsByStorage.length > 0 && (
                        <div className="top-organizations">
                          <h3>Top Organizations by Storage</h3>
                          <div className="table-container">
                            <table className="data-table">
                              <thead>
                                <tr>
                                  <th>Organization</th>
                                  <th>Storage Used</th>
                                  <th>Storage Quota</th>
                                  <th>Usage %</th>
                                </tr>
                              </thead>
                              <tbody>
                                {dashboardStats.topOrganizationsByStorage.slice(0, 5).map((org: any) => {
                                  // Ensure usage_percentage is a number
                                  let usagePercentage = 0;
                                  if (org.usage_percentage !== null && org.usage_percentage !== undefined) {
                                    usagePercentage = typeof org.usage_percentage === 'number' 
                                      ? org.usage_percentage 
                                      : parseFloat(String(org.usage_percentage)) || 0;
                                  }
                                  // Ensure it's a valid number
                                  if (isNaN(usagePercentage)) {
                                    usagePercentage = 0;
                                  }
                                  return (
                                    <tr key={org.id}>
                                      <td><strong>{org.name}</strong></td>
                                      <td>{Math.round((org.storage_used || 0) / 1024 / 1024)} MB</td>
                                      <td>{Math.round((org.storage_quota || 0) / 1024 / 1024)} MB</td>
                                      <td>
                                        <div className="usage-bar">
                                          <div 
                                            className="usage-fill" 
                                            style={{ width: `${Math.min(usagePercentage, 100)}%` }}
                                          ></div>
                                          <span>{usagePercentage.toFixed(1)}%</span>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="empty-state">
                      <i className="fas fa-chart-line"></i>
                      <p>Loading dashboard statistics...</p>
                    </div>
                  )}
                </div>
              )}

              {/* Organizations */}
              {currentView === 'organizations' && (
                <div className="organizations-section">
                  <div className="section-header">
                    <h2>Organizations & Invitations</h2>
                    <button className="btn-primary" onClick={() => {
                      setShowAddOrgModal(true);
                    }}>
                      <i className="fas fa-plus"></i> Add Organization
                    </button>
                  </div>
                  <div className="table-container">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Members</th>
                          <th>Storage</th>
                          <th>Invitation Code</th>
                          <th>Status</th>
                          <th>Created</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(organizations || []).map((org) => (
                          <tr key={org.id}>
                            <td>
                              <div className="org-info">
                                <strong>{org.name}</strong>
                                {org.description && <p>{org.description}</p>}
                              </div>
                            </td>
                            <td>{org.userCount}</td>
                            <td>
                              <div className="storage-info">
                                <span>{Math.round(org.storageUsed / 1024 / 1024)} MB</span>
                                <div className="storage-bar">
                                  <div 
                                    className="storage-used" 
                                    style={{ 
                                      width: `${(org.storageUsed / org.storageQuota) * 100}%` 
                                    }}
                                  ></div>
                                </div>
                              </div>
                            </td>
                            <td>
                              {org.invitationCode ? (
                                <div className="invitation-cell">
                                  <code className="invitation-code">{org.invitationCode}</code>
                                  {org.invitationExpiresAt && (
                                    <small className="expiry-date">
                                      Expires: {new Date(org.invitationExpiresAt).toLocaleDateString()}
                                    </small>
                                  )}
                                </div>
                              ) : (
                                <button 
                                  className="btn-secondary btn-sm"
                                  onClick={() => handleGenerateInvitationForOrg(org.id)}
                                  title="Generate Invitation Code"
                                >
                                  <i className="fas fa-key"></i> Generate Code
                                </button>
                              )}
                            </td>
                            <td>
                              <span className={`status-badge ${org.status}`}>
                                {org.status}
                              </span>
                            </td>
                            <td>{new Date(org.createdAt).toLocaleDateString()}</td>
                            <td>
                              <div className="action-buttons">
                                <button 
                                  className="btn-secondary btn-sm"
                                  onClick={() => {
                                    setSelectedOrg(org);
                                    setShowEditOrgModal(true);
                                  }}
                                  title="Edit Organization"
                                >
                                  <i className="fas fa-edit"></i>
                                </button>
                              <button 
                                className="btn-danger btn-sm"
                                onClick={() => handleDeleteOrganization(org.id)}
                                  title="Delete Organization"
                              >
                                  <i className="fas fa-trash-alt"></i>
                              </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {(!organizations || organizations.length === 0) && (
                      <div className="empty-state">
                        <i className="fas fa-building"></i>
                        <p>No organizations found</p>
                        <button className="btn-primary" onClick={() => setShowAddOrgModal(true)}>
                          <i className="fas fa-plus"></i> Create First Organization
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Users */}
              {currentView === 'users' && (
                <div className="users-section">
                  <div className="section-header">
                    <h2>Users</h2>
                    <button className="btn-primary" onClick={() => setShowAddUserModal(true)}>
                      <i className="fas fa-plus"></i> Add User
                    </button>
                  </div>
                  
                  {/* User Filters */}
                  <div className="filters-bar">
                    <div className="filter-group">
                      <input
                        type="text"
                        placeholder="Search by name or email..."
                        className="filter-input"
                        value={userFilters.search || ''}
                        onChange={(e) => handleUserFilterChange('search', e.target.value)}
                      />
                    </div>
                    <div className="filter-group">
                      <select
                        className="filter-select"
                        value={userFilters.organizationId || ''}
                        onChange={(e) => handleUserFilterChange('organizationId', e.target.value ? parseInt(e.target.value) : undefined)}
                      >
                        <option value="">All Organizations</option>
                        {(organizations || []).map((org) => (
                          <option key={org.id} value={org.id}>{org.name}</option>
                        ))}
                      </select>
                  </div>
                    <div className="filter-group">
                      <select
                        className="filter-select"
                        value={userFilters.role || ''}
                        onChange={(e) => handleUserFilterChange('role', e.target.value || undefined)}
                      >
                        <option value="">All Roles</option>
                        <option value="platform_owner">Platform Owner</option>
                        <option value="organization_admin">Organization Admin</option>
                        <option value="member">Member</option>
                      </select>
                </div>
                    <div className="filter-group">
                      <select
                        className="filter-select"
                        value={userFilters.status || ''}
                        onChange={(e) => handleUserFilterChange('status', e.target.value || undefined)}
                      >
                        <option value="">All Status</option>
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                        <option value="suspended">Suspended</option>
                      </select>
                    </div>
                    {(userFilters.search || userFilters.organizationId || userFilters.role || userFilters.status) && (
                      <button 
                        className="btn-secondary btn-sm"
                        onClick={handleClearUserFilters}
                        title="Clear Filters"
                      >
                        <i className="fas fa-times"></i> Clear
                    </button>
                    )}
                  </div>
                  
                  <div className="table-container">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Email</th>
                          <th>Organization</th>
                          <th>Role</th>
                          <th>Status</th>
                          <th>Last Login</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(users || []).map((u) => (
                          <tr key={u.id}>
                            <td>{u.firstName} {u.lastName}</td>
                            <td>{u.email}</td>
                            <td>{u.organizationName}</td>
                            <td>
                              <span className={`role-badge ${u.role}`}>
                                {u.role.replace('_', ' ')}
                              </span>
                            </td>
                            <td>
                              <span className={`status-badge ${u.status}`}>
                                {u.status}
                              </span>
                            </td>
                            <td>{u.lastLogin ? new Date(u.lastLogin).toLocaleDateString() : 'Never'}</td>
                            <td>
                              <div className="action-buttons">
                                <button 
                                  className="btn-secondary btn-sm"
                                  onClick={() => {
                                    setSelectedUser(u);
                                    setShowEditUserModal(true);
                                  }}
                                  title="Edit User"
                                >
                                  <i className="fas fa-edit"></i>
                                </button>
                              <button 
                                className="btn-danger btn-sm"
                                  onClick={() => handleDeleteUser(u.id)}
                                  title="Delete User"
                                  disabled={u.id === user?.id}
                              >
                                  <i className="fas fa-trash-alt"></i>
                              </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {(!users || users.length === 0) && (
                      <div className="empty-state">
                        <i className="fas fa-users"></i>
                        <p>No users found</p>
                      </div>
                    )}
                  </div>
                </div>
              )}


              {/* Audit Logs */}
              {currentView === 'audit-logs' && (
                <div className="audit-logs-section">
                  <div className="section-header">
                    <h2>Audit Logs</h2>
                    <button className="btn-secondary" onClick={handleExportAuditLogs}>
                      <i className="fas fa-download"></i> Export
                    </button>
                  </div>
                  <div className="table-container">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>User</th>
                          <th>Action</th>
                          <th>Resource</th>
                          <th>Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(auditLogs || []).map((log) => (
                          <tr key={log.id}>
                            <td>{auditService.formatDate(log.created_at)}</td>
                            <td>{log.first_name} {log.last_name}</td>
                            <td>
                              <span className="action-badge">
                                <i className={auditService.getActionIcon(log.action)}></i>
                                {auditService.formatAction(log.action)}
                              </span>
                            </td>
                            <td>{auditService.formatResourceType(log.resource_type)}</td>
                            <td style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxWidth: '300px' }}>
                              {formatAuditDetails(log.details)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {(!auditLogs || auditLogs.length === 0) && (
                      <div className="empty-state">
                        <i className="fas fa-clipboard-list"></i>
                        <p>No audit logs found</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Storage Analytics */}
              {currentView === 'storage' && (
                <div className="storage-section">
                  <h2>Storage Analytics</h2>
                  {storageAnalytics ? (
                    <>
                  <div className="storage-overview">
                    <div className="storage-stats">
                      <div className="stat-item">
                            <h3>{storageAnalytics.overview?.total_organizations || 0}</h3>
                        <p>Total Organizations</p>
                      </div>
                      <div className="stat-item">
                            <h3>{storageAnalytics.overview?.total_used_bytes ? Math.round(storageAnalytics.overview.total_used_bytes / 1024 / 1024 / 1024) : 0} GB</h3>
                        <p>Total Storage Used</p>
                      </div>
                      <div className="stat-item">
                            <h3>{storageAnalytics.overview?.total_quota_bytes ? Math.round(storageAnalytics.overview.total_quota_bytes / 1024 / 1024 / 1024) : 0} GB</h3>
                            <p>Total Storage Quota</p>
                          </div>
                          <div className="stat-item">
                            <h3>{(() => {
                              const usage = storageAnalytics.overview?.usage_percentage;
                              if (usage === null || usage === undefined) return '0';
                              const numUsage = typeof usage === 'number' ? usage : parseFloat(String(usage)) || 0;
                              return isNaN(numUsage) ? '0' : numUsage.toFixed(1);
                            })()}%</h3>
                        <p>Usage Percentage</p>
                      </div>
                    </div>
                      </div>

                      {storageAnalytics.byOrganization && storageAnalytics.byOrganization.length > 0 && (
                        <div className="storage-by-org">
                          <h3>Storage by Organization</h3>
                          <div className="table-container">
                            <table className="data-table">
                              <thead>
                                <tr>
                                  <th>Organization</th>
                                  <th>Storage Used</th>
                                  <th>Storage Quota</th>
                                  <th>Usage %</th>
                                  <th>File Count</th>
                                </tr>
                              </thead>
                              <tbody>
                                {storageAnalytics.byOrganization.map((org) => {
                                  // Ensure usage_percentage is a number
                                  let usagePercentage = 0;
                                  if (org.usage_percentage !== null && org.usage_percentage !== undefined) {
                                    usagePercentage = typeof org.usage_percentage === 'number' 
                                      ? org.usage_percentage 
                                      : parseFloat(String(org.usage_percentage)) || 0;
                                  }
                                  if (isNaN(usagePercentage)) {
                                    usagePercentage = 0;
                                  }
                                  return (
                                    <tr key={org.id}>
                                      <td><strong>{org.name}</strong></td>
                                      <td>{Math.round((org.used_bytes || 0) / 1024 / 1024)} MB</td>
                                      <td>{Math.round((org.storage_quota || 0) / 1024 / 1024)} MB</td>
                                      <td>
                                        <div className="usage-bar">
                                          <div 
                                            className="usage-fill" 
                                            style={{ width: `${Math.min(usagePercentage, 100)}%` }}
                                          ></div>
                                          <span>{usagePercentage.toFixed(1)}%</span>
                                        </div>
                                      </td>
                                      <td>{org.file_count || 0}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {storageAnalytics.byFileType && storageAnalytics.byFileType.length > 0 && (
                        <div className="storage-by-type">
                          <h3>Storage by File Type</h3>
                          <div className="table-container">
                            <table className="data-table">
                              <thead>
                                <tr>
                                  <th>File Type</th>
                                  <th>File Count</th>
                                  <th>Total Size</th>
                                  <th>Average Size</th>
                                </tr>
                              </thead>
                              <tbody>
                                {storageAnalytics.byFileType.map((type, index) => (
                                  <tr key={index}>
                                    <td><strong>{type.type || 'Unknown'}</strong></td>
                                    <td>{type.file_count || 0}</td>
                                    <td>{Math.round((type.total_size || 0) / 1024 / 1024)} MB</td>
                                    <td>{Math.round((type.avg_size || 0) / 1024)} KB</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                  </div>
                </div>
              )}
                    </>
                  ) : (
                    <div className="empty-state">
                      <i className="fas fa-hdd"></i>
                      <p>Loading storage analytics...</p>
                    </div>
                  )}
                </div>
              )}

            </>
          )}
        </main>
      </div>

      {/* Add User Modal */}
      {showAddUserModal && (
        <div className="modal-overlay" onClick={(e) => {
          if (e.target === e.currentTarget) {
            setShowAddUserModal(false);
          }
        }}>
          <div className="modal modal-large">
            <div className="modal-header">
              <h3>Add User</h3>
              <button onClick={() => setShowAddUserModal(false)}>
                <i className="fas fa-times"></i>
              </button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="user-first-name">First Name *</label>
                  <input type="text" id="user-first-name" required />
                </div>
                <div className="form-group">
                  <label htmlFor="user-last-name">Last Name *</label>
                  <input type="text" id="user-last-name" required />
                </div>
              </div>
              <div className="form-group">
                <label htmlFor="user-email">Email *</label>
                <input type="email" id="user-email" required />
              </div>
              <div className="form-group">
                <label htmlFor="user-password">Password *</label>
                <input type="password" id="user-password" required />
                <small className="form-help">Password can be any length</small>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="user-organization">Organization *</label>
                  <select id="user-organization" required>
                    <option value="">Select Organization</option>
                    {(organizations || []).map((org) => (
                      <option key={org.id} value={org.id}>{org.name}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="user-role">Role</label>
                  <select id="user-role">
                    <option value="member">Member</option>
                    <option value="organization_admin">Organization Admin</option>
                    <option value="platform_owner">Platform Owner</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label htmlFor="user-status">Status</label>
                <select id="user-status">
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="suspended">Suspended</option>
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowAddUserModal(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={handleCreateUser}>
                <i className="fas fa-plus"></i> Create User
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {showEditUserModal && selectedUser && (
        <div className="modal-overlay" onClick={(e) => {
          if (e.target === e.currentTarget) {
            setShowEditUserModal(false);
            setSelectedUser(null);
          }
        }}>
          <div className="modal modal-large">
            <div className="modal-header">
              <h3>Edit User</h3>
              <button onClick={() => {
                setShowEditUserModal(false);
                setSelectedUser(null);
              }}>
                <i className="fas fa-times"></i>
              </button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="edit-user-first-name">First Name *</label>
                  <input type="text" id="edit-user-first-name" defaultValue={selectedUser.firstName} required />
                </div>
                <div className="form-group">
                  <label htmlFor="edit-user-last-name">Last Name *</label>
                  <input type="text" id="edit-user-last-name" defaultValue={selectedUser.lastName} required />
                </div>
              </div>
              <div className="form-group">
                <label htmlFor="edit-user-email">Email *</label>
                <input type="email" id="edit-user-email" defaultValue={selectedUser.email} required />
              </div>
              {isOwner && (
                <div className="form-group">
                  <label htmlFor="edit-user-organization">Organization</label>
                  <select id="edit-user-organization" defaultValue={selectedUser.organizationId}>
                    {(organizations || []).map((org) => (
                      <option key={org.id} value={org.id}>{org.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="edit-user-role">Role</label>
                  <select id="edit-user-role" defaultValue={selectedUser.role}>
                    <option value="member">Member</option>
                    <option value="organization_admin">Organization Admin</option>
                    {isOwner && <option value="platform_owner">Platform Owner</option>}
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="edit-user-status">Status</label>
                  <select id="edit-user-status" defaultValue={selectedUser.status}>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => {
                setShowEditUserModal(false);
                setSelectedUser(null);
              }}>
                Cancel
              </button>
              <button className="btn-primary" onClick={handleUpdateUser}>
                <i className="fas fa-save"></i> Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Organization Modal */}
      {showAddOrgModal && (
        <div className="modal-overlay" onClick={(e) => {
          if (e.target === e.currentTarget) {
            setShowAddOrgModal(false);
          }
        }}>
          <div className="modal modal-large">
            <div className="modal-header">
              <h3>Add Organization</h3>
              <button onClick={() => setShowAddOrgModal(false)}>
                <i className="fas fa-times"></i>
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label htmlFor="org-name">Organization Name *</label>
                <input type="text" id="org-name" required />
              </div>
              <div className="form-group">
                <label htmlFor="org-description">Description</label>
                <textarea id="org-description" rows={4}></textarea>
              </div>
              <div className="form-group">
                <label htmlFor="storage-quota">Storage Quota (GB) *</label>
                <input type="number" id="storage-quota" defaultValue="5" min="1" step="0.1" />
                <small className="form-help">Enter storage quota in GB (1 GB = 1,073,741,824 bytes)</small>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowAddOrgModal(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={handleCreateOrganization}>
                Create Organization
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Organization Modal */}
      {showEditOrgModal && selectedOrg && (
        <div className="modal-overlay" onClick={(e) => {
          if (e.target === e.currentTarget) {
            setShowEditOrgModal(false);
            setSelectedOrg(null);
          }
        }}>
          <div className="modal modal-large">
            <div className="modal-header">
              <h3>Edit Organization</h3>
              <button onClick={() => {
                setShowEditOrgModal(false);
                setSelectedOrg(null);
              }}>
                <i className="fas fa-times"></i>
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label htmlFor="edit-org-name">Organization Name *</label>
                <input type="text" id="edit-org-name" defaultValue={selectedOrg.name} required />
              </div>
              <div className="form-group">
                <label htmlFor="edit-org-description">Description</label>
                <textarea id="edit-org-description" rows={4} defaultValue={selectedOrg.description || ''}></textarea>
              </div>
              <div className="form-group">
                <label htmlFor="edit-storage-quota">Storage Quota (GB) *</label>
                <input 
                  type="number" 
                  id="edit-storage-quota" 
                  defaultValue={Math.round((selectedOrg.storageQuota || 0) / 1024 / 1024 / 1024 * 10) / 10} 
                  min="1" 
                  step="0.1" 
                />
                <small className="form-help">
                  Current: {Math.round((selectedOrg.storageUsed || 0) / 1024 / 1024)} MB used of {Math.round((selectedOrg.storageQuota || 0) / 1024 / 1024)} MB ({Math.round((selectedOrg.storageUsed / selectedOrg.storageQuota) * 100)}%)
                </small>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => {
                setShowEditOrgModal(false);
                setSelectedOrg(null);
              }}>
                Cancel
              </button>
              <button className="btn-primary" onClick={handleUpdateOrganization}>
                <i className="fas fa-save"></i> Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default AdminPanel;
