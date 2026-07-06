import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getAndaiAssistantUrl, openAndaiAssistant } from '../utils/platformLinks';
import '../styles/gateway.css';

const ANDAI_URL = getAndaiAssistantUrl();

const GatewayLanding: React.FC = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const handleAndai = () => {
    openAndaiAssistant();
  };

  const displayName = user
    ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email
    : '';

  return (
    <div className="gateway-page">
      <header className="gateway-header">
        <div className="gateway-header-brand">
          <img src="/logo-vertical-white.png" alt="Task Insight" className="gateway-logo" />
        </div>
        <div className="gateway-header-actions">
          {displayName && (
            <span className="gateway-greeting">
              <i className="fas fa-user-circle" aria-hidden="true"></i>
              {displayName}
            </span>
          )}
          <button
            className="gateway-logout-btn"
            onClick={handleLogout}
            aria-label="Sign out"
          >
            <i className="fas fa-sign-out-alt" aria-hidden="true"></i>
            Sign out
          </button>
        </div>
      </header>

      <main className="gateway-main">
        <div className="gateway-hero">
          <h1 className="gateway-title">Welcome back{displayName ? `, ${displayName.split(' ')[0]}` : ''}</h1>
          <p className="gateway-subtitle">Choose a platform to continue</p>
        </div>

        <div className="gateway-cards">
          {/* TaskInsight card */}
          <button
            className="gateway-card"
            onClick={() => navigate('/dashboard/my-drive')}
            aria-label="Open TaskInsight — manage documents"
          >
            <div className="gateway-card-icon gateway-card-icon--taskinsight">
              <i className="fas fa-folder-open" aria-hidden="true"></i>
            </div>
            <div className="gateway-card-body">
              <h2 className="gateway-card-title">TaskInsight</h2>
              <p className="gateway-card-desc">Manage Documents</p>
              <p className="gateway-card-hint">
                Files, versions, reminders, sharing, and audit logs
              </p>
            </div>
            <span className="gateway-card-arrow" aria-hidden="true">
              <i className="fas fa-arrow-right"></i>
            </span>
          </button>

          {/* ANDAI card */}
          <button
            className={`gateway-card${!ANDAI_URL ? ' gateway-card--disabled' : ''}`}
            onClick={handleAndai}
            disabled={!ANDAI_URL}
            aria-label="Open ANDAI — ask the knowledge base"
            aria-disabled={!ANDAI_URL}
          >
            <div className="gateway-card-icon gateway-card-icon--andai">
              <i className="fas fa-brain" aria-hidden="true"></i>
            </div>
            <div className="gateway-card-body">
              <h2 className="gateway-card-title">ANDAI</h2>
              <p className="gateway-card-desc">Ask Knowledge Base</p>
              <p className="gateway-card-hint">
                Search, ask questions, and explore your knowledge base
              </p>
              {!ANDAI_URL && (
                <span className="gateway-card-badge">Coming soon</span>
              )}
            </div>
            <span className="gateway-card-arrow" aria-hidden="true">
              <i className="fas fa-arrow-right"></i>
            </span>
          </button>
        </div>
      </main>
    </div>
  );
};

export default GatewayLanding;
