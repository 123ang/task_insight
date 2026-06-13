import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { authService, User } from '../services/authService';
import toast from 'react-hot-toast';
import { clientLogger } from '../utils/logger';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string, adminLogin?: boolean) => Promise<boolean>;
  register: (userData: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    organizationId?: number;
    invitationCode?: string;
  }) => Promise<boolean>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<boolean>;
  updateUser: (userData: Partial<User>) => void;
  hasRole: (role: string) => boolean;
  isPlatformOwner: () => boolean;
  isOrganizationAdmin: () => boolean;
  isMember: () => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const applySession = (nextToken: string, nextUser: User) => {
    authService.setAuthData(nextToken, nextUser);
    setToken(nextToken);
    setUser(nextUser);
  };

  const clearSession = () => {
    authService.clearAuthData();
    setToken(null);
    setUser(null);
  };

  useEffect(() => {
    const initializeAuth = async () => {
      try {
        const inMemorySession = authService.getAuthData();
        if (inMemorySession.token && inMemorySession.user) {
          applySession(inMemorySession.token, inMemorySession.user);
          return;
        }

        if (window.location.pathname.includes('/login')) {
          clearSession();
          return;
        }

        const response = await authService.refreshToken();
        if (response.success && response.data) {
          applySession(response.data.token, response.data.user);
        } else {
          clearSession();
        }
      } catch (error) {
        clientLogger.debug('No active browser session to restore');
        clearSession();
      } finally {
        setIsLoading(false);
      }
    };

    const handleExpiredSession = () => clearSession();
    window.addEventListener('dms:auth-expired', handleExpiredSession);
    initializeAuth();

    return () => window.removeEventListener('dms:auth-expired', handleExpiredSession);
  }, []);

  const login = async (
    email: string,
    password: string,
    adminLogin = false
  ): Promise<boolean> => {
    try {
      setIsLoading(true);
      const response = await authService.login({ email, password, adminLogin });

      if (response.success && response.data) {
        applySession(response.data.token, response.data.user);
        toast.success('Login successful!');
        return true;
      }

      if (response.message) toast.error(response.message);
      return false;
    } catch (error: any) {
      const data = error?.response?.data;
      const validationMsg = data?.errors?.[0]?.msg || data?.errors?.[0]?.message;
      const serverMsg = data?.message;
      const fallback = error?.message === 'Network Error'
        ? 'Cannot reach server. Check your connection or try again.'
        : (error?.message || 'Login failed. Please check your credentials.');
      toast.error(validationMsg || serverMsg || fallback);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (userData: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    organizationId?: number;
    invitationCode?: string;
  }): Promise<boolean> => {
    try {
      setIsLoading(true);
      const response = await authService.register(userData);
      if (response.success) {
        toast.success('Registration successful! Please login.');
        return true;
      }

      toast.error(response.message || 'Registration failed');
      return false;
    } catch (error: any) {
      const data = error?.response?.data;
      const validationMsg = data?.errors?.[0]?.msg || data?.errors?.[0]?.message;
      const serverMsg = data?.message;
      const fallback = error?.message === 'Network Error'
        ? 'Cannot reach server. Check your connection or try again.'
        : (error?.message || 'Registration failed. Please check your input.');
      toast.error(validationMsg || serverMsg || fallback);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async (): Promise<void> => {
    try {
      await authService.logout();
    } catch (error) {
      clientLogger.warn('Server logout failed; clearing the local session');
    } finally {
      clearSession();
      toast.success('Logged out successfully');
    }
  };

  const refreshToken = async (): Promise<boolean> => {
    try {
      const response = await authService.refreshToken();
      if (response.success && response.data) {
        applySession(response.data.token, response.data.user);
        return true;
      }
    } catch (error) {
      clientLogger.debug('Session refresh failed');
    }

    clearSession();
    return false;
  };

  const updateUser = (userData: Partial<User>): void => {
    if (!user || !token) return;
    applySession(token, { ...user, ...userData });
  };

  const hasRole = (role: string): boolean => user?.role === role;
  const isPlatformOwner = (): boolean => hasRole('platform_owner');
  const isOrganizationAdmin = (): boolean => hasRole('organization_admin');
  const isMember = (): boolean => hasRole('member');

  return (
    <AuthContext.Provider value={{
      user,
      token,
      isAuthenticated: !!token && !!user,
      isLoading,
      login,
      register,
      logout,
      refreshToken,
      updateUser,
      hasRole,
      isPlatformOwner,
      isOrganizationAdmin,
      isMember,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export default AuthContext;
