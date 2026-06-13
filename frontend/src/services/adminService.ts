import { apiService, ApiResponse, PaginationResponse } from './api';

// Types
export interface DashboardStats {
  platformStats: {
    active_organizations: number;
    active_users: number;
    total_files: number;
    total_storage_used: number;
    total_storage_quota: number;
  };
  recentActivity: Array<{
    action: string;
    count: number;
    date: string;
  }>;
  userRegistrations: Array<{
    date: string;
    count: number;
  }>;
  organizationCreations: Array<{
    date: string;
    count: number;
  }>;
  topOrganizationsByStorage: Array<{
    name: string;
    id: number;
    storage_used: number;
    storage_quota: number;
    usage_percentage: number;
  }>;
  systemHealth: {
    active_users_30d: number;
    files_uploaded_7d: number;
    total_organizations: number;
    daily_activity: number;
  };
}

export interface ActivityItem {
  id: number;
  created_at: string;
  action: string;
  resource_type: string;
  resource_id: number;
  details: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  role?: string;
  organization_name?: string;
}

export interface ActivityFilters {
  action?: string;
  userId?: number;
  organizationId?: number;
}

export interface Invitation {
  id: number;
  code: string;
  organization_id: number;
  role: string;
  expires_at: string;
  generated_by: number;
  status: string;
  max_uses: number;
  use_count: number;
  created_at: string;
  organization_name?: string;
  first_name?: string;
  last_name?: string;
}

export interface InvitationCreateRequest {
  organizationId: number;
  role: string;
  expiresInDays?: number;
  maxUses?: number;
}

export interface InvitationFilters {
  search?: string;
  organizationId?: number;
  status?: string;
}

export interface StorageAnalytics {
  overview: {
    total_organizations: number;
    total_quota_mb: number;
    total_quota_bytes: number;
    total_used_bytes: number;
    usage_percentage: number;
  };
  byOrganization: Array<{
    name: string;
    id: number;
    storage_quota: number;
    used_bytes: number;
    usage_percentage: number;
    file_count: number;
  }>;
  byFileType: Array<{
    type: string;
    file_count: number;
    total_size: number;
    avg_size: number;
  }>;
  trends: Array<{
    date: string;
    files_uploaded: number;
    daily_storage_added: number;
  }>;
}

export interface SystemSettings {
  maxFileSize: number;
  allowedFileTypes: string[];
  defaultStorageQuota: number;
  sessionTimeout: string;
  registrationEnabled: boolean;
  invitationRequired: boolean;
}

export interface SystemSettingsUpdate {
  maxFileSize?: number;
  allowedFileTypes?: string[];
  defaultStorageQuota?: number;
  sessionTimeout?: string;
  registrationEnabled?: boolean;
  invitationRequired?: boolean;
}

export interface OrganizationStats {
  organizationStats: {
    active_users: number;
    total_files: number;
    total_storage_used: number;
    storage_quota: number;
    organization_name: string;
    usage_percentage: number;
  };
  recentActivity: Array<{
    action: string;
    count: number;
    date: string;
  }>;
  userRegistrations: Array<{
    date: string;
    count: number;
  }>;
  systemHealth: {
    active_users_30d: number;
    files_uploaded_7d: number;
    daily_activity: number;
  };
}

export interface OrganizationStorageAnalytics {
  overview: {
    organization_id: number;
    organization_name: string;
    total_quota_bytes: number;
    total_used_bytes: number;
    usage_percentage: number;
  };
  byFileType: Array<{
    type: string;
    file_count: number;
    total_size: number;
    avg_size: number;
  }>;
  trends: Array<{
    date: string;
    files_uploaded: number;
    daily_storage_added: number;
  }>;
}

// Admin Service
export const adminService = {
  // Get dashboard statistics
  getDashboardStats: async (): Promise<ApiResponse<DashboardStats>> => {
    return apiService.get<DashboardStats>('/admin/dashboard/stats');
  },

  // Get activity timeline
  getActivityTimeline: async (
    page: number = 1,
    limit: number = 20,
    filters?: ActivityFilters
  ): Promise<ApiResponse<PaginationResponse<ActivityItem>>> => {
    const params = {
      page,
      limit,
      ...filters,
    };
    return apiService.get<PaginationResponse<ActivityItem>>('/admin/activity/timeline', params);
  },

  // Generate invitation code
  generateInvitation: async (invitationData: InvitationCreateRequest): Promise<ApiResponse<{
    invitationId: number;
    code: string;
    organizationId: number;
    organizationName: string;
    role: string;
    expiresAt: string;
  }>> => {
    return apiService.post<{
      invitationId: number;
      code: string;
      organizationId: number;
      organizationName: string;
      role: string;
      expiresAt: string;
    }>('/admin/invitations/generate', invitationData);
  },

  // Get all invitations
  getInvitations: async (
    page: number = 1,
    limit: number = 10,
    filters?: InvitationFilters
  ): Promise<ApiResponse<PaginationResponse<Invitation>>> => {
    const params = {
      page,
      limit,
      ...filters,
    };
    return apiService.get<PaginationResponse<Invitation>>('/admin/invitations', params);
  },

  // Delete invitation (by organizationId)
  deleteInvitation: async (organizationId: number): Promise<ApiResponse<void>> => {
    return apiService.delete<void>(`/admin/invitations/${organizationId}`);
  },

  // Get storage analytics
  getStorageAnalytics: async (): Promise<ApiResponse<StorageAnalytics>> => {
    return apiService.get<StorageAnalytics>('/admin/storage/analytics');
  },

  // Get system settings
  getSystemSettings: async (): Promise<ApiResponse<SystemSettings>> => {
    return apiService.get<SystemSettings>('/admin/settings');
  },

  // Update system settings
  updateSystemSettings: async (settings: SystemSettingsUpdate): Promise<ApiResponse<void>> => {
    return apiService.put<void>('/admin/settings', settings);
  },

  // ============================================
  // ORGANIZATION ADMIN METHODS
  // ============================================

  // Get organization dashboard statistics
  getOrganizationStats: async (): Promise<ApiResponse<OrganizationStats>> => {
    return apiService.get<OrganizationStats>('/admin/organization/stats');
  },

  // Get organization storage analytics
  getOrganizationStorage: async (): Promise<ApiResponse<OrganizationStorageAnalytics>> => {
    return apiService.get<OrganizationStorageAnalytics>('/admin/organization/storage');
  },
};
