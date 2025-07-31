const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Performance Monitor Agent
module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { method, url } = req;
    const tenantId = req.headers['x-tenant-id'] || 'default';

    // Route handling
    if (url.includes('/health')) {
      return handleHealthCheck(req, res);
    } else if (url.includes('/report')) {
      return handlePerformanceReport(req, res, tenantId);
    } else if (method === 'POST') {
      return handleMonitoringTask(req, res, tenantId);
    } else if (method === 'GET') {
      return handleSystemOverview(req, res, tenantId);
    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Performance Monitor Error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
};

// Health check endpoint
async function handleHealthCheck(req, res) {
  const healthStatus = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    agent_type: 'performance-monitor',
    dependencies: {
      database: await checkDatabaseConnection(),
      monitoring_capabilities: await checkMonitoringCapabilities()
    }
  };

  const isHealthy = Object.values(healthStatus.dependencies).every(dep => dep.status === 'ok');
  
  return res.status(isHealthy ? 200 : 503).json(healthStatus);
}

// System overview endpoint
async function handleSystemOverview(req, res, tenantId) {
  try {
    const overview = await generateSystemOverview(tenantId);
    return res.status(200).json({
      success: true,
      overview,
      generated_at: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

// Performance report endpoint
async function handlePerformanceReport(req, res, tenantId) {
  try {
    const { timeframe = '24h', agent_types, detailed = false } = req.query;
    
    const report = await generatePerformanceReport({
      tenantId,
      timeframe,
      agent_types: agent_types ? agent_types.split(',') : null,
      detailed: detailed === 'true'
    });
    
    return res.status(200).json({
      success: true,
      report,
      generated_at: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

// Monitoring task endpoint
async function handleMonitoringTask(req, res, tenantId) {
  const startTime = Date.now();
  const { task_type, target_agents, monitoring_config, taskId } = req.body;

  if (!task_type) {
    return res.status(400).json({ error: 'task_type is required' });
  }

  try {
    // Get performance monitor agent info
    const { data: agent } = await supabase
      .from('agents')
      .select('*')
      .eq('type', 'performance-monitor')
      .eq('tenant_id', tenantId)
      .single();

    if (!agent) {
      return res.status(404).json({ error: 'Performance monitor agent not found for this tenant' });
    }

    // Create task record if taskId provided
    let task = null;
    if (taskId) {
      const { data: taskData } = await supabase
        .from('agent_tasks')
        .insert([{
          id: taskId,
          agent_id: agent.id,
          tenant_id: tenantId,
          task_type: 'performance_monitoring',
          input_data: { task_type, target_agents, monitoring_config },
          status: 'running',
          started_at: new Date().toISOString()
        }])
        .select()
        .single();
      task = taskData;
    }

    // Execute monitoring task
    const result = await executeMonitoringTask({
      task_type,
      target_agents,
      monitoring_config,
      tenantId
    });
    
    const responseTime = Date.now() - startTime;
    
    // Update task if exists
    if (task) {
      await supabase
        .from('agent_tasks')
        .update({
          output_data: result,
          status: 'completed',
          completed_at: new Date().toISOString()
        })
        .eq('id', taskId);
    }

    // Log metrics
    await logMetrics(agent.id, tenantId, responseTime, true);

    // Log activity
    await logActivity(agent.id, tenantId, 'info', 
      `Executed monitoring task: ${task_type}`, 
      { response_time: responseTime, task_type, target_count: target_agents?.length || 0 }
    );

    return res.status(200).json({
      success: true,
      result,
      metadata: {
        response_time_ms: responseTime,
        task_type,
        task_id: taskId,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    const responseTime = Date.now() - startTime;
    
    // Log failed metrics
    await logMetrics(agent?.id, tenantId, responseTime, false);
    
    // Update task status if exists
    if (taskId) {
      await supabase
        .from('agent_tasks')
        .update({
          status: 'failed',
          error_message: error.message,
          completed_at: new Date().toISOString()
        })
        .eq('id', taskId);
    }

    return res.status(500).json({ 
      error: 'Monitoring task failed',
      message: error.message 
    });
  }
}

// Generate system overview
async function generateSystemOverview(tenantId) {
  // Get all agents
  const { data: agents } = await supabase
    .from('agents')
    .select('*')
    .eq('tenant_id', tenantId);

  // Get recent metrics (last hour)
  const { data: recentMetrics } = await supabase
    .from('agent_metrics')
    .select('*')
    .eq('tenant_id', tenantId)
    .gte('timestamp', new Date(Date.now() - 3600000).toISOString());

  // Get recent tasks (last 24 hours)
  const { data: recentTasks } = await supabase
    .from('agent_tasks')
    .select('*')
    .eq('tenant_id', tenantId)
    .gte('created_at', new Date(Date.now() - 86400000).toISOString());

  // Get recent logs (last hour, errors only)
  const { data: recentErrors } = await supabase
    .from('agent_logs')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('level', 'error')
    .gte('timestamp', new Date(Date.now() - 3600000).toISOString())
    .order('timestamp', { ascending: false })
    .limit(10);

  // Calculate system health
  const systemHealth = calculateSystemHealth(agents, recentMetrics, recentTasks);
  
  // Agent status summary
  const agentStatusSummary = agents.reduce((acc, agent) => {
    acc[agent.status] = (acc[agent.status] || 0) + 1;
    return acc;
  }, {});

  // Performance summary
  const performanceSummary = calculatePerformanceSummary(recentMetrics);
  
  // Task summary
  const taskSummary = calculateTaskSummary(recentTasks);

  return {
    system_health: systemHealth,
    agent_count: agents.length,
    agent_status_summary: agentStatusSummary,
    performance_summary: performanceSummary,
    task_summary: taskSummary,
    recent_errors: recentErrors,
    uptime_info: await getUptimeInfo(tenantId),
    resource_usage: await getResourceUsage(tenantId)
  };
}

// Generate detailed performance report
async function generatePerformanceReport({ tenantId, timeframe, agent_types, detailed }) {
  const timeframeDuration = parseTimeframe(timeframe);
  const startTime = new Date(Date.now() - timeframeDuration);

  // Build query filters
  let agentQuery = supabase
    .from('agents')
    .select('*')
    .eq('tenant_id', tenantId);

  if (agent_types) {
    agentQuery = agentQuery.in('type', agent_types);
  }

  const { data: agents } = await agentQuery;

  // Get metrics for the timeframe
  const { data: metrics } = await supabase
    .from('agent_metrics')
    .select('*')
    .eq('tenant_id', tenantId)
    .gte('timestamp', startTime.toISOString())
    .order('timestamp', { ascending: true });

  // Get tasks for the timeframe
  const { data: tasks } = await supabase
    .from('agent_tasks')
    .select('*')
    .eq('tenant_id', tenantId)
    .gte('created_at', startTime.toISOString())
    .order('created_at', { ascending: true });

  // Get logs for the timeframe
  const { data: logs } = await supabase
    .from('agent_logs')
    .select('*')
    .eq('tenant_id', tenantId)
    .gte('timestamp', startTime.toISOString())
    .order('timestamp', { ascending: true });

  // Generate report sections
  const report = {
    timeframe: {
      duration: timeframe,
      start_time: startTime.toISOString(),
      end_time: new Date().toISOString()
    },
    summary: generateReportSummary(agents, metrics, tasks, logs),
    agent_performance: generateAgentPerformanceReport(agents, metrics, tasks),
    system_trends: generateSystemTrends(metrics, tasks, timeframeDuration),
    error_analysis: generateErrorAnalysis(logs, tasks),
    recommendations: generatePerformanceRecommendations(agents, metrics, tasks, logs)
  };

  if (detailed) {
    report.detailed_metrics = generateDetailedMetrics(metrics);
    report.task_breakdown = generateTaskBreakdown(tasks);
    report.log_analysis = generateLogAnalysis(logs);
  }

  return report;
}

// Execute monitoring task
async function executeMonitoringTask({ task_type, target_agents, monitoring_config, tenantId }) {
  switch (task_type) {
    case 'health_check':
      return await performHealthCheck(target_agents, tenantId);
    
    case 'performance_audit':
      return await performPerformanceAudit(target_agents, monitoring_config, tenantId);
    
    case 'load_test':
      return await performLoadTest(target_agents, monitoring_config, tenantId);
    
    case 'anomaly_detection':
      return await performAnomalyDetection(target_agents, monitoring_config, tenantId);
    
    case 'capacity_planning':
      return await performCapacityPlanning(target_agents, monitoring_config, tenantId);
    
    default:
      throw new Error(`Unsupported monitoring task type: ${task_type}`);
  }
}

// Perform health check on target agents
async function performHealthCheck(target_agents, tenantId) {
  const results = [];
  
  for (const agentId of target_agents || []) {
    try {
      const { data: agent } = await supabase
        .from('agents')
        .select('*')
        .eq('id', agentId)
        .eq('tenant_id', tenantId)
        .single();

      if (!agent) {
        results.push({
          agent_id: agentId,
          status: 'not_found',
          message: 'Agent not found'
        });
        continue;
      }

      // Check agent health endpoint
      const healthCheck = await checkAgentHealth(agent);
      
      // Update last health check timestamp
      await supabase
        .from('agents')
        .update({ last_health_check: new Date().toISOString() })
        .eq('id', agentId);

      results.push({
        agent_id: agentId,
        agent_name: agent.name,
        agent_type: agent.type,
        status: healthCheck.status,
        response_time: healthCheck.response_time,
        details: healthCheck.details
      });

    } catch (error) {
      results.push({
        agent_id: agentId,
        status: 'error',
        message: error.message
      });
    }
  }

  return {
    task_type: 'health_check',
    total_agents: results.length,
    healthy_agents: results.filter(r => r.status === 'healthy').length,
    unhealthy_agents: results.filter(r => r.status !== 'healthy').length,
    results
  };
}

// Perform performance audit
async function performPerformanceAudit(target_agents, config, tenantId) {
  const auditResults = [];
  const timeWindow = config?.time_window || '1h';
  const timeframeDuration = parseTimeframe(timeWindow);
  const startTime = new Date(Date.now() - timeframeDuration);

  for (const agentId of target_agents || []) {
    // Get agent metrics for the time window
    const { data: metrics } = await supabase
      .from('agent_metrics')
      .select('*')
      .eq('agent_id', agentId)
      .gte('timestamp', startTime.toISOString());

    // Get agent tasks for the time window
    const { data: tasks } = await supabase
      .from('agent_tasks')
      .select('*')
      .eq('agent_id', agentId)
      .gte('created_at', startTime.toISOString());

    const audit = {
      agent_id: agentId,
      time_window: timeWindow,
      metrics_summary: analyzeMetrics(metrics),
      task_performance: analyzeTaskPerformance(tasks),
      performance_score: calculatePerformanceScore(metrics, tasks),
      issues: identifyPerformanceIssues(metrics, tasks),
      recommendations: generateAgentRecommendations(metrics, tasks)
    };

    auditResults.push(audit);
  }

  return {
    task_type: 'performance_audit',
    audit_results: auditResults,
    overall_score: auditResults.reduce((sum, audit) => sum + audit.performance_score, 0) / auditResults.length
  };
}

// Perform load test simulation
async function performLoadTest(target_agents, config, tenantId) {
  const loadTestResults = [];
  const concurrency = config?.concurrency || 10;
  const duration = config?.duration || 60; // seconds
  const requestsPerSecond = config?.requests_per_second || 5;

  for (const agentId of target_agents || []) {
    const { data: agent } = await supabase
      .from('agents')
      .select('*')
      .eq('id', agentId)
      .eq('tenant_id', tenantId)
      .single();

    if (!agent) continue;

    // Simulate load test
    const loadTestResult = await simulateLoadTest(agent, {
      concurrency,
      duration,
      requestsPerSecond
    });

    loadTestResults.push({
      agent_id: agentId,
      agent_type: agent.type,
      load_test_config: { concurrency, duration, requestsPerSecond },
      results: loadTestResult
    });
  }

  return {
    task_type: 'load_test',
    test_results: loadTestResults
  };
}

// Perform anomaly detection
async function performAnomalyDetection(target_agents, config, tenantId) {
  const anomalies = [];
  const sensitivity = config?.sensitivity || 'medium';
  const timeWindow = config?.time_window || '24h';
  const timeframeDuration = parseTimeframe(timeWindow);
  const startTime = new Date(Date.now() - timeframeDuration);

  for (const agentId of target_agents || []) {
    // Get historical metrics
    const { data: metrics } = await supabase
      .from('agent_metrics')
      .select('*')
      .eq('agent_id', agentId)
      .gte('timestamp', startTime.toISOString())
      .order('timestamp', { ascending: true });

    // Detect anomalies in metrics
    const detectedAnomalies = detectMetricAnomalies(metrics, sensitivity);
    
    if (detectedAnomalies.length > 0) {
      anomalies.push({
        agent_id: agentId,
        anomalies: detectedAnomalies
      });
    }
  }

  return {
    task_type: 'anomaly_detection',
    detection_config: { sensitivity, time_window: timeWindow },
    anomalies_found: anomalies.length,
    anomalies
  };
}

// Perform capacity planning analysis
async function performCapacityPlanning(target_agents, config, tenantId) {
  const planningResults = [];
  const projectionPeriod = config?.projection_period || '30d';
  const growthRate = config?.expected_growth_rate || 0.1; // 10% growth

  for (const agentId of target_agents || []) {
    // Get historical data for trend analysis
    const { data: metrics } = await supabase
      .from('agent_metrics')
      .select('*')
      .eq('agent_id', agentId)
      .gte('timestamp', new Date(Date.now() - 7 * 24 * 3600000).toISOString()) // Last 7 days
      .order('timestamp', { ascending: true });

    const { data: tasks } = await supabase
      .from('agent_tasks')
      .select('*')
      .eq('agent_id', agentId)
      .gte('created_at', new Date(Date.now() - 7 * 24 * 3600000).toISOString())
      .order('created_at', { ascending: true });

    const capacityAnalysis = analyzeCapacity(metrics, tasks, growthRate, projectionPeriod);
    
    planningResults.push({
      agent_id: agentId,
      current_capacity: capacityAnalysis.current,
      projected_capacity: capacityAnalysis.projected,
      recommendations: capacityAnalysis.recommendations,
      scaling_timeline: capacityAnalysis.timeline
    });
  }

  return {
    task_type: 'capacity_planning',
    planning_results: planningResults
  };
}

// Utility functions
function parseTimeframe(timeframe) {
  const unit = timeframe.slice(-1);
  const value = parseInt(timeframe.slice(0, -1));
  
  switch (unit) {
    case 'h': return value * 3600000; // hours to milliseconds
    case 'd': return value * 86400000; // days to milliseconds
    case 'w': return value * 604800000; // weeks to milliseconds
    default: return 86400000; // default to 24 hours
  }
}

function calculateSystemHealth(agents, metrics, tasks) {
  const activeAgents = agents.filter(a => a.status === 'active').length;
  const totalAgents = agents.length;
  
  const recentSuccessfulTasks = tasks.filter(t => t.status === 'completed').length;
  const totalRecentTasks = tasks.length;
  
  const avgResponseTime = metrics
    .filter(m => m.metric_type === 'response_time')
    .reduce((sum, m, _, arr) => sum + m.metric_value / arr.length, 0);

  let healthScore = 0;
  
  // Agent availability (40% weight)
  healthScore += (activeAgents / Math.max(totalAgents, 1)) * 40;
  
  // Task success rate (40% weight)
  healthScore += (recentSuccessfulTasks / Math.max(totalRecentTasks, 1)) * 40;
  
  // Response time (20% weight) - lower is better
  const responseTimeScore = Math.max(0, 100 - (avgResponseTime / 10)); // Assume 1000ms = 0 score
  healthScore += (responseTimeScore / 100) * 20;

  return {
    score: Math.round(healthScore),
    status: healthScore >= 80 ? 'excellent' : healthScore >= 60 ? 'good' : healthScore >= 40 ? 'fair' : 'poor',
    factors: {
      agent_availability: Math.round((activeAgents / Math.max(totalAgents, 1)) * 100),
      task_success_rate: Math.round((recentSuccessfulTasks / Math.max(totalRecentTasks, 1)) * 100),
      avg_response_time: Math.round(avgResponseTime)
    }
  };
}

function calculatePerformanceSummary(metrics) {
  const metricsByType = metrics.reduce((acc, metric) => {
    if (!acc[metric.metric_type]) {
      acc[metric.metric_type] = [];
    }
    acc[metric.metric_type].push(metric.metric_value);
    return acc;
  }, {});

  const summary = {};
  for (const [type, values] of Object.entries(metricsByType)) {
    summary[type] = {
      average: values.reduce((sum, val) => sum + val, 0) / values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      count: values.length
    };
  }

  return summary;
}

function calculateTaskSummary(tasks) {
  const statusCounts = tasks.reduce((acc, task) => {
    acc[task.status] = (acc[task.status] || 0) + 1;
    return acc;
  }, {});

  const completedTasks = tasks.filter(t => t.status === 'completed' && t.started_at && t.completed_at);
  const avgDuration = completedTasks.length > 0
    ? completedTasks.reduce((sum, task) => {
        return sum + (new Date(task.completed_at) - new Date(task.started_at));
      }, 0) / completedTasks.length
    : 0;

  return {
    total: tasks.length,
    by_status: statusCounts,
    average_duration_ms: Math.round(avgDuration),
    success_rate: tasks.length > 0 ? Math.round((statusCounts.completed || 0) / tasks.length * 100) : 0
  };
}

// Additional utility functions would continue here...
// (checkAgentHealth, simulateLoadTest, detectMetricAnomalies, etc.)

async function checkAgentHealth(agent) {
  // Simulate health check - in real implementation, this would call the agent's health endpoint
  const startTime = Date.now();
  
  try {
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 50));
    
    const responseTime = Date.now() - startTime;
    
    return {
      status: 'healthy',
      response_time: responseTime,
      details: {
        endpoint: agent.health_check_url,
        version: agent.version,
        last_check: new Date().toISOString()
      }
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      response_time: Date.now() - startTime,
      details: {
        error: error.message
      }
    };
  }
}

async function simulateLoadTest(agent, config) {
  // Simulate load test results
  const { concurrency, duration, requestsPerSecond } = config;
  const totalRequests = requestsPerSecond * duration;
  
  // Simulate realistic performance degradation under load
  const baseResponseTime = 150;
  const maxResponseTime = baseResponseTime * (1 + concurrency * 0.1);
  const successRate = Math.max(0.8, 1 - (concurrency * 0.02));
  
  return {
    total_requests: totalRequests,
    successful_requests: Math.round(totalRequests * successRate),
    failed_requests: Math.round(totalRequests * (1 - successRate)),
    average_response_time: Math.round(baseResponseTime + (Math.random() * (maxResponseTime - baseResponseTime))),
    min_response_time: Math.round(baseResponseTime * 0.8),
    max_response_time: Math.round(maxResponseTime),
    requests_per_second_achieved: requestsPerSecond * successRate,
    error_rate: Math.round((1 - successRate) * 100),
    duration_seconds: duration
  };
}

function detectMetricAnomalies(metrics, sensitivity) {
  // Simple anomaly detection based on statistical outliers
  const anomalies = [];
  const metricsByType = metrics.reduce((acc, metric) => {
    if (!acc[metric.metric_type]) {
      acc[metric.metric_type] = [];
    }
    acc[metric.metric_type].push(metric);
    return acc;
  }, {});

  const sensitivityThresholds = {
    low: 3,
    medium: 2.5,
    high: 2
  };
  
  const threshold = sensitivityThresholds[sensitivity] || 2.5;

  for (const [type, typeMetrics] of Object.entries(metricsByType)) {
    const values = typeMetrics.map(m => m.metric_value);
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);

    typeMetrics.forEach(metric => {
      const zScore = Math.abs((metric.metric_value - mean) / stdDev);
      if (zScore > threshold) {
        anomalies.push({
          metric_id: metric.id,
          metric_type: type,
          value: metric.metric_value,
          expected_range: [mean - threshold * stdDev, mean + threshold * stdDev],
          z_score: zScore,
          timestamp: metric.timestamp,
          severity: zScore > threshold * 1.5 ? 'high' : 'medium'
        });
      }
    });
  }

  return anomalies;
}

function analyzeCapacity(metrics, tasks, growthRate, projectionPeriod) {
  // Analyze current capacity and project future needs
  const currentThroughput = tasks.length / 7; // tasks per day over last 7 days
  const avgResponseTime = metrics
    .filter(m => m.metric_type === 'response_time')
    .reduce((sum, m, _, arr) => sum + m.metric_value / arr.length, 0);

  const projectionDays = parseTimeframe(projectionPeriod) / 86400000;
  const projectedThroughput = currentThroughput * Math.pow(1 + growthRate, projectionDays / 30);

  return {
    current: {
      throughput_per_day: Math.round(currentThroughput),
      avg_response_time: Math.round(avgResponseTime),
      utilization: Math.min(100, (currentThroughput / 100) * 100) // Assume 100 tasks/day is max capacity
    },
    projected: {
      throughput_per_day: Math.round(projectedThroughput),
      estimated_response_time: Math.round(avgResponseTime * (projectedThroughput / currentThroughput)),
      estimated_utilization: Math.min(100, (projectedThroughput / 100) * 100)
    },
    recommendations: generateCapacityRecommendations(currentThroughput, projectedThroughput, avgResponseTime),
    timeline: generateScalingTimeline(projectionDays, growthRate)
  };
}

function generateCapacityRecommendations(current, projected, responseTime) {
  const recommendations = [];
  
  if (projected > current * 2) {
    recommendations.push({
      priority: 'high',
      action: 'Scale infrastructure',
      reason: 'Projected load will exceed current capacity by more than 100%'
    });
  }
  
  if (responseTime > 500) {
    recommendations.push({
      priority: 'medium',
      action: 'Optimize performance',
      reason: 'Current response time is above optimal threshold'
    });
  }
  
  if (projected > current * 1.5) {
    recommendations.push({
      priority: 'medium',
      action: 'Plan capacity increase',
      reason: 'Projected load will exceed current capacity by 50%'
    });
  }

  return recommendations;
}

function generateScalingTimeline(projectionDays, growthRate) {
  const milestones = [];
  const checkpoints = [7, 14, 30, 60, 90]; // days
  
  checkpoints.forEach(days => {
    if (days <= projectionDays) {
      const growthFactor = Math.pow(1 + growthRate, days / 30);
      milestones.push({
        day: days,
        growth_factor: Math.round(growthFactor * 100) / 100,
        action_required: growthFactor > 1.5 ? 'Scale up' : growthFactor > 1.2 ? 'Monitor closely' : 'Normal operation'
      });
    }
  });

  return milestones;
}

// Standard utility functions (same as other agents)
async function checkDatabaseConnection() {
  try {
    const { data, error } = await supabase
      .from('agents')
      .select('count')
      .limit(1);
    
    return {
      status: error ? 'error' : 'ok',
      error: error?.message
    };
  } catch (error) {
    return {
      status: 'error',
      error: error.message
    };
  }
}

async function checkMonitoringCapabilities() {
  // Check if monitoring functions are working
  try {
    const testMetrics = await calculatePerformanceSummary([]);
    return {
      status: 'ok',
      capabilities: ['health_check', 'performance_audit', 'load_test', 'anomaly_detection', 'capacity_planning']
    };
  } catch (error) {
    return {
      status: 'error',
      error: error.message
    };
  }
}

async function getUptimeInfo(tenantId) {
  // Get system uptime information
  const { data: oldestAgent } = await supabase
    .from('agents')
    .select('created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true })
    .limit(1)
    .single();

  const systemStartTime = oldestAgent ? new Date(oldestAgent.created_at) : new Date();
  const uptime = Date.now() - systemStartTime.getTime();

  return {
    system_start_time: systemStartTime.toISOString(),
    uptime_ms: uptime,
    uptime_days: Math.floor(uptime / 86400000),
    uptime_hours: Math.floor((uptime % 86400000) / 3600000)
  };
}

async function getResourceUsage(tenantId) {
  // Get resource usage statistics
  const { data: agents } = await supabase
    .from('agents')
    .select('id')
    .eq('tenant_id', tenantId);

  const { data: tasks } = await supabase
    .from('agent_tasks')
    .select('id')
    .eq('tenant_id', tenantId)
    .gte('created_at', new Date(Date.now() - 86400000).toISOString());

  const { data: metrics } = await supabase
    .from('agent_metrics')
    .select('id')
    .eq('tenant_id', tenantId)
    .gte('timestamp', new Date(Date.now() - 86400000).toISOString());

  return {
    active_agents: agents?.length || 0,
    tasks_last_24h: tasks?.length || 0,
    metrics_last_24h: metrics?.length || 0,
    estimated_storage_mb: ((tasks?.length || 0) * 0.1) + ((metrics?.length || 0) * 0.05) // Rough estimate
  };
}

// Additional report generation functions
function generateReportSummary(agents, metrics, tasks, logs) {
  return {
    total_agents: agents.length,
    active_agents: agents.filter(a => a.status === 'active').length,
    total_metrics: metrics.length,
    total_tasks: tasks.length,
    total_logs: logs.length,
    error_count: logs.filter(l => l.level === 'error').length,
    success_rate: tasks.length > 0 ? Math.round((tasks.filter(t => t.status === 'completed').length / tasks.length) * 100) : 0
  };
}

function generateAgentPerformanceReport(agents, metrics, tasks) {
  return agents.map(agent => {
    const agentMetrics = metrics.filter(m => m.agent_id === agent.id);
    const agentTasks = tasks.filter(t => t.agent_id === agent.id);
    
    return {
      agent_id: agent.id,
      agent_name: agent.name,
      agent_type: agent.type,
      status: agent.status,
      metrics_count: agentMetrics.length,
      tasks_count: agentTasks.length,
      avg_response_time: agentMetrics
        .filter(m => m.metric_type === 'response_time')
        .reduce((sum, m, _, arr) => sum + m.metric_value / arr.length, 0),
      success_rate: agentTasks.length > 0 
        ? Math.round((agentTasks.filter(t => t.status === 'completed').length / agentTasks.length) * 100)
        : 0
    };
  });
}

function generateSystemTrends(metrics, tasks, timeframeDuration) {
  // Generate trend analysis over the timeframe
  const intervals = 10; // Divide timeframe into 10 intervals
  const intervalDuration = timeframeDuration / intervals;
  const trends = [];

  for (let i = 0; i < intervals; i++) {
    const intervalStart = new Date(Date.now() - timeframeDuration + (i * intervalDuration));
    const intervalEnd = new Date(intervalStart.getTime() + intervalDuration);
    
    const intervalMetrics = metrics.filter(m => {
      const timestamp = new Date(m.timestamp);
      return timestamp >= intervalStart && timestamp < intervalEnd;
    });
    
    const intervalTasks = tasks.filter(t => {
      const timestamp = new Date(t.created_at);
      return timestamp >= intervalStart && timestamp < intervalEnd;
    });

    trends.push({
      interval: i + 1,
      start_time: intervalStart.toISOString(),
      end_time: intervalEnd.toISOString(),
      metrics_count: intervalMetrics.length,
      tasks_count: intervalTasks.length,
      avg_response_time: intervalMetrics
        .filter(m => m.metric_type === 'response_time')
        .reduce((sum, m, _, arr) => arr.length > 0 ? sum + m.metric_value / arr.length : 0, 0)
    });
  }

  return trends;
}

function generateErrorAnalysis(logs, tasks) {
  const errorLogs = logs.filter(l => l.level === 'error');
  const failedTasks = tasks.filter(t => t.status === 'failed');
  
  const errorsByAgent = errorLogs.reduce((acc, log) => {
    acc[log.agent_id] = (acc[log.agent_id] || 0) + 1;
    return acc;
  }, {});

  const commonErrors = errorLogs.reduce((acc, log) => {
    const errorType = log.message.split(':')[0] || 'Unknown';
    acc[errorType] = (acc[errorType] || 0) + 1;
    return acc;
  }, {});

  return {
    total_errors: errorLogs.length,
    failed_tasks: failedTasks.length,
    errors_by_agent: errorsByAgent,
    common_error_types: Object.entries(commonErrors)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([type, count]) => ({ type, count }))
  };
}

function generatePerformanceRecommendations(agents, metrics, tasks, logs) {
  const recommendations = [];
  
  // Check for high response times
  const avgResponseTime = metrics
    .filter(m => m.metric_type === 'response_time')
    .reduce((sum, m, _, arr) => sum + m.metric_value / arr.length, 0);
  
  if (avgResponseTime > 1000) {
    recommendations.push({
      priority: 'high',
      category: 'performance',
      title: 'High Response Times Detected',
      description: `Average response time is ${Math.round(avgResponseTime)}ms, which exceeds the recommended 1000ms threshold.`,
      actions: ['Optimize agent algorithms', 'Scale infrastructure', 'Review database queries']
    });
  }

  // Check for high error rates
  const errorRate = logs.filter(l => l.level === 'error').length / Math.max(logs.length, 1);
  if (errorRate > 0.05) { // 5% error rate
    recommendations.push({
      priority: 'high',
      category: 'reliability',
      title: 'High Error Rate Detected',
      description: `Error rate is ${Math.round(errorRate * 100)}%, which exceeds the recommended 5% threshold.`,
      actions: ['Review error logs', 'Implement better error handling', 'Add monitoring alerts']
    });
  }

  // Check for inactive agents
  const inactiveAgents = agents.filter(a => a.status !== 'active').length;
  if (inactiveAgents > 0) {
    recommendations.push({
      priority: 'medium',
      category: 'availability',
      title: 'Inactive Agents Found',
      description: `${inactiveAgents} agents are currently inactive.`,
      actions: ['Restart inactive agents', 'Check agent health', 'Review deployment status']
    });
  }

  return recommendations;
}

function generateDetailedMetrics(metrics) {
  const metricsByType = metrics.reduce((acc, metric) => {
    if (!acc[metric.metric_type]) {
      acc[metric.metric_type] = [];
    }
    acc[metric.metric_type].push(metric);
    return acc;
  }, {});

  const detailed = {};
  for (const [type, typeMetrics] of Object.entries(metricsByType)) {
    const values = typeMetrics.map(m => m.metric_value);
    detailed[type] = {
      count: values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      average: values.reduce((sum, val) => sum + val, 0) / values.length,
      median: calculateMedian(values),
      percentile_95: calculatePercentile(values, 95),
      standard_deviation: calculateStandardDeviation(values)
    };
  }

  return detailed;
}

function generateTaskBreakdown(tasks) {
  const breakdown = {
    by_type: {},
    by_status: {},
    by_agent: {},
    duration_analysis: {}
  };

  tasks.forEach(task => {
    // By type
    breakdown.by_type[task.task_type] = (breakdown.by_type[task.task_type] || 0) + 1;
    
    // By status
    breakdown.by_status[task.status] = (breakdown.by_status[task.status] || 0) + 1;
    
    // By agent
    breakdown.by_agent[task.agent_id] = (breakdown.by_agent[task.agent_id] || 0) + 1;
  });

  // Duration analysis for completed tasks
  const completedTasks = tasks.filter(t => t.status === 'completed' && t.started_at && t.completed_at);
  if (completedTasks.length > 0) {
    const durations = completedTasks.map(t => new Date(t.completed_at) - new Date(t.started_at));
    breakdown.duration_analysis = {
      count: durations.length,
      average_ms: durations.reduce((sum, d) => sum + d, 0) / durations.length,
      min_ms: Math.min(...durations),
      max_ms: Math.max(...durations),
      median_ms: calculateMedian(durations)
    };
  }

  return breakdown;
}

function generateLogAnalysis(logs) {
  const analysis = {
    by_level: {},
    by_agent: {},
    timeline: {},
    common_messages: {}
  };

  logs.forEach(log => {
    // By level
    analysis.by_level[log.level] = (analysis.by_level[log.level] || 0) + 1;
    
    // By agent
    analysis.by_agent[log.agent_id] = (analysis.by_agent[log.agent_id] || 0) + 1;
    
    // Timeline (by hour)
    const hour = new Date(log.timestamp).getHours();
    analysis.timeline[hour] = (analysis.timeline[hour] || 0) + 1;
    
    // Common messages
    const messageKey = log.message.substring(0, 50); // First 50 chars
    analysis.common_messages[messageKey] = (analysis.common_messages[messageKey] || 0) + 1;
  });

  return analysis;
}

// Mathematical utility functions
function calculateMedian(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 
    ? (sorted[mid - 1] + sorted[mid]) / 2 
    : sorted[mid];
}

function calculatePercentile(values, percentile) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

function calculateStandardDeviation(values) {
  const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

// Standard logging functions
async function logMetrics(agentId, tenantId, responseTime, success) {
  if (!agentId) return;

  const metrics = [
    {
      agent_id: agentId,
      tenant_id: tenantId,
      metric_type: 'response_time',
      metric_value: responseTime,
      unit: 'ms'
    }
  ];

  if (success !== undefined) {
    metrics.push({
      agent_id: agentId,
      tenant_id: tenantId,
      metric_type: 'success_rate',
      metric_value: success ? 100 : 0,
      unit: 'percentage'
    });
  }

  await supabase
    .from('agent_metrics')
    .insert(metrics);
}

async function logActivity(agentId, tenantId, level, message, context = {}) {
  if (!agentId) return;

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

