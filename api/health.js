// Simple health check endpoint
module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Check environment variables
    const hasSupabaseUrl = !!process.env.SUPABASE_URL;
    const hasSupabaseKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;

    return res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        hasSupabaseUrl,
        hasSupabaseKey
      },
      message: 'FMAA Backend API is running successfully'
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
};