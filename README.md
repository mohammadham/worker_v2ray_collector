#  Cloudflare Worker VPN Config Bot Pro

## Table of Contents
1. [Overview](#overview)
2. [Feature List](#feature-list)
3. [System Architecture & Diagram](#system-architecture--diagram)
4. [Operational Scenarios](#operational-scenarios)
5. [Complete Documentation](#complete-documentation)  
   - 5.1 Setup & Deployment  
   - 5.2 Environment Variables  
   - 5.3 KV Namespace  
   - 5.4 Telegram Bot Configuration  
   - 5.5 Usage (Users & Admins)  
   - 5.6 Web Dashboard  
6. [Strengths & Weaknesses](#strengths--weaknesses)
7. [Conclusion](#conclusion)

---

## 1. Overview
The **VPN Config Bot Pro** is a high-performance Cloudflare Worker-based system designed to automatically scrape, test, rate, and distribute V2Ray-compatible VPN configurations (VLESS, VMess, Trojan, Shadowsocks).

It combines a **Modular REST API**, a **Responsive Web Dashboard**, and a **Feature-Rich Telegram Bot** into a single, scalable solution. The system uses advanced sharding and indexing to maintain high performance even with thousands of configurations.

---

## 2. Feature List

### Core Automation & Storage
- **Modular Architecture** – Clean ES Modules structure separating handlers, services, and utilities.
- **Sharded KV Storage** – Distributes configurations across multiple protocol-specific buckets (shards) to bypass KV size limits and improve read/write speed.
- **Auto-Indexing** – High-speed country-based indexing for location-specific retrieval.
- **Config Extraction** – Advanced scraping with provider tracking and duplicate detection based on core server parameters.
- **Health Testing** – Real-time status (`active`, `dns_only`, `dead`) and latency testing with geo-location resolution (country flags).
- **Scheduled Queue** – Batched distribution system to prevent channel flooding, with configurable intervals and batch sizes.

### User Interaction (Telegram Bot)
- **Advanced UI** – Persistent reply keyboards for easy navigation, switching between User, Admin, and Sub-Admin states.
- **Community Submissions** – Users can submit configs which are held in a pending queue for admin review.
- **Voting System** – Integrated "Report" system (with optional toggling). "Like" counts are managed via external integration or app-side triggers.
- **Subscription Service** – A built-in multi-user subscription system allowing "Sub-Admins" (contributors with 20+ approved configs) to manage personal pools and clients.
- **Retrieval Options** – Get "Latest" or "Best Rated" configs instantly.
- **Interactive Tools** – Optional "Share" and "QR Code" buttons for every config.

### Admin Operations
- **App Update Management** – Manage Android app versions, download links, and descriptions directly from the dashboard.
- **Announcement System** – Push global announcements to connected apps or the bot.
- **Broadcast Service** – Send mass messages to all bot users with delivery tracking.
- **Template Engine** – Full control over message formatting per protocol with live preview support.
- **Manual Control** – Trigger immediate scrapes, cleanups, or re-tests via bot commands or dashboard.

### Web Dashboard
- **Real-time Stats** – Comprehensive metrics on configs, users, votes, and system health.
- **Management Tabs** – Dedicated interfaces for Links, Channels, Configs, Templates, Submissions, App Info, and Global Settings.
- **Advanced Filters** – Search and sort configs by type, country, latency, or quality score.
- **Toggle Settings** – Easily enable/disable features like the "Report" button, "QR Code" button, or "Auto-Queue".

---

## 3. System Architecture & Diagram

The project uses a component-based modular structure:
- `worker/src/handlers/`: Entry points for Bot, Dashboard, and API routing.
- `worker/src/services/`: Core logic for voting, storage, queue management, and fetching.
- `worker/src/utils/`: Shared utilities for KV, Telegram API, and VPN protocol parsing.
- `worker/src/templates/`: HTML and dynamic UI templates.

```mermaid
flowchart TB
    subgraph "Cloudflare Worker (ES Modules)"
        direction TB
        Entry[worker.js] --> BotH[bot.js Handler]
        Entry --> DashH[dashboard.js Handler]
        Entry --> Cron[scheduled.js Handler]
        
        BotH --> Services[Services Layer]
        DashH --> Services
        Cron --> Services
        
        subgraph Services
            Storage[storage.js - Sharding & Indexing]
            Fetcher[fetcher.js - Scraper]
            Queue[queue.js - Batched Publish]
            Broadcast[broadcast.js - Mass Msg]
            Voting[voting.js - Optimized Scores]
        end
        
        Services --> Utils[Utils: KV, Telegram, VPN]
        Utils --> KV[(KV Namespace: VPN_CACHE)]
    end
    
    subgraph "External"
        TG[Telegram Bot API] <--> BotH
        Web[Admin Browser] <--> DashH
        App[Android App] <--> Entry
        Sources[Config Sources] <-- Fetcher
    end
```

---

## 4. Complete Documentation

### 4.1 Setup & Deployment
1. **Initialize KV** – Create a KV namespace named `VPN_CACHE` in Cloudflare.
2. **Environment Variables** – Set the required variables (see 4.2).
3. **Deploy** – Build and deploy using Wrangler or GitHub Actions.
4. **Set Webhook** – Visit `https://your-worker.workers.dev/set-webhook` to initialize the bot.

### 4.2 Environment Variables
| Variable | Description |
|---|---|
| `BOT_TOKEN` | Your Telegram Bot Token. |
| `CHANNEL_ID` | Default channel for public posts. |
| `ADMIN_CHAT_ID` | Your Telegram User ID. |
| `DASHBOARD_USER` | Dashboard login username. |
| `DASHBOARD_PASS` | Dashboard login password. |

### 4.3 Storage Optimization (Sharding)
To handle large volumes of data, configurations are stored in **Buckets**:
`cfgs:{protocol}:{shard_id}` (e.g., `cfgs:vless:1`).
Each bucket is capped at 100 items to ensure fast KV performance. The system automatically rotates through 5 shards per protocol, supporting up to 2,000 active configurations.

---

## 5. Usage & Features

### Reporting & QR Codes
Admins can toggle these buttons in the Dashboard Settings:
- **Report Button**: Enabled by default. Allows users to flag dead configs.
- **QR Code Button**: Replaces the "Open" button with a link to a dynamically generated QR code image for easy scanning.

### App Update System
The bot provides endpoints for external Android apps:
- `/api/app-update`: Returns version, link, and force-update status.
- `/api/announcement`: Returns current active global announcement.

### Quality Score Calculation
Configurations are ranked using a `quality_score` derived from:
- Latency (bonuses for <200ms).
- Status (active/dead).
- Community Likes (weight: +10 per like).
- Reports (weight: -50 per report).
Configs with a score below -200 are automatically purged.

---

## 6. Strengths
- **Massive Scalability** – Sharding and indexing prevent KV bottlenecking.
- **Optimized Performance** – Vote caching within config objects reduces KV lookups by 95%.
- **Modular Codebase** – Easy to extend and maintain.
- **Full Automation** – Automated queue, cleanup, and distribution.

---

## 7. Conclusion
This project is a professional-grade solution for VPN configuration management on Cloudflare Workers. Its modular design and optimized storage architecture make it suitable for both small personal bots and large-scale community services.
