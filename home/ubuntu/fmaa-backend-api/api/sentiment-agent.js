const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Sentiment Analysis Agent
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
    } else if (url.includes('/status')) {
      return handleStatusCheck(req, res, tenantId);
    } else if (method === 'POST') {
      return handleSentimentAnalysis(req, res, tenantId);
    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Sentiment Agent Error:', error);
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
    agent_type: 'sentiment-analysis',
    dependencies: {
      huggingface_api: await checkHuggingFaceAPI(),
      database: await checkDatabaseConnection()
    }
  };

  const isHealthy = Object.values(healthStatus.dependencies).every(dep => dep.status === 'ok');
  
  return res.status(isHealthy ? 200 : 503).json(healthStatus);
}

// Status check with metrics
async function handleStatusCheck(req, res, tenantId) {
  try {
    // Get agent info
    const { data: agent } = await supabase
      .from('agents')
      .select('*')
      .eq('type', 'sentiment-analysis')
      .eq('tenant_id', tenantId)
      .single();

    if (!agent) {
      return res.status(404).json({ error: 'Sentiment agent not found for this tenant' });
    }

    // Get recent metrics
    const { data: metrics } = await supabase
      .from('agent_metrics')
      .select('*')
      .eq('agent_id', agent.id)
      .gte('timestamp', new Date(Date.now() - 3600000).toISOString()) // Last hour
      .order('timestamp', { ascending: false });

    // Get recent tasks
    const { data: tasks } = await supabase
      .from('agent_tasks')
      .select('*')
      .eq('agent_id', agent.id)
      .gte('created_at', new Date(Date.now() - 86400000).toISOString()) // Last 24 hours
      .order('created_at', { ascending: false })
      .limit(10);

    const status = {
      agent,
      metrics: processMetrics(metrics),
      recent_tasks: tasks,
      performance: calculatePerformanceStats(tasks)
    };

    return res.status(200).json(status);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

// Main sentiment analysis endpoint
async function handleSentimentAnalysis(req, res, tenantId) {
  const startTime = Date.now();
  const { text, taskId, options = {} } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'Text is required for sentiment analysis' });
  }

  if (text.length > 5000) {
    return res.status(400).json({ error: 'Text too long. Maximum 5000 characters allowed.' });
  }

  try {
    // Get agent info
    const { data: agent } = await supabase
      .from('agents')
      .select('*')
      .eq('type', 'sentiment-analysis')
      .eq('tenant_id', tenantId)
      .single();

    if (!agent) {
      return res.status(404).json({ error: 'Sentiment agent not found for this tenant' });
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
          task_type: 'sentiment_analysis',
          input_data: { text, options },
          status: 'running',
          started_at: new Date().toISOString()
        }])
        .select()
        .single();
      task = taskData;
    }

    // Perform sentiment analysis
    const sentimentResult = await analyzeSentiment(text, options);
    
    const responseTime = Date.now() - startTime;
    
    // Update task if exists
    if (task) {
      await supabase
        .from('agent_tasks')
        .update({
          output_data: sentimentResult,
          status: 'completed',
          completed_at: new Date().toISOString()
        })
        .eq('id', taskId);
    }

    // Log metrics
    await logMetrics(agent.id, tenantId, responseTime, true);

    // Log activity
    await logActivity(agent.id, tenantId, 'info', 
      `Sentiment analysis completed for text length: ${text.length}`, 
      { response_time: responseTime, sentiment: sentimentResult.label }
    );

    return res.status(200).json({
      success: true,
      result: sentimentResult,
      metadata: {
        response_time_ms: responseTime,
        text_length: text.length,
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
      error: 'Sentiment analysis failed',
      message: error.message 
    });
  }
}

// Perform sentiment analysis using Hugging Face API
async function analyzeSentiment(text, options = {}) {
  const model = options.model || 'cardiffnlp/twitter-roberta-base-sentiment-latest';
  
  try {
    const response = await fetch(
      `https://api-inference.huggingface.co/models/${model}`,
      {
        headers: {
          'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
        body: JSON.stringify({
          inputs: text,
          options: {
            wait_for_model: true
          }
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Hugging Face API error: ${response.status}`);
    }

    const result = await response.json();
    
    // Handle different response formats
    let sentimentData;
    if (Array.isArray(result) && result.length > 0) {
      sentimentData = result[0];
    } else if (result.label && result.score) {
      sentimentData = result;
    } else {
      throw new Error('Unexpected response format from Hugging Face API');
    }

    // Normalize sentiment labels
    const normalizedSentiment = normalizeSentimentLabel(sentimentData.label);
    
    return {
      label: normalizedSentiment,
      score: sentimentData.score,
      confidence: sentimentData.score,
      raw_result: sentimentData,
      model_used: model,
      analysis_timestamp: new Date().toISOString()
    };

  } catch (error) {
    console.error('Sentiment analysis error:', error);
    throw new Error(`Failed to analyze sentiment: ${error.message}`);
  }
}

// Normalize different sentiment label formats
function normalizeSentimentLabel(label) {
  const labelLower = label.toLowerCase();
  
  if (labelLower.includes('pos') || labelLower === 'positive') {
    return 'positive';
  } else if (labelLower.includes('neg') || labelLower === 'negative') {
    return 'negative';
  } else if (labelLower.includes('neu') || labelLower === 'neutral') {
    return 'neutral';
  }
  
  return label; // Return original if no match
}

// Check Hugging Face API availability
async function checkHuggingFaceAPI() {
  try {
    const response = await fetch('https://api-inference.huggingface.co/models/cardiffnlp/twitter-roberta-base-sentiment-latest', {
      headers: {
        'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
      },
      method: 'GET'
    });
    
    return {
      status: response.ok ? 'ok' : 'error',
      response_code: response.status
    };
  } catch (error) {
    return {
      status: 'error',
      error: error.message
    };
  }
}

// Check database connection
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

// Process metrics for display
function processMetrics(metrics) {
  if (!metrics || metrics.length === 0) return {};
  
  const grouped = metrics.reduce((acc, metric) => {
    if (!acc[metric.metric_type]) {
      acc[metric.metric_type] = [];
    }
    acc[metric.metric_type].push(metric);
    return acc;
  }, {});

  const processed = {};
  for (const [type, values] of Object.entries(grouped)) {
    processed[type] = {
      current: values[0]?.metric_value,
      average: values.reduce((sum, v) => sum + v.metric_value, 0) / values.length,
      count: values.length,
      unit: values[0]?.unit
    };
  }

  return processed;
}

// Calculate performance statistics
function calculatePerformanceStats(tasks) {
  if (!tasks || tasks.length === 0) {
    return {
      total_tasks: 0,
      success_rate: 0,
      average_response_time: 0
    };
  }

  const completed = tasks.filter(t => t.status === 'completed');
  const failed = tasks.filter(t => t.status === 'failed');
  
  const responseTimes = completed
    .filter(t => t.started_at && t.completed_at)
    .map(t => new Date(t.completed_at) - new Date(t.started_at));

  return {
    total_tasks: tasks.length,
    completed_tasks: completed.length,
    failed_tasks: failed.length,
    success_rate: tasks.length > 0 ? (completed.length / tasks.length) * 100 : 0,
    average_response_time: responseTimes.length > 0 
      ? responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length 
      : 0
  };
}

// Log metrics to database
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

// Log activity to database
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

