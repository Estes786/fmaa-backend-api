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

## Troubleshooting
- Make sure you're using the service_role key, not the anon/public key
- Double-check that the Supabase URL is correct
- Ensure your Supabase database has the required tables (agents, etc.)