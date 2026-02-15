// Cloudflare Worker - VPN Config Bot Pro - COMPLETE VERSION
// تمام APIهای قبلی حفظ شده و ویژگی‌های جدید اضافه شده‌اند

const CONFIG_PATTERNS = [
  /vless:\/\/[^\s<>"]+/g,
  /vmess:\/\/[^\s<>"]+/g,
  /trojan:\/\/[^\s<>"]+/g,
  /ss:\/\/[^\s<>"]+/g,
];

const DEFAULT_TEMPLATES = {
  vless: "🟢 *VLESS Config*\n🌍 Server: {server}\n📍 Location: {location}\n📊 Status: {status}\n⭐ Rating: {rating}\n📢 {channel}",
  vmess: "🔵 *VMess Config*\n🌍 Server: {server}\n📍 Location: {location}\n📊 Status: {status}\n⭐ Rating: {rating}\n📢 {channel}",
  trojan: "🔴 *Trojan Config*\n🌍 Server: {server}\n📍 Location: {location}\n📊 Status: {status}\n⭐ Rating: {rating}\n📢 {channel}",
  ss: "🟡 *Shadowsocks Config*\n🌍 Server: {server}\n📍 Location: {location}\n📊 Status: {status}\n⭐ Rating: {rating}\n📢 {channel}",
  default: "⚪ *VPN Config*\n🌍 Server: {server}\n📍 Location: {location}\n📊 Status: {status}\n⭐ Rating: {rating}\n📢 {channel}",
  user_bundle: "🎁 *User Contribution*\n👤 Contributor: {user}\n📦 Total: {count} configs\n\n{configs}\n\n📢 {channel}"
};

const DEFAULT_SETTINGS = {
  maxFailedTests: 1000,
  autoDeleteDays: 3,
  staleDeleteDays: 5,
  pendingDeleteHours: 48,
  enableRedirect: false,
  redirectUrl: "",
  activeTemplate: "default",
  rateLimitPerSecond: 30,
  minLikesToKeep: 1,
  enableQueue: false,
  queueIntervalMin: 15,
  queueBatchSize: 1
};

// ======== KV Helpers with Local Caching ========
const KV_CACHE = new Map();
const CACHE_TTL = 5000;

async function kvGet(env, key, defaultVal = null) {
  const cached = KV_CACHE.get(key);
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return cached.value;
  }
  
  try {
    const val = await env.VPN_CACHE.get(key, "json");
    const result = (val !== null && val !== undefined) ? val : defaultVal;
    KV_CACHE.set(key, { value: result, time: Date.now() });
    return result;
  } catch (e) { 
    return defaultVal; 
  }
}

async function kvSet(env, key, value) {
  await env.VPN_CACHE.put(key, JSON.stringify(value));
  KV_CACHE.set(key, { value, time: Date.now() });
}

async function kvDelete(env, key) {
  await env.VPN_CACHE.delete(key);
  KV_CACHE.delete(key);
}

// ======== Security Helpers ========
function utf8ToBase64(str) {
  try {
    const bytes = new TextEncoder().encode(str);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  } catch (e) {
    return btoa(unescape(encodeURIComponent(str)));
  }
}

async function getJwtSecret(env) {
  let secret = await kvGet(env, "auth_secret");
  if (!secret) {
    secret = crypto.randomUUID();
    await kvSet(env, "auth_secret", secret);
  }
  return secret;
}

async function signToken(payload, secret) {
  const header = utf8ToBase64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = utf8ToBase64(JSON.stringify(payload)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const data = header + "." + body;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  const sigBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  return data + "." + sigBase64;
}

async function verifyToken(token, secret) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      console.error("Token verify failed: Invalid parts length", parts.length);
      return null;
    }
    const [header, body, signature] = parts;
    const data = header + "." + body;

    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw", enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false, ["verify"]
    );

    // Recovery of base64 padding for signature
    let sigStr = signature.replace(/-/g, "+").replace(/_/g, "/");
    while (sigStr.length % 4) sigStr += "=";

    const sigBuf = Uint8Array.from(atob(sigStr), c => c.charCodeAt(0));
    const isValid = await crypto.subtle.verify("HMAC", key, sigBuf, enc.encode(data));

    if (isValid) {
      // Recovery of body padding
      let bodyStr = body.replace(/-/g, "+").replace(/_/g, "/");
      while (bodyStr.length % 4) bodyStr += "=";
      return JSON.parse(decodeURIComponent(escape(atob(bodyStr))));
    } else {
      console.error("Token verify failed: Invalid signature");
    }
  } catch (e) {
    console.error("Token verify exception:", e);
  }
  return null;
}

// ======== Rate Limiter for Telegram API ========
class RateLimiter {
  constructor(maxPerSecond = 30) {
    this.queue = [];
    this.processing = false;
    this.minInterval = 1000 / maxPerSecond;
    this.lastSent = 0;
  }

  async add(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject, retries: 0 });
      this.process();
    });
  }

  async process() {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const now = Date.now();
      const waitTime = Math.max(0, this.minInterval - (now - this.lastSent));
      
      if (waitTime > 0) {
        await new Promise(r => setTimeout(r, waitTime));
      }

      const item = this.queue.shift();
      this.lastSent = Date.now();

      try {
        const result = await item.task();
        item.resolve(result);
      } catch (e) {
        if (e.status === 429 && item.retries < 3) {
          item.retries++;
          const delay = (e.retryAfter || 1) * 1000 * Math.pow(2, item.retries);
          setTimeout(() => {
            this.queue.unshift(item);
            this.process();
          }, delay);
        } else {
          item.reject(e);
        }
      }
    }

    this.processing = false;
  }
}

const telegramRateLimiter = new RateLimiter(25);

// ======== Telegram API with Rate Limiting ========
function telegramApi(token) {
  return `https://api.telegram.org/bot${token}`;
}

async function sendTelegramWithRateLimit(env, chatId, text, replyMarkup = null, parseMode = "Markdown") {
  return telegramRateLimiter.add(async () => {
    const body = { chat_id: chatId, text, parse_mode: parseMode };
    if (replyMarkup) body.reply_markup = replyMarkup;
    
    const resp = await fetch(`${telegramApi(env.BOT_TOKEN)}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    
    if (resp.status === 429) {
      const data = await resp.json();
      const error = new Error("Rate limited");
      error.status = 429;
      error.retryAfter = data.parameters?.retry_after || 1;
      throw error;
    }
    
    return await resp.json();
  });
}

async function sendTelegram(env, chatId, text, replyMarkup = null, parseMode = "Markdown") {
  try {
    return await sendTelegramWithRateLimit(env, chatId, text, replyMarkup, parseMode);
  } catch (e) { 
    console.error("Send error:", e); 
    return null; 
  }
}

async function answerCallback(env, callbackId, text = "") {
  try {
    await fetch(`${telegramApi(env.BOT_TOKEN)}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackId, text, show_alert: false })
    });
  } catch {}
}

// ======== Config Helpers ========
function extractConfigs(text) {
  const configs = new Set();
  for (const pattern of CONFIG_PATTERNS) {
    const matches = text.match(new RegExp(pattern.source, "g"));
    if (matches) matches.forEach(m => configs.add(m));
  }
  return [...configs];
}

function detectType(config) {
  if (config.startsWith("vless://")) return "vless";
  if (config.startsWith("vmess://")) return "vmess";
  if (config.startsWith("trojan://")) return "trojan";
  if (config.startsWith("ss://")) return "ss";
  return "unknown";
}

function getCoreConfig(config) {
  try {
    if (config.startsWith("vmess://")) {
      const b64 = config.replace("vmess://", "").trim();
      const decoded = atob(b64);
      const data = JSON.parse(decoded);
      const coreData = { ...data };
      delete coreData.ps;
      // Sort keys to ensure consistent JSON string regardless of original order
      const sortedData = Object.keys(coreData).sort().reduce((obj, key) => {
        obj[key] = coreData[key];
        return obj;
      }, {});
      return "vmess://" + btoa(JSON.stringify(sortedData));
    }
    // For VLESS, Trojan, SS, the core is everything before the '#'
    return config.split('#')[0];
  } catch (e) {
    return config.split('#')[0] || config;
  }
}

function hashConfig(config) {
  const core = getCoreConfig(config);
  let hash = 0;
  for (let i = 0; i < core.length; i++) {
    const c = core.charCodeAt(i);
    hash = ((hash << 5) - hash) + c;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function getFlag(countryCode) {
  if (!countryCode || countryCode === "UN") return "🏳️";
  try {
    return countryCode
      .toUpperCase()
      .replace(/./g, char => String.fromCodePoint(char.charCodeAt(0) + 127397));
  } catch (e) {
    return "🏳️";
  }
}

function extractServer(config) {
  const type = detectType(config);
  try {
    if (type === "vmess") {
      const b64 = config.replace("vmess://", "").trim();
      try {
        const data = JSON.parse(atob(b64));
        return {
          host: data.add || data.host || "",
          port: parseInt(data.port) || 443,
          remark: data.ps || ""
        };
      } catch (e) {
        // Handle potential base64 padding issues or malformed JSON
        return { host: null, port: null };
      }
    }

    if (type === "vless" || type === "trojan") {
      const url = new URL(config.replace("vless://", "http://").replace("trojan://", "http://"));
      return {
        host: url.hostname.replace(/[\[\]]/g, ""),
        port: parseInt(url.port) || 443,
        remark: decodeURIComponent(url.hash.substring(1))
      };
    }

    if (type === "ss") {
      let part = config.replace("ss://", "");
      let remark = "";
      if (part.includes("#")) {
        const split = part.split("#");
        part = split[0];
        remark = decodeURIComponent(split[1]);
      }

      if (part.includes("@")) {
        const [auth, server] = part.split("@");
        const hp = server.split("?")[0];
        if (hp.includes(":")) {
          const [host, port] = hp.split(":");
          return { host, port: parseInt(port) || 443, remark };
        }
      } else {
        // Legacy SS links are often full base64
        try {
          const decoded = atob(part);
          if (decoded.includes("@")) {
            const server = decoded.split("@")[1];
            const [host, port] = server.split(":");
            return { host, port: parseInt(port) || 443, remark };
          }
        } catch {}
      }
    }
  } catch (e) {
    console.error("Parse error:", e);
  }
  return { host: null, port: null, remark: "" };
}

function extractChannelSource(text, config) {
  const patterns = [
    /#(\w+)/g,
    /@(\w+)/g,
    /t\.me\/(\w+)/g,
    /channel[:\s]+(\w+)/gi
  ];
  
  const sources = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      sources.push(match[1]);
    }
  }
  
  try {
    const type = detectType(config);
    if (type === "vmess") {
      const b64 = config.replace("vmess://", "");
      const data = JSON.parse(atob(b64));
      if (data.ps) sources.push(data.ps);
    } else {
      const hashPart = config.split("#")[1];
      if (hashPart) {
        const decoded = decodeURIComponent(hashPart);
        sources.push(decoded);
      }
    }
  } catch {}
  
  return [...new Set(sources)].slice(0, 3);
}

async function fetchWithTimeout(url, options = {}, timeout = 5000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

async function testConfig(config) {
  const { host, port } = extractServer(config);
  if (!host) return { 
    status: "error", 
    message: "Cannot parse server", 
    latency: -1, 
    host: null, 
    port: null,
    timestamp: new Date().toISOString()
  };
  
  const result = { 
    host, 
    port, 
    ip: null,
    country: "Unknown",
    countryCode: "UN",
    tcp: false, 
    dns: false, 
    latency: -1,
    timestamp: new Date().toISOString()
  };

  // 1. DNS Check
  try {
    const dnsResp = await fetchWithTimeout(`https://cloudflare-dns.com/dns-query?name=${host}&type=A`, {
      headers: { "Accept": "application/dns-json" }
    }, 3000);
    const dnsData = await dnsResp.json();
    if (dnsData.Answer && dnsData.Answer.length > 0) {
      result.dns = true;
      result.ip = dnsData.Answer[0].data;
    }
  } catch (e) {}

  // 1.5 Geo-Location Check (if DNS succeeded)
  if (result.dns && result.ip) {
    try {
      // Use ip-api.com (free for non-commercial, 45 requests per minute)
      const geoResp = await fetchWithTimeout(`http://ip-api.com/json/${result.ip}`, {}, 2000).catch(() => null);
      if (geoResp) {
        const geoData = await geoResp.json();
        if (geoData.status === "success") {
          result.country = geoData.country || "Unknown";
          result.countryCode = geoData.countryCode || "UN";
        }
      }
    } catch (e) {}
  }

  // 2. TCP/HTTPS Check
  if (result.dns) {
    try {
      const start = Date.now();
      // Try HTTPS first
      let resp = await fetchWithTimeout(`https://${host}:${port}`, {
        method: "HEAD",
        cf: { cacheTtl: 0 }
      }, 5000).catch(() => null);

      // If HTTPS fails, try HTTP
      if (!resp) {
        resp = await fetchWithTimeout(`http://${host}:${port}`, {
          method: "HEAD",
          cf: { cacheTtl: 0 }
        }, 5000).catch(() => null);
      }

      const elapsed = Date.now() - start;
      if (resp) {
        result.tcp = true;
        result.latency = elapsed;
      }
    } catch (e) {}
  }

  result.status = result.tcp ? "active" : result.dns ? "dns_only" : "dead";
  result.message = result.tcp ? `Online - ${result.latency}ms` : result.dns ? "DNS OK, TCP failed" : "Offline";
  return result;
}

// ======== Voting System ========
async function voteConfig(env, configHash, userId, voteType) {
  const votes = await kvGet(env, `votes_${configHash}`, { likes: [], dislikes: [], score: 0 });
  
  votes.likes = votes.likes.filter(id => id !== userId);
  votes.dislikes = votes.dislikes.filter(id => id !== userId);
  
  if (voteType === 'like') {
    votes.likes.push(userId);
  } else if (voteType === 'dislike') {
    votes.dislikes.push(userId);
  }
  
  votes.score = votes.likes.length - votes.dislikes.length;
  votes.lastVote = new Date().toISOString();
  
  await kvSet(env, `votes_${configHash}`, votes);
  await updateConfigQualityScore(env, configHash);
  return votes;
}

async function getConfigVotes(env, configHash) {
  return await kvGet(env, `votes_${configHash}`, { likes: [], dislikes: [], score: 0 });
}

function calculateQualityScore(config, votes) {
  let score = 0;
  // 1. Voting weight (High impact)
  score += (votes.likes?.length || 0) * 50;
  score -= (votes.dislikes?.length || 0) * 100;

  // 2. Latency weight
  if (config.test_result?.status === "active" && config.test_result?.latency > 0) {
    const latency = config.test_result.latency;
    if (latency < 200) score += 100;
    else if (latency < 500) score += 50;
    else if (latency < 1000) score += 20;
    else if (latency > 5000) score -= 50;
  } else if (config.test_result?.status === "dead") {
    score -= 200;
  }

  // 3. Age decay (Slightly favor newer configs if scores are equal)
  const ageDays = (Date.now() - new Date(config.created_at).getTime()) / (1000 * 60 * 60 * 24);
  score -= Math.floor(ageDays) * 5;

  return score;
}

async function pushToQueue(env, item) {
  const queue = await kvGet(env, "publish_queue", []);
  queue.push(item);
  await kvSet(env, "publish_queue", queue);
}

async function processQueue(env) {
  const settings = await kvGet(env, "bot_settings", DEFAULT_SETTINGS);
  if (!settings.enableQueue) return;

  const lastRun = await kvGet(env, "last_queue_run", 0);
  const now = Date.now();
  const intervalMs = (settings.queueIntervalMin || 15) * 60 * 1000;

  if (now - lastRun < intervalMs) return;

  const queue = await kvGet(env, "publish_queue", []);
  if (queue.length === 0) return;

  const batchSize = settings.queueBatchSize || 1;
  const toProcess = queue.slice(0, batchSize);
  const remaining = queue.slice(batchSize);

  const channels = await kvGet(env, "channel_ids", [env.CHANNEL_ID]);

  for (const item of toProcess) {
    for (const ch of channels) {
      try {
        let msg, keyboard;
        if (item.type === "bundle") {
          msg = await formatMessage(env, null, null, null, ch, item.configs, item.userAttr);
          keyboard = { inline_keyboard: [[{ text: "📤 Share", url: `https://t.me/share/url?url=${encodeURIComponent(item.configs?.[0] || "")}` }]] };
        } else {
          const votes = await getConfigVotes(env, item.hash);
          msg = await formatMessage(env, item.config, item.testResult, votes, ch);
          keyboard = configKeyboard(item.config, item.hash, ch);
        }
        await sendTelegram(env, ch, msg, keyboard);
        await new Promise(r => setTimeout(r, 1000));
      } catch (e) { console.error("Queue send error:", e); }
    }
  }

  await kvSet(env, "publish_queue", remaining);
  await kvSet(env, "last_queue_run", now);
}

async function updateConfigQualityScore(env, configHash) {
  const stored = await kvGet(env, "stored_configs", []);
  const idx = stored.findIndex(c => c.hash === configHash);
  if (idx === -1) return null;

  const votes = await getConfigVotes(env, configHash);
  stored[idx].quality_score = calculateQualityScore(stored[idx], votes);

  await kvSet(env, "stored_configs", stored);
  return stored[idx].quality_score;
}

async function incrementUserStats(env, chatId, count) {
  const stats = await kvGet(env, `user_stats_${chatId}`, { approved_count: 0 });
  stats.approved_count += count;
  await kvSet(env, `user_stats_${chatId}`, stats);
}

// ======== Menus ========
function userMenu() {
  return { inline_keyboard: [
    [{ text: "📤 Submit Config", callback_data: "submit_config" }],
    [{ text: "📋 Latest Configs", callback_data: "latest_configs" }],
    [{ text: "⭐ Best Rated", callback_data: "best_rated" }],
    [{ text: "💎 My Subscription", callback_data: "user_subscription" }],
    [{ text: "📊 Bot Stats", callback_data: "bot_stats" }],
    [{ text: "ℹ️ Help", callback_data: "user_help" }]
  ]};
}

function subAdminMenu(isInitialized = false) {
  if (!isInitialized) {
    return { inline_keyboard: [[{ text: "🚀 Initialize Subscription Service", callback_data: "sub_init" }]] };
  }
  return { inline_keyboard: [
    [{ text: "➕ Add Config", callback_data: "sub_add_config" }, { text: "🗑️ Manage Configs", callback_data: "sub_list_configs" }],
    [{ text: "👥 Manage Clients", callback_data: "sub_manage_clients" }],
    [{ text: "📊 Service Stats", callback_data: "sub_stats" }],
    [{ text: "🔙 Back to User Menu", callback_data: "back_to_user" }]
  ]};
}

function adminMenu() {
  return { inline_keyboard: [
    [{ text: "🔍 Check Now", callback_data: "admin_check_now" }],
    [{ text: "📋 Links", callback_data: "admin_links" }, { text: "📺 Channels", callback_data: "admin_channels" }],
    [{ text: "📝 Templates", callback_data: "admin_templates" }, { text: "⚙️ Settings", callback_data: "admin_settings" }],
    [{ text: "📊 Status", callback_data: "admin_status" }],
    [{ text: "👥 Submissions", callback_data: "admin_submissions" }],
    [{ text: "🗑️ Cleanup", callback_data: "admin_cleanup" }],
    [{ text: "📤 Submit Config", callback_data: "submit_config" }]
  ]};
}

function configKeyboard(config, hash, channelInfo = null) {
  const type = detectType(config);
  let shareUrl = `https://t.me/share/url?url=${encodeURIComponent(config)}`;

  if (channelInfo) {
    if (String(channelInfo).startsWith('@')) {
      shareUrl = `https://t.me/${channelInfo.substring(1)}`;
    } else if (String(channelInfo).startsWith('-100')) {
      // For private channels we can't easily link without username or invite link
      // But we can link to the channel if we have a username.
    }
  }

  return { inline_keyboard: [
    [{ text: "👎 Report", callback_data: `dislike_${hash}` }],
    [{ text: "📤 Share", url: shareUrl }, { text: "📱 Open", url: `https://t.me/share/url?url=${encodeURIComponent(config)}` }]
  ]};
}

// ======== Format Message ========
async function formatMessage(env, config, testResult, votes = null, channelInfo = null, bundleConfigs = null, userAttr = null) {
  const settings = await kvGet(env, "bot_settings", DEFAULT_SETTINGS);
  const templates = await kvGet(env, "message_templates", DEFAULT_TEMPLATES);
  
  const channel = channelInfo || "VPN Config Bot";

  // Handle bundle case
  if (bundleConfigs && Array.isArray(bundleConfigs)) {
    const template = templates.user_bundle || DEFAULT_TEMPLATES.user_bundle;
    const configsText = bundleConfigs.map(c => `\`${c}\``).join("\n\n");
    return template
      .replace(/{configs}/g, configsText)
      .replace(/{user}/g, userAttr || "Anonymous")
      .replace(/{count}/g, bundleConfigs.length)
      .replace(/{channel}/g, channel);
  }

  let templateKey = settings.activeTemplate;
  if (templateKey === 'default' || !templates[templateKey]) {
    templateKey = detectType(config);
  }
  
  const template = templates[templateKey] || templates.default || DEFAULT_TEMPLATES.default;
  const { host, port } = extractServer(config);
  const server = host ? `${host}:${port}` : "Unknown";
  const emoji = testResult.status === "active" ? "✅" : testResult.status === "dns_only" ? "⚠️" : "❌";
  
  const rating = votes ? `👍 ${votes.likes.length} | 👎 ${votes.dislikes.length}` : "N/A";
  const flag = getFlag(testResult.countryCode);
  const location = `${flag} ${testResult.country || "Unknown"}`;
  
  return template
    .replace(/{type}/g, detectType(config).toUpperCase())
    .replace(/{server}/g, server)
    .replace(/{status}/g, `${emoji} ${testResult.message}`)
    .replace(/{rating}/g, rating)
    .replace(/{latency}/g, testResult.latency > 0 ? `${testResult.latency}ms` : "N/A")
    .replace(/{channel}/g, channel)
    .replace(/{location}/g, location)
    + `\n\n\`${config}\``;
}

// ======== Cleanup Logic ========
async function manageStorage(env, newCount, configsArray = null) {
  const MAX_CONFIGS = 1000;
  let stored = configsArray || await kvGet(env, "stored_configs", []);

  if (stored.length + newCount <= MAX_CONFIGS) return stored;

  const target = MAX_CONFIGS - newCount;
  const now = Date.now();
  const TEN_DAYS = 10 * 24 * 60 * 60 * 1000;

  // Stage 0: Remove extremely low quality (e.g. many reports)
  stored.sort((a, b) => (a.quality_score || 0) - (b.quality_score || 0));
  while (stored.length > target && (stored[0].quality_score || 0) < -200) {
    stored.shift();
  }
  if (stored.length <= target) return stored;

  // Stage 1: Remove Dead
  stored = stored.filter(c => c.test_result?.status !== "dead");
  if (stored.length <= target) return stored;

  // Stage 2: Remove Older than 10 days
  stored = stored.filter(c => {
    const age = now - new Date(c.created_at).getTime();
    return isNaN(age) || age <= TEN_DAYS;
  });
  if (stored.length <= target) return stored;

  // Stage 3: Remove High Latency (High Ping)
  // Sort by latency descending (highest first)
  stored.sort((a, b) => (b.test_result?.latency || 9999) - (a.test_result?.latency || 9999));
  while (stored.length > target && (stored[0].test_result?.latency || 0) > 2000) {
    stored.shift();
  }
  if (stored.length <= target) return stored;

  // Stage 4: Retest oldest and remove failed
  // Sort by created_at ascending (oldest first)
  stored.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  for (let i = 0; i < stored.length && stored.length > target; i++) {
    const testResult = await testConfig(stored[i].config);
    if (testResult.status === "dead") {
       stored.splice(i, 1);
       i--;
    } else {
      stored[i].test_result = testResult;
      const votes = await getConfigVotes(env, stored[i].hash);
      stored[i].quality_score = calculateQualityScore(stored[i], votes);
    }
  }
  if (stored.length <= target) return stored;

  // Stage 5: Remove oldest (FIFO)
  stored.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  while (stored.length > target) {
    stored.shift();
  }

  return stored;
}

async function cleanupConfigs(env) {
  const settings = await kvGet(env, "bot_settings", DEFAULT_SETTINGS);
  const stored = await kvGet(env, "stored_configs", []);
  const now = Date.now();
  const removed = [];
  const kept = [];

  for (const config of stored) {
    let shouldRemove = false;
    
    // 1. Check Age (Standard 10-day rule from user)
    const created = new Date(config.created_at).getTime();
    if (!isNaN(created)) {
      const daysSinceCreated = (now - created) / (1000 * 60 * 60 * 24);
      const votes = await getConfigVotes(env, config.hash);
      const hasLikes = votes.likes.length >= (settings.minLikesToKeep || 1);

      // If older than 10 days and no significant likes, or older than autoDeleteDays
      if (daysSinceCreated > 10 && !hasLikes) {
        shouldRemove = true;
      } else if (daysSinceCreated > (settings.autoDeleteDays || 15) && !hasLikes) {
        shouldRemove = true;
      }
    }
    
    // 2. Check Stale Test Results
    if (!shouldRemove && config.test_result?.timestamp) {
      const lastTest = new Date(config.test_result.timestamp).getTime();
      if (!isNaN(lastTest)) {
        const daysSinceTest = (now - lastTest) / (1000 * 60 * 60 * 24);
        if (daysSinceTest > (settings.staleDeleteDays || 14)) {
          shouldRemove = true;
        }
      }
    }
    
    // 3. Check Failed Tests
    if (!shouldRemove && config.failed_tests && config.failed_tests >= (settings.maxFailedTests || 50)) {
      shouldRemove = true;
    }
    
    if (shouldRemove) {
      removed.push(config);
      await kvDelete(env, `votes_${config.hash}`);
    } else {
      kept.push(config);
    }
  }

  await kvSet(env, "stored_configs", kept);
  return { removed: removed.length, kept: kept.length };
}

// ======== Concurrency Limited Promise All ========
async function promiseAllWithLimit(promises, limit = 5) {
  const results = [];
  const executing = [];
  
  for (const [index, promise] of promises.entries()) {
    const p = Promise.resolve(promise).then(result => ({ status: 'fulfilled', value: result, index }))
      .catch(error => ({ status: 'rejected', reason: error, index }));
    
    results.push(p);
    
    if (executing.length >= limit) {
      await Promise.race(executing);
    }
    
    executing.push(p);
    
    p.finally(() => {
      const index = executing.indexOf(p);
      if (index > -1) executing.splice(index, 1);
    });
  }
  
  return Promise.all(results);
}

// ======== Fetch & Distribute ========
async function checkAndDistribute(env) {
  const links = await kvGet(env, "source_links", []);
  const channels = await kvGet(env, "channel_ids", [env.CHANNEL_ID]);
  let cache = await kvGet(env, "configs_cache", []);
  const allNew = [];

  for (const link of links) {
    try {
      const resp = await fetch(link, {
        headers: { "User-Agent": "Mozilla/5.0" },
        cf: { cacheTtl: 300 }
      });
      const text = await resp.text();
      const configs = extractConfigs(text);
      
      for (const config of configs) {
        const h = hashConfig(config);
        if (!cache.includes(h)) {
          const sources = extractChannelSource(text, config);
          allNew.push({ config, hash: h, sources });
          cache.push(h);
        }
      }
    } catch (e) { console.error(`Fetch error ${link}:`, e); }
  }

  if (cache.length > 500) cache = cache.slice(-500);
  await kvSet(env, "configs_cache", cache);

  const settings = await kvGet(env, "bot_settings", DEFAULT_SETTINGS);
  const newConfigsToStore = [];
  let sentCount = 0;
  let invalidCount = 0;

  // Limit processing to 12 new configs per run to avoid Free Tier subrequest limits (50)
  for (const item of allNew.slice(0, 12)) {
    const testResult = await testConfig(item.config);

    // Strict Filtering: Only Active and Latency < 10,000ms
    if (testResult.status !== "active" || testResult.latency >= 10000 || testResult.latency < 0) {
      invalidCount++;
      continue;
    }

    const votes = await getConfigVotes(env, item.hash);

    const configObj = {
      config: item.config, 
      hash: item.hash, 
      type: detectType(item.config),
      sources: item.sources,
      test_result: testResult, 
      created_at: new Date().toISOString(),
      failed_tests: 0,
      ...extractServer(item.config)
    };
    configObj.quality_score = calculateQualityScore(configObj, votes);
    newConfigsToStore.push(configObj);

    if (settings.enableQueue) {
      await pushToQueue(env, { type: "single", config: item.config, hash: item.hash, testResult });
    } else {
      for (const channel of channels) {
        try {
          const msg = await formatMessage(env, item.config, testResult, votes, channel);
          const keyboard = configKeyboard(item.config, item.hash, channel);
          await sendTelegram(env, channel, msg, keyboard);
          await new Promise(r => setTimeout(r, 500));
        } catch (e) { console.error(`Send error to ${channel}:`, e); }
      }
    }
    sentCount++;
  }

  if (newConfigsToStore.length > 0) {
    const cleanedStored = await manageStorage(env, newConfigsToStore.length);
    const finalConfigs = [...newConfigsToStore, ...cleanedStored];
    await kvSet(env, "stored_configs", finalConfigs.slice(0, 1000));
  }

  const summary = `✅ Summary:\n- Distributed: ${sentCount}\n- Skipped (Invalid): ${invalidCount}\n- Total Scanned: ${Math.min(allNew.length, 12)}`;
  await sendTelegram(env, env.ADMIN_CHAT_ID, summary);

  return { new_configs: sentCount, invalid: invalidCount, total: allNew.length };
}

// ======== Webhook Handler ========
async function handleWebhook(env, update) {
  if (update.callback_query) return handleCallback(env, update.callback_query);

  const message = update.message || {};
  const chatId = String(message.chat?.id || "");
  const text = message.text || "";
  const isAdmin = chatId === env.ADMIN_CHAT_ID;

  if (!text) return;

  const userState = await kvGet(env, `user_state_${chatId}`);
  if (userState === "awaiting_config") {
    await kvSet(env, `user_state_${chatId}`, null);
    const configs = extractConfigs(text);
    if (configs.length > 0) {
      const subs = await kvGet(env, "submissions", []);
      const sources = extractChannelSource(text, configs[0]);
      
      subs.push({
        id: Math.random().toString(36).substring(2, 10),
        configs: configs,
        submitted_by: chatId,
        username: message.from?.username || "unknown",
        status: "pending",
        sources: sources,
        created_at: new Date().toISOString()
      });

      await kvSet(env, "submissions", subs);
      await sendTelegram(env, chatId, `✅ ${configs.length} config(s) submitted!\nSources: ${sources.join(', ') || 'Unknown'}`);
    } else {
      await sendTelegram(env, chatId, "❌ No valid config found. Supported: vless://, vmess://, trojan://, ss://");
    }
    return;
  }

  if (userState === "sub_awaiting_config") {
    await kvSet(env, `user_state_${chatId}`, null);
    const configs = extractConfigs(text);
    if (configs.length > 0) {
      const subData = await kvGet(env, `sub_admin_data_${chatId}`);
      if (subData) {
        subData.configs = [...(subData.configs || []), ...configs];
        await kvSet(env, `sub_admin_data_${chatId}`, subData);
        await sendTelegram(env, chatId, `✅ Added ${configs.length} personal config(s)!`, subAdminMenu(true));
      }
    } else {
      await sendTelegram(env, chatId, "❌ No valid config found.");
    }
    return;
  }

  if (userState === "sub_awaiting_limits") {
    await kvSet(env, `user_state_${chatId}`, null);
    const parts = text.trim().split(/\s+/);
    const limitAct = parseInt(parts[0]);
    const limitVol = parseInt(parts[1]);

    if (!isNaN(limitAct) && !isNaN(limitVol)) {
      const subData = await kvGet(env, `sub_admin_data_${chatId}`);
      if (subData) {
        const clientId = Math.random().toString(36).substring(2, 10).toUpperCase();
        const newClient = {
          clientId,
          limitAct,
          limitVol,
          usedAct: 0,
          usedVol: 0,
          created_at: new Date().toISOString()
        };
        subData.clients = [...(subData.clients || []), newClient];
        await kvSet(env, `sub_admin_data_${chatId}`, subData);

        const combinedCode = `${subData.adminId}-${clientId}`;
        await kvSet(env, `sub_lookup_client_${combinedCode}`, chatId);

        await sendTelegram(env, chatId, `✅ Client Added!\nSubscription Code: \`${combinedCode}\``, subAdminMenu(true));
      }
    } else {
      await sendTelegram(env, chatId, "❌ Invalid format. Please use: `[Activations] [VolumeGB]`");
    }
    return;
  }

  if (text.startsWith("/sub_del_client_")) {
    const cid = text.replace("/sub_del_client_", "").trim();
    const subData = await kvGet(env, `sub_admin_data_${chatId}`);
    if (subData && subData.clients) {
      const idx = subData.clients.findIndex(c => c.clientId === cid);
      if (idx !== -1) {
        const combinedCode = `${subData.adminId}-${cid}`;
        subData.clients.splice(idx, 1);
        await kvSet(env, `sub_admin_data_${chatId}`, subData);
        await kvDelete(env, `sub_lookup_client_${combinedCode}`);
        await sendTelegram(env, chatId, "✅ Client deleted.");
      }
    }
    return;
  }

  if (text === "/start") {
    const menu = isAdmin ? adminMenu() : userMenu();
    await sendTelegram(env, chatId, "🌐 *VPN Config Bot Pro*\n\nChoose an option:", menu);
  } else if (text === "/check" && isAdmin) {
    await sendTelegram(env, chatId, "🔄 Fetching...");
    const result = await checkAndDistribute(env);
    await sendTelegram(env, chatId, `✅ Done! New: ${result.new_configs}, Total: ${result.total}`);
  } else if (text === "/cleanup" && isAdmin) {
    await sendTelegram(env, chatId, "🧹 Running cleanup...");
    const result = await cleanupConfigs(env);
    await sendTelegram(env, chatId, `✅ Cleanup done!\nRemoved: ${result.removed}\nKept: ${result.kept}`);
  } else if (text === "/submit") {
    await kvSet(env, `user_state_${chatId}`, "awaiting_config");
    await sendTelegram(env, chatId, "📤 Send your V2Ray config now:");
  } else if (text === "/latest") {
    const stored = await kvGet(env, "stored_configs", []);
    const latest = stored.slice(0, 5);
    if (latest.length > 0) {
      for (const c of latest) {
        const votes = await getConfigVotes(env, c.hash);
        const msg = await formatMessage(env, c.config, c.test_result || {status: "unknown", message: "Unknown"}, votes, chatId);
        await sendTelegram(env, chatId, msg, configKeyboard(c.config, c.hash, chatId));
      }
    } else {
      await sendTelegram(env, chatId, "No configs available yet.");
    }
  } else if (text === "/best") {
    const stored = await kvGet(env, "stored_configs", []);
    const configsWithVotes = await Promise.all(
      stored.map(async c => ({
        ...c,
        votes: await getConfigVotes(env, c.hash)
      }))
    );
    
    const sorted = configsWithVotes
      .filter(c => (c.quality_score || 0) > 0 || c.test_result?.status === "active")
      .sort((a, b) => {
        if ((b.quality_score || 0) !== (a.quality_score || 0)) return (b.quality_score || 0) - (a.quality_score || 0);
        return (a.test_result?.latency || 9999) - (b.test_result?.latency || 9999);
      })
      .slice(0, 5);
    
    for (const c of sorted) {
      const msg = await formatMessage(env, c.config, c.test_result || {status: "unknown", message: "Unknown"}, c.votes, chatId);
      await sendTelegram(env, chatId, msg, configKeyboard(c.config, c.hash, chatId));
    }
  } else if (text.startsWith("/add_link ") && isAdmin) {
    const url = text.replace("/add_link ", "").trim();
    const links = await kvGet(env, "source_links", []);
    if (!links.includes(url)) { links.push(url); await kvSet(env, "source_links", links); }
    await sendTelegram(env, chatId, `✅ Link added.`);
  } else if (text.startsWith("/remove_link ") && isAdmin) {
    const url = text.replace("/remove_link ", "").trim();
    let links = await kvGet(env, "source_links", []);
    links = links.filter(l => l !== url);
    await kvSet(env, "source_links", links);
    await sendTelegram(env, chatId, `✅ Link removed.`);
  } else if (text.startsWith("/add_channel ") && isAdmin) {
    const cid = text.replace("/add_channel ", "").trim();
    const channels = await kvGet(env, "channel_ids", []);
    if (!channels.includes(cid)) { channels.push(cid); await kvSet(env, "channel_ids", channels); }
    await sendTelegram(env, chatId, `✅ Channel added.`);
  } else if (text.startsWith("/remove_channel ") && isAdmin) {
    const cid = text.replace("/remove_channel ", "").trim();
    let channels = await kvGet(env, "channel_ids", []);
    channels = channels.filter(c => c !== cid);
    await kvSet(env, "channel_ids", channels);
    await sendTelegram(env, chatId, `✅ Channel removed.`);
  } else if (text === "/status" && isAdmin) {
    const links = await kvGet(env, "source_links", []);
    const channels = await kvGet(env, "channel_ids", []);
    const cache = await kvGet(env, "configs_cache", []);
    const stored = await kvGet(env, "stored_configs", []);
    const subs = await kvGet(env, "submissions", []);
    const pending = subs.filter(s => s.status === "pending").length;
    await sendTelegram(env, chatId, `📊 *Status*\n\nLinks: ${links.length}\nChannels: ${channels.length}\nCache: ${cache.length}\nConfigs: ${stored.length}\nPending: ${pending}`);
  } else if (!isAdmin) {
    const configs = extractConfigs(text);
    if (configs.length > 0) {
      const subs = await kvGet(env, "submissions", []);
      const sources = extractChannelSource(text, configs[0]);
      
      subs.push({
        id: Math.random().toString(36).substring(2, 10),
        configs: configs,
        submitted_by: chatId,
        username: message.from?.username || "unknown",
        status: "pending",
        sources: sources,
        created_at: new Date().toISOString()
      });

      await kvSet(env, "submissions", subs);
      await sendTelegram(env, chatId, `✅ ${configs.length} config(s) submitted!\nSources: ${sources.join(', ') || 'Unknown'}`);
    } else {
      await sendTelegram(env, chatId, "Use /start for menu.", userMenu());
    }
  }
}

async function handleCallback(env, callback) {
  const chatId = String(callback.message.chat.id);
  const data = callback.data || "";
  const isAdmin = chatId === env.ADMIN_CHAT_ID;
  const userId = callback.from.id;
  
  await answerCallback(env, callback.id, "Processing...");

  if (data.startsWith("like_") || data.startsWith("dislike_")) {
    const hash = data.replace(/^(like|dislike)_/, "");
    const voteType = data.startsWith("like_") ? "like" : "dislike";
    const votes = await voteConfig(env, hash, userId, voteType);
    
    const statusMsg = voteType === 'like' ? `Voted! Score: ${votes.score}` : `Reported! Total reports: ${votes.dislikes.length}`;
    await answerCallback(env, callback.id, statusMsg);
    
    const stored = await kvGet(env, "stored_configs", []);
    const cfg = stored.find(c => c.hash === hash);
    if (cfg) {
      const testResult = cfg.test_result || await testConfig(cfg.config);
      const newMsg = await formatMessage(env, cfg.config, testResult, votes, chatId);
      
      try {
        await fetch(`${telegramApi(env.BOT_TOKEN)}/editMessageText`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            message_id: callback.message.message_id,
            text: newMsg,
            parse_mode: "Markdown",
            reply_markup: configKeyboard(cfg.config, hash, chatId)
          })
        });
      } catch (e) { console.error("Edit error:", e); }
    }
    return;
  }

  if (data === "submit_config") {
    await kvSet(env, `user_state_${chatId}`, "awaiting_config");
    await sendTelegram(env, chatId, "📤 Send your V2Ray config now:");
  } else if (data === "user_subscription") {
    const stats = await kvGet(env, `user_stats_${chatId}`, { approved_count: 0 });
    if (stats.approved_count < 20 && !isAdmin) {
      await sendTelegram(env, chatId, `❌ You need at least 20 approved configs to start your own subscription service.\nYour current count: ${stats.approved_count}`);
      return;
    }
    const subData = await kvGet(env, `sub_admin_data_${chatId}`);
    await sendTelegram(env, chatId, "💎 *Subscription Management*\n\nHere you can manage your personal subscription service.", subAdminMenu(!!subData));
  } else if (data === "sub_init") {
    let subData = await kvGet(env, `sub_admin_data_${chatId}`);
    if (!subData) {
      const adminId = Math.random().toString(36).substring(2, 10).toUpperCase();
      subData = { adminId, configs: [], clients: [], created_at: new Date().toISOString() };
      await kvSet(env, `sub_admin_data_${chatId}`, subData);
      await kvSet(env, `sub_lookup_admin_${adminId}`, chatId);
      await sendTelegram(env, chatId, `✅ Service initialized!\nYour Admin ID: \`${adminId}\``);
    }
    await sendTelegram(env, chatId, "💎 *Subscription Management*", subAdminMenu(true));
  } else if (data === "back_to_user") {
    await sendTelegram(env, chatId, "🌐 *VPN Config Bot Pro*", userMenu());
  } else if (data === "sub_add_config") {
    await kvSet(env, `user_state_${chatId}`, "sub_awaiting_config");
    await sendTelegram(env, chatId, "📤 Send your personal V2Ray config(s) now:");
  } else if (data === "sub_list_configs") {
    const subData = await kvGet(env, `sub_admin_data_${chatId}`);
    if (subData && subData.configs?.length) {
      await sendTelegram(env, chatId, "🗑️ *Your Personal Configs:*\nClick one to delete it:");
      for (let i = 0; i < subData.configs.length; i++) {
        const c = subData.configs[i];
        const h = hashConfig(c);
        await sendTelegram(env, chatId, `\`${c.substring(0, 50)}...\``, {
          inline_keyboard: [[{ text: "🗑️ Delete", callback_data: `sub_del_config_${i}` }]]
        });
      }
    } else {
      await sendTelegram(env, chatId, "No personal configs yet.");
    }
  } else if (data.startsWith("sub_del_config_")) {
    const idx = parseInt(data.replace("sub_del_config_", ""));
    const subData = await kvGet(env, `sub_admin_data_${chatId}`);
    if (subData && subData.configs?.[idx]) {
      subData.configs.splice(idx, 1);
      await kvSet(env, `sub_admin_data_${chatId}`, subData);
      await sendTelegram(env, chatId, "✅ Deleted.");
    }
  } else if (data === "sub_manage_clients") {
    const subData = await kvGet(env, `sub_admin_data_${chatId}`);
    if (subData) {
      let msg = `👥 *Manage Clients*\nAdmin ID: \`${subData.adminId}\`\n\n`;
      if (subData.clients?.length) {
        subData.clients.forEach((c, i) => {
          const code = `${subData.adminId}-${c.clientId}`;
          msg += `${i+1}. Code: \`${code}\`\n   Limit: ${c.limitVol}GB | Used: ${c.usedVol?.toFixed(2) || 0}GB\n   Acts: ${c.usedAct}/${c.limitAct}\n   [Delete /sub_del_client_${c.clientId}]\n\n`;
        });
      } else {
        msg += "No clients added yet.";
      }
      await sendTelegram(env, chatId, msg, {
        inline_keyboard: [
          [{ text: "➕ Add Client", callback_data: "sub_add_client" }],
          [{ text: "🔙 Back", callback_data: "user_subscription" }]
        ]
      });
    }
  } else if (data === "sub_add_client") {
    await kvSet(env, `user_state_${chatId}`, "sub_awaiting_limits");
    await sendTelegram(env, chatId, "📝 Enter limits for the new client.\nFormat: `[Activations] [VolumeGB]`\nExample: `3 50` (3 devices, 50GB)");
  } else if (data === "sub_stats") {
    const subData = await kvGet(env, `sub_admin_data_${chatId}`);
    if (subData) {
      const totalUsed = (subData.clients || []).reduce((sum, c) => sum + (c.usedVol || 0), 0);
      const msg = `📊 *Service Stats*\n\nAdmin ID: \`${subData.adminId}\`\nConfigs: ${subData.configs?.length || 0}\nClients: ${subData.clients?.length || 0}\nTotal Traffic: ${totalUsed.toFixed(2)} GB`;
      await sendTelegram(env, chatId, msg, { inline_keyboard: [[{ text: "🔙 Back", callback_data: "user_subscription" }]] });
    }
  } else if (data === "latest_configs") {
    const stored = await kvGet(env, "stored_configs", []);
    const latest = stored.slice(0, 5);
    for (const c of latest) {
      const votes = await getConfigVotes(env, c.hash);
      const msg = await formatMessage(env, c.config, c.test_result || {status: "unknown", message: "Unknown"}, votes, chatId);
      await sendTelegram(env, chatId, msg, configKeyboard(c.config, c.hash, chatId));
    }
    if (!latest.length) await sendTelegram(env, chatId, "No configs yet.");
  } else if (data === "best_rated") {
    const stored = await kvGet(env, "stored_configs", []);
    const configsWithVotes = await Promise.all(
      stored.map(async c => ({
        ...c,
        votes: await getConfigVotes(env, c.hash)
      }))
    );
    
    const sorted = configsWithVotes
      .filter(c => (c.quality_score || 0) > 0)
      .sort((a, b) => (b.quality_score || 0) - (a.quality_score || 0))
      .slice(0, 5);
    
    for (const c of sorted) {
      const msg = await formatMessage(env, c.config, c.test_result || {status: "unknown", message: "Unknown"}, c.votes, chatId);
      await sendTelegram(env, chatId, msg, configKeyboard(c.config, c.hash, chatId));
    }
    if (!sorted.length) await sendTelegram(env, chatId, "No rated configs yet.");
  } else if (data === "bot_stats") {
    const stored = await kvGet(env, "stored_configs", []);
    const active = stored.filter(c => c.test_result?.status === "active").length;
    const totalVotes = await Promise.all(stored.map(c => getConfigVotes(env, c.hash)));
    const totalLikes = totalVotes.reduce((sum, v) => sum + v.likes.length, 0);
    await sendTelegram(env, chatId, `📊 Total: ${stored.length}\nActive: ${active}\nTotal Likes: ${totalLikes}`);
  } else if (data === "admin_check_now" && isAdmin) {
    await sendTelegram(env, chatId, "🔄 Fetching...");
    const result = await checkAndDistribute(env);
    await sendTelegram(env, chatId, `✅ ${result.new_configs} new configs.`);
  } else if (data === "admin_cleanup" && isAdmin) {
    await sendTelegram(env, chatId, "🧹 Cleaning up...");
    const result = await cleanupConfigs(env);
    await sendTelegram(env, chatId, `✅ Removed: ${result.removed}, Kept: ${result.kept}`);
  } else if (data === "admin_links" && isAdmin) {
    const links = await kvGet(env, "source_links", []);
    await sendTelegram(env, chatId, "📋 *Links:*\n" + links.map((l, i) => `${i + 1}. \`${l}\``).join("\n"));
  } else if (data === "admin_channels" && isAdmin) {
    const ch = await kvGet(env, "channel_ids", []);
    await sendTelegram(env, chatId, "📺 *Channels:*\n" + ch.map((c, i) => `${i + 1}. \`${c}\``).join("\n"));
  } else if (data === "admin_templates" && isAdmin) {
    const templates = await kvGet(env, "message_templates", DEFAULT_TEMPLATES);
    const settings = await kvGet(env, "bot_settings", DEFAULT_SETTINGS);
    let msg = `📝 *Templates* (Active: \`${settings.activeTemplate}\`)\n\n`;
    for (const [key, val] of Object.entries(templates)) {
      msg += `🔹 *${key.toUpperCase()}*:\n\`\`\`\n${val}\n\`\`\`\n`;
    }
    await sendTelegram(env, chatId, msg);
  } else if (data === "admin_status" && isAdmin) {
    const links = await kvGet(env, "source_links", []);
    const channels = await kvGet(env, "channel_ids", []);
    const cache = await kvGet(env, "configs_cache", []);
    const stored = await kvGet(env, "stored_configs", []);
    await sendTelegram(env, chatId, `📊 Links: ${links.length}, Ch: ${channels.length}, Cache: ${cache.length}, Configs: ${stored.length}`);
  } else if (data === "admin_settings" && isAdmin) {
    const settings = await kvGet(env, "bot_settings", DEFAULT_SETTINGS);
    await sendTelegram(env, chatId, `⚙️ *Settings:*\n\`\`\`json\n${JSON.stringify(settings, null, 2)}\n\`\`\`\nUse /set to change.`);
  } else if (data === "admin_submissions" && isAdmin) {
    const subs = await kvGet(env, "submissions", []);
    const pending = subs.filter(s => s.status === "pending").slice(0, 10);
    if (pending.length) {
      for (const s of pending) {
        const id = s.id || hashConfig(s.configs?.[0] || "");
        const configsPreview = (s.configs || []).slice(0, 3).map(c => `\`${c.substring(0, 50)}...\``).join("\n");
        await sendTelegram(env, chatId, `📤 From @${s.username}\n📦 Total: ${s.configs?.length || 0} configs\nSources: ${(s.sources || []).join(', ') || 'Unknown'}\n\n${configsPreview}`, {
          inline_keyboard: [[
            { text: "✅ Approve", callback_data: `approve_${id}` },
            { text: "❌ Reject", callback_data: `reject_${id}` }
          ]]
        });
      }
    } else { await sendTelegram(env, chatId, "No pending submissions."); }
  } else if (data.startsWith("approve_") && isAdmin) {
    const id = data.replace("approve_", "");
    const subs = await kvGet(env, "submissions", []);
    const sub = subs.find(s => s.status === "pending" && (s.id === id || hashConfig(s.configs?.[0] || "") === id));
    if (sub) {
      const settings = await kvGet(env, "bot_settings", DEFAULT_SETTINGS);
      const userAttr = sub.username !== "unknown" ? `@${sub.username}` : `User ${sub.submitted_by}`;

      if (settings.enableQueue) {
        await pushToQueue(env, { type: "bundle", configs: sub.configs, userAttr });
      } else {
        const channels = await kvGet(env, "channel_ids", [env.CHANNEL_ID]);
        const msg = await formatMessage(env, null, null, null, null, sub.configs, userAttr);
        for (const ch of channels) {
          const keyboard = { inline_keyboard: [[{ text: "📤 Share", url: `https://t.me/share/url?url=${encodeURIComponent(sub.configs?.[0] || "")}` }]] };
          await sendTelegram(env, ch, msg, keyboard);
          await new Promise(r => setTimeout(r, 1000));
        }
      }
      
      sub.status = "approved";
      await kvSet(env, "submissions", subs);
      await incrementUserStats(env, sub.submitted_by, sub.configs?.length || 1);

      // Add to stored configs (individually)
      let currentStored = await kvGet(env, "stored_configs", []);
      for (const cfg of (sub.configs || [])) {
        const h = hashConfig(cfg);
        const testResult = await testConfig(cfg);
        const votes = await getConfigVotes(env, h);
        const newEntry = {
          config: cfg,
          hash: h,
          type: detectType(cfg),
          sources: sub.sources,
          test_result: testResult,
          created_at: new Date().toISOString(),
          failed_tests: testResult.status === "dead" ? 1 : 0,
          ...extractServer(cfg)
        };
        newEntry.quality_score = calculateQualityScore(newEntry, votes);
        currentStored.unshift(newEntry);
      }

      const cleaned = await manageStorage(env, 0, currentStored);
      await kvSet(env, "stored_configs", cleaned.slice(0, 1000));

      await sendTelegram(env, chatId, "✅ Approved and published!");
    }
  } else if (data.startsWith("reject_") && isAdmin) {
    const id = data.replace("reject_", "");
    const subs = await kvGet(env, "submissions", []);
    const sub = subs.find(s => s.status === "pending" && (s.id === id || hashConfig(s.configs?.[0] || "") === id));
    if (sub) { 
      sub.status = "rejected"; 
      await kvSet(env, "submissions", subs); 
    }
    await sendTelegram(env, chatId, "❌ Rejected.");
  }
}

// ======== Dashboard HTML - COMPLETE VERSION ========
function dashboardHTML(env) {
  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VPN Bot Pro Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',Tahoma,sans-serif;background:#0a0a1a;color:#e0e0e0;min-height:100vh;direction:rtl}
.glass{background:rgba(255,255,255,.05);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,.1);border-radius:16px}
.container{max-width:1400px;margin:0 auto;padding:20px}
.login-box{max-width:400px;margin:15vh auto;padding:40px;text-align:center}
.login-box h1{font-size:28px;margin-bottom:30px;color:#00d4ff}
input,textarea,select{width:100%;padding:12px 16px;border:1px solid rgba(255,255,255,.15);border-radius:10px;background:rgba(255,255,255,.05);color:#fff;font-size:14px;margin-bottom:16px;outline:none;direction:ltr}
input:focus,textarea:focus,select:focus{border-color:#00d4ff}
button{padding:12px 24px;border:none;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;transition:.3s}
.btn-primary{background:linear-gradient(135deg,#00d4ff,#0099cc);color:#000;width:100%}
.btn-primary:hover{opacity:.9;transform:translateY(-1px)}
.btn-danger{background:#ff4444;color:#fff;padding:8px 16px;font-size:12px}
.btn-success{background:#00cc66;color:#fff;padding:8px 16px;font-size:12px}
.btn-sm{padding:8px 16px;font-size:12px;background:rgba(0,212,255,.2);color:#00d4ff;border:1px solid rgba(0,212,255,.3)}
.header{display:flex;justify-content:space-between;align-items:center;padding:20px 30px;margin-bottom:30px}
.header h1{font-size:24px;color:#00d4ff}
.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:30px}
.stat-card{padding:24px;text-align:center}
.stat-card .num{font-size:36px;font-weight:700;color:#00d4ff}
.stat-card .label{color:#888;margin-top:8px;font-size:14px}
.tabs{display:flex;gap:8px;margin-bottom:24px;flex-wrap:wrap}
.tab{padding:10px 20px;border-radius:10px;cursor:pointer;background:rgba(255,255,255,.05);border:1px solid transparent;transition:.3s}
.tab.active{background:rgba(0,212,255,.15);border-color:#00d4ff;color:#00d4ff}
.section{display:none;padding:24px}
.section.active{display:block}
.list-item{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid rgba(255,255,255,.05)}
.list-item:last-child{border-bottom:none}
.config-card{padding:16px;margin-bottom:12px;border-radius:12px;background:rgba(255,255,255,.03);position:relative}
.config-card code{display:block;word-break:break-all;font-size:11px;color:#888;margin-top:8px;background:rgba(0,0,0,.3);padding:8px;border-radius:6px}
.badge{padding:4px 10px;border-radius:20px;font-size:11px;font-weight:600;margin-right:8px}
.badge-active{background:rgba(0,255,100,.15);color:#0f0}
.badge-dead{background:rgba(255,0,0,.15);color:#f55}
.badge-dns{background:rgba(255,200,0,.15);color:#fa0}
.badge-pending{background:rgba(0,150,255,.15);color:#0af}
.add-row{display:flex;gap:12px;margin-bottom:16px}
.add-row input{margin-bottom:0;flex:1}
.voting{display:flex;gap:10px;margin-top:10px;align-items:center}
.vote-btn{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);color:#fff;padding:6px 12px;border-radius:6px;cursor:pointer;transition:.3s}
.vote-btn:hover{background:rgba(0,212,255,.2);border-color:#00d4ff}
.vote-btn.liked{color:#0f0;border-color:#0f0}
.vote-btn.disliked{color:#f55;border-color:#f55}
.settings-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px;margin-bottom:20px}
.settings-item{display:flex;flex-direction:column}
.settings-item label{color:#00d4ff;margin-bottom:6px;font-size:13px}
.settings-item input,.settings-item select{background:rgba(0,0,0,.2)}
#app{min-height:100vh}
.loading{display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,.8);padding:20px 40px;border-radius:10px;z-index:1000}
.loading.active{display:block}
.pagination{display:flex;gap:10px;justify-content:center;margin-top:20px}
.page-btn{padding:8px 16px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);color:#fff;border-radius:6px;cursor:pointer}
.page-btn.active{background:#00d4ff;color:#000}
.page-btn:disabled{opacity:.5;cursor:not-allowed}
.sort-bar{display:flex;gap:12px;margin-bottom:16px;align-items:center}
.sort-bar select{width:auto;min-width:150px}
</style>
</head>
<body>
<div id="app">
<div id="login-container" class="login-box glass" style="display:block">
<h1>🌐 VPN Bot Pro Panel</h1>
<input id="username" placeholder="Username" autocomplete="off">
<input id="password" type="password" placeholder="Password">
<button class="btn-primary" onclick="login()">Login</button>
<p id="login-error" style="color:#f55;margin-top:12px;display:none"></p>
<script>
  if (localStorage.getItem('token')) {
    document.getElementById('login-container').style.display = 'none';
  }
</script>
</div>
<div id="dashboardz" style="display:none">
<script>
  if (localStorage.getItem('token')) {
    document.getElementById('login-container').style.display = 'none';
    document.getElementById('dashboardz').style.display = 'block';
  }
</script>
<div class="header glass">
<h1>🌐 VPN Bot Pro Dashboard</h1>
<button class="btn-danger" onclick="logout()">Logout</button>
</div>
<div class="container">
<div class="stats-grid" id="stats"></div>
<div class="tabs">
<div class="tab active" onclick="showTab('links')">📋 Links</div>
<div class="tab" onclick="showTab('channels')">📺 Channels</div>
<div class="tab" onclick="showTab('configs')">🔰 Configs</div>
<div class="tab" onclick="showTab('templates')">📝 Templates</div>
<div class="tab" onclick="showTab('submissions')">👥 Submissions</div>
<div class="tab" onclick="showTab('settings')">⚙️ Settings</div>
<div class="tab" onclick="showTab('actions')">⚡ Actions</div>
</div>
<div id="links" class="section active glass">
<div class="add-row"><input id="new-link" placeholder="https://..."><button class="btn-sm" onclick="addLink()">Add Link</button></div>
<div id="links-list"></div>
</div>
<div id="channels" class="section glass">
<div class="add-row"><input id="new-channel" placeholder="-100..."><button class="btn-sm" onclick="addChannel()">Add Channel</button></div>
<div id="channels-list"></div>
</div>
<div id="configs" class="section glass">
<div class="sort-bar">
<select id="sort-by" onchange="loadConfigs()">
<option value="newest">Newest First</option>
<option value="best">Best Rated</option>
<option value="latency">Lowest Ping</option>
<option value="active">Active Only</option>
</select>
<input type="number" id="limit-input" placeholder="Limit (10-100)" value="20" style="width:120px" onchange="loadConfigs()">
</div>
<div id="configs-list"></div>
<div class="pagination" id="pagination"></div>
</div>
<div id="templates" class="section glass">
<div style="margin-bottom:16px;display:flex;justify-content:space-between;align-items:center">
<div>
<label style="color:#00d4ff">Active Template:</label>
<select id="active-template" onchange="setActiveTemplate()" style="width:200px">
<option value="default">Default (Auto-detect)</option>
<option value="vless">VLESS Style</option>
<option value="vmess">VMess Style</option>
<option value="trojan">Trojan Style</option>
<option value="ss">Shadowsocks Style</option>
<option value="user_bundle">User Bundle Style</option>
</select>
</div>
<button class="btn-danger" onclick="resetTemplates()">Reset All to Defaults</button>
</div>
<div id="templates-list"></div>
</div>
<div id="submissions" class="section glass"><div id="submissions-list"></div></div>
<div id="settings" class="section glass">
<div class="settings-grid" id="settings-grid"></div>
<button class="btn-primary" onclick="saveSettings()">Save Settings</button>
<div style="margin-top:20px;padding:16px;background:rgba(0,212,255,.1);border-radius:8px">
<h3 style="color:#00d4ff;margin-bottom:12px">Redirect / Template Mode</h3>
<label style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
<input type="checkbox" id="enable-redirect" style="width:auto"> Enable Redirect instead of Template
</label>
<input id="redirect-url" placeholder="https://example.com" style="margin-bottom:12px">
<button class="btn-sm" onclick="saveRedirectSettings()">Save Redirect Settings</button>
</div>
</div>
<div id="actions" class="section glass" style="text-align:center;padding:40px">
<button class="btn-primary" style="max-width:300px;margin:10px auto;display:block" onclick="fetchNow()">🔍 Fetch Configs Now</button>
<button class="btn-primary" style="max-width:300px;margin:10px auto;display:block;background:linear-gradient(135deg,#ff6b6b,#ee5a5a)" onclick="cleanupNow()">🗑️ Cleanup Dead Configs</button>
<button class="btn-primary" style="max-width:300px;margin:10px auto;display:block;background:linear-gradient(135deg,#4ecdc4,#44a08d)" onclick="retestAll()">🔄 Retest All Configs</button>
<div class="add-row" style="max-width:500px;margin:20px auto">
<input id="test-config-input" placeholder="vless://... or vmess://...">
<button class="btn-sm" onclick="testCfg()">Test</button>
</div>
<div id="test-result" style="margin-top:16px"></div>
<div id="action-result" style="margin-top:16px"></div>
</div>
</div>
</div>
</div>
<div class="loading" id="loading">Processing...</div>

<!-- Script 1: Basic Login Logic -->
<script>
async function login() {
  var u = document.getElementById('username').value;
  var p = document.getElementById('password').value;
  var err = document.getElementById('login-error');
  var ld = document.getElementById('loading');

  if (!err || !ld) return;

  err.style.display = 'none';
  ld.style.display = 'block';

  try {
    var resp = await fetch('/dashboard/api/login', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({username: u, password: p})
    });
    var data = await resp.json();
    ld.style.display = 'none';

    if (resp.ok && data.token) {
      localStorage.setItem('token', data.token);
      window.location.reload();
    } else {
      err.style.display = 'block';
      err.textContent = data.error || 'Invalid credentials';
    }
  } catch (e) {
    ld.style.display = 'none';
    err.style.display = 'block';
    err.textContent = 'Connection error: ' + e.message;
  }
}
window.login = login;
</script>

<!-- Script 2: Main Dashboard Logic -->
<script>
var TOKEN = localStorage.getItem('token') || "";
var API = "/dashboard/api";
var currentPage = 1;
var totalPages = 1;

function showLoading(){ var el = document.getElementById("loading"); if(el) el.classList.add("active"); }
function hideLoading(){ var el = document.getElementById("loading"); if(el) el.classList.remove("active"); }

async function api(path, method, body) {
  showLoading();
  var h = {"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"};
  var opts = {method: method || "GET", headers: h};
  if (body) opts.body = JSON.stringify(body);
  try {
    console.log("Dashboard API Call:", path);
    var r = await fetch(API + path, opts);
    if (r.status === 401) {
      console.warn("Unauthorized API call, logging out...");
      logout();
      return null;
    }
    var d = await r.json();
    hideLoading();
    return d;
  } catch (e) {
    hideLoading();
    console.error("API Error at " + path + ":", e);
    return null;
  }
}

window.logout = function() {
  console.log("Logging out...");
  localStorage.removeItem('token');
  window.location.reload();
};

window.showDashboard = async function() {
  console.log("Initializing Dashboard...");
  if (!TOKEN) {
    console.log("No token found, staying on login screen.");
    return;
  }

  // Show dashboard container immediately
  var lc = document.getElementById("login-container");
  var db = document.getElementById("dashboardz");
  if (lc) lc.style.display = "none";
  if (db) db.style.display = "block";

  try {
    console.log("Loading Dashboard Sections...");
    await loadStats();
    await loadLinks();
    await loadChannels();
    await loadConfigs(1);
    await loadTemplates();
    await loadSubmissions();
    await loadSettings();
    console.log("Dashboard Loaded Successfully.");
  } catch (e) {
    console.error("Dashboard Load Error:", e);
    alert("Error loading dashboard data: " + e.message);
  }
};

async function loadStats() {
  console.log("Loading Stats...");
  var d = await api("/stats");
  if (!d) return;
  document.getElementById("stats").innerHTML =
    '<div class="stat-card glass"><div class="num">'+(d.total_configs||0)+'</div><div class="label">Total Configs</div></div>' +
    '<div class="stat-card glass"><div class="num">'+(d.active_configs||0)+'</div><div class="label">Active</div></div>' +
    '<div class="stat-card glass"><div class="num">'+(d.source_links||0)+'</div><div class="label">Links</div></div>' +
    '<div class="stat-card glass"><div class="num">'+(d.channels||0)+'</div><div class="label">Channels</div></div>' +
    '<div class="stat-card glass"><div class="num">'+(d.pending_submissions||0)+'</div><div class="label">Pending</div></div>' +
    '<div class="stat-card glass"><div class="num">'+(d.queue_size||0)+'</div><div class="label">Queue</div></div>' +
    '<div class="stat-card glass"><div class="num">'+(d.total_votes||0)+'</div><div class="label">Total Votes</div></div>';
}

async function loadLinks() {
  var d = await api("/links");
  if (!d) return;
  var html = "";
  (d.links || []).forEach(function(l) {
    html += '<div class="list-item"><span style="word-break:break-all;font-size:13px">' + l + '</span><button class="btn-danger" onclick="removeLink(\'' + l + '\')">Remove</button></div>';
  });
  document.getElementById("links-list").innerHTML = html || "<p>No links configured.</p>";
}

window.addLink = async function(){var u=document.getElementById("new-link").value; if(u){await api("/links","POST",{url:u}); document.getElementById("new-link").value=""; loadLinks(); loadStats();}};
window.removeLink = async function(u){await api("/links","DELETE",{url:u}); loadLinks(); loadStats();};

async function loadChannels() {
  var d = await api("/channels");
  if (!d) return;
  var html = "";
  (d.channels || []).forEach(function(c) {
    html += '<div class="list-item"><span>' + c + '</span><button class="btn-danger" onclick="removeChannel(\'' + c + '\')">Remove</button></div>';
  });
  document.getElementById("channels-list").innerHTML = html || "<p>No channels configured.</p>";
}

window.addChannel = async function(){var c=document.getElementById("new-channel").value; if(c){await api("/channels","POST",{channel_id:c}); document.getElementById("new-channel").value=""; loadChannels(); loadStats();}};
window.removeChannel = async function(c){await api("/channels","DELETE",{channel_id:c}); loadChannels(); loadStats();};

function getFlag(code) {
  if (!code || code === "UN") return "🏳️";
  return code.toUpperCase().replace(/./g, function(c) { return String.fromCodePoint(c.charCodeAt(0) + 127397); });
}

window.loadConfigs = async function(page) {
  currentPage = page || 1;
  var sortBy = document.getElementById("sort-by").value;
  var limit = parseInt(document.getElementById("limit-input").value) || 20;
  var d = await api("/configs?sort=" + sortBy + "&limit=" + limit + "&page=" + currentPage);
  if (!d) return;
  totalPages = Math.ceil((d.total || 0) / limit);
  
  var html = "";
  (d.configs || []).forEach(function(c) {
    var badge = c.test_result && c.test_result.status === "active" ? "badge-active" : (c.test_result && c.test_result.status === "dns_only" ? "badge-dns" : "badge-dead");
    var votes = c.votes || {likes: [], dislikes: [], score: 0};
    var loc = getFlag(c.test_result ? c.test_result.countryCode : "") + " " + (c.test_result ? c.test_result.country || "Unknown" : "Unknown");
    html += '<div class="config-card"><div style="display:flex;justify-content:space-between;align-items:center"><div><span class="badge ' + badge + '">' + c.type.toUpperCase() + '</span><span style="font-size:12px">' + loc + '</span></div><span style="color:#888;font-size:12px">' + (c.test_result ? c.test_result.latency || "N/A" : "N/A") + 'ms</span></div><div style="margin:8px 0">' + (c.test_result ? c.test_result.message : "Offline") + ' | Sources: ' + (c.sources ? c.sources.join(", ") : "Unknown") + '</div><div class="voting"><button class="vote-btn" onclick="vote(\'' + c.hash + '\',\'like\')">👍 ' + votes.likes.length + '</button><button class="vote-btn" onclick="vote(\'' + c.hash + '\',\'dislike\')">👎 ' + votes.dislikes.length + '</button><span style="color:#00d4ff">Score: ' + votes.score + '</span></div><code>' + c.config + '</code><div style="margin-top:10px"><button class="btn-danger" onclick="deleteConfig(\'' + c.hash + '\')">🗑️ Delete</button></div></div>';
  });
  document.getElementById("configs-list").innerHTML = html || "<p>No configs yet.</p>";
  renderPagination();
};

function renderPagination() {
  var html = '';
  for (var i = 1; i <= totalPages; i++) {
    html += '<button class="page-btn ' + (i === currentPage ? 'active' : '') + '" onclick="loadConfigs(' + i + ')">' + i + '</button>';
  }
  document.getElementById("pagination").innerHTML = html;
}

window.vote = async function(hash, type) { await api("/vote", "POST", {config_hash: hash, vote: type}); loadConfigs(currentPage); };
window.deleteConfig = async function(hash) { if(confirm("Delete this config?")){ await api("/configs/" + hash, "DELETE"); loadConfigs(currentPage); loadStats(); } };

async function loadTemplates() {
  var d = await api("/templates");
  if (!d) return;
  var t = d.templates || {};
  document.getElementById("active-template").value = d.activeTemplate || "default";
  var html = "";
  Object.keys(t).forEach(function(k) {
    html += '<div style="margin-bottom:16px"><label style="color:#00d4ff;font-weight:600">' + k + '</label><textarea id="tmpl_' + k + '" style="margin-top:8px;height:80px">' + t[k] + '</textarea><button class="btn-sm" onclick="saveTemplate(\'' + k + '\')">Save</button></div>';
  });
  document.getElementById("templates-list").innerHTML = html;
}

window.saveTemplate = async function(type) { var v = document.getElementById("tmpl_" + type).value; await api("/templates", "POST", {type: type, template: v}); alert("Saved!"); };
window.resetTemplates = async function() { if(confirm("Reset all templates?")){ await api("/templates/reset", "POST"); loadTemplates(); } };
window.setActiveTemplate = async function() { var template = document.getElementById("active-template").value; await api("/settings", "POST", {key: "activeTemplate", value: template}); };

async function loadSubmissions() {
  var d = await api("/submissions");
  if (!d) return;
  var html = "";
  (d.submissions || []).forEach(function(s) {
    var id = s.id || "unknown";
    var preview = (s.configs || []).slice(0, 2).join("\n");
    html += '<div class="config-card"><span class="badge badge-pending">Bundle (' + (s.configs ? s.configs.length : 0) + ')</span> @' + s.username + '<div style="color:#888;font-size:12px;margin:4px 0">Sources: ' + (s.sources ? s.sources.join(", ") : "Unknown") + '</div><code>' + preview + '...</code><div style="margin-top:8px"><button class="btn-success" onclick="approveSub(\'' + id + '\')">✅ Approve</button> <button class="btn-danger" onclick="rejectSub(\'' + id + '\')">❌ Reject</button></div></div>';
  });
  document.getElementById("submissions-list").innerHTML = html || "<p>No pending submissions.</p>";
}

window.approveSub = async function(id) { await api("/submissions/approve", "POST", {id: id}); loadSubmissions(); loadStats(); };
window.rejectSub = async function(id) { await api("/submissions/reject", "POST", {id: id}); loadSubmissions(); loadStats(); };

async function loadSettings() {
  var d = await api("/settings");
  if (!d) return;
  var s = d.settings || {};
  document.getElementById("settings-grid").innerHTML =
    '<div class="settings-item"><label>Max Failed Tests</label><input type="number" id="setting-maxFailedTests" value="'+(s.maxFailedTests||1000)+'"></div>' +
    '<div class="settings-item"><label>Auto Delete Days</label><input type="number" id="setting-autoDeleteDays" value="'+(s.autoDeleteDays||3)+'"></div>' +
    '<div class="settings-item"><label>Stale Delete Days</label><input type="number" id="setting-staleDeleteDays" value="'+(s.staleDeleteDays||5)+'"></div>' +
    '<div class="settings-item"><label>Min Likes to Keep</label><input type="number" id="setting-minLikesToKeep" value="'+(s.minLikesToKeep||1)+'"></div>' +
    '<div class="settings-item"><label>Rate Limit</label><input type="number" id="setting-rateLimit" value="'+(s.rateLimitPerSecond||30)+'"></div>' +
    '<div class="settings-item"><label>Queue Interval (min)</label><input type="number" id="setting-queueInterval" value="'+(s.queueIntervalMin||15)+'"></div>' +
    '<div class="settings-item"><label>Queue Batch Size</label><input type="number" id="setting-queueBatch" value="'+(s.queueBatchSize||1)+'"></div>' +
    '<div class="settings-item"><label>Enable Queue</label><select id="setting-enableQueue"><option value="false" '+(s.enableQueue?'':'selected')+'>Disabled</option><option value="true" '+(s.enableQueue?'selected':'')+'>Enabled</option></select></div>';
  document.getElementById("enable-redirect").checked = s.enableRedirect || false;
  document.getElementById("redirect-url").value = s.redirectUrl || "";
}

window.saveSettings = async function() {
  var settings = {
    maxFailedTests: parseInt(document.getElementById("setting-maxFailedTests").value),
    autoDeleteDays: parseInt(document.getElementById("setting-autoDeleteDays").value),
    staleDeleteDays: parseInt(document.getElementById("setting-staleDeleteDays").value),
    minLikesToKeep: parseInt(document.getElementById("setting-minLikesToKeep").value),
    rateLimitPerSecond: parseInt(document.getElementById("setting-rateLimit").value),
    queueIntervalMin: parseInt(document.getElementById("setting-queueInterval").value),
    queueBatchSize: parseInt(document.getElementById("setting-queueBatch").value),
    enableQueue: document.getElementById("setting-enableQueue").value === "true"
  };
  await api("/settings", "POST", {key: "all", value: settings});
  alert("Settings saved!");
};

window.saveRedirectSettings = async function() {
  var enableRedirect = document.getElementById("enable-redirect").checked;
  var redirectUrl = document.getElementById("redirect-url").value;
  await api("/settings", "POST", {key: "enableRedirect", value: enableRedirect});
  await api("/settings", "POST", {key: "redirectUrl", value: redirectUrl});
  alert("Redirect settings saved!");
};

window.fetchNow = async function() { var d = await api("/fetch-now", "POST"); alert("Done! New: " + (d ? d.new_configs : 0)); loadConfigs(1); loadStats(); };
window.cleanupNow = async function() { var d = await api("/cleanup", "POST"); alert("Removed: " + (d ? d.removed : 0)); loadConfigs(1); loadStats(); };
window.retestAll = async function() { var d = await api("/retest-all", "POST"); alert("Retested: " + (d ? d.tested : 0)); loadConfigs(currentPage); };
window.testCfg = async function() {
  var c = document.getElementById("test-config-input").value;
  if (!c) return;
  var d = await api("/test", "POST", {config: c});
  if (d) document.getElementById("test-result").innerHTML = 'Result: ' + d.status + ' (' + d.latency + 'ms)';
};

window.showTab = function(name) {
  document.querySelectorAll(".section").forEach(function(s){s.classList.remove("active");});
  document.querySelectorAll(".tab").forEach(function(t){t.classList.remove("active");});
  document.getElementById(name).classList.add("active");
};

if (TOKEN) {
  console.log("Token detected, triggering dashboard load...");
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { window.showDashboard(); });
  } else {
    window.showDashboard();
  }
} else {
  console.log("No token detected, showing login screen.");
}
</script>
</body></html>`;
}

// ======== Dashboard API - COMPLETE VERSION ========
async function handleDashboardAPI(env, request, path) {
  const url = new URL(request.url);
  const method = request.method;
  const secret = await getJwtSecret(env);

  // Normalize path
  const normalizedPath = path.endsWith("/") ? path.slice(0, -1) : path;

  // Login - API موجود قبلی
  if (normalizedPath === "/login" && method === "POST") {
    let credentials;
    try {
      credentials = await request.json();
    } catch (e) {
      return jsonResp({ error: "Invalid request body" }, 400);
    }
    const { username, password } = credentials;

    // Safety check for unset credentials
    const validUser = env.DASHBOARD_USER || "";
    const validPass = env.DASHBOARD_PASS || "";

    if (username === validUser && password === validPass) {
      const payload = { sub: username, exp: Date.now() + 86400000 };
      const token = await signToken(payload, secret);
      return jsonResp({ token, username });
    }
    return jsonResp({ error: "Invalid username or password" }, 401);
  }

  // Auth check
  const auth = request.headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) return jsonResp({ error: "Unauthorized" }, 401);

  const token = auth.replace("Bearer ", "");
  const userPayload = await verifyToken(token, secret);

  if (!userPayload) {
    console.error("Auth Failed: Invalid token signature or format");
    return jsonResp({ error: "Invalid or expired token" }, 401);
  }
  if (userPayload.exp < Date.now()) {
    console.error("Auth Failed: Token expired at", new Date(userPayload.exp).toISOString());
    return jsonResp({ error: "Token expired" }, 401);
  }

  // Stats - API موجود قبلی با بهبود
  if (normalizedPath === "/stats") {
    const stored = await kvGet(env, "stored_configs", []);
    const links = await kvGet(env, "source_links", []);
    const channels = await kvGet(env, "channel_ids", []);
    const subs = await kvGet(env, "submissions", []);
    const queue = await kvGet(env, "publish_queue", []);
    
    let totalVotes = 0;
    for (const c of stored) {
      const votes = await getConfigVotes(env, c.hash);
      totalVotes += votes.likes.length + votes.dislikes.length;
    }
    
    return jsonResp({
      total_configs: stored.length,
      active_configs: stored.filter(c => c.test_result?.status === "active").length,
      source_links: links.length,
      channels: channels.length,
      pending_submissions: subs.filter(s => s.status === "pending").length,
      queue_size: queue.length,
      total_votes: totalVotes
    });
  }

  // Links - API موجود قبلی حفظ شده
  if (normalizedPath === "/links" && method === "GET") return jsonResp({ links: await kvGet(env, "source_links", []) });
  if (normalizedPath === "/links" && method === "POST") {
    const { url: linkUrl } = await request.json();
    const links = await kvGet(env, "source_links", []);
    if (!links.includes(linkUrl)) { links.push(linkUrl); await kvSet(env, "source_links", links); }
    return jsonResp({ links });
  }
  if (normalizedPath === "/links" && method === "DELETE") {
    const { url: linkUrl } = await request.json();
    let links = await kvGet(env, "source_links", []);
    links = links.filter(l => l !== linkUrl);
    await kvSet(env, "source_links", links);
    return jsonResp({ links });
  }

  // Channels - API موجود قبلی حفظ شده
  if (normalizedPath === "/channels" && method === "GET") return jsonResp({ channels: await kvGet(env, "channel_ids", []) });
  if (normalizedPath === "/channels" && method === "POST") {
    const { channel_id } = await request.json();
    const channels = await kvGet(env, "channel_ids", []);
    if (!channels.includes(channel_id)) { channels.push(channel_id); await kvSet(env, "channel_ids", channels); }
    return jsonResp({ channels });
  }
  if (normalizedPath === "/channels" && method === "DELETE") {
    const { channel_id } = await request.json();
    let channels = await kvGet(env, "channel_ids", []);
    channels = channels.filter(c => c !== channel_id);
    await kvSet(env, "channel_ids", channels);
    return jsonResp({ channels });
  }

  // Configs با Pagination و Sorting - API موجود قبلی با بهبود
  if (normalizedPath === "/configs" && method === "GET") {
    const sortBy = url.searchParams.get("sort") || "newest";
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit")) || 20, 10), 100);
    const page = Math.max(parseInt(url.searchParams.get("page")) || 1, 1);
    
    let stored = await kvGet(env, "stored_configs", []);
    
    stored = await Promise.all(stored.map(async c => ({
      ...c,
      votes: await getConfigVotes(env, c.hash)
    })));
    
    switch(sortBy) {
      case "best":
        stored.sort((a, b) => (b.quality_score || 0) - (a.quality_score || 0));
        break;
      case "latency":
        stored.sort((a, b) => (a.test_result?.latency || 9999) - (b.test_result?.latency || 9999));
        break;
      case "active":
        stored = stored.filter(c => c.test_result?.status === "active");
        break;
      case "newest":
      default:
        break;
    }
    
    const total = stored.length;
    const start = (page - 1) * limit;
    const paginated = stored.slice(start, start + limit);
    
    return jsonResp({ configs: paginated, total, page, limit });
  }

  // Delete Config - API جدید
  if (normalizedPath.startsWith("/configs/") && method === "DELETE") {
    const hash = normalizedPath.replace("/configs/", "");
    let stored = await kvGet(env, "stored_configs", []);
    const config = stored.find(c => c.hash === hash);
    
    if (config) {
      stored = stored.filter(c => c.hash !== hash);
      await kvSet(env, "stored_configs", stored);
      await kvDelete(env, `votes_${hash}`);
      return jsonResp({ deleted: true, hash });
    }
    return jsonResp({ error: "Not found" }, 404);
  }

  // Voting - API جدید (Handles single or batch)
  if (normalizedPath === "/vote" && method === "POST") {
    const body = await request.json();
    const userId = userPayload.sub;

    if (Array.isArray(body.votes)) {
      const results = [];
      for (const item of body.votes) {
        if (item.hash && item.type) {
          const v = await voteConfig(env, item.hash, userId, item.type);
          results.push({ hash: item.hash, votes: v });
        }
      }
      return jsonResp({ results });
    } else {
      const { config_hash, vote } = body;
      const votes = await voteConfig(env, config_hash, userId, vote);
      return jsonResp({ votes });
    }
  }

  // Templates - API موجود قبلی حفظ شده
  if (normalizedPath === "/templates" && method === "GET") {
    const templates = await kvGet(env, "message_templates", DEFAULT_TEMPLATES);
    const settings = await kvGet(env, "bot_settings", DEFAULT_SETTINGS);
    return jsonResp({ templates, activeTemplate: settings.activeTemplate });
  }
  if (normalizedPath === "/templates" && method === "POST") {
    const { type, template } = await request.json();
    const templates = await kvGet(env, "message_templates", DEFAULT_TEMPLATES);
    templates[type] = template;
    await kvSet(env, "message_templates", templates);
    return jsonResp({ templates });
  }
  if (normalizedPath === "/templates/reset" && method === "POST") {
    await kvSet(env, "message_templates", DEFAULT_TEMPLATES);
    return jsonResp({ templates: DEFAULT_TEMPLATES });
  }

  // Submissions - API موجود قبلی حفظ شده
  if (normalizedPath === "/submissions" && method === "GET") {
    const subs = await kvGet(env, "submissions", []);
    return jsonResp({ submissions: subs.filter(s => s.status === "pending").slice(0, 50) });
  }
  if (normalizedPath === "/submissions/approve" && method === "POST") {
    const { id } = await request.json();
    const subs = await kvGet(env, "submissions", []);
    const sub = subs.find(s => s.status === "pending" && (s.id === id || hashConfig(s.configs?.[0] || "") === id));
    if (sub) {
      const settings = await kvGet(env, "bot_settings", DEFAULT_SETTINGS);
      const userAttr = sub.username !== "unknown" ? `@${sub.username}` : `User ${sub.submitted_by}`;

      if (settings.enableQueue) {
        await pushToQueue(env, { type: "bundle", configs: sub.configs, userAttr });
      } else {
        const channels = await kvGet(env, "channel_ids", [env.CHANNEL_ID]);
        const msg = await formatMessage(env, null, null, null, null, sub.configs, userAttr);
        for (const ch of channels) {
          const keyboard = { inline_keyboard: [[{ text: "📤 Share", url: `https://t.me/share/url?url=${encodeURIComponent(sub.configs?.[0] || "")}` }]] };
          await sendTelegram(env, ch, msg, keyboard);
        }
      }
      sub.status = "approved";
      await kvSet(env, "submissions", subs);
      await incrementUserStats(env, sub.submitted_by, sub.configs?.length || 1);

      // Add to stored configs (individually)
      let currentStored = await kvGet(env, "stored_configs", []);
      for (const cfg of (sub.configs || [])) {
        const h = hashConfig(cfg);
        const testResult = await testConfig(cfg);
        const votes = await getConfigVotes(env, h);
        const newEntry = {
          config: cfg, hash: h, type: detectType(cfg), sources: sub.sources,
          test_result: testResult, created_at: new Date().toISOString(),
          failed_tests: testResult.status === "dead" ? 1 : 0, ...extractServer(cfg)
        };
        newEntry.quality_score = calculateQualityScore(newEntry, votes);
        currentStored.unshift(newEntry);
      }
      const cleaned = await manageStorage(env, 0, currentStored);
      await kvSet(env, "stored_configs", cleaned.slice(0, 1000));

      return jsonResp({ status: "approved" });
    }
    return jsonResp({ error: "Not found" }, 404);
  }
  if (normalizedPath === "/submissions/reject" && method === "POST") {
    const { id } = await request.json();
    const subs = await kvGet(env, "submissions", []);
    const sub = subs.find(s => s.status === "pending" && (s.id === id || hashConfig(s.configs?.[0] || "") === id));
    if (sub) { sub.status = "rejected"; await kvSet(env, "submissions", subs); }
    return jsonResp({ status: "rejected" });
  }

  // Settings - API جدید
  if (normalizedPath === "/settings" && method === "GET") {
    const settings = await kvGet(env, "bot_settings", DEFAULT_SETTINGS);
    return jsonResp({ settings });
  }
  if (normalizedPath === "/settings" && method === "POST") {
    const { key, value } = await request.json();
    const settings = await kvGet(env, "bot_settings", DEFAULT_SETTINGS);
    
    if (key === "all") {
      Object.assign(settings, value);
    } else {
      settings[key] = value;
    }
    
    await kvSet(env, "bot_settings", settings);
    return jsonResp({ settings });
  }

  // Fetch Now - API موجود قبلی حفظ شده
  if (normalizedPath === "/fetch-now" && method === "POST") {
    const result = await checkAndDistribute(env);
    return jsonResp(result);
  }

  // Cleanup - API جدید
  if (normalizedPath === "/cleanup" && method === "POST") {
    const result = await cleanupConfigs(env);
    return jsonResp(result);
  }

  // Retest All - API جدید
  if (normalizedPath === "/retest-all" && method === "POST") {
    const stored = await kvGet(env, "stored_configs", []);
    const limit = 5; // محدودیت همزمانی
    
    const testPromises = stored.map((config, index) => async () => {
      const testResult = await testConfig(config.config);
      config.test_result = testResult;
      if (testResult.status === "dead") {
        config.failed_tests = (config.failed_tests || 0) + 1;
      } else {
        config.failed_tests = 0;
      }
      const votes = await getConfigVotes(env, config.hash);
      config.quality_score = calculateQualityScore(config, votes);
      return config;
    });
    
    // اجرا با محدودیت همزمانی
    const results = [];
    for (let i = 0; i < testPromises.length; i += limit) {
      const batch = testPromises.slice(i, i + limit);
      const batchResults = await Promise.all(batch.map(fn => fn()));
      results.push(...batchResults);
      await new Promise(r => setTimeout(r, 100)); // جلوگیری از overload
    }
    
    await kvSet(env, "stored_configs", results);
    return jsonResp({ tested: results.length });
  }

  // Test - API موجود قبلی حفظ شده
  if (normalizedPath === "/test" && method === "POST") {
    const { config } = await request.json();
    return jsonResp(await testConfig(config));
  }

  return jsonResp({ error: "Not found" }, 404);
}

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
}

// ======== Main Handler - COMPLETE ========
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,Authorization"
      }});
    }

    // Init defaults on first request
    const initialized = await kvGet(env, "_initialized");
    if (!initialized) {
      await kvSet(env, "source_links", ["https://raw.githubusercontent.com/arshiacomplus/v2rayExtractor/refs/heads/main/mix/sub.html"]);
      await kvSet(env, "channel_ids", [env.CHANNEL_ID]);
      await kvSet(env, "configs_cache", []);
      await kvSet(env, "submissions", []);
      await kvSet(env, "stored_configs", []);
      await kvSet(env, "message_templates", DEFAULT_TEMPLATES);
      await kvSet(env, "bot_settings", DEFAULT_SETTINGS);
      await kvSet(env, "_initialized", true);
    }

    // Webhook - API موجود قبلی حفظ شده
    if (url.pathname === "/webhook" && request.method === "POST") {
      try {
        const update = await request.json();
        await handleWebhook(env, update);
        return new Response("OK");
      } catch (e) {
        return new Response(`Error: ${e.message}`, { status: 500 });
      }
    }

    // Public API for Configs
    if (url.pathname === "/api/configs") {
      const limit = Math.min(parseInt(url.searchParams.get("limit")) || 10, 100);
      const country = url.searchParams.get("country")?.toUpperCase();
      const minQuality = parseInt(url.searchParams.get("min_quality")) || 0;
      const sortBy = url.searchParams.get("sort") || "newest";

      const stored = await kvGet(env, "stored_configs", []);

      let filtered = stored.filter(c => c.test_result?.status === "active" && (c.quality_score || 0) >= minQuality);
      if (country) {
        filtered = filtered.filter(c => c.test_result?.countryCode === country);
      }

      if (sortBy === "best") {
        filtered.sort((a, b) => (b.quality_score || 0) - (a.quality_score || 0));
      }

      const active = filtered.slice(0, limit);
      return jsonResp({
        count: active.length,
        country: country || "ALL",
        min_quality: minQuality,
        sort: sortBy,
        configs: active.map(c => c.config)
      });
    }

    // Subscription API (Base64 for V2Ray clients)
    if (url.pathname === "/api/sub") {
      const limit = Math.min(parseInt(url.searchParams.get("limit")) || 100, 1000);
      const country = url.searchParams.get("country")?.toUpperCase();
      const minQuality = parseInt(url.searchParams.get("min_quality")) || 0;
      const sortBy = url.searchParams.get("sort") || "best";

      const stored = await kvGet(env, "stored_configs", []);

      let filtered = stored.filter(c => c.test_result?.status === "active" && (c.quality_score || 0) >= minQuality);
      if (country) {
        filtered = filtered.filter(c => c.test_result?.countryCode === country);
      }

      if (sortBy === "best") {
        filtered.sort((a, b) => (b.quality_score || 0) - (a.quality_score || 0));
      }

      const active = filtered.slice(0, limit);
      const rawContent = active.map(c => c.config).join("\n");
      const subContent = utf8ToBase64(rawContent);

      return new Response(subContent, {
        headers: { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" }
      });
    }

    // Countries List API for App UI
    if (url.pathname === "/api/countries") {
      const stored = await kvGet(env, "stored_configs", []);
      const active = stored.filter(c => c.test_result?.status === "active");

      const counts = {};
      active.forEach(c => {
        const code = c.test_result?.countryCode || "UN";
        const name = c.test_result?.country || "Unknown";
        if (!counts[code]) {
          counts[code] = { country: name, countryCode: code, count: 0 };
        }
        counts[code].count++;
      });

      return jsonResp(Object.values(counts).sort((a, b) => b.count - a.count));
    }

    // User-to-User Subscription API
    if (url.pathname === "/api/user-sub") {
      const code = url.searchParams.get("code");
      if (!code) return jsonResp({ error: "Code required" }, 400);

      const adminChatId = await kvGet(env, `sub_lookup_client_${code}`);
      if (!adminChatId) return new Response("Invalid subscription code", { status: 403 });

      const subData = await kvGet(env, `sub_admin_data_${adminChatId}`);
      if (!subData) return new Response("Service unavailable", { status: 404 });

      const subParts = code.split('-'); const clientId = subParts[subParts.length - 1];
      const client = subData.clients?.find(c => c.clientId === clientId);

      if (!client) return new Response("Client not found", { status: 404 });
      if (client.usedVol >= client.limitVol) return new Response("Subscription expired (Volume limit)", { status: 403 });

      const configs = subData.configs || [];
      const rawContent = configs.join("\n");
      const subContent = utf8ToBase64(rawContent);
      return new Response(subContent, {
        headers: { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" }
      });
    }

    // Usage Reporting API
    if (url.pathname === "/api/user-sub/report" && request.method === "POST") {
      const { code, volumeMB, activate } = await request.json();
      const adminChatId = await kvGet(env, `sub_lookup_client_${code}`);
      if (!adminChatId) return jsonResp({ error: "Invalid code" }, 403);

      const subData = await kvGet(env, `sub_admin_data_${adminChatId}`);
      const subParts = code.split('-'); const clientId = subParts[subParts.length - 1];
      const client = subData.clients?.find(c => c.clientId === clientId);

      if (client) {
        if (volumeMB) client.usedVol = (client.usedVol || 0) + (volumeMB / 1024);
        if (activate) client.usedAct = (client.usedAct || 0) + 1;

        await kvSet(env, `sub_admin_data_${adminChatId}`, subData);
        return jsonResp({ status: "updated", usedVol: client.usedVol, usedAct: client.usedAct });
      }
      return jsonResp({ error: "Client not found" }, 404);
    }

    // Dashboard API - API موجود قبلی با بهبود
    if (url.pathname.startsWith("/dashboard/api")) {
      const apiPath = url.pathname.replace("/dashboard/api", "");
      return handleDashboardAPI(env, request, apiPath);
    }

    // Dashboard HTML - API موجود قبلی حفظ شده
    if (url.pathname === "/dashboard" || url.pathname === "/dashboard/") {
      return new Response(dashboardHTML(env), { headers: { "Content-Type": "text/html;charset=UTF-8" } });
    }

    // Set Webhook - API موجود قبلی حفظ شده
    if (url.pathname === "/set-webhook") {
      const workerUrl = url.origin;
      const resp = await fetch(`${telegramApi(env.BOT_TOKEN)}/setWebhook?url=${workerUrl}/webhook`);
      const data = await resp.json();
      return jsonResp(data);
    }

    // Redirect/Template Logic - ویژگی جدید
    if (url.pathname === "/" || url.pathname === "") {
      const settings = await kvGet(env, "bot_settings", DEFAULT_SETTINGS);
      
      if (settings.enableRedirect && settings.redirectUrl) {
        return Response.redirect(settings.redirectUrl, 302);
      }
      
      // نمایش صفحه توضیحات/پرتفولیو به جای متن ساده
      return new Response(portfolioHTML(env), { 
        headers: { "Content-Type": "text/html;charset=UTF-8" } 
      });
    }

    return new Response("VPN Config Bot Pro is running. Dashboard: /dashboard", { headers: { "Content-Type": "text/plain" } });
  },

  async scheduled(event, env, ctx) {
    // Cron job برای fetch و cleanup
    ctx.waitUntil(checkAndDistribute(env));
    ctx.waitUntil(cleanupConfigs(env));
    ctx.waitUntil(processQueue(env));
  }
};

// ======== Portfolio HTML - ویژگی جدید ========
function portfolioHTML(env) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>VPN Config Service</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { 
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  background: linear-gradient(135deg, #0f0c29, #302b63, #24243e);
  color: #fff;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}
.container {
  max-width: 800px;
  padding: 40px;
  text-align: center;
}
h1 { font-size: 3em; margin-bottom: 20px; background: linear-gradient(45deg, #00d4ff, #0099cc); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.subtitle { font-size: 1.2em; color: #aaa; margin-bottom: 40px; }
.features { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 40px 0; }
.feature { background: rgba(255,255,255,0.05); padding: 30px; border-radius: 15px; border: 1px solid rgba(255,255,255,0.1); transition: transform 0.3s; }
.feature:hover { transform: translateY(-5px); background: rgba(255,255,255,0.1); }
.feature-icon { font-size: 2.5em; margin-bottom: 15px; }
.feature h3 { color: #00d4ff; margin-bottom: 10px; }
.feature p { color: #aaa; font-size: 0.9em; }
.cta { margin-top: 40px; }
.btn { 
  display: inline-block; 
  padding: 15px 40px; 
  background: linear-gradient(45deg, #00d4ff, #0099cc); 
  color: #000; 
  text-decoration: none; 
  border-radius: 30px; 
  font-weight: bold;
  margin: 10px;
  transition: transform 0.3s;
}
.btn:hover { transform: scale(1.05); }
.footer { margin-top: 60px; color: #666; font-size: 0.9em; }
</style>
</head>
<body>
<div class="container">
<h1>🌐 VPN Config Bot Pro</h1>
<p class="subtitle">Advanced VPN Configuration Management Service</p>

<div class="features">
<div class="feature">
<div class="feature-icon">⚡</div>
<h3>Fast Testing</h3>
<p>Automated latency and connectivity testing for all configs</p>
</div>
<div class="feature">
<div class="feature-icon">🛡️</div>
<h3>Quality Control</h3>
<p>Community voting system to ensure high-quality configs</p>
</div>
<div class="feature">
<div class="feature-icon">🤖</div>
<h3>Telegram Bot</h3>
<p>Easy submission and management through Telegram</p>
</div>
<div class="feature">
<div class="feature-icon">📊</div>
<h3>Dashboard</h3>
<p>Comprehensive web dashboard for administrators</p>
</div>
</div>

<div class="cta">
<a href="/dashboard" class="btn">Access Dashboard</a>
<a href="https://t.me/${env.BOT_USERNAME || 'your_bot'}" class="btn">Open Telegram Bot</a>
</div>

<div class="footer">
<p>Powered by Cloudflare Workers | Secure & Fast</p>
</div>
</div>
</body>
</html>`;
}