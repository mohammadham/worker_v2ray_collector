# VPN Config Bot - PRD

## Problem Statement
Build a Telegram bot on Cloudflare Workers for collecting, testing, and distributing V2Ray proxy configs (vless, vmess, trojan, ss) to Telegram channels.

## Architecture
- **Cloudflare Worker**: Self-contained bot + dashboard (worker.js)
- **Backend**: FastAPI (Python) for local testing/preview
- **Frontend**: React dashboard for management
- **Storage**: Cloudflare KV (worker) / MongoDB (local)
- **Telegram**: Webhook-based bot with inline keyboards

## Core Requirements
1. Fetch configs from configurable source URLs
2. Extract vless/vmess/trojan/ss configs using regex
3. Test configs (TCP connection + DNS resolution + latency)
4. Deduplicate using hash-based cache (500 items)
5. Publish to Telegram channels with inline buttons
6. Admin commands via Telegram
7. Glass menu for users to submit configs
8. Web dashboard with auth for management
9. Cron trigger for automatic hourly fetch
10. User config submission with approval workflow

## User Personas
- **Admin**: Manages bot via Telegram commands & web dashboard
- **Users**: Submit configs, view latest configs via bot
- **Channel Subscribers**: Receive tested configs automatically

## What's Implemented (2026-02-09)
- [x] Complete Cloudflare Worker script with all features
- [x] Telegram bot with webhook, admin/user menus
- [x] Config extraction for all 4 types
- [x] TCP + DNS testing with latency measurement
- [x] Deduplication cache
- [x] Channel publishing with inline keyboards
- [x] Web dashboard (React) with login, stats, CRUD
- [x] Template editor
- [x] User submission approval workflow
- [x] Worker script viewer/downloader
- [x] wrangler.toml config
- [x] Deployment guide

## Testing: 100% pass rate (backend + frontend)

## Backlog
- P0: Deploy to Cloudflare Workers
- P1: Subscription link feature (/sub/USER_ID)
- P1: Config quality scoring system
- P2: Auto-remove dead configs from channel
- P2: Multi-language support (FA/EN)
- P2: Rate limiting for user submissions
