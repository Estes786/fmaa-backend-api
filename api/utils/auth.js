const { createClient } = require('@supabase/supabase-js');
const { dbUtils } = require('./database');

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Authentication utility functions for FMAA ecosystem
 */
class AuthUtils {
  constructor() {
    this.supabase = supabase;
  }

  /**
   * Verify JWT token and extract user info
   */
  async verifyToken(token) {
    try {
      const { data: { user }, error } = await this.supabase.auth.getUser(token);
      
      if (error) {
        throw new Error(`Token verification failed: ${error.message}`);
      }

      if (!user) {
        throw new Error('Invalid token: no user found');
      }

      return user;
    } catch (error) {
      console.error('Token verification error:', error);
      throw error;
    }
  }

  /**
   * Extract token from Authorization header
   */
  extractTokenFromHeader(authHeader) {
    if (!authHeader) {
      throw new Error('Authorization header is required');
    }

    if (!authHeader.startsWith('Bearer ')) {
      throw new Error('Authorization header must start with "Bearer "');
    }

    return authHeader.substring(7); // Remove "Bearer " prefix
  }

  /**
   * Middleware function to authenticate requests
   */
  async authenticateRequest(req) {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader) {
        // For development/testing, allow requests without auth
        if (process.env.NODE_ENV === 'development') {
          return {
            user: {
              id: 'dev-user',
              email: 'dev@example.com',
              tenant_id: 'default'
            },
            tenant_id: 'default'
          };
        }
        throw new Error('Authorization header is required');
      }

      const token = this.extractTokenFromHeader(authHeader);
      const user = await this.verifyToken(token);

      // Get or create user record in our database
      const dbUser = await this.getOrCreateUser(user);

      return {
        user: dbUser,
        tenant_id: dbUser.tenant_id
      };
    } catch (error) {
      console.error('Authentication error:', error);
      throw error;
    }
  }

  /**
   * Get or create user in database
   */
  async getOrCreateUser(supabaseUser) {
    try {
      // First try to get existing user
      const { data: existingUser, error: getUserError } = await dbUtils.admin
        .from('users')
        .select('*')
        .eq('auth_provider_id', supabaseUser.id)
        .single();

      if (existingUser && !getUserError) {
        return existingUser;
      }

      // Get or create default tenant
      const { tenant } = await dbUtils.getOrCreateTenant('default', 'Default Tenant');

      // Create new user
      const userData = {
        email: supabaseUser.email,
        name: supabaseUser.user_metadata?.full_name || supabaseUser.email,
        tenant_id: tenant.id,
        auth_provider: 'supabase',
        auth_provider_id: supabaseUser.id,
        role: 'user',
        metadata: {
          created_from: 'api_auth',
          supabase_metadata: supabaseUser.user_metadata
        }
      };

      const { data: newUser, error: createError } = await dbUtils.admin
        .from('users')
        .insert([userData])
        .select()
        .single();

      if (createError) {
        throw createError;
      }

      return newUser;
    } catch (error) {
      console.error('Error in getOrCreateUser:', error);
      throw error;
    }
  }

  /**
   * Check if user has permission for specific action
   */
  async checkPermission(user, action, resource = null) {
    // Basic role-based permissions
    const permissions = {
      admin: ['*'], // Admin can do everything
      user: [
        'read:agents',
        'create:agents',
        'update:own_agents',
        'delete:own_agents',
        'read:tasks',
        'create:tasks',
        'read:metrics',
        'read:logs'
      ],
      viewer: [
        'read:agents',
        'read:tasks',
        'read:metrics',
        'read:logs'
      ]
    };

    const userPermissions = permissions[user.role] || permissions.viewer;

    // Check for wildcard permission
    if (userPermissions.includes('*')) {
      return true;
    }

    // Check for exact permission match
    if (userPermissions.includes(action)) {
      return true;
    }

    // Check for resource-specific permissions
    if (resource && action.includes('own_')) {
      const baseAction = action.replace('own_', '');
      if (userPermissions.includes(`${baseAction}:own_${resource.type}`) && 
          resource.created_by === user.id) {
        return true;
      }
    }

    return false;
  }

  /**
   * Generate API key for programmatic access
   */
  async generateApiKey(userId, name, permissions = []) {
    const apiKey = this.generateRandomKey();
    const hashedKey = await this.hashApiKey(apiKey);

    const { data, error } = await dbUtils.admin
      .from('api_keys')
      .insert([{
        user_id: userId,
        name,
        key_hash: hashedKey,
        permissions,
        created_at: new Date().toISOString(),
        last_used_at: null,
        is_active: true
      }])
      .select()
      .single();

    if (error) {
      throw error;
    }

    return {
      id: data.id,
      key: apiKey, // Return unhashed key only once
      name: data.name,
      permissions: data.permissions,
      created_at: data.created_at
    };
  }

  /**
   * Verify API key
   */
  async verifyApiKey(apiKey) {
    try {
      const hashedKey = await this.hashApiKey(apiKey);

      const { data: keyRecord, error } = await dbUtils.admin
        .from('api_keys')
        .select(`
          *,
          users!inner(*)
        `)
        .eq('key_hash', hashedKey)
        .eq('is_active', true)
        .single();

      if (error || !keyRecord) {
        throw new Error('Invalid API key');
      }

      // Update last used timestamp
      await dbUtils.admin
        .from('api_keys')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', keyRecord.id);

      return {
        user: keyRecord.users,
        api_key: keyRecord,
        tenant_id: keyRecord.users.tenant_id
      };
    } catch (error) {
      console.error('API key verification error:', error);
      throw error;
    }
  }

  /**
   * Authenticate request with either JWT or API key
   */
  async authenticateRequestFlexible(req) {
    const authHeader = req.headers.authorization;
    const apiKey = req.headers['x-api-key'];

    try {
      // Try API key first
      if (apiKey) {
        return await this.verifyApiKey(apiKey);
      }

      // Fall back to JWT authentication
      if (authHeader) {
        return await this.authenticateRequest(req);
      }

      // Development mode fallback
      if (process.env.NODE_ENV === 'development') {
        return {
          user: {
            id: 'dev-user',
            email: 'dev@example.com',
            tenant_id: 'default',
            role: 'admin'
          },
          tenant_id: 'default'
        };
      }

      throw new Error('Authentication required: provide either Authorization header or X-API-Key');
    } catch (error) {
      console.error('Flexible authentication error:', error);
      throw error;
    }
  }

  /**
   * Create session for user
   */
  async createSession(user, expiresIn = '24h') {
    const sessionId = this.generateRandomKey();
    const expiresAt = new Date();
    
    // Parse expiration time
    const timeValue = parseInt(expiresIn.slice(0, -1));
    const timeUnit = expiresIn.slice(-1);
    
    switch (timeUnit) {
      case 'h':
        expiresAt.setHours(expiresAt.getHours() + timeValue);
        break;
      case 'd':
        expiresAt.setDate(expiresAt.getDate() + timeValue);
        break;
      case 'm':
        expiresAt.setMinutes(expiresAt.getMinutes() + timeValue);
        break;
      default:
        expiresAt.setHours(expiresAt.getHours() + 24); // Default 24 hours
    }

    const { data, error } = await dbUtils.admin
      .from('user_sessions')
      .insert([{
        id: sessionId,
        user_id: user.id,
        expires_at: expiresAt.toISOString(),
        created_at: new Date().toISOString(),
        is_active: true
      }])
      .select()
      .single();

    if (error) {
      throw error;
    }

    return {
      session_id: sessionId,
      expires_at: expiresAt.toISOString(),
      user
    };
  }

  /**
   * Verify session
   */
  async verifySession(sessionId) {
    const { data: session, error } = await dbUtils.admin
      .from('user_sessions')
      .select(`
        *,
        users!inner(*)
      `)
      .eq('id', sessionId)
      .eq('is_active', true)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (error || !session) {
      throw new Error('Invalid or expired session');
    }

    return {
      session,
      user: session.users,
      tenant_id: session.users.tenant_id
    };
  }

  /**
   * Revoke session
   */
  async revokeSession(sessionId) {
    const { error } = await dbUtils.admin
      .from('user_sessions')
      .update({ is_active: false })
      .eq('id', sessionId);

    if (error) {
      throw error;
    }

    return { success: true };
  }

  /**
   * Rate limiting check
   */
  async checkRateLimit(identifier, limit = 100, windowMs = 3600000) { // 100 requests per hour
    const windowStart = new Date(Date.now() - windowMs);

    // Count requests in current window
    const { data: requests, error } = await dbUtils.admin
      .from('rate_limit_log')
      .select('id')
      .eq('identifier', identifier)
      .gte('timestamp', windowStart.toISOString());

    if (error) {
      console.error('Rate limit check error:', error);
      return { allowed: true, remaining: limit }; // Allow on error
    }

    const requestCount = requests?.length || 0;
    const remaining = Math.max(0, limit - requestCount);
    const allowed = requestCount < limit;

    // Log this request if allowed
    if (allowed) {
      await dbUtils.admin
        .from('rate_limit_log')
        .insert([{
          identifier,
          timestamp: new Date().toISOString()
        }]);
    }

    return {
      allowed,
      remaining,
      reset_time: new Date(Date.now() + windowMs).toISOString()
    };
  }

  /**
   * Utility functions
   */
  generateRandomKey(length = 32) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  async hashApiKey(key) {
    // Simple hash for demo - in production use proper crypto
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(key).digest('hex');
  }

  /**
   * Middleware wrapper for Express-like frameworks
   */
  requireAuth(options = {}) {
    return async (req, res, next) => {
      try {
        const auth = await this.authenticateRequestFlexible(req);
        req.user = auth.user;
        req.tenant_id = auth.tenant_id;
        
        // Check permissions if specified
        if (options.permission) {
          const hasPermission = await this.checkPermission(
            auth.user, 
            options.permission, 
            options.resource
          );
          
          if (!hasPermission) {
            return res.status(403).json({ 
              error: 'Insufficient permissions',
              required_permission: options.permission 
            });
          }
        }

        // Check rate limit if specified
        if (options.rateLimit) {
          const identifier = auth.user.id;
          const rateCheck = await this.checkRateLimit(
            identifier,
            options.rateLimit.limit,
            options.rateLimit.windowMs
          );

          if (!rateCheck.allowed) {
            return res.status(429).json({
              error: 'Rate limit exceeded',
              reset_time: rateCheck.reset_time
            });
          }

          // Add rate limit headers
          res.setHeader('X-RateLimit-Limit', options.rateLimit.limit);
          res.setHeader('X-RateLimit-Remaining', rateCheck.remaining);
          res.setHeader('X-RateLimit-Reset', rateCheck.reset_time);
        }

        next();
      } catch (error) {
        return res.status(401).json({ 
          error: 'Authentication failed',
          message: error.message 
        });
      }
    };
  }

  /**
   * Get user profile with additional info
   */
  async getUserProfile(userId) {
    const { data: user, error } = await dbUtils.admin
      .from('users')
      .select(`
        *,
        tenants!inner(*),
        api_keys(id, name, permissions, created_at, last_used_at, is_active)
      `)
      .eq('id', userId)
      .single();

    if (error) {
      throw error;
    }

    return user;
  }

  /**
   * Update user profile
   */
  async updateUserProfile(userId, updates) {
    const allowedFields = ['name', 'metadata'];
    const filteredUpdates = {};
    
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        filteredUpdates[field] = updates[field];
      }
    }

    if (Object.keys(filteredUpdates).length === 0) {
      throw new Error('No valid fields to update');
    }

    filteredUpdates.updated_at = new Date().toISOString();

    const { data, error } = await dbUtils.admin
      .from('users')
      .update(filteredUpdates)
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
  }
}

// Export singleton instance
const authUtils = new AuthUtils();

module.exports = {
  AuthUtils,
  authUtils
};

