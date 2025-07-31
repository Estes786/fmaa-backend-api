const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Agent Factory - Core orchestration system
module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { method } = req;
    const tenantId = req.headers['x-tenant-id'] || 'default';

    switch (method) {
      case 'GET':
        return await handleGetAgents(req, res, tenantId);
      case 'POST':
        return await handleCreateAgent(req, res, tenantId);
      case 'PUT':
        return await handleUpdateAgent(req, res, tenantId);
      case 'DELETE':
        return await handleDeleteAgent(req, res, tenantId);
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Agent Factory Error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
};

// Get all agents for a tenant
async function handleGetAgents(req, res, tenantId) {
  const { data: agents, error } = await supabase
    .from('agents')
    .select(`
      *,
      agent_tasks!inner(
        id,
        status,
        created_at
      ),
      agent_metrics!inner(
        metric_type,
        metric_value,
        timestamp
      )
    `)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  // Aggregate metrics for each agent
  const agentsWithMetrics = agents.map(agent => {
    const recentMetrics = agent.agent_metrics
      .filter(m => new Date(m.timestamp) > new Date(Date.now() - 3600000)) // Last hour
      .reduce((acc, metric) => {
        acc[metric.metric_type] = metric.metric_value;
        return acc;
      }, {});

    const activeTasks = agent.agent_tasks
      .filter(task => ['pending', 'running'].includes(task.status))
      .length;

    return {
      ...agent,
      metrics: recentMetrics,
      activeTasks,
      agent_tasks: undefined,
      agent_metrics: undefined
    };
  });

  return res.status(200).json({
    success: true,
    agents: agentsWithMetrics,
    total: agentsWithMetrics.length
  });
}

// Create new agent
async function handleCreateAgent(req, res, tenantId) {
  const { name, type, config = {} } = req.body;

  if (!name || !type) {
    return res.status(400).json({ 
      error: 'Missing required fields: name, type' 
    });
  }

  const supportedTypes = ['sentiment-analysis', 'recommendation', 'performance-monitor'];
  if (!supportedTypes.includes(type)) {
    return res.status(400).json({ 
      error: `Unsupported agent type. Supported types: ${supportedTypes.join(', ')}` 
    });
  }

  const agentId = uuidv4();
  const agentData = {
    id: agentId,
    tenant_id: tenantId,
    name,
    type,
    config,
    status: 'deploying',
    version: '1.0.0',
    endpoint_url: `/api/${type}`,
    health_check_url: `/api/${type}/health`
  };

  const { data: agent, error } = await supabase
    .from('agents')
    .insert([agentData])
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  // Simulate deployment process
  setTimeout(async () => {
    await deployAgent(agentId, type, config);
  }, 1000);

  // Log agent creation
  await logAgentActivity(agentId, tenantId, 'info', `Agent ${name} created and deployment initiated`);

  return res.status(201).json({
    success: true,
    agent,
    message: 'Agent created successfully and deployment initiated'
  });
}

// Update agent configuration
async function handleUpdateAgent(req, res, tenantId) {
  const agentId = req.query.id;
  const updates = req.body;

  if (!agentId) {
    return res.status(400).json({ error: 'Agent ID is required' });
  }

  const { data: agent, error } = await supabase
    .from('agents')
    .update(updates)
    .eq('id', agentId)
    .eq('tenant_id', tenantId)
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  await logAgentActivity(agentId, tenantId, 'info', `Agent ${agent.name} updated`);

  return res.status(200).json({
    success: true,
    agent,
    message: 'Agent updated successfully'
  });
}

// Delete agent
async function handleDeleteAgent(req, res, tenantId) {
  const agentId = req.query.id;

  if (!agentId) {
    return res.status(400).json({ error: 'Agent ID is required' });
  }

  // First get agent info for logging
  const { data: agent } = await supabase
    .from('agents')
    .select('name')
    .eq('id', agentId)
    .eq('tenant_id', tenantId)
    .single();

  // Delete agent (cascade will handle related records)
  const { error } = await supabase
    .from('agents')
    .delete()
    .eq('id', agentId)
    .eq('tenant_id', tenantId);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  if (agent) {
    await logAgentActivity(agentId, tenantId, 'info', `Agent ${agent.name} deleted`);
  }

  return res.status(200).json({
    success: true,
    message: 'Agent deleted successfully'
  });
}

// Deploy agent (simulate deployment process)
async function deployAgent(agentId, type, config) {
  try {
    // Simulate deployment delay
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Update agent status to active
    await supabase
      .from('agents')
      .update({ 
        status: 'active',
        last_health_check: new Date().toISOString()
      })
      .eq('id', agentId);

    // Initialize agent metrics
    const initialMetrics = [
      { agent_id: agentId, metric_type: 'response_time', metric_value: 150, unit: 'ms' },
      { agent_id: agentId, metric_type: 'success_rate', metric_value: 100, unit: 'percentage' },
      { agent_id: agentId, metric_type: 'throughput', metric_value: 10, unit: 'requests_per_second' }
    ];

    await supabase
      .from('agent_metrics')
      .insert(initialMetrics);

    console.log(`Agent ${agentId} deployed successfully`);
  } catch (error) {
    console.error(`Failed to deploy agent ${agentId}:`, error);
    
    // Update agent status to error
    await supabase
      .from('agents')
      .update({ status: 'error' })
      .eq('id', agentId);
  }
}

// Log agent activity
async function logAgentActivity(agentId, tenantId, level, message, context = {}) {
  await supabase
    .from('agent_logs')
    .insert([{
      agent_id: agentId,
      tenant_id: tenantId,
      level,
      message,
      context
    }]);
}

