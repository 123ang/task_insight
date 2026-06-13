import {
  apiService,
  ApiResponse,
  getAccessToken,
  setAccessToken,
} from './api';

export interface User {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  organizationId?: number;
  organizationName?: string;
  status: string;
  lastLogin?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
  adminLogin?: boolean;
}

export interface LoginResponse {
  token: string;
  user: User;
}

export interface RegisterRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  organizationId?: number;
  invitationCode?: string;
}

export interface RegisterResponse {
  userId: number;
  email: string;
  firstName: string;
  lastName: string;
}

export interface RefreshTokenResponse {
  token: string;
  user: User;
}

let currentUser: User | null = null;

export const authService = {
  login: async (credentials: LoginRequest): Promise<ApiResponse<LoginResponse>> => {
    return apiService.post<LoginResponse>('/auth/login', credentials);
  },

  register: async (userData: RegisterRequest): Promise<ApiResponse<RegisterResponse>> => {
    return apiService.post<RegisterResponse>('/auth/register', userData);
  },

  refreshToken: async (_legacyRefreshToken?: string): Promise<ApiResponse<RefreshTokenResponse>> => {
    return apiService.post<RefreshTokenResponse>('/auth/refresh');
  },

  logout: async (): Promise<ApiResponse<void>> => {
    return apiService.post<void>('/auth/logout');
  },

  getProfile: async (): Promise<ApiResponse<User>> => {
    return apiService.get<User>('/auth/profile');
  },

  verifyToken: async (): Promise<ApiResponse<{ user: User }>> => {
    return apiService.get<{ user: User }>('/auth/verify');
  },

  // Authentication state is intentionally memory-only. The browser keeps only
  // the rotating HttpOnly refresh cookie, which JavaScript cannot read.
  setAuthData: (token: string, user: User) => {
    setAccessToken(token);
    currentUser = user;
  },

  getAuthData: (): { token: string | null; user: User | null; refreshToken: null } => ({
    token: getAccessToken(),
    user: currentUser,
    refreshToken: null,
  }),

  clearAuthData: () => {
    setAccessToken(null);
    currentUser = null;
  },

  isAuthenticated: (): boolean => !!getAccessToken() && !!currentUser,

  hasRole: (role: string): boolean => currentUser?.role === role,

  isPlatformOwner: (): boolean => currentUser?.role === 'platform_owner',

  isOrganizationAdmin: (): boolean => currentUser?.role === 'organization_admin',

  isMember: (): boolean => currentUser?.role === 'member',
};
