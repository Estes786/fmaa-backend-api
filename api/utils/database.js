const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client with service role key for admin operations
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Initialize Supabase client with service role key for admin operations
const supabaseClient = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Database utility functions for FMAA ecosystem
 */
class DatabaseUtils {
  constructor() {
    this.admin = supabaseAdmin;
    this.client = supabaseClient;
  }

  /**
   * Set tenant context for Row Level Security
   */
  async setTenantContext(tenantId) {
    const { error } = await this.admin.rpc('set_config', {
      setting_name: 'app.current_tenant_id',
      setting_value: tenantId,
      is_local: true
    });
    
    if (error) {
      console.error('Failed to set tenant context:', error);
    }
  }

  /**
   * Get or create tenant
   */
  async getOrCreateTenant(tenantSlug, tenantName = null) {
    try {
      // First try to get existing tenant
      const { data: existingTenant, error: getError } = await this.admin
        .from('tenants')
        .select('*')
        .eq('slug', tenantSlug)
        .single();

      if (existingTenant && !getError) {
        return { tenant: existingTenant, created: false };
      }

      // Create new tenant if not exists
      const { data: newTenant, error: createError } = await this.admin
        .from('tenants')
        .insert([{
          name: tenantName || tenantSlug,
          slug: tenantSlug,
          subscription_tier: 'free'
        }])
        .select()
        .single();

      if (createError) {
        throw createError;
      }

      return { tenant: newTenant, created: true };
    } catch (error) {
      console.error('Error in getOrCreateTenant:', error);
      throw error;
    }
  }

  /**
   * Get agent by ID and tenant
   */
  async getAgent(agentId, tenantId) {
    const { data, error } = await this.admin
      .from('agents')
      .select('*')
      .eq('id', agentId)
      .eq('tenant_id', tenantId)
      .single();

    if (error) {
      throw error;
    }

    return data;
  }

  /**
   * Get agent by type and tenant
   */
  async getAgentByType(agentType, tenantId) {
    const { data, error } = await this.admin
      .from('agents')
      .select('*')
      .eq('type', agentType)
      .eq('tenant_id', tenantId)
      .single();

    if (error && error.code !== 'PGRST116') { // Not found error
      throw error;
    }

    return data;
  }

  /**
   * Create or update agent
   */
  async upsertAgent(agentData) {
    const { data, error } = await this.admin
      .from('agents')
      .upsert([agentData], { onConflict: 'id' })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
  }

  /**
   * Create agent task
   */
  async createTask(taskData) {
    const { data, error } = await this.admin
      .from('agent_tasks')
      .insert([taskData])
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
  }

  /**
   * Update agent task
   */
  async updateTask(taskId, updates) {
    const { data, error } = await this.admin
      .from('agent_tasks')
      .update(updates)
      .eq('id', taskId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
  }

  /**
   * Log agent metrics
   */
  async logMetrics(metrics) {
    if (!Array.isArray(metrics)) {
      metrics = [metrics];
    }

    const { data, error } = await this.admin
      .from('agent_metrics')
      .insert(metrics)
      .select();

    if (error) {
      throw error;
    }

    return data;
  }

  /**
   * Log agent activity
   */
  async logActivity(logData) {
    if (!Array.isArray(logData)) {
      logData = [logData];
    }

    const { data, error } = await this.admin
      .from('agent_logs')
      .insert(logData)
      .select();

    if (error) {
      throw error;
    }

    return data;
  }

  /**
   * Get agent metrics with filters
   */
  async getMetrics(filters = {}) {
    let query = this.admin.from('agent_metrics').select('*');

    if (filters.agent_id) {
      query = query.eq('agent_id', filters.agent_id);
    }

    if (filters.tenant_id) {
      query = query.eq('tenant_id', filters.tenant_id);
    }

    if (filters.metric_type) {
      query = query.eq('metric_type', filters.metric_type);
    }

    if (filters.start_time) {
      query = query.gte('timestamp', filters.start_time);
    }

    if (filters.end_time) {
      query = query.lte('timestamp', filters.end_time);
    }

    if (filters.limit) {
      query = query.limit(filters.limit);
    }

    query = query.order('timestamp', { ascending: false });

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    return data;
  }

  /**
   * Get agent tasks with filters
   */
  async getTasks(filters = {}) {
    let query = this.admin.from('agent_tasks').select('*');

    if (filters.agent_id) {
      query = query.eq('agent_id', filters.agent_id);
    }

    if (filters.tenant_id) {
      query = query.eq('tenant_id', filters.tenant_id);
    }

    if (filters.status) {
      query = query.eq('status', filters.status);
    }

    if (filters.task_type) {
      query = query.eq('task_type', filters.task_type);
    }

    if (filters.start_time) {
      query = query.gte('created_at', filters.start_time);
    }

    if (filters.end_time) {
      query = query.lte('created_at', filters.end_time);
    }

    if (filters.limit) {
      query = query.limit(filters.limit);
    }

    query = query.order('created_at', { ascending: false });

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    return data;
  }

  /**
   * Get agent logs with filters
   */
  async getLogs(filters = {}) {
    let query = this.admin.from('agent_logs').select('*');

    if (filters.agent_id) {
      query = query.eq('agent_id', filters.agent_id);
    }

    if (filters.tenant_id) {
      query = query.eq('tenant_id', filters.tenant_id);
    }

    if (filters.level) {
      query = query.eq('level', filters.level);
    }

    if (filters.start_time) {
      query = query.gte('timestamp', filters.start_time);
    }

    if (filters.end_time) {
      query = query.lte('timestamp', filters.end_time);
    }

    if (filters.limit) {
      query = query.limit(filters.limit);
    }

    query = query.order('timestamp', { ascending: false });

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    return data;
  }

  /**
   * Get system statistics
   */
  async getSystemStats(tenantId, timeframe = '24h') {
    const timeframeDuration = this.parseTimeframe(timeframe);
    const startTime = new Date(Date.now() - timeframeDuration);

    try {
      // Get agent counts
      const { data: agents } = await this.admin
        .from('agents')
        .select('id, status, type')
        .eq('tenant_id', tenantId);

      // Get task counts
      const { data: tasks } = await this.admin
        .from('agent_tasks')
        .select('id, status, task_type')
        .eq('tenant_id', tenantId)
        .gte('created_at', startTime.toISOString());

      // Get error counts
      const { data: errors } = await this.admin
        .from('agent_logs')
        .select('id, level')
        .eq('tenant_id', tenantId)
        .eq('level', 'error')
        .gte('timestamp', startTime.toISOString());

      // Get recent metrics
      const { data: metrics } = await this.admin
        .from('agent_metrics')
        .select('metric_type, metric_value')
        .eq('tenant_id', tenantId)
        .gte('timestamp', startTime.toISOString());

      return {
        agents: {
          total: agents?.length || 0,
          active: agents?.filter(a => a.status === 'active').length || 0,
          inactive: agents?.filter(a => a.status === 'inactive').length || 0,
          error: agents?.filter(a => a.status === 'error').length || 0
        },
        tasks: {
          total: tasks?.length || 0,
          completed: tasks?.filter(t => t.status === 'completed').length || 0,
          failed: tasks?.filter(t => t.status === 'failed').length || 0,
          pending: tasks?.filter(t => t.status === 'pending').length || 0,
          running: tasks?.filter(t => t.status === 'running').length || 0
        },
        errors: {
          total: errors?.length || 0
        },
        performance: this.calculatePerformanceStats(metrics || [])
      };
    } catch (error) {
      console.error('Error getting system stats:', error);
      throw error;
    }
  }

  /**
   * Health check for database connection
   */
  async healthCheck() {
    try {
      const { data, error } = await this.admin
        .from('tenants')
        .select('count')
        .limit(1);

      return {
        status: error ? 'error' : 'healthy',
        error: error?.message,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Clean up old data
   */
  async cleanupOldData(retentionDays = 30) {
    const cutoffDate = new Date(Date.now() - (retentionDays * 24 * 60 * 60 * 1000));

    try {
      // Clean up old metrics
      const { error: metricsError } = await this.admin
        .from('agent_metrics')
        .delete()
        .lt('timestamp', cutoffDate.toISOString());

      if (metricsError) {
        console.error('Error cleaning up metrics:', metricsError);
      }

      // Clean up old logs (keep errors longer)
      const { error: logsError } = await this.admin
        .from('agent_logs')
        .delete()
        .lt('timestamp', cutoffDate.toISOString())
        .neq('level', 'error');

      if (logsError) {
        console.error('Error cleaning up logs:', logsError);
      }

      // Clean up old completed tasks
      const { error: tasksError } = await this.admin
        .from('agent_tasks')
        .delete()
        .lt('created_at', cutoffDate.toISOString())
        .eq('status', 'completed');

      if (tasksError) {
        console.error('Error cleaning up tasks:', tasksError);
      }

      return {
        success: true,
        cleaned_before: cutoffDate.toISOString()
      };
    } catch (error) {
      console.error('Error in cleanup:', error);
      throw error;
    }
  }

  /**
   * Utility functions
   */
  parseTimeframe(timeframe) {
    const unit = timeframe.slice(-1);
    const value = parseInt(timeframe.slice(0, -1));
    
    switch (unit) {
      case 'h': return value * 3600000; // hours to milliseconds
      case 'd': return value * 86400000; // days to milliseconds
      case 'w': return value * 604800000; // weeks to milliseconds
      default: return 86400000; // default to 24 hours
    }
  }

  calculatePerformanceStats(metrics) {
    if (!metrics.length) {
      return {
        avg_response_time: 0,
        avg_success_rate: 0,
        avg_throughput: 0
      };
    }

    const responseTimeMetrics = metrics.filter(m => m.metric_type === 'response_time');
    const successRateMetrics = metrics.filter(m => m.metric_type === 'success_rate');
    const throughputMetrics = metrics.filter(m => m.metric_type === 'throughput');

    return {
      avg_response_time: responseTimeMetrics.length > 0
        ? responseTimeMetrics.reduce((sum, m) => sum + m.metric_value, 0) / responseTimeMetrics.length
        : 0,
      avg_success_rate: successRateMetrics.length > 0
        ? successRateMetrics.reduce((sum, m) => sum + m.metric_value, 0) / successRateMetrics.length
        : 0,
      avg_throughput: throughputMetrics.length > 0
        ? throughputMetrics.reduce((sum, m) => sum + m.metric_value, 0) / throughputMetrics.length
        : 0
    };
  }

  /**
   * Batch operations
   */
  async batchInsert(table, records, batchSize = 100) {
    const results = [];
    
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      
      const { data, error } = await this.admin
        .from(table)
        .insert(batch)
        .select();

      if (error) {
        throw error;
      }

      results.push(...data);
    }

    return results;
  }

  /**
   * Transaction-like operations using RPC
   */
  async executeTransaction(operations) {
    // This would require custom PostgreSQL functions for complex transactions
    // For now, we'll execute operations sequentially
    const results = [];
    
    for (const operation of operations) {
      try {
        const result = await this[operation.method](...operation.args);
        results.push({ success: true, result });
      } catch (error) {
        results.push({ success: false, error: error.message });
        // Optionally break on first error for transaction-like behavior
        break;
      }
    }

    return results;
  }
}

// Export singleton instance
const dbUtils = new DatabaseUtils();

module.exports = {
  DatabaseUtils,
  dbUtils,
  supabaseAdmin,
  supabaseClient
};

