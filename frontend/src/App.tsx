import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './contexts/AuthContext';
import { FileProvider } from './contexts/FileContext';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import AdminPanel from './components/AdminPanel';
import OrganizationAdminPanel from './components/OrganizationAdminPanel';
import ProtectedRoute from './components/ProtectedRoute';
import GatewayLanding from './components/GatewayLanding';
import './styles/main.css';
import './styles/auth.css';
import './styles/dashboard.css';
import './styles/admin.css';
import './styles/modals.css';
import './styles/avatars.css';
import './styles/reminders.css';
import './styles/gateway.css';

function App() {
  return (
    <AuthProvider>
      <FileProvider>
        <Router>
          <div className="App">
            <Toaster 
              position="top-right"
              toastOptions={{
                duration: 4000,
                style: {
                  background: '#363636',
                  color: '#fff',
                },
                success: {
                  duration: 3000,
                  iconTheme: {
                    primary: '#141464',
                    secondary: '#fff',
                  },
                },
              }}
            />
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <GatewayLanding />
                  </ProtectedRoute>
                }
              />
              <Route 
                path="/dashboard" 
                element={<Navigate to="/dashboard/my-drive" replace />}
              />
              <Route 
                path="/dashboard/my-drive" 
                element={
                  <ProtectedRoute>
                    <Dashboard />
                  </ProtectedRoute>
                } 
              />
              <Route 
                path="/dashboard/my-drive/folder/:folderId" 
                element={
                  <ProtectedRoute>
                    <Dashboard />
                  </ProtectedRoute>
                } 
              />
              <Route 
                path="/dashboard/starred" 
                element={
                  <ProtectedRoute>
                    <Dashboard />
                  </ProtectedRoute>
                } 
              />
              <Route 
                path="/dashboard/shared" 
                element={
                  <ProtectedRoute>
                    <Dashboard />
                  </ProtectedRoute>
                } 
              />
              <Route 
                path="/dashboard/trash" 
                element={
                  <ProtectedRoute>
                    <Dashboard />
                  </ProtectedRoute>
                } 
              />
              <Route 
                path="/dashboard/todo" 
                element={
                  <ProtectedRoute>
                    <Dashboard />
                  </ProtectedRoute>
                } 
              />
              <Route 
                path="/admin" 
                element={
                  <ProtectedRoute requireAdmin={true}>
                    <AdminPanel />
                  </ProtectedRoute>
                } 
              />
              <Route 
                path="/admin/:tab" 
                element={
                  <ProtectedRoute requireAdmin={true}>
                    <AdminPanel />
                  </ProtectedRoute>
                } 
              />
              <Route 
                path="/admin/organization" 
                element={
                  <ProtectedRoute requireAdmin={true}>
                    <OrganizationAdminPanel />
                  </ProtectedRoute>
                } 
              />
              <Route 
                path="/admin/organization/:tab" 
                element={
                  <ProtectedRoute requireAdmin={true}>
                    <OrganizationAdminPanel />
                  </ProtectedRoute>
                } 
              />
              <Route path="*" element={<Navigate to="/login" replace />} />
            </Routes>
          </div>
        </Router>
      </FileProvider>
    </AuthProvider>
  );
}

export default App;