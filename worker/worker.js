// Cloudflare Worker - VPN Config Bot with Dashboard
// Deploy: wrangler deploy

const CONFIG_PATTERNS = [
  /vless:\/\/[^\s<>"]+/g,
  /vmess:\/\/[^\s<>"]+/g,
  /trojan:\/\/[^\s<>"]+/g,
  /ss:\/\/[^\s<>"]+/g,
];

const DEFAULT_TEMPLATES = {
  vless: "🟢 *VLESS Config*\n🌍 Server: {server}\n📊 Status: {status}",
  vmess: "🔵 *VMess Config*\n🌍 Server: {server}\n📊 Status: {status}",
  trojan: "🔴 *Trojan Config*\n🌍 Server: {server}\n📊 Status: {status}",
  ss: "🟡 *Shadowsocks Config*\n🌍 Server: {server}\n📊 Status: {status}",
  default: "⚪ *VPN Config*\n🌍 Server: {server}\n📊 Status: {status}"
};

// ======== KV Helpers ========
async function kvGet(env, key, defaultVal = null) {
  try {
    const val = await env.VPN_CACHE.get(key, "json");
    return val !== null ? val : defaultVal;
  } catch { return defaultVal; }
}

async function kvSet(env, key, value) {
  await env.VPN_CACHE.put(key, JSON.stringify(value));
}

// ======== Telegram API ========
function telegramApi(token) {
  return `https://api.telegram.org/bot${token}`;
}

async function sendTelegram(env, chatId, text, replyMarkup = null, parseMode = "Markdown") {
  const body = { chat_id: chatId, text, parse_mode: parseMode };
  if (replyMarkup) body.reply_markup = replyMarkup;
  try {
    const resp = await fetch(`${telegramApi(env.BOT_TOKEN)}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    return await resp.json();
  } catch (e) { console.error("Send error:", e); return null; }
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

function hashConfig(config) {
  let hash = 0;
  for (let i = 0; i < config.length; i++) {
    const c = config.charCodeAt(i);
    hash = ((hash << 5) - hash) + c;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function extractServer(config) {
  const type = detectType(config);
  try {
    if (type === "vmess") {
      const b64 = config.replace("vmess://", "");
      const data = JSON.parse(atob(b64));
      return { host: data.add || "", port: parseInt(data.port) || 443 };
    }
    if (type === "vless" || type === "trojan") {
      const part = config.split("://")[1];
      const atSplit = part.split("@");
      if (atSplit.length > 1) {
        const hp = atSplit[1].split("?")[0].split("#")[0];
        if (hp.includes(":")) {
          const [host, port] = hp.split(/:\/?/);
          return { host: host.replace(/[\[\]]/g, ""), port: parseInt(port) || 443 };
        }
      }
    }
    if (type === "ss") {
      const part = config.replace("ss://", "");
      if (part.includes("@")) {
        const hp = part.split("@")[1].split("?")[0].split("#")[0];
        if (hp.includes(":")) {
          const [host, port] = hp.split(":");
          return { host, port: parseInt(port) || 443 };
        }
      }
    }
  } catch {}
  return { host: null, port: null };
}

async function testConfig(config) {
  const { host, port } = extractServer(config);
  if (!host) return { status: "error", message: "Cannot parse", latency: -1, host: null, port: null };
  const result = { host, port, tcp: false, dns: false, latency: -1 };

  try {
    const start = Date.now();
    const resp = await fetch(`https://${host}:${port}`, {
      method: "HEAD",
      signal: AbortSignal.timeout(5000),
      cf: { cacheTtl: 0 }
    }).catch(() => null);
    const elapsed = Date.now() - start;
    if (resp) {
      result.tcp = true;
      result.dns = true;
      result.latency = elapsed;
    }
  } catch {}

  if (!result.tcp) {
    try {
      const resp = await fetch(`http://${host}:${port}`, {
        method: "HEAD",
        signal: AbortSignal.timeout(5000),
        cf: { cacheTtl: 0 }
      }).catch(() => null);
      if (resp) {
        result.tcp = true;
        result.dns = true;
        result.latency = Date.now();
      }
    } catch {}
  }

  if (!result.dns) {
    try {
      const dnsResp = await fetch(`https://cloudflare-dns.com/dns-query?name=${host}&type=A`, {
        headers: { "Accept": "application/dns-json" }
      });
      const dnsData = await dnsResp.json();
      if (dnsData.Answer && dnsData.Answer.length > 0) result.dns = true;
    } catch {}
  }

  result.status = result.tcp ? "active" : result.dns ? "dns_only" : "dead";
  result.message = result.tcp ? `Online - ${result.latency}ms` : result.dns ? "DNS OK, TCP failed" : "Offline";
  return result;
}

// ======== Menus ========
function userMenu() {
  return { inline_keyboard: [
    [{ text: "📤 Submit Config", callback_data: "submit_config" }],
    [{ text: "📋 Latest Configs", callback_data: "latest_configs" }],
    [{ text: "📊 Bot Stats", callback_data: "bot_stats" }],
    [{ text: "ℹ️ Help", callback_data: "user_help" }]
  ]};
}

function adminMenu() {
  return { inline_keyboard: [
    [{ text: "🔍 Check Now", callback_data: "admin_check_now" }],
    [{ text: "📋 Links", callback_data: "admin_links" }, { text: "📺 Channels", callback_data: "admin_channels" }],
    [{ text: "📝 Templates", callback_data: "admin_templates" }, { text: "📊 Status", callback_data: "admin_status" }],
    [{ text: "👥 Submissions", callback_data: "admin_submissions" }],
    [{ text: "📤 Submit Config", callback_data: "submit_config" }]
  ]};
}

function configKeyboard(config) {
  const type = detectType(config);
  const h = hashConfig(config);
  return { inline_keyboard: [
    [{ text: `📋 Copy ${type.toUpperCase()}`, callback_data: `copy_${h}` }],
    [{ text: "📤 Share", callback_data: `share_${h}` }, { text: "📱 Open", url: `https://t.me/share/url?url=${encodeURIComponent(config.substring(0, 200))}` }]
  ]};
}

// ======== Format Message ========
async function formatMessage(env, config, testResult) {
  const templates = await kvGet(env, "message_templates", DEFAULT_TEMPLATES);
  const type = detectType(config);
  const template = templates[type] || templates.default || DEFAULT_TEMPLATES.default;
  const { host, port } = extractServer(config);
  const server = host ? `${host}:${port}` : "Unknown";
  const emoji = testResult.status === "active" ? "✅" : testResult.status === "dns_only" ? "⚠️" : "❌";
  return template.replace("{type}", type.toUpperCase()).replace("{server}", server).replace("{status}", `${emoji} ${testResult.message}`);
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
          allNew.push(config);
          cache.push(h);
        }
      }
    } catch (e) { console.error(`Fetch error ${link}:`, e); }
  }

  if (cache.length > 500) cache = cache.slice(-500);
  await kvSet(env, "configs_cache", cache);

  // Store configs in KV
  const storedConfigs = await kvGet(env, "stored_configs", []);
  let sentCount = 0;

  for (const config of allNew.slice(0, 20)) {
    const testResult = await testConfig(config);
    const msg = await formatMessage(env, config, testResult);
    const fullMsg = `${msg}\n\n\`${config}\``;
    const keyboard = configKeyboard(config);

    storedConfigs.unshift({
      config, hash: hashConfig(config), type: detectType(config),
      test_result: testResult, created_at: new Date().toISOString(),
      ...extractServer(config)
    });

    for (const channel of channels) {
      try {
        await sendTelegram(env, channel, fullMsg, keyboard);
        await new Promise(r => setTimeout(r, 1000));
      } catch (e) { console.error(`Send error to ${channel}:`, e); }
    }
    sentCount++;
  }

  if (storedConfigs.length > 200) storedConfigs.length = 200;
  await kvSet(env, "stored_configs", storedConfigs);

  if (sentCount > 0) {
    await sendTelegram(env, env.ADMIN_CHAT_ID, `✅ ${sentCount} new configs distributed to ${channels.length} channel(s).`);
  }
  return { new_configs: sentCount, total: allNew.length };
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
      for (const cfg of configs) {
        subs.push({
          config: cfg, type: detectType(cfg), submitted_by: chatId,
          username: message.from?.username || "unknown", status: "pending",
          created_at: new Date().toISOString()
        });
      }
      await kvSet(env, "submissions", subs);
      await sendTelegram(env, chatId, `✅ ${configs.length} config(s) submitted!`);
    } else {
      await sendTelegram(env, chatId, "❌ No valid config found. Supported: vless://, vmess://, trojan://, ss://");
    }
    return;
  }

  if (text === "/start") {
    const menu = isAdmin ? adminMenu() : userMenu();
    await sendTelegram(env, chatId, "🌐 *VPN Config Bot*\n\nChoose an option:", menu);
  } else if (text === "/check" && isAdmin) {
    await sendTelegram(env, chatId, "🔄 Fetching...");
    const result = await checkAndDistribute(env);
    await sendTelegram(env, chatId, `✅ Done! New: ${result.new_configs}, Total: ${result.total}`);
  } else if (text === "/submit") {
    await kvSet(env, `user_state_${chatId}`, "awaiting_config");
    await sendTelegram(env, chatId, "📤 Send your V2Ray config now:");
  } else if (text === "/latest") {
    const stored = await kvGet(env, "stored_configs", []);
    const latest = stored.slice(0, 5);
    if (latest.length > 0) {
      for (const c of latest) {
        await sendTelegram(env, chatId, `🔰 *${c.type.toUpperCase()}*\n${c.test_result?.message || "Unknown"}\n\n\`${c.config}\``);
      }
    } else {
      await sendTelegram(env, chatId, "No configs available yet.");
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
      for (const cfg of configs) {
        subs.push({ config: cfg, type: detectType(cfg), submitted_by: chatId, username: message.from?.username || "unknown", status: "pending", created_at: new Date().toISOString() });
      }
      await kvSet(env, "submissions", subs);
      await sendTelegram(env, chatId, `✅ ${configs.length} config(s) submitted!`);
    } else {
      await sendTelegram(env, chatId, "Use /start for menu.", userMenu());
    }
  }
}

async function handleCallback(env, callback) {
  const chatId = String(callback.message.chat.id);
  const data = callback.data || "";
  const isAdmin = chatId === env.ADMIN_CHAT_ID;
  await answerCallback(env, callback.id, "Processing...");

  if (data === "submit_config") {
    await kvSet(env, `user_state_${chatId}`, "awaiting_config");
    await sendTelegram(env, chatId, "📤 Send your V2Ray config now:");
  } else if (data === "latest_configs") {
    const stored = await kvGet(env, "stored_configs", []);
    const latest = stored.slice(0, 5);
    for (const c of latest) {
      await sendTelegram(env, chatId, `🔰 *${c.type.toUpperCase()}*\n${c.test_result?.message || "Unknown"}\n\n\`${c.config}\``);
    }
    if (!latest.length) await sendTelegram(env, chatId, "No configs yet.");
  } else if (data === "bot_stats") {
    const stored = await kvGet(env, "stored_configs", []);
    const active = stored.filter(c => c.test_result?.status === "active").length;
    await sendTelegram(env, chatId, `📊 Total: ${stored.length}\nActive: ${active}`);
  } else if (data === "admin_check_now" && isAdmin) {
    await sendTelegram(env, chatId, "🔄 Fetching...");
    const result = await checkAndDistribute(env);
    await sendTelegram(env, chatId, `✅ ${result.new_configs} new configs.`);
  } else if (data === "admin_links" && isAdmin) {
    const links = await kvGet(env, "source_links", []);
    await sendTelegram(env, chatId, "📋 *Links:*\n" + links.map((l, i) => `${i + 1}. \`${l}\``).join("\n"));
  } else if (data === "admin_channels" && isAdmin) {
    const ch = await kvGet(env, "channel_ids", []);
    await sendTelegram(env, chatId, "📺 *Channels:*\n" + ch.map((c, i) => `${i + 1}. \`${c}\``).join("\n"));
  } else if (data === "admin_status" && isAdmin) {
    const links = await kvGet(env, "source_links", []);
    const channels = await kvGet(env, "channel_ids", []);
    const cache = await kvGet(env, "configs_cache", []);
    const stored = await kvGet(env, "stored_configs", []);
    await sendTelegram(env, chatId, `📊 Links: ${links.length}, Ch: ${channels.length}, Cache: ${cache.length}, Configs: ${stored.length}`);
  } else if (data === "admin_submissions" && isAdmin) {
    const subs = await kvGet(env, "submissions", []);
    const pending = subs.filter(s => s.status === "pending").slice(0, 10);
    if (pending.length) {
      for (const s of pending) {
        const h = hashConfig(s.config);
        await sendTelegram(env, chatId, `📤 From @${s.username}\nType: ${s.type}\n\n\`${s.config}\``, {
          inline_keyboard: [[
            { text: "✅ Approve", callback_data: `approve_${h}` },
            { text: "❌ Reject", callback_data: `reject_${h}` }
          ]]
        });
      }
    } else { await sendTelegram(env, chatId, "No pending submissions."); }
  } else if (data.startsWith("approve_") && isAdmin) {
    const h = data.replace("approve_", "");
    const subs = await kvGet(env, "submissions", []);
    const sub = subs.find(s => s.status === "pending" && hashConfig(s.config) === h);
    if (sub) {
      const testResult = await testConfig(sub.config);
      const msg = await formatMessage(env, sub.config, testResult);
      const channels = await kvGet(env, "channel_ids", [env.CHANNEL_ID]);
      for (const ch of channels) {
        await sendTelegram(env, ch, `${msg}\n\n\`${sub.config}\``, configKeyboard(sub.config));
        await new Promise(r => setTimeout(r, 1000));
      }
      sub.status = "approved";
      await kvSet(env, "submissions", subs);
      await sendTelegram(env, chatId, "✅ Approved and published!");
    }
  } else if (data.startsWith("reject_") && isAdmin) {
    const h = data.replace("reject_", "");
    const subs = await kvGet(env, "submissions", []);
    const sub = subs.find(s => s.status === "pending" && hashConfig(s.config) === h);
    if (sub) { sub.status = "rejected"; await kvSet(env, "submissions", subs); }
    await sendTelegram(env, chatId, "❌ Rejected.");
  } else if (data.startsWith("copy_")) {
    const h = data.replace("copy_", "");
    const stored = await kvGet(env, "stored_configs", []);
    const cfg = stored.find(c => hashConfig(c.config) === h);
    if (cfg) await sendTelegram(env, chatId, `\`${cfg.config}\``);
  }
}

// ======== Dashboard HTML ========
function dashboardHTML(env) {
  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VPN Bot Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',Tahoma,sans-serif;background:#0a0a1a;color:#e0e0e0;min-height:100vh;direction:rtl}
.glass{background:rgba(255,255,255,.05);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,.1);border-radius:16px}
.container{max-width:1200px;margin:0 auto;padding:20px}
.login-box{max-width:400px;margin:15vh auto;padding:40px;text-align:center}
.login-box h1{font-size:28px;margin-bottom:30px;color:#00d4ff}
input,textarea{width:100%;padding:12px 16px;border:1px solid rgba(255,255,255,.15);border-radius:10px;background:rgba(255,255,255,.05);color:#fff;font-size:14px;margin-bottom:16px;outline:none;direction:ltr}
input:focus,textarea:focus{border-color:#00d4ff}
button{padding:12px 24px;border:none;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;transition:.3s}
.btn-primary{background:linear-gradient(135deg,#00d4ff,#0099cc);color:#000;width:100%}
.btn-primary:hover{opacity:.9;transform:translateY(-1px)}
.btn-danger{background:#ff4444;color:#fff;padding:8px 16px;font-size:12px}
.btn-sm{padding:8px 16px;font-size:12px;background:rgba(0,212,255,.2);color:#00d4ff;border:1px solid rgba(0,212,255,.3)}
.header{display:flex;justify-content:space-between;align-items:center;padding:20px 30px;margin-bottom:30px}
.header h1{font-size:24px;color:#00d4ff}
.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:30px}
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
.config-card{padding:16px;margin-bottom:12px;border-radius:12px;background:rgba(255,255,255,.03)}
.config-card code{display:block;word-break:break-all;font-size:11px;color:#888;margin-top:8px;background:rgba(0,0,0,.3);padding:8px;border-radius:6px}
.badge{padding:4px 10px;border-radius:20px;font-size:11px;font-weight:600}
.badge-active{background:rgba(0,255,100,.15);color:#0f0}
.badge-dead{background:rgba(255,0,0,.15);color:#f55}
.badge-dns{background:rgba(255,200,0,.15);color:#fa0}
.add-row{display:flex;gap:12px;margin-bottom:16px}
.add-row input{margin-bottom:0;flex:1}
#app{min-height:100vh}
</style>
</head>
<body>
<div id="app">
<div id="login" class="login-box glass">
<h1>🌐 VPN Bot Panel</h1>
<input id="username" placeholder="Username" autocomplete="off">
<input id="password" type="password" placeholder="Password">
<button class="btn-primary" onclick="login()">Login</button>
<p id="login-error" style="color:#f55;margin-top:12px;display:none"></p>
</div>
<div id="dashboard" style="display:none">
<div class="header glass">
<h1>🌐 VPN Bot Dashboard</h1>
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
<div id="configs" class="section glass"><div id="configs-list"></div></div>
<div id="templates" class="section glass"><div id="templates-list"></div></div>
<div id="submissions" class="section glass"><div id="submissions-list"></div></div>
<div id="actions" class="section glass" style="text-align:center;padding:40px">
<button class="btn-primary" style="max-width:300px;margin:10px auto;display:block" onclick="fetchNow()">🔍 Fetch Configs Now</button>
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
<script>
let TOKEN="";const API=location.origin+"/dashboard/api";
async function api(path,method="GET",body=null){
  const h={"Authorization":"Bearer "+TOKEN,"Content-Type":"application/json"};
  const opts={method,headers:h};
  if(body)opts.body=JSON.stringify(body);
  const r=await fetch(API+path,opts);
  return r.json();
}
async function login(){
  const u=document.getElementById("username").value;
  const p=document.getElementById("password").value;
  try{
    const r=await fetch(API+"/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:u,password:p})});
    const d=await r.json();
    if(d.token){TOKEN=d.token;localStorage.setItem("token",TOKEN);showDashboard();}
    else{document.getElementById("login-error").style.display="block";document.getElementById("login-error").textContent="Invalid credentials";}
  }catch{document.getElementById("login-error").style.display="block";document.getElementById("login-error").textContent="Login failed";}
}
function logout(){TOKEN="";localStorage.removeItem("token");location.reload();}
async function showDashboard(){
  document.getElementById("login").style.display="none";
  document.getElementById("dashboard").style.display="block";
  await loadStats();await loadLinks();await loadChannels();await loadConfigs();await loadTemplates();await loadSubmissions();
}
async function loadStats(){
  const d=await api("/stats");
  document.getElementById("stats").innerHTML=
    '<div class="stat-card glass"><div class="num">'+(d.total_configs||0)+'</div><div class="label">Total Configs</div></div>'+
    '<div class="stat-card glass"><div class="num">'+(d.active_configs||0)+'</div><div class="label">Active</div></div>'+
    '<div class="stat-card glass"><div class="num">'+(d.source_links||0)+'</div><div class="label">Links</div></div>'+
    '<div class="stat-card glass"><div class="num">'+(d.channels||0)+'</div><div class="label">Channels</div></div>'+
    '<div class="stat-card glass"><div class="num">'+(d.pending_submissions||0)+'</div><div class="label">Pending</div></div>';
}
async function loadLinks(){
  const d=await api("/links");
  document.getElementById("links-list").innerHTML=(d.links||[]).map((l,i)=>
    '<div class="list-item"><span style="word-break:break-all;font-size:13px">'+l+'</span><button class="btn-danger" onclick="removeLink(\\''+l+'\\')">Remove</button></div>'
  ).join("");
}
async function addLink(){const u=document.getElementById("new-link").value;if(u){await api("/links","POST",{url:u});document.getElementById("new-link").value="";loadLinks();loadStats();}}
async function removeLink(u){await api("/links","DELETE",{url:u});loadLinks();loadStats();}
async function loadChannels(){
  const d=await api("/channels");
  document.getElementById("channels-list").innerHTML=(d.channels||[]).map(c=>
    '<div class="list-item"><span>'+c+'</span><button class="btn-danger" onclick="removeChannel(\\''+c+'\\')">Remove</button></div>'
  ).join("");
}
async function addChannel(){const c=document.getElementById("new-channel").value;if(c){await api("/channels","POST",{channel_id:c});document.getElementById("new-channel").value="";loadChannels();loadStats();}}
async function removeChannel(c){await api("/channels","DELETE",{channel_id:c});loadChannels();loadStats();}
async function loadConfigs(){
  const d=await api("/configs");
  document.getElementById("configs-list").innerHTML=(d.configs||[]).map(c=>{
    const badge=c.test_result?.status==="active"?"badge-active":c.test_result?.status==="dns_only"?"badge-dns":"badge-dead";
    return '<div class="config-card"><span class="badge '+badge+'">'+c.type.toUpperCase()+'</span> '+(c.test_result?.message||"Unknown")+'<code>'+c.config+'</code></div>';
  }).join("")||"<p>No configs yet.</p>";
}
async function loadTemplates(){
  const d=await api("/templates");
  const t=d.templates||{};
  document.getElementById("templates-list").innerHTML=Object.entries(t).map(([k,v])=>
    '<div style="margin-bottom:16px"><label style="color:#00d4ff;font-weight:600">'+k+'</label><textarea id="tmpl_'+k+'" style="margin-top:8px;height:80px">'+v+'</textarea><button class="btn-sm" onclick="saveTemplate(\\''+k+'\\')">Save</button></div>'
  ).join("");
}
async function saveTemplate(type){const v=document.getElementById("tmpl_"+type).value;await api("/templates","POST",{type,template:v});}
async function loadSubmissions(){
  const d=await api("/submissions");
  document.getElementById("submissions-list").innerHTML=(d.submissions||[]).map(s=>
    '<div class="config-card"><span class="badge badge-dns">'+s.type+'</span> @'+s.username+'<code>'+s.config+'</code><div style="margin-top:8px"><button class="btn-sm" onclick="approveSub(\\''+btoa(s.config)+'\\')">✅ Approve</button> <button class="btn-danger" onclick="rejectSub(\\''+btoa(s.config)+'\\')">❌ Reject</button></div></div>'
  ).join("")||"<p>No pending submissions.</p>";
}
async function approveSub(b64){await api("/submissions/approve","POST",{config:atob(b64)});loadSubmissions();loadStats();}
async function rejectSub(b64){await api("/submissions/reject","POST",{config:atob(b64)});loadSubmissions();loadStats();}
async function fetchNow(){
  document.getElementById("action-result").innerHTML="<p>Fetching...</p>";
  const d=await api("/fetch-now","POST");
  document.getElementById("action-result").innerHTML="<p>✅ New: "+(d.new_configs||0)+"</p>";
  loadConfigs();loadStats();
}
async function testCfg(){
  const c=document.getElementById("test-config-input").value;
  if(!c)return;
  document.getElementById("test-result").innerHTML="Testing...";
  const d=await api("/test","POST",{config:c});
  const badge=d.status==="active"?"badge-active":d.status==="dns_only"?"badge-dns":"badge-dead";
  document.getElementById("test-result").innerHTML='<span class="badge '+badge+'">'+d.message+'</span> Latency: '+(d.latency||"N/A")+'ms';
}
function showTab(name){
  document.querySelectorAll(".section").forEach(s=>s.classList.remove("active"));
  document.querySelectorAll(".tab").forEach(t=>t.classList.remove("active"));
  document.getElementById(name).classList.add("active");
  event.target.classList.add("active");
}
window.onload=function(){
  const t=localStorage.getItem("token");
  if(t){TOKEN=t;showDashboard();}
};
</script>
</body></html>`;
}

// ======== Dashboard API ========
async function handleDashboardAPI(env, request, path) {
  const url = new URL(request.url);
  const method = request.method;

  // Login
  if (path === "/login" && method === "POST") {
    const { username, password } = await request.json();
    if (username === env.DASHBOARD_USER && password === env.DASHBOARD_PASS) {
      const token = btoa(JSON.stringify({ sub: username, exp: Date.now() + 86400000 }));
      return jsonResp({ token, username });
    }
    return jsonResp({ error: "Invalid credentials" }, 401);
  }

  // Auth check
  const auth = request.headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) return jsonResp({ error: "Unauthorized" }, 401);
  try {
    const payload = JSON.parse(atob(auth.replace("Bearer ", "")));
    if (payload.exp < Date.now()) return jsonResp({ error: "Token expired" }, 401);
  } catch { return jsonResp({ error: "Invalid token" }, 401); }

  if (path === "/stats") {
    const stored = await kvGet(env, "stored_configs", []);
    const links = await kvGet(env, "source_links", []);
    const channels = await kvGet(env, "channel_ids", []);
    const subs = await kvGet(env, "submissions", []);
    return jsonResp({
      total_configs: stored.length,
      active_configs: stored.filter(c => c.test_result?.status === "active").length,
      source_links: links.length,
      channels: channels.length,
      pending_submissions: subs.filter(s => s.status === "pending").length
    });
  }
  if (path === "/links" && method === "GET") return jsonResp({ links: await kvGet(env, "source_links", []) });
  if (path === "/links" && method === "POST") {
    const { url: linkUrl } = await request.json();
    const links = await kvGet(env, "source_links", []);
    if (!links.includes(linkUrl)) { links.push(linkUrl); await kvSet(env, "source_links", links); }
    return jsonResp({ links });
  }
  if (path === "/links" && method === "DELETE") {
    const { url: linkUrl } = await request.json();
    let links = await kvGet(env, "source_links", []);
    links = links.filter(l => l !== linkUrl);
    await kvSet(env, "source_links", links);
    return jsonResp({ links });
  }
  if (path === "/channels" && method === "GET") return jsonResp({ channels: await kvGet(env, "channel_ids", []) });
  if (path === "/channels" && method === "POST") {
    const { channel_id } = await request.json();
    const channels = await kvGet(env, "channel_ids", []);
    if (!channels.includes(channel_id)) { channels.push(channel_id); await kvSet(env, "channel_ids", channels); }
    return jsonResp({ channels });
  }
  if (path === "/channels" && method === "DELETE") {
    const { channel_id } = await request.json();
    let channels = await kvGet(env, "channel_ids", []);
    channels = channels.filter(c => c !== channel_id);
    await kvSet(env, "channel_ids", channels);
    return jsonResp({ channels });
  }
  if (path === "/configs") {
    const stored = await kvGet(env, "stored_configs", []);
    return jsonResp({ configs: stored.slice(0, 50), total: stored.length });
  }
  if (path === "/templates" && method === "GET") return jsonResp({ templates: await kvGet(env, "message_templates", DEFAULT_TEMPLATES) });
  if (path === "/templates" && method === "POST") {
    const { type, template } = await request.json();
    const templates = await kvGet(env, "message_templates", DEFAULT_TEMPLATES);
    templates[type] = template;
    await kvSet(env, "message_templates", templates);
    return jsonResp({ templates });
  }
  if (path === "/submissions") {
    const subs = await kvGet(env, "submissions", []);
    return jsonResp({ submissions: subs.filter(s => s.status === "pending").slice(0, 50) });
  }
  if (path === "/submissions/approve" && method === "POST") {
    const { config } = await request.json();
    const subs = await kvGet(env, "submissions", []);
    const sub = subs.find(s => s.config === config && s.status === "pending");
    if (sub) {
      const testResult = await testConfig(config);
      const msg = await formatMessage(env, config, testResult);
      const channels = await kvGet(env, "channel_ids", [env.CHANNEL_ID]);
      for (const ch of channels) {
        await sendTelegram(env, ch, `${msg}\n\n\`${config}\``, configKeyboard(config));
      }
      sub.status = "approved";
      await kvSet(env, "submissions", subs);
      return jsonResp({ status: "approved", test_result: testResult });
    }
    return jsonResp({ error: "Not found" }, 404);
  }
  if (path === "/submissions/reject" && method === "POST") {
    const { config } = await request.json();
    const subs = await kvGet(env, "submissions", []);
    const sub = subs.find(s => s.config === config && s.status === "pending");
    if (sub) { sub.status = "rejected"; await kvSet(env, "submissions", subs); }
    return jsonResp({ status: "rejected" });
  }
  if (path === "/fetch-now" && method === "POST") {
    const result = await checkAndDistribute(env);
    return jsonResp(result);
  }
  if (path === "/test" && method === "POST") {
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

// ======== Main Handler ========
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
      await kvSet(env, "_initialized", true);
    }

    if (url.pathname === "/webhook" && request.method === "POST") {
      try {
        const update = await request.json();
        await handleWebhook(env, update);
        return new Response("OK");
      } catch (e) {
        return new Response(`Error: ${e.message}`, { status: 500 });
      }
    }

    if (url.pathname.startsWith("/dashboard/api")) {
      const apiPath = url.pathname.replace("/dashboard/api", "");
      return handleDashboardAPI(env, request, apiPath);
    }

    if (url.pathname === "/dashboard" || url.pathname === "/dashboard/") {
      return new Response(dashboardHTML(env), { headers: { "Content-Type": "text/html;charset=UTF-8" } });
    }

    if (url.pathname === "/set-webhook") {
      const workerUrl = url.origin;
      const resp = await fetch(`${telegramApi(env.BOT_TOKEN)}/setWebhook?url=${workerUrl}/webhook`);
      const data = await resp.json();
      return jsonResp(data);
    }

    return new Response("VPN Config Bot is running. Dashboard: /dashboard", { headers: { "Content-Type": "text/plain" } });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkAndDistribute(env));
  }
};
