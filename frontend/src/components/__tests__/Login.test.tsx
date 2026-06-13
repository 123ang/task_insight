import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import Login from '../Login';
import { AuthProvider } from '../../contexts/AuthContext';
import { authService } from '../../services/authService';
import { toast } from 'react-hot-toast';

// Mock the API service
jest.mock('../../services/authService', () => ({
  authService: {
    login: jest.fn(),
    register: jest.fn(),
    setAuthData: jest.fn(),
    getAuthData: jest.fn(() => ({ token: null, user: null, refreshToken: null })),
    verifyToken: jest.fn(),
    clearAuthData: jest.fn(),
  },
}));

// Mock react-router-dom
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

// Mock react-hot-toast
jest.mock('react-hot-toast', () => {
  const toastMock = {
    success: jest.fn(),
    error: jest.fn(),
  };

  return {
    __esModule: true,
    default: toastMock,
    toast: toastMock,
  };
});

// Test wrapper component
const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <BrowserRouter>
    <AuthProvider>
      {children}
    </AuthProvider>
  </BrowserRouter>
);

const getInputById = (id: string) => document.getElementById(id) as HTMLInputElement;
const getLoginForm = () => document.getElementById('login-form') as HTMLElement;

const clickCreateAccountOption = async (user: ReturnType<typeof userEvent.setup>, optionText: string) => {
  await user.click(screen.getByRole('button', { name: /create account/i }));
  const optionsPanel = document.getElementById('create-account-options') as HTMLElement;
  await user.click(within(optionsPanel).getByText(optionText));
};

describe('Login Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (authService.getAuthData as jest.Mock).mockReturnValue({ token: null, user: null, refreshToken: null });
    (authService.login as jest.Mock).mockResolvedValue({ success: false, message: 'Invalid email or password' });
    (authService.register as jest.Mock).mockResolvedValue({ success: true });
  });

  it('renders login form by default', () => {
    render(
      <TestWrapper>
        <Login />
      </TestWrapper>
    );

    expect(screen.getByAltText('Task Insight')).toBeInTheDocument();
    expect(getInputById('login-email')).toBeInTheDocument();
    expect(getInputById('login-password')).toBeInTheDocument();
    expect(within(getLoginForm()).getByRole('button', { name: /^sign in$/i })).toBeInTheDocument();
  });

  it('switches to create account options when clicking create account tab', async () => {
    const user = userEvent.setup();
    
    render(
      <TestWrapper>
        <Login />
      </TestWrapper>
    );

    await user.click(screen.getByRole('button', { name: /create account/i }));

    const optionsPanel = document.getElementById('create-account-options') as HTMLElement;
    expect(optionsPanel).toHaveClass('active');
    expect(screen.getByText('How would you like to create your account?')).toBeInTheDocument();
    expect(within(optionsPanel).getByText('Join Organization')).toBeInTheDocument();
    expect(within(optionsPanel).getByText('Task Insight Admin')).toBeInTheDocument();
  });

  it('shows registration form when selecting join organization option', async () => {
    const user = userEvent.setup();
    
    render(
      <TestWrapper>
        <Login />
      </TestWrapper>
    );

    await clickCreateAccountOption(user, 'Join Organization');

    const registerForm = document.getElementById('register-form') as HTMLElement;
    expect(registerForm).toHaveClass('active');
    expect(within(registerForm).getByRole('heading', { name: 'Join Organization' })).toBeInTheDocument();
    expect(getInputById('invitation-code')).toBeInTheDocument();
    expect(getInputById('register-firstname')).toBeInTheDocument();
    expect(getInputById('register-lastname')).toBeInTheDocument();
    expect(getInputById('register-email')).toBeInTheDocument();
  });

  it('shows admin form when selecting admin option', async () => {
    const user = userEvent.setup();
    
    render(
      <TestWrapper>
        <Login />
      </TestWrapper>
    );

    await clickCreateAccountOption(user, 'Task Insight Admin');

    expect(document.getElementById('admin-form')).toHaveClass('active');
    expect(screen.getByText('Task Insight Admin Access')).toBeInTheDocument();
    expect(getInputById('admin-email')).toBeInTheDocument();
    expect(getInputById('admin-password')).toBeInTheDocument();
  });

  it('validates required fields in login form', async () => {
    const user = userEvent.setup();
    
    render(
      <TestWrapper>
        <Login />
      </TestWrapper>
    );

    const loginButton = within(getLoginForm()).getByRole('button', { name: /^sign in$/i });
    await user.click(loginButton);

    // Check that required validation is triggered
    const emailInput = getInputById('login-email');
    const passwordInput = getInputById('login-password');

    expect(emailInput).toBeRequired();
    expect(passwordInput).toBeRequired();
  });

  it('allows navigation back from registration form', async () => {
    const user = userEvent.setup();
    
    render(
      <TestWrapper>
        <Login />
      </TestWrapper>
    );

    await clickCreateAccountOption(user, 'Join Organization');

    // Click back button
    const registerForm = document.getElementById('register-form') as HTMLElement;
    const backButton = within(registerForm).getByRole('button', { name: /back to options/i });
    await user.click(backButton);

    expect(document.getElementById('create-account-options')).toHaveClass('active');
    expect(screen.getByText('How would you like to create your account?')).toBeInTheDocument();
  });

  it('validates password confirmation in registration form', async () => {
    const user = userEvent.setup();
    
    render(
      <TestWrapper>
        <Login />
      </TestWrapper>
    );

    await clickCreateAccountOption(user, 'Join Organization');

    // Fill out form with mismatched passwords
    await user.type(getInputById('invitation-code'), 'TEST123');
    await user.type(getInputById('register-firstname'), 'John');
    await user.type(getInputById('register-lastname'), 'Doe');
    await user.type(getInputById('register-email'), 'john@example.com');
    await user.type(getInputById('register-password'), 'Password12345');
    await user.type(getInputById('register-confirm'), 'Different12345');

    const registerForm = document.getElementById('register-form') as HTMLElement;
    const registerButton = within(registerForm).getByRole('button', { name: /join organization/i });
    await user.click(registerButton);

    expect(toast.error).toHaveBeenCalledWith('Passwords do not match');
  });

  it('shows loading state during form submission', async () => {
    const user = userEvent.setup();
    (authService.login as jest.Mock).mockReturnValue(new Promise(() => {}));
    
    render(
      <TestWrapper>
        <Login />
      </TestWrapper>
    );

    // Fill out login form
    await user.type(getInputById('login-email'), 'test@example.com');
    await user.type(getInputById('login-password'), 'password123');

    const loginButton = within(getLoginForm()).getByRole('button', { name: /^sign in$/i });
    await user.click(loginButton);

    // Should show loading state
    await waitFor(() => {
      expect(screen.getByText(/logging in/i)).toBeInTheDocument();
    });
  });
});
