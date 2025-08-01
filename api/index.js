// Root API endpoint
module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Health check and API info
  return res.status(200).json({
    message: 'FMAA Backend API - Running on Vercel',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    endpoints: {
      'POST /api/agent-factory': 'Agent management operations',
      'POST /api/sentiment-agent': 'Sentiment analysis',
      'POST /api/recommendation-agent': 'Recommendation engine',
      'GET /api/performance-monitor': 'Performance monitoring'
    },
    status: 'healthy'
  });
};