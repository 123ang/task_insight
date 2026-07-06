import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';

const Login: React.FC = () => {
  const navigate = useNavigate();
  const { login, register, isAuthenticated, isLoading, isPlatformOwner, isOrganizationAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState('login');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [visiblePasswords, setVisiblePasswords] = useState<Record<string, boolean>>({});

  const togglePasswordVisibility = (fieldId: string) => {
    setVisiblePasswords((current) => ({
      ...current,
      [fieldId]: !current[fieldId],
    }));
  };

  const renderPasswordField = (fieldId: string, label: string, placeholder: string) => {
    const isVisible = Boolean(visiblePasswords[fieldId]);

    return (
      <div className="form-group">
        <label htmlFor={fieldId}>{label}</label>
        <div className="password-input-wrapper">
          <input
            type={isVisible ? 'text' : 'password'}
            id={fieldId}
            required
            placeholder={placeholder}
            disabled={isSubmitting}
          />
          <button
            type="button"
            className="password-toggle-btn"
            aria-label={isVisible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
            aria-pressed={isVisible}
            onClick={() => togglePasswordVisibility(fieldId)}
            disabled={isSubmitting}
          >
            <i className={`fas ${isVisible ? 'fa-eye-slash' : 'fa-eye'}`} aria-hidden="true"></i>
          </button>
        </div>
      </div>
    );
  };

  // Redirect if already authenticated (but only after loading is complete)
  useEffect(() => {
    // Only redirect if we're sure the user is authenticated and not loading
      if (!isLoading && isAuthenticated) {
        // Check if user is admin (platform owner or organization admin)
        if (isPlatformOwner() || isOrganizationAdmin()) {
          navigate('/admin', { replace: true });
        } else {
          navigate('/', { replace: true });
        }
    }
  }, [isAuthenticated, isLoading, navigate, isPlatformOwner, isOrganizationAdmin]);

  const showTab = (tab: string, event?: React.MouseEvent) => {
    if (event) event.preventDefault();
    setActiveTab(tab);
  };

  const selectOption = (option: string) => {
    if (option === 'member') {
      setActiveTab('register');
    } else if (option === 'admin') {
      setActiveTab('admin');
    }
  };

  const goBackToOptions = () => {
    setActiveTab('create-account-options');
  };

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    
    try {
      const emailInput = document.getElementById('login-email') as HTMLInputElement;
      const passwordInput = document.getElementById('login-password') as HTMLInputElement;
      const email = emailInput?.value;
      const password = passwordInput?.value;

      if (!email || !password) {
        toast.error('Please fill in all fields');
        return;
      }

      if (!emailInput.checkValidity()) {
        toast.error('Please provide a valid email address');
        return;
      }

      const success = await login(email, password);
      
      if (success) {
        navigate('/');
      }
    } catch (error) {
      console.error('Login error:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAdminLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    
    try {
      const emailInput = document.getElementById('admin-email') as HTMLInputElement;
      const passwordInput = document.getElementById('admin-password') as HTMLInputElement;
      const email = emailInput?.value;
      const password = passwordInput?.value;

      if (!email || !password) {
        toast.error('Please fill in all fields');
        return;
      }

      if (!emailInput.checkValidity()) {
        toast.error('Please provide a valid email address');
        return;
      }

      const success = await login(email, password, true);
      
      if (success) {
        navigate('/admin');
      }
    } catch (error) {
      console.error('Admin login error:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegister = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    
    try {
      const invitationCode = (document.getElementById('invitation-code') as HTMLInputElement)?.value;
      const firstName = (document.getElementById('register-firstname') as HTMLInputElement)?.value;
      const lastName = (document.getElementById('register-lastname') as HTMLInputElement)?.value;
      const emailInput = document.getElementById('register-email') as HTMLInputElement;
      const email = emailInput?.value;
      const password = (document.getElementById('register-password') as HTMLInputElement)?.value;
      const confirmPassword = (document.getElementById('register-confirm') as HTMLInputElement)?.value;
      
      if (!firstName || !lastName || !email || !password || !confirmPassword) {
        toast.error('Please fill in all fields');
        return;
      }

      if (!emailInput.checkValidity()) {
        toast.error('Please provide a valid email address');
        return;
      }
      
      if (password !== confirmPassword) {
        toast.error('Passwords do not match');
        return;
      }

      if (!password || password.trim() === '') {
        toast.error('Password is required');
        return;
      }

      if (password.length < 12) {
        toast.error('Password must be at least 12 characters long');
        return;
      }

      if (!invitationCode || invitationCode.trim() === '') {
        toast.error('Invitation code is required');
        return;
      }

      const success = await register({
        firstName,
        lastName,
        email,
        password,
        invitationCode: invitationCode.trim() || undefined,
      });

      if (success) {
        setActiveTab('login');
      }
    } catch (error) {
      console.error('Registration error:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <img src="/logo-vertical-white.png" alt="Task Insight" className="auth-logo" />
        </div>
        
        <div className="auth-tabs">
          <button 
            className={`tab-btn ${activeTab === 'login' ? 'active' : ''}`} 
            onClick={(e) => showTab('login', e)}
          >
            Login
          </button>
          <button 
            className={`tab-btn ${activeTab === 'create-account-options' ? 'active' : ''}`} 
            onClick={(e) => showTab('create-account-options', e)}
          >
            Create Account
          </button>
        </div>
        
        {/* Login Form */}
        <div id="login-form" className={`auth-form ${activeTab === 'login' ? 'active' : ''}`}>
          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label htmlFor="login-email">Email</label>
              <input 
                type="email" 
                id="login-email" 
                required 
                placeholder="Enter your email"
                disabled={isSubmitting}
              />
            </div>
            {renderPasswordField('login-password', 'Password', 'Enter your password')}
            <button 
              type="submit" 
              className="btn-primary"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <i className="fas fa-spinner fa-spin"></i>
                  Logging in...
                </>
              ) : (
                'Sign In'
              )}
            </button>
          </form>
        </div>
        
        {/* Create Account Options */}
        <div id="create-account-options" className={`auth-form create-account-options ${activeTab === 'create-account-options' ? 'active' : ''}`}>
          <div className="options-header">
            <h3>How would you like to create your account?</h3>
            <p>Choose the option that applies to your situation</p>
          </div>
          
          <div className="options-container">
            <div className="option-card" onClick={() => selectOption('member')}>
              <div className="option-icon">
                <i className="fas fa-user-plus"></i>
              </div>
              <div className="option-content">
                <h4>Join Organization</h4>
                <p>I have an invitation code from my organization admin</p>
                <div className="option-features">
                  <span className="feature-tag">Invitation Required</span>
                  <span className="feature-tag">Team Member</span>
                </div>
              </div>
            </div>
            
            <div className="option-card" onClick={() => selectOption('admin')}>
              <div className="option-icon">
                <i className="fas fa-shield-alt"></i>
              </div>
              <div className="option-content">
                <h4>Task Insight Admin</h4>
                <p>I am a Task Insight administrator and want to manage organizations</p>
                <div className="option-features">
                  <span className="feature-tag">Admin Only</span>
                  <span className="feature-tag">Full Control</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        {/* Register Form */}
        <div id="register-form" className={`auth-form ${activeTab === 'register' ? 'active' : ''}`}>
          <div className="form-header">
            <button className="back-btn" onClick={goBackToOptions}>
              <i className="fas fa-arrow-left"></i>
              Back to options
            </button>
            <h3>Join Organization</h3>
          </div>
          <form onSubmit={handleRegister}>
            <div className="form-group">
              <label htmlFor="invitation-code">Invitation Code</label>
              <input type="text" id="invitation-code" placeholder="Enter invitation code" required />
              <small className="form-help">Ask your organization admin for an invitation code</small>
            </div>
            <div className="form-group">
              <label htmlFor="register-firstname">First Name</label>
              <input 
                type="text" 
                id="register-firstname" 
                required 
                placeholder="Enter your first name"
                disabled={isSubmitting}
              />
            </div>
            <div className="form-group">
              <label htmlFor="register-lastname">Last Name</label>
              <input 
                type="text" 
                id="register-lastname" 
                required 
                placeholder="Enter your last name"
                disabled={isSubmitting}
              />
            </div>
            <div className="form-group">
              <label htmlFor="register-email">Email</label>
              <input 
                type="email" 
                id="register-email" 
                required 
                placeholder="Enter your email"
                disabled={isSubmitting}
              />
            </div>
            {renderPasswordField('register-password', 'Password', 'Enter your password')}
            {renderPasswordField('register-confirm', 'Confirm Password', 'Confirm your password')}
            <button 
              type="submit" 
              className="btn-primary"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <i className="fas fa-spinner fa-spin"></i>
                  Registering...
                </>
              ) : (
                'Join Organization'
              )}
            </button>
          </form>
        </div>
        
        {/* Admin Form */}
        <div id="admin-form" className={`auth-form ${activeTab === 'admin' ? 'active' : ''}`}>
          <div className="form-header">
            <button className="back-btn" onClick={goBackToOptions}>
              <i className="fas fa-arrow-left"></i>
              Back to options
            </button>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <i className="fas fa-shield-alt" style={{ color: '#141464' }}></i>
              Task Insight Admin Access
            </h3>
          </div>
          <div style={{ background: '#e0e0f0', padding: '16px', borderRadius: '8px', marginBottom: '20px', borderLeft: '4px solid #141464' }}>
            <p style={{ fontSize: '13px', color: '#5f6368', margin: 0 }}>
              <strong style={{ color: '#141464' }}>Admin Only:</strong> Only Task Insight administrators can create organizations. 
              Please sign in with your admin credentials to access the Task Insight management panel.
            </p>
          </div>
          <form onSubmit={handleAdminLogin}>
            <div className="form-group">
              <label htmlFor="admin-email">Admin Email</label>
              <input 
                type="email" 
                id="admin-email" 
                required 
                placeholder="Enter admin email"
                disabled={isSubmitting}
              />
            </div>
            {renderPasswordField('admin-password', 'Admin Password', 'Enter admin password')}
            <button 
              type="submit" 
              className="btn-primary"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <i className="fas fa-spinner fa-spin"></i>
                  Signing in...
                </>
              ) : (
                <>
                  <i className="fas fa-sign-in-alt"></i>
                  Sign In to Task Insight Admin
                </>
              )}
            </button>
          </form>
          <div style={{ marginTop: '16px', textAlign: 'center', fontSize: '13px', color: '#5f6368' }}>
            <p style={{ margin: 0 }}>Don't have admin access? Contact your Task Insight administrator.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
