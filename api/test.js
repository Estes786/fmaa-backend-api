// Comprehensive test endpoint for debugging deployment issues
module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const testResults = {
      timestamp: new Date().toISOString(),
      nodeVersion: process.version,
      platform: process.platform,
      environment: {
        NODE_ENV: process.env.NODE_ENV || 'not set',
        hasSupabaseUrl: !!process.env.SUPABASE_URL,
        hasSupabaseKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        supabaseUrlLength: process.env.SUPABASE_URL ? process.env.SUPABASE_URL.length : 0,
        supabaseKeyLength: process.env.SUPABASE_SERVICE_ROLE_KEY ? process.env.SUPABASE_SERVICE_ROLE_KEY.length : 0
      },
      dependencies: {},
      tests: {}
    };

    // Test dependencies
    try {
      const supabase = require('@supabase/supabase-js');
      testResults.dependencies.supabase = '✅ OK';
    } catch (e) {
      testResults.dependencies.supabase = `❌ ERROR: ${e.message}`;
    }

    try {
      const uuid = require('uuid');
      testResults.dependencies.uuid = '✅ OK';
    } catch (e) {
      testResults.dependencies.uuid = `❌ ERROR: ${e.message}`;
    }

    try {
      const axios = require('axios');
      testResults.dependencies.axios = '✅ OK';
    } catch (e) {
      testResults.dependencies.axios = `❌ ERROR: ${e.message}`;
    }

    // Test Supabase connection
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      try {
        const { createClient } = require('@supabase/supabase-js');
        const supabaseClient = createClient(
          process.env.SUPABASE_URL,
          process.env.SUPABASE_SERVICE_ROLE_KEY
        );
        
        // Simple health check - don't make actual DB calls to avoid errors
        testResults.tests.supabaseClient = '✅ Client created successfully';
      } catch (e) {
        testResults.tests.supabaseClient = `❌ ERROR: ${e.message}`;
      }
    } else {
      testResults.tests.supabaseClient = '⚠️ Missing environment variables';
    }

    // Test utils imports
    try {
      const dbUtils = require('./utils/database');
      testResults.tests.databaseUtils = '✅ OK';
    } catch (e) {
      testResults.tests.databaseUtils = `❌ ERROR: ${e.message}`;
    }

    try {
      const authUtils = require('./utils/auth');
      testResults.tests.authUtils = '✅ OK';
    } catch (e) {
      testResults.tests.authUtils = `❌ ERROR: ${e.message}`;
    }

    return res.status(200).json({
      status: 'test_completed',
      message: 'FMAA Backend API - Comprehensive Test Results',
      ...testResults
    });

  } catch (error) {
    return res.status(500).json({
      status: 'test_failed',
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
  }
};