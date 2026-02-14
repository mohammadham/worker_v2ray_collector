# Comprehensive Documentation: VPN Config Bot Pro

## 1. Overview
The **VPN Config Bot Pro** is a powerful Cloudflare Worker that automates the lifecycle of VPN configuration distribution via Telegram. It scrapes configurations from various sources, tests their connectivity and latency, allows community voting, and redistributes high-quality configs to Telegram channels.

---

## 2. Feature List

### Core Automation
- **Config Extraction**: Scrapes plain text from configured URLs and extracts VPN configs (VLESS, VMess, Trojan, Shadowsocks) using advanced regex and protocol-specific parsing.
- **Protocol Support**: Comprehensive support for `vless://`, `vmess://`, `trojan://`, and `ss://` (including legacy base64 formats).
- **Intelligent Testing**: Tests each config via DNS-over-HTTPS (Cloudflare) and TCP/HTTPS `HEAD` requests to verify connectivity and measure latency.
- **Automatic Distribution**: Discovered and tested configs are automatically posted to configured Telegram channels.
- **Scheduled Cleanup**: Periodically removes dead, stale, or unpopular configurations to maintain a high-quality feed.
- **Publish Queue**: Paces the distribution of new configurations to avoid flooding channels. Configurable interval and batch size.

### Telegram User Interface
- **Monospaced Configs**: All configs are sent in a monospaced format, allowing users to tap and copy them instantly.
- **Bundle Submissions**: If a user sends multiple configurations in one message, the bot groups them into a single "Bundle" for approval.
- **Quality Reporting**: Users can report dead or slow configurations using the **👎 Report** button. High report counts negatively impact the config's Quality Score.
- **Quality Score**: A sophisticated scoring system that combines automated test results, user reports, and "Auto-Likes" from external sources (e.g., Android App).
- **On-Demand Retrieval**: Users can fetch the `/latest` or `/best` (highest Quality Score) configurations directly through the bot.
- **Submission System**: Users can submit raw configs or text containing configs; the bot extracts and queues them for admin approval.

### Admin Features
- **Dashboard API & UI**: A complete web-based management interface for monitoring stats, managing links/channels, and approving submissions.
- **Customizable Templates**: Admins can edit message templates per protocol using placeholders like `{server}`, `{status}`, `{rating}`, `{latency}`, `{channel}`, `{location}`, `{user}`, `{count}`, and `{configs}`.
- **Template Reset**: Ability to instantly restore all message templates to their default values from the dashboard.
- **Manual Control**: Force cleanup or fetch operations via Telegram commands or the dashboard.
- **Submission Management**: Review pending user submissions with one-click approve/reject functionality.

---

## 3. System Architecture

```mermaid
flowchart TB
    subgraph "Cloudflare Worker Environment"
        direction TB
        WH[Webhook Handler] -->|callback| TG[Telegram Bot API]
        SC[Scheduled Cron] -->|periodic| FnC[Fetch & Distribute]
        FnC -->|store/retrieve| KV[(KV Namespace: VPN_CACHE)]
        FnC -->|test| Test[Config Tester]
        FnC -->|send| TG

        SUB[Submission Handler] -->|store| KV
        SUB -->|approve| Publish[Publish to Channels]

        AdminAPI[Dashboard API] -->|CRUD| KV
        AdminAPI -->|triggers| FnC
        AdminAPI -->|triggers| Cleanup[Cleanup Job]

        DashUI[Dashboard HTML] -->|fetches| AdminAPI

        Root[Root Path] -->|Logic| HTTPResponse[Redirect/Portfolio]
    end

    subgraph "External Systems"
        Sources[Source URLs] -->|HTTP GET| FnC
        User[Telegram User] -->|commands/configs| WH
        Channel[Telegram Channel] <--|formatted configs| TG
        Admin[Admin] -->|web dashboard| DashUI
    end

    KV -->|local cache| MemCache[In-Memory Cache (5s TTL)]
    Test -->|DNS check| CF_DNS[Cloudflare DoH]
    Test -->|TCP/HTTPS check| Target[VPN Server]
```

---

## 4. Operational Scenarios

### Scenario A: Automated Aggregation
The bot runs on a schedule (e.g., every minute), fetches new links from GitHub/Gist sources, tests them, and posts active ones to the main channel without any human intervention.

### Scenario B: Community Curation
Users submit configurations they found. The admin receives a notification, approves the submission via the dashboard, and the bot then tests and publishes it, giving credit to the source/submitter.

### Scenario C: Quality Maintenance
Over time, configurations may die or become slow. The cleanup task runs daily, checking if configs have passed their "stale" threshold or have too many failed tests, automatically purging the database.

---

## 5. Technical Documentation

### 5.1 Environment Variables (Secrets)
| Variable | Description |
|---|---|
| `BOT_TOKEN` | Your Telegram Bot Token from @BotFather. |
| `ADMIN_CHAT_ID` | Your Telegram User ID (used for admin access). |
| `CHANNEL_ID` | Default channel ID (e.g., `-100...`) for distribution. |
| `DASHBOARD_USER` | Username for the web dashboard. |
| `DASHBOARD_PASS` | Password for the web dashboard. |

### 5.2 Key Logic & Performance
- **Rate Limiting**: Implements a `RateLimiter` class to respect Telegram's message limits (approx. 30 msg/s).
- **Concurrency**: Uses `promiseAllWithLimit` to batch network requests (tests/sends) without overloading the Worker or remote servers.
- **Parsing**: Robust extraction using the `URL` API and safe Base64/JSON parsing for complex protocols like VMess.
- **Testing**: Dual-stage testing (DNS followed by HTTP/HTTPS HEAD) ensures high accuracy of "Active" status.

### 5.3 Storage & Deduplication Policies
- **Storage Limit**: The bot maintains a strict limit of **1,000 configurations** in KV.
- **Smart Deduplication**: Configurations are compared based on their core connection parameters (Host, Port, ID, Cipher). Any text after the `#` symbol or the `ps` field in VMess is ignored during comparison.
- **Quality-Based Management**: Configurations with extremely low **Quality Scores** (due to multiple reports) are prioritized for removal.
- **Auto-Cleanup Pipeline**: When the storage limit is reached, the bot performs a 6-stage cleanup:
  0.  **Quality Purge**: Remove configurations with a Quality Score below -200.
  1.  **Remove Dead**: Delete all configs marked as "dead".
  2.  **Age Check**: Delete configs older than **10 days**.
  3.  **Latency Check**: Delete configs with high latency (ping > 2000ms).
  4.  **Proactive Testing**: Retest oldest configs, update their Quality Score, and remove those that fail.
  5.  **FIFO**: Remove oldest configs if still over the limit.

---

## 6. Strengths & Weaknesses

### ✅ Strengths
- **Fully Serverless**: Zero hosting costs on Cloudflare's Free Tier.
- **Native UX**: Monospaced text for instant copy-paste on mobile.
- **Resilient**: Robust error handling for malformed configs and network timeouts.
- **Highly Configurable**: Templates and settings can be changed in real-time via the dashboard.

### ❌ Current Weaknesses
- **Free Tier Limits**: KV read/write limits may be reached under extremely high volume (e.g., >100,000 daily operations).
- **Protocol Depth**: Currently limited to TCP/HTTPS reachability; does not perform a full protocol handshake (e.g., UDP testing).

---

## 7. Roadmap & Improvements
- [ ] **Geo-Location**: Integration with IP-API to show server location flags.
- [ ] **Durable Objects**: Advanced rate limiting for users with a paid Cloudflare plan.
- [ ] **Multi-Protocol**: Future support for WireGuard and OpenVPN profiles.
- [ ] **Advanced Metrics**: Visual charts for uptime and popularity trends.

---

## 8. API Reference

The bot provides a REST API for management and integration. All dashboard endpoints require a Bearer Token obtained via `/login`.

### Authentication
- **POST `/dashboard/api/login`**
  - Body: `{"username": "...", "password": "..."}`
  - Returns: `{"token": "..."}`

### Management Endpoints (Auth Required)
- **GET `/dashboard/api/stats`**: Get system statistics.
- **GET `/dashboard/api/configs?sort=newest&limit=20&page=1`**: Fetch stored configs.
- **POST `/dashboard/api/templates/reset`**: Restore all templates to defaults.
- **POST `/dashboard/api/fetch-now`**: Trigger manual config scraping.
- **POST `/dashboard/api/vote`**: Submit votes (single or batch).
  - Single: `{"config_hash": "...", "vote": "like|dislike"}`
  - Batch: `{"votes": [{"hash": "...", "type": "like"}, ...]}`
- **POST `/dashboard/api/settings`**: Update bot settings.
  - Body: `{"key": "all", "value": { ... }}`

### Public Endpoints (No Auth)
- **GET `/api/configs?limit=10&country=US`**
  - Returns a simple list of currently active raw configurations.
  - Optional `limit` (default 10, max 100).
  - Optional `country` code (e.g., `US`, `DE`, `TR`) to filter results.
  - Example Response:
    ```json
    {
      "count": 2,
      "country": "US",
      "configs": ["vless://...", "vmess://..."]
    }
    ```

---

## 9. Admin Commands Reference

Admins can control the bot directly via Telegram:

- `/start`: Open Admin Menu.
- `/check`: Force immediate scraping and distribution.
- `/cleanup`: Manually trigger the removal of dead/old configs.
- `/status`: View detailed KV and queue statistics.
- `/add_link [URL]`: Add a new source link.
- `/add_channel [ID]`: Add a new destination channel ID.
- `/submit`: Enter submission mode to add a config manually.
