const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Recommendation Agent
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
      return handleRecommendation(req, res, tenantId);
    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Recommendation Agent Error:', error);
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
    agent_type: 'recommendation',
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
      .eq('type', 'recommendation')
      .eq('tenant_id', tenantId)
      .single();

    if (!agent) {
      return res.status(404).json({ error: 'Recommendation agent not found for this tenant' });
    }

    // Get recent metrics
    const { data: metrics } = await supabase
      .from('agent_metrics')
      .select('*')
      .eq('agent_id', agent.id)
      .gte('timestamp', new Date(Date.now() - 3600000).toISOString())
      .order('timestamp', { ascending: false });

    // Get recent tasks
    const { data: tasks } = await supabase
      .from('agent_tasks')
      .select('*')
      .eq('agent_id', agent.id)
      .gte('created_at', new Date(Date.now() - 86400000).toISOString())
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

// Main recommendation endpoint
async function handleRecommendation(req, res, tenantId) {
  const startTime = Date.now();
  const { 
    user_profile, 
    item_features, 
    interaction_history, 
    recommendation_type = 'content_based',
    num_recommendations = 5,
    taskId,
    options = {} 
  } = req.body;

  if (!user_profile && !interaction_history) {
    return res.status(400).json({ 
      error: 'Either user_profile or interaction_history is required' 
    });
  }

  try {
    // Get agent info
    const { data: agent } = await supabase
      .from('agents')
      .select('*')
      .eq('type', 'recommendation')
      .eq('tenant_id', tenantId)
      .single();

    if (!agent) {
      return res.status(404).json({ error: 'Recommendation agent not found for this tenant' });
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
          task_type: 'recommendation',
          input_data: { 
            user_profile, 
            item_features, 
            interaction_history, 
            recommendation_type,
            num_recommendations,
            options 
          },
          status: 'running',
          started_at: new Date().toISOString()
        }])
        .select()
        .single();
      task = taskData;
    }

    // Generate recommendations
    const recommendations = await generateRecommendations({
      user_profile,
      item_features,
      interaction_history,
      recommendation_type,
      num_recommendations,
      options
    });
    
    const responseTime = Date.now() - startTime;
    
    // Update task if exists
    if (task) {
      await supabase
        .from('agent_tasks')
        .update({
          output_data: recommendations,
          status: 'completed',
          completed_at: new Date().toISOString()
        })
        .eq('id', taskId);
    }

    // Log metrics
    await logMetrics(agent.id, tenantId, responseTime, true);

    // Log activity
    await logActivity(agent.id, tenantId, 'info', 
      `Generated ${recommendations.recommendations.length} recommendations using ${recommendation_type}`, 
      { 
        response_time: responseTime, 
        recommendation_type,
        num_recommendations: recommendations.recommendations.length
      }
    );

    return res.status(200).json({
      success: true,
      result: recommendations,
      metadata: {
        response_time_ms: responseTime,
        recommendation_type,
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
      error: 'Recommendation generation failed',
      message: error.message 
    });
  }
}

// Generate recommendations using different algorithms
async function generateRecommendations({
  user_profile,
  item_features,
  interaction_history,
  recommendation_type,
  num_recommendations,
  options
}) {
  switch (recommendation_type) {
    case 'content_based':
      return await generateContentBasedRecommendations({
        user_profile,
        item_features,
        num_recommendations,
        options
      });
    
    case 'collaborative_filtering':
      return await generateCollaborativeRecommendations({
        user_profile,
        interaction_history,
        num_recommendations,
        options
      });
    
    case 'hybrid':
      return await generateHybridRecommendations({
        user_profile,
        item_features,
        interaction_history,
        num_recommendations,
        options
      });
    
    case 'semantic':
      return await generateSemanticRecommendations({
        user_profile,
        item_features,
        num_recommendations,
        options
      });
    
    default:
      throw new Error(`Unsupported recommendation type: ${recommendation_type}`);
  }
}

// Content-based recommendations
async function generateContentBasedRecommendations({
  user_profile,
  item_features,
  num_recommendations,
  options
}) {
  // Simulate content-based recommendation algorithm
  const userPreferences = user_profile.preferences || {};
  const items = item_features || [];
  
  // Calculate similarity scores
  const scoredItems = items.map(item => {
    let score = 0;
    
    // Category preference matching
    if (userPreferences.categories && item.category) {
      score += userPreferences.categories.includes(item.category) ? 0.3 : 0;
    }
    
    // Feature matching
    if (userPreferences.features && item.features) {
      const commonFeatures = item.features.filter(f => 
        userPreferences.features.includes(f)
      );
      score += (commonFeatures.length / item.features.length) * 0.4;
    }
    
    // Rating preference
    if (userPreferences.min_rating && item.rating) {
      score += item.rating >= userPreferences.min_rating ? 0.2 : 0;
    }
    
    // Add some randomness for diversity
    score += Math.random() * 0.1;
    
    return {
      ...item,
      recommendation_score: score,
      explanation: generateExplanation('content_based', item, userPreferences)
    };
  });
  
  // Sort by score and take top N
  const recommendations = scoredItems
    .sort((a, b) => b.recommendation_score - a.recommendation_score)
    .slice(0, num_recommendations);
  
  return {
    recommendations,
    algorithm: 'content_based',
    confidence: calculateConfidence(recommendations),
    diversity_score: calculateDiversity(recommendations),
    generated_at: new Date().toISOString()
  };
}

// Collaborative filtering recommendations
async function generateCollaborativeRecommendations({
  user_profile,
  interaction_history,
  num_recommendations,
  options
}) {
  // Simulate collaborative filtering using interaction history
  const userInteractions = interaction_history || [];
  
  // Find similar users based on interaction patterns
  const similarUsers = await findSimilarUsers(user_profile.id, userInteractions);
  
  // Generate recommendations based on similar users' preferences
  const recommendations = [];
  const seenItems = new Set(userInteractions.map(i => i.item_id));
  
  for (const similarUser of similarUsers.slice(0, 10)) {
    const userItems = similarUser.interactions
      .filter(i => !seenItems.has(i.item_id) && i.rating >= 4)
      .slice(0, 3);
    
    userItems.forEach(item => {
      const existing = recommendations.find(r => r.item_id === item.item_id);
      if (existing) {
        existing.recommendation_score += similarUser.similarity * 0.1;
      } else {
        recommendations.push({
          ...item,
          recommendation_score: similarUser.similarity * item.rating / 5,
          explanation: generateExplanation('collaborative', item, { similar_users: 1 })
        });
      }
    });
  }
  
  return {
    recommendations: recommendations
      .sort((a, b) => b.recommendation_score - a.recommendation_score)
      .slice(0, num_recommendations),
    algorithm: 'collaborative_filtering',
    confidence: calculateConfidence(recommendations),
    similar_users_count: similarUsers.length,
    generated_at: new Date().toISOString()
  };
}

// Hybrid recommendations
async function generateHybridRecommendations({
  user_profile,
  item_features,
  interaction_history,
  num_recommendations,
  options
}) {
  // Combine content-based and collaborative filtering
  const contentRecs = await generateContentBasedRecommendations({
    user_profile,
    item_features,
    num_recommendations: num_recommendations * 2,
    options
  });
  
  const collabRecs = await generateCollaborativeRecommendations({
    user_profile,
    interaction_history,
    num_recommendations: num_recommendations * 2,
    options
  });
  
  // Merge and re-rank recommendations
  const allRecs = [...contentRecs.recommendations, ...collabRecs.recommendations];
  const mergedRecs = new Map();
  
  allRecs.forEach(rec => {
    const key = rec.item_id || rec.id;
    if (mergedRecs.has(key)) {
      const existing = mergedRecs.get(key);
      existing.recommendation_score = (existing.recommendation_score + rec.recommendation_score) / 2;
      existing.explanation += ` & ${rec.explanation}`;
    } else {
      mergedRecs.set(key, { ...rec });
    }
  });
  
  const finalRecs = Array.from(mergedRecs.values())
    .sort((a, b) => b.recommendation_score - a.recommendation_score)
    .slice(0, num_recommendations);
  
  return {
    recommendations: finalRecs,
    algorithm: 'hybrid',
    confidence: calculateConfidence(finalRecs),
    content_weight: 0.6,
    collaborative_weight: 0.4,
    generated_at: new Date().toISOString()
  };
}

// Semantic recommendations using Hugging Face
async function generateSemanticRecommendations({
  user_profile,
  item_features,
  num_recommendations,
  options
}) {
  try {
    const userQuery = user_profile.description || user_profile.interests?.join(' ') || '';
    
    if (!userQuery) {
      throw new Error('User profile must contain description or interests for semantic recommendations');
    }
    
    // Use sentence similarity model from Hugging Face
    const similarities = await Promise.all(
      item_features.map(async (item) => {
        const itemText = item.description || item.title || '';
        const similarity = await calculateSemanticSimilarity(userQuery, itemText);
        
        return {
          ...item,
          recommendation_score: similarity,
          explanation: generateExplanation('semantic', item, { similarity })
        };
      })
    );
    
    const recommendations = similarities
      .sort((a, b) => b.recommendation_score - a.recommendation_score)
      .slice(0, num_recommendations);
    
    return {
      recommendations,
      algorithm: 'semantic',
      confidence: calculateConfidence(recommendations),
      model_used: 'sentence-transformers/all-MiniLM-L6-v2',
      generated_at: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('Semantic recommendation error:', error);
    // Fallback to content-based if semantic fails
    return await generateContentBasedRecommendations({
      user_profile,
      item_features,
      num_recommendations,
      options
    });
  }
}

// Calculate semantic similarity using Hugging Face
async function calculateSemanticSimilarity(text1, text2) {
  try {
    const response = await fetch(
      'https://api-inference.huggingface.co/models/sentence-transformers/all-MiniLM-L6-v2',
      {
        headers: {
          'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
        body: JSON.stringify({
          inputs: {
            source_sentence: text1,
            sentences: [text2]
          }
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Hugging Face API error: ${response.status}`);
    }

    const result = await response.json();
    return result[0] || 0;
    
  } catch (error) {
    console.error('Semantic similarity error:', error);
    // Fallback to simple text similarity
    return calculateSimpleTextSimilarity(text1, text2);
  }
}

// Simple text similarity fallback
function calculateSimpleTextSimilarity(text1, text2) {
  const words1 = text1.toLowerCase().split(/\s+/);
  const words2 = text2.toLowerCase().split(/\s+/);
  
  const intersection = words1.filter(word => words2.includes(word));
  const union = [...new Set([...words1, ...words2])];
  
  return intersection.length / union.length;
}

// Find similar users (mock implementation)
async function findSimilarUsers(userId, userInteractions) {
  // In a real implementation, this would query the database for similar users
  // For now, return mock similar users
  return [
    {
      id: 'user_2',
      similarity: 0.85,
      interactions: [
        { item_id: 'item_1', rating: 4.5, category: 'electronics' },
        { item_id: 'item_2', rating: 5.0, category: 'books' }
      ]
    },
    {
      id: 'user_3',
      similarity: 0.72,
      interactions: [
        { item_id: 'item_3', rating: 4.0, category: 'electronics' },
        { item_id: 'item_4', rating: 4.8, category: 'home' }
      ]
    }
  ];
}

// Generate explanation for recommendation
function generateExplanation(algorithm, item, context) {
  switch (algorithm) {
    case 'content_based':
      return `Recommended based on your preferences for ${item.category || 'similar items'}`;
    case 'collaborative':
      return `Users with similar tastes also liked this item`;
    case 'semantic':
      return `Semantically similar to your interests (${(context.similarity * 100).toFixed(1)}% match)`;
    default:
      return 'Recommended for you';
  }
}

// Calculate confidence score
function calculateConfidence(recommendations) {
  if (!recommendations.length) return 0;
  
  const avgScore = recommendations.reduce((sum, rec) => sum + rec.recommendation_score, 0) / recommendations.length;
  const variance = recommendations.reduce((sum, rec) => sum + Math.pow(rec.recommendation_score - avgScore, 2), 0) / recommendations.length;
  
  // Higher average score and lower variance = higher confidence
  return Math.min(avgScore * (1 - Math.sqrt(variance)), 1);
}

// Calculate diversity score
function calculateDiversity(recommendations) {
  if (!recommendations.length) return 0;
  
  const categories = new Set(recommendations.map(r => r.category).filter(Boolean));
  return categories.size / recommendations.length;
}

// Utility functions (same as sentiment agent)
async function checkHuggingFaceAPI() {
  try {
    const response = await fetch('https://api-inference.huggingface.co/models/sentence-transformers/all-MiniLM-L6-v2', {
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

