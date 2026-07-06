import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { adminService, OrganizationStats, OrganizationStorageAnalytics } from '../services/adminService';
import { userService } from '../services/userService';
import { User } from '../services/authService';
import { auditService, AuditLog } from '../services/auditService';
import { getAndaiAssistantUrl, openAndaiAssistant } from '../utils/platformLinks';
import toast from 'react-hot-toast';
import '../styles/admin.css';

const OrganizationAdminPanel: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ tab?: string }>();
  const { user, logout, isOrganizationAdmin } = useAuth();
  const andaiAssistantUrl = getAndaiAssistantUrl();
  
  // Get current view from URL or default to 'overview'
  const getCurrentView = () => {
    if (params.tab) return params.tab;
    if (location.pathname === '/admin/organization') return 'overview';
    return 'overview';
  };
  
  const [currentView, setCurrentView] = useState(getCurrentView());
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [showEditUserModal, setShowEditUserModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  
  const [isLoading, setIsLoading] = useState(true);
  const [organizationStats, setOrganizationStats] = useState<OrganizationStats | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [storageAnalytics, setStorageAnalytics] = useState<OrganizationStorageAnalytics | null>(null);
  const [hasLoadedInitialData, setHasLoadedInitialData] = useState(false);
  
  // User filters
  const [userFilters, setUserFilters] = useState<{
    search?: string;
    role?: string;
    status?: string;
  }>({});

  // Check if user is organization admin
  const isOrgAdmin = isOrganizationAdmin();

  // Redirect if not organization admin
  useEffect(() => {
    if (!isOrgAdmin) {
      navigate('/dashboard');
    }
  }, [isOrgAdmin, navigate]);

  // Load initial data - run only once
  useEffect(() => {
    if (isOrgAdmin && !hasLoadedInitialData &&
        process.env.REACT_APP_OFFLINE_MODE !== 'true' && 
        process.env.REACT_APP_DISABLE_API_CALLS !== 'true') {
      setHasLoadedInitialData(true);
      loadDashboardData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOrgAdmin, hasLoadedInitialData]);

  const loadDashboardData = async () => {
    setIsLoading(true);
    try {
      const [statsRes, usersRes, storageRes] = await Promise.all([
        adminService.getOrganizationStats(),
        userService.getUsers(1, 100, { organizationId: user?.organizationId }),
        adminService.getOrganizationStorage(),
      ]);

      // Handle organization stats
      if (statsRes.success && statsRes.data) {
        setOrganizationStats(statsRes.data);
      } else {
        console.error('Organization stats error:', statsRes);
      }

      // Handle users
      if (usersRes.success && usersRes.data) {
        const usersData = usersRes.data.data || [];
        setUsers(Array.isArray(usersData) ? usersData : []);
      } else {
        console.error('Users error:', usersRes);
        setUsers([]);
      }

      // Handle storage analytics
      if (storageRes.success && storageRes.data) {
        setStorageAnalytics(storageRes.data);
      } else {
        console.error('Storage analytics error:', storageRes);
      }

      // Load audit logs
      await loadAuditLogs();
    } catch (error) {
      console.error('Error loading dashboard data:', error);
      toast.error('Failed to load dashboard data');
    } finally {
      setIsLoading(false);
    }
  };

  const loadAuditLogs = async () => {
    try {
      const response = await auditService.getAuditLogs(1, 50, {
        organizationId: user?.organizationId
      });
      
      if (response.success && response.data) {
        const logsData = response.data.data || [];
        setAuditLogs(Array.isArray(logsData) ? logsData : []);
      } else {
        setAuditLogs([]);
      }
    } catch (error) {
      console.error('Error loading audit logs:', error);
      setAuditLogs([]);
    }
  };

  const loadUsers = async () => {
    try {
      const response = await userService.getUsers(1, 100, {
        organizationId: user?.organizationId,
        ...userFilters
      });
      
      if (response.success && response.data) {
        const usersData = response.data.data || [];
        setUsers(Array.isArray(usersData) ? usersData : []);
      } else {
        setUsers([]);
      }
    } catch (error) {
      console.error('Error loading users:', error);
      toast.error('Failed to load users');
    }
  };

  // Handle create user
  const handleCreateUser = async () => {
    const email = (document.getElementById('user-email') as HTMLInputElement)?.value;
    const password = (document.getElementById('user-password') as HTMLInputElement)?.value;
    const firstName = (document.getElementById('user-first-name') as HTMLInputElement)?.value;
    const lastName = (document.getElementById('user-last-name') as HTMLInputElement)?.value;
    const role = (document.getElementById('user-role') as HTMLSelectElement)?.value;
    const status = (document.getElementById('user-status') as HTMLSelectElement)?.value;

    if (!email || !password || !firstName || !lastName || !user?.organizationId) {
      toast.error('Please fill in all required fields');
      return;
    }

    try {
      const response = await userService.createUser({
        email,
        password,
        firstName,
        lastName,
        organizationId: user.organizationId,
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
    if (!window.confirm('Are you sure you want to delete this user?')) {
      return;
    }

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
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
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


  if (!isOrgAdmin) {
    return null;
  }

  const handleViewChange = (view: string) => {
    setCurrentView(view);
    if (view === 'overview') {
      navigate('/admin/organization');
    } else {
      navigate(`/admin/organization/${view}`);
    }
  };

  return (
    <div className="admin-panel" style={{ position: 'relative' }}>
      {/* Header */}
      <header className="admin-header">
        <div className="header-left">
          <div className="logo" onClick={() => navigate('/admin/organization')} style={{ cursor: 'pointer' }}>
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
                {andaiAssistantUrl && (
                  <button onClick={() => {
                    setShowUserMenu(false);
                    openAndaiAssistant();
                  }}>
                    <i className="fas fa-brain"></i> ANDAI Assistant
                  </button>
                )}
                <button onClick={() => navigate('/dashboard/my-drive')}>
                  <i className="fas fa-home"></i> Dashboard
                </button>
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
              className={`nav-item ${currentView === 'users' ? 'active' : ''}`}
              onClick={() => handleViewChange('users')}
            >
              <i className="fas fa-users"></i>
              <span>Users</span>
            </button>
            <button 
              className={`nav-item ${currentView === 'storage' ? 'active' : ''}`}
              onClick={() => handleViewChange('storage')}
            >
              <i className="fas fa-hdd"></i>
              <span>Storage</span>
            </button>
            <button 
              className={`nav-item ${currentView === 'audit-logs' ? 'active' : ''}`}
              onClick={() => handleViewChange('audit-logs')}
            >
              <i className="fas fa-clipboard-list"></i>
              <span>Audit Logs</span>
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
            {/* Overview Section */}
            {currentView === 'overview' && organizationStats && (
              <div className="overview-section">
                <h2>Organization Overview</h2>
                {organizationStats ? (
                  <>
                    <div className="stats-grid">
                      <div className="stat-card">
                        <div className="stat-icon">
                          <i className="fas fa-building"></i>
                        </div>
                        <div className="stat-content">
                          <h3>{organizationStats.organizationStats.organization_name || 'N/A'}</h3>
                          <p>Organization Name</p>
                        </div>
                      </div>
                      <div className="stat-card">
                        <div className="stat-icon">
                          <i className="fas fa-users"></i>
                        </div>
                        <div className="stat-content">
                          <h3>{organizationStats.organizationStats.active_users || 0}</h3>
                          <p>Active Users</p>
                        </div>
                      </div>
                      <div className="stat-card">
                        <div className="stat-icon">
                          <i className="fas fa-file"></i>
                        </div>
                        <div className="stat-content">
                          <h3>{organizationStats.organizationStats.total_files || 0}</h3>
                          <p>Total Files</p>
                        </div>
                      </div>
                      <div className="stat-card">
                        <div className="stat-icon">
                          <i className="fas fa-percentage"></i>
                        </div>
                        <div className="stat-content">
                          <h3>{parseFloat(String(organizationStats.organizationStats.usage_percentage || 0)).toFixed(1)}%</h3>
                          <p>Storage Usage</p>
                        </div>
                      </div>
                    </div>

                    <div className="stats-grid-secondary">
                      <div className="stat-card">
                        <div className="stat-icon">
                          <i className="fas fa-hdd"></i>
                        </div>
                        <div className="stat-content">
                          <h3>{formatFileSize(organizationStats.organizationStats.total_storage_used || 0)}</h3>
                          <p>Storage Used</p>
                        </div>
                      </div>
                      <div className="stat-card">
                        <div className="stat-icon">
                          <i className="fas fa-chart-line"></i>
                        </div>
                        <div className="stat-content">
                          <h3>{formatFileSize(organizationStats.organizationStats.storage_quota || 0)}</h3>
                          <p>Storage Quota</p>
                        </div>
                      </div>
                      <div className="stat-card">
                        <div className="stat-icon">
                          <i className="fas fa-folder"></i>
                        </div>
                        <div className="stat-content">
                          <h3>{formatFileSize((organizationStats.organizationStats.storage_quota || 0) - (organizationStats.organizationStats.total_storage_used || 0))}</h3>
                          <p>Storage Available</p>
                        </div>
                      </div>
                      <div className="stat-card">
                        <div className="stat-icon">
                          <i className="fas fa-user-friends"></i>
                        </div>
                        <div className="stat-content">
                          <h3>{organizationStats.systemHealth?.active_users_30d || 0}</h3>
                          <p>Active Users (30 days)</p>
                        </div>
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            )}

            {/* Users Section */}
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
                      onChange={(e) => {
                        setUserFilters({ ...userFilters, search: e.target.value });
                        loadUsers();
                      }}
                    />
                  </div>
                  <div className="filter-group">
                    <select
                      className="filter-select"
                      value={userFilters.role || ''}
                      onChange={(e) => {
                        setUserFilters({ ...userFilters, role: e.target.value || undefined });
                        loadUsers();
                      }}
                    >
                      <option value="">All Roles</option>
                      <option value="organization_admin">Organization Admin</option>
                      <option value="member">Member</option>
                    </select>
                  </div>
                  <div className="filter-group">
                    <select
                      className="filter-select"
                      value={userFilters.status || ''}
                      onChange={(e) => {
                        setUserFilters({ ...userFilters, status: e.target.value || undefined });
                        loadUsers();
                      }}
                    >
                      <option value="">All Status</option>
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                      <option value="suspended">Suspended</option>
                    </select>
                  </div>
                  {(userFilters.search || userFilters.role || userFilters.status) && (
                    <button 
                      className="btn-secondary btn-sm"
                      onClick={() => {
                        setUserFilters({});
                        loadUsers();
                      }}
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

            {/* Storage Section */}
            {currentView === 'storage' && storageAnalytics && (
              <div className="storage-section">
                <div className="section-header">
                  <h2>
                    <i className="fas fa-hdd"></i>
                    Storage Analytics
                  </h2>
                </div>
                
                {/* Storage Overview */}
                <div className="storage-overview-grid">
                  <div className="storage-card">
                    <h3>Storage Usage</h3>
                    <div className="storage-chart">
                      <div
                        className="circular-progress"
                        style={{
                          '--progress': parseFloat(String(storageAnalytics.overview.usage_percentage || 0))
                        } as React.CSSProperties}
                      >
                        <span>{parseFloat(String(storageAnalytics.overview.usage_percentage || 0)).toFixed(1)}%</span>
                      </div>
                    </div>
                    <p className="storage-details">
                      {formatFileSize(storageAnalytics.overview.total_used_bytes)} / {formatFileSize(storageAnalytics.overview.total_quota_bytes)} Used
                    </p>
                  </div>
                </div>

                {/* Storage by File Type */}
                {storageAnalytics.byFileType && storageAnalytics.byFileType.length > 0 && (
                  <div style={{ marginTop: '2rem' }}>
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
                              <td>{type.file_count}</td>
                              <td>{Math.round((type.total_size || 0) / 1024 / 1024)} MB</td>
                              <td>{Math.round((type.avg_size || 0) / 1024)} KB</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Audit Logs Section */}
            {currentView === 'audit-logs' && (
              <div className="audit-logs-section">
                <div className="section-header">
                  <h2>Audit Logs</h2>
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
                          <td>
                            {log.first_name && log.last_name
                              ? `${log.first_name} ${log.last_name}`
                              : log.email || 'Unknown'}
                          </td>
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
          </>
        )}
        </main>
      </div>

      {/* Add User Modal */}
      {showAddUserModal && (
        <div className="modal-overlay" onClick={() => setShowAddUserModal(false)}>
          <div className="modal-content modal-large" onClick={(e) => e.stopPropagation()}>
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
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="user-role">Role *</label>
                  <select id="user-role" required>
                    <option value="member">Member</option>
                    <option value="organization_admin">Organization Admin</option>
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="user-status">Status *</label>
                  <select id="user-status" required>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowAddUserModal(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={handleCreateUser}>
                Create User
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {showEditUserModal && selectedUser && (
        <div className="modal-overlay" onClick={() => {
          setShowEditUserModal(false);
          setSelectedUser(null);
        }}>
          <div className="modal-content modal-large" onClick={(e) => e.stopPropagation()}>
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
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="edit-user-role">Role *</label>
                  <select id="edit-user-role" defaultValue={selectedUser.role} required>
                    <option value="member">Member</option>
                    <option value="organization_admin">Organization Admin</option>
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="edit-user-status">Status *</label>
                  <select id="edit-user-status" defaultValue={selectedUser.status} required>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
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
                Update User
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OrganizationAdminPanel;
