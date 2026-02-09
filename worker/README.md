# Deployment Guide - VPN Config Bot on Cloudflare Workers

## Prerequisites
- A Cloudflare account
- `wrangler` CLI installed: `npm install -g wrangler`
- A Telegram bot token from @BotFather

## Steps

### 1. Login to Cloudflare
```bash
wrangler login
```

### 2. Create KV Namespace
```bash
wrangler kv:namespace create VPN_CACHE
```
Copy the `id` value and update `wrangler.toml`.

### 3. Update wrangler.toml
Replace `YOUR_KV_NAMESPACE_ID` with the actual KV namespace ID.

Update `BOT_TOKEN`, `ADMIN_CHAT_ID`, `CHANNEL_ID`, `DASHBOARD_USER`, `DASHBOARD_PASS` if needed.

### 4. Deploy
```bash
cd /app/worker
wrangler deploy
```

### 5. Set Telegram Webhook
After deployment, visit:
```
https://YOUR-WORKER.workers.dev/set-webhook
```
Or manually:
```
https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook?url=https://YOUR-WORKER.workers.dev/webhook
```

### 6. Access Dashboard
```
https://YOUR-WORKER.workers.dev/dashboard
```
Login with the credentials set in `wrangler.toml`.

## Bot Commands (Telegram)

### Admin Commands
- `/start` - Main menu with inline buttons
- `/check` - Fetch configs now
- `/links` - List source links
- `/channels` - List channels
- `/status` - Bot status
- `/add_link URL` - Add source link
- `/remove_link URL` - Remove source link
- `/add_channel ID` - Add target channel
- `/remove_channel ID` - Remove channel

### User Commands
- `/start` - Glass menu with options
- `/submit` - Submit a config
- `/latest` - Get latest configs
- `/help` - Help info

## Cron Schedule
The worker runs every hour (`0 * * * *`) to automatically fetch, test, and distribute new configs.

## Files
- `worker.js` - Complete Cloudflare Worker script
- `wrangler.toml` - Configuration file
