import axios, { AxiosInstance, AxiosResponse, AxiosError } from 'axios';
import toast from 'react-hot-toast';
import { clientLogger } from '../utils/logger';

// API Configuration
const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000/api';
const API_TIMEOUT = parseInt(process.env.REACT_APP_API_TIMEOUT || '30000');
const OFFLINE_MODE = process.env.REACT_APP_OFFLINE_MODE === 'true' || process.env.REACT_APP_DISABLE_API_CALLS === 'true' || false;
let accessToken: string | null = null;
let refreshPromise: Promise<string | null> | null = null;

export const setAccessToken = (token: string | null) => {
  accessToken = token;
};

export const getAccessToken = () => accessToken;

// Create axios instance
const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
  // DO NOT use transformRequest - it interferes with axios's automatic JSON serialization
  // FormData handling is done in the request interceptor instead
});

// Request interceptor to add auth token and handle FormData
api.interceptors.request.use(
  (config) => {
    if (accessToken) {
      config.headers.Authorization = `Bearer ${accessToken}`;
    }
    
    // Handle FormData - delete Content-Type to let browser set it with boundary
    if (config.data instanceof FormData) {
      delete config.headers['Content-Type'];
    }
    
    // Log and validate folder requests for debugging without exposing auth payloads.
    if (config.url?.includes('/folders')) {
      clientLogger.debug('API folder request', {
        url: config.url,
        method: config.method,
        dataType: typeof config.data,
        isObject: typeof config.data === 'object' && config.data !== null,
        isFormData: config.data instanceof FormData,
        contentType: config.headers['Content-Type'],
      });
      
      // Prevent "[object Object]" string from being sent
      if (config.data && typeof config.data === 'string' && config.data === '[object Object]') {
        clientLogger.error('API request data was incorrectly stringified');
        throw new Error('Data was incorrectly converted to "[object Object]" string');
      }
    }
    
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
const refreshAccessToken = async (): Promise<string | null> => {
  if (!refreshPromise) {
    refreshPromise = axios.post(
      `${API_BASE_URL}/auth/refresh`,
      undefined,
      {
        timeout: API_TIMEOUT,
        withCredentials: true,
        headers: { 'Content-Type': 'application/json' },
      }
    ).then((response) => {
      const token = response.data?.data?.token || null;
      setAccessToken(token);
      return token;
    }).catch(() => {
      setAccessToken(null);
      return null;
    }).finally(() => {
      refreshPromise = null;
    });
  }

  return refreshPromise;
};

api.interceptors.response.use(
  (response: AxiosResponse) => {
    return response;
  },
  async (error: AxiosError) => {
    const { response } = error;
    
    if (response) {
      const { status, data } = response;
      const errorMessage = (data as any)?.message || 'An error occurred';
      
      switch (status) {
        case 401:
          const originalRequest = error.config as typeof error.config & { _retry?: boolean };
          const requestUrl = originalRequest?.url || '';
          const isAuthLifecycleRequest = [
            '/auth/login',
            '/auth/register',
            '/auth/refresh',
            '/auth/logout',
          ].some((path) => requestUrl.includes(path));

          if (originalRequest && !originalRequest._retry && !isAuthLifecycleRequest) {
            originalRequest._retry = true;
            const nextToken = await refreshAccessToken();
            if (nextToken) {
              originalRequest.headers.Authorization = `Bearer ${nextToken}`;
              return api(originalRequest);
            }
          }

          setAccessToken(null);
          window.dispatchEvent(new CustomEvent('dms:auth-expired'));
          // Only show toast if not already on login page
          if (!window.location.pathname.includes('/login')) {
            toast.error('Session expired. Please login again.');
            setTimeout(() => {
              window.location.href = '/login';
            }, 100);
          }
          break;
        case 400:
          // Bad Request - show validation errors or error message (skip for auth so AuthContext can show the right message)
          const isAuthRequest = (error.config?.url || '').includes('/auth/login') || (error.config?.url || '').includes('/auth/register');
          if (!isAuthRequest) {
            const validationErrors = (data as any)?.errors;
            if (validationErrors && Array.isArray(validationErrors) && validationErrors.length > 0) {
              validationErrors.forEach((err: any) => {
                toast.error(err.msg || err.message || 'Validation error');
              });
            } else {
              toast.error(errorMessage);
            }
          }
          break;
        case 403:
          toast.error('Access denied. You do not have permission to perform this action.');
          break;
        case 404:
          toast.error('Resource not found.');
          break;
        case 422:
          // Validation errors
          const errors = (data as any)?.errors;
          if (errors && Array.isArray(errors)) {
            errors.forEach((err: any) => {
              toast.error(err.msg || err.message || 'Validation error');
            });
          } else {
            toast.error(errorMessage);
          }
          break;
        case 429:
          toast.error('Too many requests. Please try again later.');
          break;
        case 500:
          // Show backend message when available so users see the real reason (e.g. validation)
          toast.error(errorMessage);
          break;
        default:
          toast.error(errorMessage);
      }
    } else if (error.request) {
      // No response received (backend down, CORS, timeout, or real network failure)
      // Show a clear message so users don't only see the browser's vague "Network Error"
      if (!error.config?.url?.includes('/auth/verify')) {
        toast.error('Cannot reach server. Check your connection or try again later.');
        clientLogger.warn('Request failed without response', { url: error.config?.url });
      }
    } else {
      // Other error
      clientLogger.error('Unexpected API error', error);
    }
    
    return Promise.reject(error);
  }
);

// API Response types
export interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data?: T;
  errors?: any[];
}

export interface PaginationResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export interface FilesPaginationResponse<T> {
  files: T[];  // Files endpoint uses 'files' instead of 'data'
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

// Generic API methods
export const apiService = {
  // GET request
  get: async <T>(url: string, params?: any): Promise<ApiResponse<T>> => {
    if (OFFLINE_MODE) {
      clientLogger.warn('Offline mode: API call blocked', { url });
      return { success: false, message: 'Offline mode - backend not available' };
    }
    const response = await api.get(url, { params });
    return response.data;
  },

  // POST request
  post: async <T>(url: string, data?: any): Promise<ApiResponse<T>> => {
    if (OFFLINE_MODE) {
      clientLogger.warn('Offline mode: API call blocked', { url });
      return { success: false, message: 'Offline mode - backend not available' };
    }
    
    // Log folder requests for debugging without exposing auth payloads.
    if (url.includes('/folders')) {
      clientLogger.debug('API folder POST request', {
        url,
        dataType: typeof data,
        isObject: typeof data === 'object' && data !== null,
        isFormData: data instanceof FormData,
      });
    }
    
    // Ensure data is a plain object, not a stringified object
    // For JSON requests (non-FormData), ensure it's an object
    let requestData = data;
    if (data && typeof data === 'string' && data === '[object Object]') {
      clientLogger.error('API POST data was incorrectly stringified');
      throw new Error('Invalid data format: object was converted to "[object Object]" string');
    }
    
    // Explicitly ensure JSON serialization for non-FormData requests
    // Axios should handle this automatically, but we'll be explicit
    const config: any = {};
    if (data && typeof data === 'object' && !(data instanceof FormData)) {
      // Ensure Content-Type is set for JSON
      config.headers = {
        'Content-Type': 'application/json'
      };
    }
    
    const response = await api.post(url, requestData, config);
    return response.data;
  },

  // PUT request
  put: async <T>(url: string, data?: any): Promise<ApiResponse<T>> => {
    if (OFFLINE_MODE) {
      clientLogger.warn('Offline mode: API call blocked', { url });
      return { success: false, message: 'Offline mode - backend not available' };
    }
    const response = await api.put(url, data);
    return response.data;
  },

  // DELETE request
  delete: async <T>(url: string): Promise<ApiResponse<T>> => {
    if (OFFLINE_MODE) {
      clientLogger.warn('Offline mode: API call blocked', { url });
      return { success: false, message: 'Offline mode - backend not available' };
    }
    const response = await api.delete(url);
    return response.data;
  },

  // PATCH request
  patch: async <T>(url: string, data?: any): Promise<ApiResponse<T>> => {
    if (OFFLINE_MODE) {
      clientLogger.warn('Offline mode: API call blocked', { url });
      return { success: false, message: 'Offline mode - backend not available' };
    }
    const response = await api.patch(url, data);
    return response.data;
  },

  // File upload
  upload: async <T>(url: string, formData: FormData, onProgress?: (progress: number) => void): Promise<ApiResponse<T>> => {
    if (OFFLINE_MODE) {
      clientLogger.warn('Offline mode: API call blocked', { url });
      return { success: false, message: 'Offline mode - backend not available' };
    }
    // For large file uploads, use a much longer timeout (2 hours = 7200000ms)
    // This allows for 2GB+ files even on slow connections
    const uploadTimeout = parseInt(process.env.REACT_APP_UPLOAD_TIMEOUT || '7200000'); // 2 hours default
    
    clientLogger.debug('Sending file upload', {
      url,
      formDataKeys: Array.from(formData.keys()),
      hasFile: formData.has('file'),
      file: formData.get('file') ? {
        name: (formData.get('file') as File)?.name,
        size: (formData.get('file') as File)?.size,
        type: (formData.get('file') as File)?.type
      } : 'no file'
    });
    
    const response = await api.post(url, formData, {
      timeout: uploadTimeout, // Override default timeout for uploads
      onUploadProgress: (progressEvent: any) => {
        if (onProgress && progressEvent.total) {
          const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          onProgress(progress);
        }
      },
    });
    return response.data;
  },

  // File download
  download: async (url: string, filename?: string): Promise<void> => {
    if (OFFLINE_MODE) {
      clientLogger.warn('Offline mode: API call blocked', { url });
      return;
    }
    const response = await api.get(url, {
      responseType: 'blob',
    });
    
    const blob = new Blob([response.data]);
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename || 'download';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);
  },
};

export default api;
