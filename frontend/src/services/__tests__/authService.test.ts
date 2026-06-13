import { authService } from '../authService';
import { apiService, getAccessToken, setAccessToken } from '../api';

// Mock the apiService
jest.mock('../api', () => ({
  apiService: {
    post: jest.fn(),
    get: jest.fn(),
  },
  getAccessToken: jest.fn(),
  setAccessToken: jest.fn(),
}));

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

describe('authService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorageMock.clear();
    (getAccessToken as jest.Mock).mockReturnValue(null);
    authService.clearAuthData();
    jest.clearAllMocks();
  });

  describe('login', () => {
    it('logs in successfully and stores auth data', async () => {
      const mockResponse = {
        success: true,
        data: {
          token: 'test-token',
          refreshToken: 'test-refresh-token',
          user: {
            id: 1,
            email: 'test@example.com',
            firstName: 'John',
            lastName: 'Doe',
            role: 'member',
          },
        },
      };

      (apiService.post as jest.Mock).mockResolvedValue(mockResponse);

      const credentials = {
        email: 'test@example.com',
        password: 'password123',
      };

      const result = await authService.login(credentials);

      expect(apiService.post).toHaveBeenCalledWith('/auth/login', credentials);
      expect(result).toEqual(mockResponse);
      expect(localStorageMock.getItem('token')).toBeNull();
      expect(localStorageMock.getItem('refreshToken')).toBeNull();
      expect(localStorageMock.getItem('user')).toBeNull();
    });

    it('handles admin login flag', async () => {
      const mockResponse = {
        success: true,
        data: {
          token: 'test-token',
          refreshToken: 'test-refresh-token',
          user: {
            id: 1,
            email: 'test@example.com',
            firstName: 'John',
            lastName: 'Doe',
            role: 'member',
          },
        },
      };

      (apiService.post as jest.Mock).mockResolvedValue(mockResponse);

      const credentials = {
        email: 'test@example.com',
        password: 'password123',
        adminLogin: true,
      };

      await authService.login(credentials);

      expect(apiService.post).toHaveBeenCalledWith('/auth/login', credentials);
    });
  });

  describe('register', () => {
    it('registers a new user successfully', async () => {
      const mockResponse = {
        success: true,
        data: {
          userId: 1,
          email: 'john@example.com',
          firstName: 'John',
          lastName: 'Doe',
        },
      };

      (apiService.post as jest.Mock).mockResolvedValue(mockResponse);

      const userData = {
        invitationCode: 'INVITE123',
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
        password: 'password123',
      };

      const result = await authService.register(userData);

      expect(apiService.post).toHaveBeenCalledWith('/auth/register', userData);
      expect(result).toEqual(mockResponse);
    });
  });

  describe('logout', () => {
    it('clears auth data on logout', async () => {
      // Set up auth data
      localStorageMock.setItem('token', 'test-token');
      localStorageMock.setItem('refreshToken', 'test-refresh-token');
      localStorageMock.setItem('user', JSON.stringify({ id: 1, email: 'test@example.com' }));

      (apiService.post as jest.Mock).mockResolvedValue({ success: true });

      await authService.logout();

      expect(apiService.post).toHaveBeenCalledWith('/auth/logout');
      expect(localStorageMock.getItem('token')).toBe('test-token');
      expect(localStorageMock.getItem('refreshToken')).toBe('test-refresh-token');
      expect(localStorageMock.getItem('user')).toBe(JSON.stringify({ id: 1, email: 'test@example.com' }));
    });
  });

  describe('verifyToken', () => {
    it('verifies a valid token', async () => {
      const mockResponse = {
        success: true,
        data: {
          user: {
            id: 1,
            email: 'test@example.com',
            firstName: 'John',
            lastName: 'Doe',
            role: 'member',
          },
        },
      };

      (apiService.get as jest.Mock).mockResolvedValue(mockResponse);

      const result = await authService.verifyToken();

      expect(apiService.get).toHaveBeenCalledWith('/auth/verify');
      expect(result).toEqual(mockResponse);
    });
  });

  describe('refreshToken', () => {
    it('refreshes the access token', async () => {
      localStorageMock.setItem('refreshToken', 'old-refresh-token');

      const mockResponse = {
        success: true,
        data: {
          token: 'new-token',
          refreshToken: 'new-refresh-token',
        },
      };

      (apiService.post as jest.Mock).mockResolvedValue(mockResponse);

      const result = await authService.refreshToken('old-refresh-token');

      expect(apiService.post).toHaveBeenCalledWith('/auth/refresh');
      expect(result).toEqual(mockResponse);
      expect(localStorageMock.getItem('token')).toBeNull();
      expect(localStorageMock.getItem('refreshToken')).toBe('old-refresh-token');
    });
  });

  describe('getAuthData', () => {
    it('retrieves in-memory auth data without exposing a refresh token', () => {
      const user = {
        id: 1,
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        role: 'member',
        status: 'active',
      };
      (getAccessToken as jest.Mock).mockReturnValue('test-token');
      authService.setAuthData('test-token', user);

      const authData = authService.getAuthData();

      expect(authData.token).toBe('test-token');
      expect(authData.refreshToken).toBeNull();
      expect(authData.user).toEqual(user);
      expect(setAccessToken).toHaveBeenCalledWith('test-token');
    });

    it('returns null values when no auth data is stored', () => {
      const authData = authService.getAuthData();

      expect(authData.token).toBeNull();
      expect(authData.refreshToken).toBeNull();
      expect(authData.user).toBeNull();
    });
  });

  describe('clearAuthData', () => {
    it('clears all in-memory auth data', () => {
      authService.setAuthData('test-token', {
        id: 1,
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        role: 'member',
        status: 'active',
      });

      authService.clearAuthData();

      expect(setAccessToken).toHaveBeenLastCalledWith(null);
      expect(localStorageMock.getItem('token')).toBeNull();
      expect(localStorageMock.getItem('refreshToken')).toBeNull();
      expect(localStorageMock.getItem('user')).toBeNull();
    });
  });
});
