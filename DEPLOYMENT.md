# Deployment Guide - Vercel

## Environment Variables Required

Your Vercel deployment needs these environment variables to work properly:

### Required Variables:
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Your Supabase service role key

## How to Fix the Deployment Error

### Method 1: Via Vercel Dashboard
1. Go to your Vercel dashboard (https://vercel.com/dashboard)
2. Select your project (`fmaa-backend-api`)
3. Go to Settings → Environment Variables
4. Add the following variables:
   - `SUPABASE_URL` = `https://your-project-id.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY` = `your-service-role-key`

### Method 2: Via Vercel CLI
```bash
# Install Vercel CLI if not installed
npm i -g vercel

# Login to Vercel
vercel login

# Add environment variables
vercel env add SUPABASE_URL
vercel env add SUPABASE_SERVICE_ROLE_KEY

# Redeploy
vercel --prod
```

### Getting Supabase Credentials
1. Go to your Supabase dashboard (https://supabase.com/dashboard)
2. Select your project
3. Go to Settings → API
4. Copy:
   - URL (Project URL)
   - service_role key (keep this secret!)

## After Adding Environment Variables
1. Trigger a new deployment by pushing a commit or manually redeploying in Vercel
2. Your API endpoints should now work properly

## Testing Your Deployment
After deployment, test these endpoints:
- `https://your-app.vercel.app/api/health` - Health check
- `https://your-app.vercel.app/api/index` - API info
- `https://your-app.vercel.app/` - Root endpoint

## Recent Fixes Applied
✅ Fixed environment variable inconsistency (was using SUPABASE_ANON_KEY, now uses SUPABASE_SERVICE_ROLE_KEY)
✅ Added root API endpoint for better routing
✅ Added health check endpoint for deployment testing
✅ Improved Vercel configuration
✅ Added deployment optimization files

## Troubleshooting
- Make sure you're using the service_role key, not the anon/public key
- Double-check that the Supabase URL is correct
- Ensure your Supabase database has the required tables (agents, etc.)
- If still failing, check the health endpoint: `/api/health`
- Check Vercel deployment logs in dashboard for specific errors