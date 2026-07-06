import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const value = (viteName: string, legacyName: string, fallback = '') => (
    env[viteName] || env[legacyName] || fallback
  );

  return {
    plugins: [react()],
    define: {
      'process.env.REACT_APP_API_BASE_URL': JSON.stringify(
        value('VITE_API_BASE_URL', 'REACT_APP_API_BASE_URL', 'http://localhost:5000/api')
      ),
      'process.env.REACT_APP_API_TIMEOUT': JSON.stringify(
        value('VITE_API_TIMEOUT', 'REACT_APP_API_TIMEOUT', '30000')
      ),
      'process.env.REACT_APP_UPLOAD_TIMEOUT': JSON.stringify(
        value('VITE_UPLOAD_TIMEOUT', 'REACT_APP_UPLOAD_TIMEOUT', '7200000')
      ),
      'process.env.REACT_APP_OFFLINE_MODE': JSON.stringify(
        value('VITE_OFFLINE_MODE', 'REACT_APP_OFFLINE_MODE', 'false')
      ),
      'process.env.REACT_APP_DISABLE_API_CALLS': JSON.stringify(
        value('VITE_DISABLE_API_CALLS', 'REACT_APP_DISABLE_API_CALLS', 'false')
      ),
      'process.env.REACT_APP_DEBUG_API': JSON.stringify(
        value('VITE_DEBUG_API', 'REACT_APP_DEBUG_API', 'false')
      ),
      'process.env.REACT_APP_ANDAI_URL': JSON.stringify(
        value('VITE_ANDAI_URL', 'REACT_APP_ANDAI_URL')
      ),
    },
    server: {
      port: 3000,
    },
    preview: {
      port: 4173,
    },
  };
});
