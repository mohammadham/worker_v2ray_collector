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
7. [Areas for Improvement & Bug Fixes](#areas-for-improvement--bug-fixes)
8. [Proposed Feature Enhancements](#proposed-feature-enhancements)
9. [Conclusion](#conclusion)

---

## 1. Overview
The **VPN Config Bot Pro** is a Cloudflare Worker that acts as a Telegram bot to automatically collect, test, rate, and redistribute VPN configuration links (VLESS, VMess, Trojan, Shadowsocks). It includes a complete web‑based admin dashboard, a voting system, submission approval workflows, scheduled cleanup, and rate‑limited Telegram API calls. All persistent data is stored in Cloudflare KV.

---

## 2. Feature List

### Core Automation
- **Config Extraction** – Scrapes plain text from configured URLs and extracts all VPN configs using regex patterns.
- **Protocol Support** – Recognises `vless://`, `vmess://`, `trojan://`, `ss://`.
- **Health Testing** – Tests each config via DNS-over-HTTPS (Cloudflare) and TCP `HEAD` requests; reports status (`active`, `dns_only`, `dead`) and latency.
- **Automatic Distribution** – Sends newly discovered, tested configs to one or more Telegram channels.
- **Scheduled Execution** – Uses Worker’s `scheduled` event to run fetch and cleanup every minute (configurable).

### User Interaction (Telegram)
- **Start Menu** – Different menus for regular users and admin.
- **Submit Configs** – Users can send raw configs; submissions go into a pending queue.
- **Voting** – Like/dislike buttons on each published config; scores are stored per user.
- **Latest & Best Rated** – Retrieve newest or top‑scored configs.
- **Stats** – View total configs, active count, total likes.
- **Copy & Share** – Buttons to copy config or share via Telegram.

### Admin Operations (Telegram & Dashboard)
- **Manage Source Links** – Add/remove URLs that are polled for new configs.
- **Manage Channels** – Add/remove destination Telegram channels.
- **Submissions Approval** – View pending submissions, approve/reject, and auto‑publish to channels.
- **Templates** – Customise message templates per protocol.
- **Settings** – Adjust cleanup thresholds, rate limits, retention days, etc.
- **Manual Triggers** – `/check`, `/cleanup`, and admin menu buttons for immediate execution.
- **Dashboard** – Full web‑based control panel with authentication.

### Web Dashboard
- **Login** – Basic authentication (static credentials from env vars).
- **Statistics Cards** – Total configs, active, links, channels, pending, votes.
- **Tabbed Interface** – Manage links, channels, configs, templates, submissions, settings, actions.
- **Configs View** – Paginated, sortable (newest, best, latency, active), delete configs, vote simulation.
- **Template Editor** – Edit message templates per protocol, set active template.
- **Settings Editor** – Modify all numeric/boolean settings via form.
- **Action Buttons** – Fetch now, cleanup, retest all, test single config.
- **Responsive Design** – Mobile‑friendly, dark theme, glassmorphism UI.

### Data Management & Persistence
- **KV Storage** – Uses Cloudflare KV for all dynamic data: config cache, stored configs, votes, submissions, templates, settings, links, channels.
- **Local KV Cache** – In‑memory cache with 5‑second TTL to reduce KV reads.
- **Cleanup Logic** – Automatic deletion based on:
  - Age without likes (`autoDeleteDays`)
  - Stale test results (`staleDeleteDays`)
  - Excessive consecutive failed tests (`maxFailedTests`)
- **Concurrency Control** – Limits parallel operations (test, Telegram sends) to avoid overload.

### Resilience & Performance
- **Rate Limiter** – Custom `RateLimiter` class to respect Telegram’s 30 messages/second limit, with retry on 429.
- **Promise Limiting** – `promiseAllWithLimit` restricts concurrent tests and Telegram sends.
- **Error Handling** – Graceful degradation; failed fetches/sends are logged but do not crash the worker.
- **Retry Logic** – On 429 (rate limit), retries up to 3 times with exponential backoff.

### Additional Features
- **Redirect Mode** – Option to redirect the root path (`/`) to a custom URL instead of showing the portfolio page.
- **Portfolio Page** – Professional landing page describing the service, with links to dashboard and bot.
- **Set Webhook Endpoint** – Helper endpoint to configure Telegram webhook.
- **CORS Headers** – Enabled for dashboard API.

---

## 3. System Architecture & Diagram

```mermaid
flowchart TB
    subgraph "Cloudflare Worker"
        direction TB
        WH[Webhook Handler] -->|callback| TG[Telegram Bot API]
        SC[Scheduled Cron] -->|periodic| FnC[Fetch & Distribute]
        FnC -->|store/retrieve| KV[(KV Namespace)]
        FnC -->|test| Test[Config Tester]
        FnC -->|send| TG
        
        SUB[Submission Handler] -->|store| KV
        SUB -->|approve| Publish
        
        AdminAPI[Dashboard API] -->|CRUD| KV
        AdminAPI -->|triggers| FnC
        AdminAPI -->|triggers| Cleanup[Cleanup Job]
        
        DashUI[Dashboard HTML] -->|fetches| AdminAPI
        
        Root[Root Path] -->|redirect/portfolio| HTTPResponse
    end
    
    subgraph "External"
        Sources[Source URLs] -->|HTTP GET| FnC
        User[Telegram User] -->|messages| WH
        User -->|callback| WH
        Channel[Telegram Channel] <--|new configs| TG
        Admin[Admin] -->|commands| WH
        Admin -->|web access| DashUI
    end
    
    KV -->|cache| MemCache[In‑Memory Cache (5s TTL)]
    Test -->|dns/tcp| CloudflareDNS[Cloudflare DoH]
    Test -->|tcp| Target[Config Server]
```

**Key Flows**:
1. **Automatic Fetch** – Cron runs `checkAndDistribute()`: fetches source links, extracts new configs, tests them, stores results, and sends active ones to channels.
2. **User Submission** – User sends config or presses “Submit” button; worker stores submission as pending in KV.
3. **Admin Approval** – Admin approves via callback or dashboard; config is tested, formatted, and published to channels.
4. **Voting** – User clicks like/dislike; vote is recorded; message is edited to reflect new score.
5. **Dashboard** – Admin logs in, views/manages all resources via REST API backed by KV.

---

## 4. Operational Scenarios

### Scenario 1: Fully Automatic Mode
- Admin configures several source URLs (e.g., GitHub raw config lists) and one or more output Telegram channels.
- Worker runs every minute: fetches new configs, tests them, and automatically posts **only the ones that pass** to the channels.
- No manual intervention required.

### Scenario 2: Community Submission + Approval
- Users discover the bot, press “Submit Config” and paste their config.
- Admin receives notification (via menu) and can approve/reject each submission.
- Approved configs are tested and published to channels, credited with the submitter’s username.

### Scenario 3: Rating & Curation
- Subscribers in channels see like/dislike buttons under each config.
- High‑rated configs appear in the “Best Rated” command.
- Admin can set `minLikesToKeep` so that popular configs are not auto‑deleted even if they are old.

### Scenario 4: Dashboard Management
- Admin visits `/dashboard`, logs in, and monitors system health.
- Adds/removes source links, channels, edits templates, adjusts cleanup thresholds.
- Manually triggers a fetch or cleanup run.
- Deletes problematic configs directly from the dashboard.

---

## 5. Complete Documentation

### 5.1 Setup & Deployment
1. **Create a Cloudflare Worker** – Use the dashboard or Wrangler CLI.
2. **Bind a KV Namespace** – Name it `VPN_CACHE` (must match variable name in code).
3. **Set Environment Variables** (secrets) – See section 5.2.
4. **Upload the Worker script** – Copy the entire `worker.js` content.
5. **Configure Trigger** – Add a Cron trigger (e.g., `* * * * *`) for scheduled tasks.
6. **Set Webhook** – Send a GET request to `https://your-worker.workers.dev/set-webhook` (this will call Telegram `setWebhook` with the worker’s URL).

### 5.2 Environment Variables (Secrets)
| Variable          | Description                                                                 |
|-------------------|-----------------------------------------------------------------------------|
| `BOT_TOKEN`       | Telegram Bot Token from @BotFather.                                        |
| `CHANNEL_ID`      | Default Telegram channel ID where configs will be posted (e.g., `-1001234567890`). |
| `ADMIN_CHAT_ID`   | Telegram user ID of the admin (for admin menus and notifications).         |
| `DASHBOARD_USER`  | Username for web dashboard login.                                          |
| `DASHBOARD_PASS`  | Password for web dashboard login.                                          |
| `BOT_USERNAME`    | (Optional) Bot username for portfolio page link.                           |

### 5.3 KV Namespace
- **Namespace name**: `VPN_CACHE` (must match code).
- No initial data required; worker automatically populates defaults on first run.

### 5.4 Telegram Bot Configuration
- Create a bot via BotFather, get token.
- Enable inline mode (optional).
- Set commands (suggested):
  ```
  start - Show main menu
  submit - Submit a new config
  latest - Show latest configs
  best - Show best rated configs
  status - Bot status (admin only)
  check - Force fetch (admin only)
  cleanup - Force cleanup (admin only)
  add_link - Add source URL (admin)
  remove_link - Remove source URL (admin)
  add_channel - Add channel ID (admin)
  remove_channel - Remove channel ID (admin)
  ```

### 5.5 Usage

#### Regular Users
- `/start` → User menu: Submit, Latest, Best Rated, Stats, Help.
- **Submit Config**: Click button or send `/submit`, then paste any config text. Bot extracts valid configs and stores as pending.
- **View Configs**: `Latest` and `Best Rated` show formatted messages with copy/vote/share buttons.
- **Vote**: Click 👍 or 👎 – score updates in real time.

#### Administrators
- All user commands + admin‑only menu.
- **Source Links**: Add via `/add_link https://...` or dashboard.
- **Channels**: Add via `/add_channel -100...` or dashboard.
- **Submissions**: Admin menu → Submissions → approve/reject each.
- **Manual Fetch**: `/check` or dashboard button.
- **Cleanup**: `/cleanup` or dashboard button.
- **Settings**: Dashboard only (full JSON edit or form).

### 5.6 Web Dashboard
- URL: `https://your-worker.workers.dev/dashboard`
- Login with `DASHBOARD_USER` / `DASHBOARD_PASS`.
- **Tabs**:
  - **Links**: View/add/remove source URLs.
  - **Channels**: View/add/remove destination channel IDs.
  - **Configs**: Browse all stored configs with pagination, sort, delete, vote simulation.
  - **Templates**: Edit message templates per protocol; select active template.
  - **Submissions**: Approve/reject pending user submissions.
  - **Settings**: Modify numeric/boolean settings, redirect mode.
  - **Actions**: Trigger fetch, cleanup, retest all, test a single config.
- All changes are immediately persisted to KV.

---

## 6. Strengths & Weaknesses

### ✅ Strengths
- **All‑in‑one** – Combines scraping, testing, publishing, voting, and admin UI in a single worker.
- **Cost‑effective** – Runs entirely on Cloudflare’s free tier (KV, Workers).
- **Scalable** – Uses concurrency limiting and KV caching; can handle hundreds of configs.
- **Customizable** – Templates, settings, redirect mode make it adaptable.
- **Good UX** – Inline keyboards, real‑time vote updates, clean dashboard.
- **Resilient** – Rate limiting, retries, error catching prevent crashes.
- **Portfolio page** – Professional public face.

### ❌ Weaknesses & Limitations

1. **Config Testing Reliability**
   - Only tests TCP port reachability via `HEAD` request – not a true VPN protocol handshake.
   - Uses Cloudflare DoH – may be blocked in some regions or count toward DoH limits.
   - No support for UDP or advanced protocol‑specific checks.
   - Latency measurement may be inflated due to Cloudflare proxy.

2. **Config Parsing**
   - Regex extraction is fragile; embedded newlines or unusual formatting may fail.
   - VMess base64 decoding assumes specific JSON structure; malformed configs crash silently.
   - Does not support `ss://` with SIP002 format (no `@` delimiter) or `vless://` with extra query parameters.

3. **Security**
   - Dashboard uses hard‑coded credentials (no 2FA, session management only via self‑encoded JWT-like token).
   - No CSRF protection; token stored in localStorage.
   - Admin chat ID is used as sole identifier – if compromised, attacker gains full admin control.
   - Submissions contain raw configs with possible personal remarks (remarks may reveal server owner).

4. **KV & Performance**
   - `kvGet`/`kvSet` are called frequently; local cache helps but only 5s TTL.
   - Large config lists (500+) may hit KV read/write limits or cause slow responses.
   - No pagination for `stored_configs` in memory – entire list loaded on each operation.

5. **Error Handling Gaps**
   - Many `try/catch` blocks are empty or just `console.error`; some failures are ignored (e.g., DNS test).
   - `testConfig` may throw unhandled exceptions from `fetch` if signal times out – not fully caught.
   - No logging or monitoring integration.

6. **Bot Interaction**
   - `/start` overwrites user state; if user is in “awaiting_config”, `/start` will exit that state without confirmation.
   - Callback queries are answered with “Processing…” but sometimes the edit fails silently.
   - No feedback when user tries to vote on a config that was already deleted.

7. **Deployment Complexity**
   - Relies on environment variables for secrets; no built‑in setup wizard.
   - Admin must manually set webhook via `/set-webhook` endpoint.

8. **Protocol Limitations**
   - Only supports four protocols; no WireGuard, OpenVPN, etc.
   - No support for configs with `&` in parameters (query string split may fail).

---

## 7. Areas for Improvement & Bug Fixes

### 🔧 Immediate Bug Fixes
1. **VMess Parsing** – In `extractServer`, `atob` may fail on non‑base64 strings; wrap in `try/catch` and fallback.
2. **`testConfig` timeout** – `AbortSignal.timeout` is not supported in all Workers environments; use `AbortController` with `setTimeout`.
3. **`sendTelegram` rate limiter** – The limiter is created once per worker instance; but multiple instances may exist, causing bursts. Use a Durable Object or external rate limiting for accuracy.
4. **`kvGet` default handling** – Some calls pass `[]` as default but the stored value might be `null`; ensure consistent type.
5. **`cleanupConfigs`** – `daysSinceTest` uses `lastTest` but if test_result is missing, it compares `undefined` and `NaN`. Add guard.
6. **`handleCallback` – when editing message after vote, the bot token is not included in the `fetch` URL; it uses `telegramApi(env.BOT_TOKEN)` correctly? Yes, but `fetch` inside callback uses `telegramApi(env.BOT_TOKEN)` – however, `env` is not in scope there. Actually the code uses `telegramApi(env.BOT_TOKEN)` inside the `fetch` call – this works because `env` is passed to `handleCallback`. No bug, but ensure `env` is defined.

### ⚙️ Performance & Reliability
- **Implement proper pagination in `stored_configs`** – Keep all configs in KV as a list of keys, not a single large array. Currently, the whole array is read/written each time, which will hit KV 1MB limit and slow performance.
- **Use KV expiration** – Instead of manual cleanup, set TTL on KV entries for votes/configs.
- **Parallel test limiting** – `promiseAllWithLimit` is used only in retest-all; apply it in `checkAndDistribute` as well.
- **Improve caching** – Increase cache TTL for static data (templates, settings). Use `cache-control` for source URL fetches.

### 🛡️ Security Enhancements
- **Dashboard authentication** – Replace simple token with proper session management (e.g., JWT with short expiry, secure cookie).
- **Add CSRF token** for dashboard API POST requests.
- **Rate limit login attempts** – Prevent brute force.
- **Admin action confirmation** – Require second confirmation for deletion of configs/links.
- **Sanitise config remarks** – Strip potentially offensive text before publishing.

### 🧪 Testing Accuracy
- **Use protocol‑specific probes** – For VMess/VLESS, attempt a real handshake (maybe via external service) or at least measure TLS handshake time.
- **Add fallback DNS** – If Cloudflare DoH is unavailable, try Google or system DNS.
- **Test multiple ports** – Some configs use non‑standard ports; verify both 443 and the specified port.

### 📱 User Experience
- **Add “Report” button** – Allow users to report dead or malicious configs.
- **Show submitter name** on approved configs (optional).
- **Add inline search** – Search configs by remark, IP, or protocol.
- **Persistent user state** – Use conversation handler to avoid state loss.

### 📊 Monitoring & Logging
- **Integrate with Cloudflare Logpush** or send logs to a webhook.
- **Track daily active users, votes, submissions** – Store aggregated stats in KV.
- **Alert admin** when many configs fail test or when source URLs are down.

---

## 8. Proposed Feature Enhancements

### 🚀 High‑Impact Additions
1. **Multi‑protocol Support**
   - Add WireGuard (`wg://`), OpenVPN (`.ovpn`), IKEv2, etc.
   - Parse base64‑encoded OpenVPN profiles.

2. **Geo‑location Tagging**
   - Resolve server IP to country/city using MaxMind or ip-api, display flag in message.

3. **Automatic Channel Post Scheduling**
   - Instead of posting immediately, queue configs and post at intervals to avoid channel flooding.

4. **User Favourites**
   - Allow users to “bookmark” configs; send notification when a favourited config goes offline.

5. **Config Quality Score**
   - Combine latency, uptime, vote score, and age into a single quality score.

6. **Dark Web / Alternative Fetch**
   - Support fetching from IPFS, Tor, or Telegram channels (via MTProto).

7. **Multi‑Admin Support**
   - Allow multiple admin chat IDs with different permission levels.

8. **Backup & Restore**
   - Export/import all KV data via dashboard.

9. **Internationalisation (i18n)**
   - Support multiple languages in bot messages.

10. **Performance Metrics Dashboard**
    - Graphs of active configs over time, vote trends, etc. using Chart.js.

### 🧩 Nice‑to‑Have
- **Config Shortener** – Generate tiny URLs for long configs.
- **QR Code** – Generate QR for easy mobile scan (in dashboard).
- **REST API** for third‑party integration.
- **Subscription via RSS** – Users can subscribe to config feeds.
- **Auto‑remove low‑score configs** – Delete if dislike count exceeds likes by threshold.

---

## 9. Conclusion
The **VPN Config Bot Pro** is a sophisticated, feature‑rich Cloudflare Worker that successfully automates the lifecycle of VPN configuration distribution. It demonstrates strong engineering practices such as rate limiting, concurrency control, and a modular design. However, it also exhibits several limitations in testing reliability, security, and scalability under heavy load.

By addressing the identified weaknesses and implementing the suggested improvements, this bot can evolve into a production‑grade service suitable for large communities. Its foundation is solid, and with proper maintenance and enhancements, it can become an indispensable tool for VPN config sharing.

---