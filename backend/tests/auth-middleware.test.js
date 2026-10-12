jest.mock('../config/database', () => ({
  executeQuery: jest.fn()
}));

const jwt = require('jsonwebtoken');
const { executeQuery } = require('../config/database');
const { requireFileAccess, verifyToken } = require('../middleware/auth');

const createResponse = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const runMiddleware = async(middleware, req) => {
  const res = createResponse();
  const next = jest.fn();

  await middleware(req, res, next);

  return { res, next };
};

const mockFileQueries = ({ file, shares = [] }) => {
  executeQuery.mockImplementation(async(query, params = []) => {
    if (query.includes('FROM files WHERE id = ?')) {
      return file
        ? { success: true, data: [file] }
        : { success: true, data: [] };
    }

    if (query.includes('SELECT organization_id FROM users WHERE id = ?')) {
      return {
        success: true,
        data: [{ organization_id: params[0] === 42 ? 5 : null }]
      };
    }

    if (query.includes('FROM file_shares')) {
      return { success: true, data: shares };
    }

    return { success: true, data: [] };
  });
};

describe('requireFileAccess', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('denies same-organization members who do not own the file and have no share', async() => {
    mockFileQueries({
      file: {
        id: 10,
        name: 'private.pdf',
        status: 'active',
        organization_id: 5,
        uploaded_by: 99,
        storage_path: 'private.pdf'
      }
    });

    const req = {
      params: { fileId: 10 },
      user: {
        id: 42,
        role: 'member',
        organization_id: 5
      }
    };

    const { res, next } = await runMiddleware(requireFileAccess, req);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false
    }));
  });

  it('does not allow active-file access to deleted files', async() => {
    mockFileQueries({
      file: {
        id: 11,
        name: 'deleted.pdf',
        status: 'deleted',
        organization_id: 5,
        uploaded_by: 42,
        storage_path: 'deleted.pdf'
      }
    });

    const req = {
      params: { fileId: 11 },
      user: {
        id: 42,
        role: 'member',
        organization_id: 5
      }
    };

    const { res, next } = await runMiddleware(requireFileAccess, req);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      message: 'File not found.'
    }));
  });

  it('allows the file owner to access an active file', async() => {
    mockFileQueries({
      file: {
        id: 12,
        name: 'owned.pdf',
        status: 'active',
        organization_id: 5,
        uploaded_by: 42,
        storage_path: 'owned.pdf'
      }
    });

    const req = {
      params: { fileId: 12 },
      user: {
        id: 42,
        role: 'member',
        organization_id: 5
      }
    };

    const { res, next } = await runMiddleware(requireFileAccess, req);

    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.file).toEqual(expect.objectContaining({
      id: 12,
      path: expect.stringContaining('owned.pdf')
    }));
  });
});

describe('verifyToken session enforcement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('accepts a typed access token only while its server session is active', async() => {
    executeQuery.mockResolvedValue({
      success: true,
      data: [{
        id: 42,
        email: 'member@example.com',
        role: 'member',
        status: 'active',
        organization_id: 5
      }]
    });
    const token = jwt.sign(
      { kind: 'access', sid: 'session-1', userId: 42 },
      'test-secret',
      { expiresIn: '1h' }
    );
    const req = {
      header: jest.fn(() => `Bearer ${token}`)
    };

    const { res, next } = await runMiddleware(verifyToken, req);

    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(executeQuery).toHaveBeenCalledWith(
      expect.stringContaining('INNER JOIN auth_sessions'),
      [42, 'session-1']
    );
  });

  it('rejects refresh tokens presented as bearer access tokens', async() => {
    const token = jwt.sign(
      { kind: 'refresh', sid: 'session-1', userId: 42 },
      'test-secret',
      { expiresIn: '1h' }
    );
    const req = {
      header: jest.fn(() => `Bearer ${token}`)
    };

    const { res, next } = await runMiddleware(verifyToken, req);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it('rejects access tokens after their session is revoked', async() => {
    executeQuery.mockResolvedValue({ success: true, data: [] });
    const token = jwt.sign(
      { kind: 'access', sid: 'revoked-session', userId: 42 },
      'test-secret',
      { expiresIn: '1h' }
    );
    const req = {
      header: jest.fn(() => `Bearer ${token}`)
    };

    const { res, next } = await runMiddleware(verifyToken, req);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
