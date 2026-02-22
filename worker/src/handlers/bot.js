import { kvGet, kvSet, kvDelete, trackUser } from '../utils/kv.js';
import { sendTelegram, answerCallback, telegramApi } from '../utils/telegram.js';
import {
  extractConfigs, detectType, hashConfig, extractServer,
  extractChannelSource, testConfig, getBucket, ALL_BUCKETS
} from '../utils/vpn.js';
import { voteConfig, calculateQualityScore } from '../services/voting.js';
import { manageStorage, cleanupConfigs, incrementUserStats, updateCountryIndex } from '../services/storage.js';
import { pushToQueue } from '../services/queue.js';
import { checkAndDistribute } from '../services/fetcher.js';
import { startBroadcast } from '../services/broadcast.js';
import { formatMessage, configKeyboard } from './formatter.js';
import { DEFAULT_TEMPLATES, DEFAULT_SETTINGS } from '../constants.js';

// Menu Button Labels
const BUTTONS = {
  SUBMIT: "📤 Submit Config",
  LATEST: "📋 Latest Configs",
  BEST: "⭐ Best Rated",
  MY_SUB: "💎 My Subscription",
  STATS: "📊 Bot Stats",
  HELP: "ℹ️ Help",
  ADMIN: "🔐 Admin Panel",
  CHECK: "🔍 Check Now",
  MANAGE_CONFIGS: "🔰 Manage Configs",
  SETTINGS: "⚙️ Settings",
  SUBMISSIONS: "👥 Submissions",
  CLEANUP: "🧹 Cleanup",
  BROADCAST: "📢 Broadcast",
  BACK_USER: "🔙 Back to User Menu",
  LINKS: "📋 Links",
  CHANNELS: "📺 Channels",
  TEMPLATES: "📝 Templates",
  STATUS: "📊 Status",
  APP_UPDATE: "📱 App Update",
  ANNOUNCEMENTS: "📢 Announcements",
  ADD_CONFIG: "➕ Add Config",
  SUB_LIST: "🗑️ Manage Configs",
  SUB_CLIENTS: "👥 Manage Clients",
  SUB_STATS: "📊 Service Stats",
  BACK: "🔙 Back"
};

const KEYBOARDS = {
  MAIN: (isAdmin) => {
    const rows = [
      [{ text: BUTTONS.SUBMIT }, { text: BUTTONS.LATEST }],
      [{ text: BUTTONS.BEST }, { text: BUTTONS.MY_SUB }],
      [{ text: BUTTONS.STATS }, { text: BUTTONS.HELP }]
    ];
    if (isAdmin) rows.push([{ text: BUTTONS.ADMIN }]);
    return { keyboard: rows, resize_keyboard: true };
  },
  ADMIN_MAIN: {
    keyboard: [
      [{ text: BUTTONS.CHECK }, { text: BUTTONS.MANAGE_CONFIGS }],
      [{ text: BUTTONS.SETTINGS }, { text: BUTTONS.SUBMISSIONS }],
      [{ text: BUTTONS.CLEANUP }, { text: BUTTONS.BROADCAST }],
      [{ text: BUTTONS.BACK_USER }]
    ],
    resize_keyboard: true
  },
  ADMIN_CONFIGS: {
    keyboard: [
      [{ text: BUTTONS.LINKS }, { text: BUTTONS.CHANNELS }],
      [{ text: BUTTONS.TEMPLATES }, { text: BUTTONS.STATUS }],
      [{ text: BUTTONS.BACK }]
    ],
    resize_keyboard: true
  },
  ADMIN_SETTINGS: {
    keyboard: [
      [{ text: BUTTONS.APP_UPDATE }, { text: BUTTONS.ANNOUNCEMENTS }],
      [{ text: BUTTONS.BACK }]
    ],
    resize_keyboard: true
  },
  SUB_ADMIN: {
    keyboard: [
      [{ text: BUTTONS.ADD_CONFIG }, { text: BUTTONS.SUB_LIST }],
      [{ text: BUTTONS.SUB_CLIENTS }, { text: BUTTONS.SUB_STATS }],
      [{ text: BUTTONS.BACK }]
    ],
    resize_keyboard: true
  }
};

// ======== Menus ========
export function userMenu() {
  return { inline_keyboard: [
    [{ text: "📤 Submit Config", callback_data: "submit_config" }],
    [{ text: "📋 Latest Configs", callback_data: "latest_configs" }],
    [{ text: "⭐ Best Rated", callback_data: "best_rated" }],
    [{ text: "💎 My Subscription", callback_data: "user_subscription" }],
    [{ text: "📊 Bot Stats", callback_data: "bot_stats" }],
    [{ text: "ℹ️ Help", callback_data: "user_help" }]
  ]};
}

export function subAdminMenu(isInitialized = false) {
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

export function adminMenu() {
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

async function getAllStoredConfigs(env) {
  const all = [];
  for (const bucketKey of ALL_BUCKETS) {
    const list = await kvGet(env, bucketKey, []);
    all.push(...list);
  }
  return all;
}

// ======== Webhook Handler ========
export async function handleWebhook(env, update) {
  if (update.callback_query) return handleCallback(env, update.callback_query);

  const message = update.message || {};
  const chatId = String(message.chat?.id || "");
  const text = message.text || "";
  const isAdmin = chatId === env.ADMIN_CHAT_ID;

  if (!text) return;

  // Track new users
  await trackUser(env, chatId);

  const settings = await kvGet(env, "bot_settings", DEFAULT_SETTINGS);
  const fallbackProvider = settings.channelUsername || "VPN Config Bot";

  const userState = await kvGet(env, `user_state_${chatId}`);
  const menuState = await kvGet(env, `user_menu_state_${chatId}`, "MAIN");

  if (userState === "awaiting_config") {
    await kvSet(env, `user_state_${chatId}`, null);
    const configs = extractConfigs(text);
    if (configs.length > 0) {
      const subs = await kvGet(env, "submissions", []);
      const provider = extractChannelSource(text, configs[0], fallbackProvider);

      subs.push({
        id: Math.random().toString(36).substring(2, 10),
        configs: configs,
        submitted_by: chatId,
        username: message.from?.username || "unknown",
        status: "pending",
        provider: provider,
        created_at: new Date().toISOString()
      });

      await kvSet(env, "submissions", subs);
      await sendTelegram(env, chatId, `✅ ${configs.length} config(s) submitted!\nSource: ${provider}`);
    } else {
      await sendTelegram(env, chatId, "❌ No valid config found. Supported: vless://, vmess://, trojan://, ss://");
    }
    return;
  }

  if (userState === "awaiting_broadcast" && isAdmin) {
    await kvSet(env, `user_state_${chatId}`, null);
    await sendTelegram(env, chatId, "🚀 Starting broadcast...");
    const stats = await startBroadcast(env, text);
    await sendTelegram(env, chatId, `✅ Broadcast complete!\nSent: ${stats.sent}\nFailed: ${stats.failed}`);
    return;
  }

  // --- Navigation Logic ---
  if (text === "/start" || text === BUTTONS.BACK_USER) {
    await kvSet(env, `user_menu_state_${chatId}`, "MAIN");
    await sendTelegram(env, chatId, "🌐 *VPN Config Bot Pro*", KEYBOARDS.MAIN(isAdmin));
    return;
  }

  if (text === BUTTONS.ADMIN && isAdmin) {
    await kvSet(env, `user_menu_state_${chatId}`, "ADMIN_MAIN");
    await sendTelegram(env, chatId, "🔐 *Admin Panel*", KEYBOARDS.ADMIN_MAIN);
    return;
  }

  if (text === BUTTONS.MANAGE_CONFIGS && isAdmin) {
    await kvSet(env, `user_menu_state_${chatId}`, "ADMIN_CONFIGS");
    await sendTelegram(env, chatId, "🔰 *Manage Configs*", KEYBOARDS.ADMIN_CONFIGS);
    return;
  }

  if (text === BUTTONS.SETTINGS && isAdmin) {
    await kvSet(env, `user_menu_state_${chatId}`, "ADMIN_SETTINGS");
    await sendTelegram(env, chatId, "⚙️ *Settings*", KEYBOARDS.ADMIN_SETTINGS);
    return;
  }

  if (text === BUTTONS.MY_SUB) {
    const stats = await kvGet(env, `user_stats_${chatId}`, { approved_count: 0 });
    if (stats.approved_count < 20 && !isAdmin) {
      await sendTelegram(env, chatId, `❌ You need at least 20 approved configs to start your own subscription service.\nYour current count: ${stats.approved_count}`);
      return;
    }
    await kvSet(env, `user_menu_state_${chatId}`, "SUB_ADMIN");
    const subData = await kvGet(env, `sub_admin_data_${chatId}`);
    await sendTelegram(env, chatId, "💎 *Subscription Management*", KEYBOARDS.SUB_ADMIN);
    return;
  }

  if (text === BUTTONS.BACK) {
    if (menuState === "ADMIN_CONFIGS" || menuState === "ADMIN_SETTINGS") {
      await kvSet(env, `user_menu_state_${chatId}`, "ADMIN_MAIN");
      await sendTelegram(env, chatId, "🔐 *Admin Panel*", KEYBOARDS.ADMIN_MAIN);
    } else {
      await kvSet(env, `user_menu_state_${chatId}`, "MAIN");
      await sendTelegram(env, chatId, "🌐 *VPN Config Bot Pro*", KEYBOARDS.MAIN(isAdmin));
    }
    return;
  }

  // --- Command Logic ---
  if (text === BUTTONS.CHECK || (text === "/check" && isAdmin)) {
    await sendTelegram(env, chatId, "🔄 Fetching...");
    const result = await checkAndDistribute(env);
    await sendTelegram(env, chatId, `✅ Done! New: ${result.new_configs}, Total: ${result.total}`);
  } else if ((text === BUTTONS.CLEANUP || text === "/cleanup") && isAdmin) {
    await sendTelegram(env, chatId, "🧹 Running cleanup...");
    const result = await cleanupConfigs(env);
    await sendTelegram(env, chatId, `✅ Cleanup done!\nRemoved: ${result.removed}\nKept: ${result.kept}`);
  } else if (text === BUTTONS.SUBMIT || text === "/submit") {
    await kvSet(env, `user_state_${chatId}`, "awaiting_config");
    await sendTelegram(env, chatId, "📤 Send your V2Ray config now:");
  } else if (text === BUTTONS.LATEST || text === "/latest") {
    const stored = await getAllStoredConfigs(env);
    const latest = stored.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);
    if (latest.length > 0) {
      for (const c of latest) {
        const msg = await formatMessage(env, c.config, c.test_result || {status: "unknown", message: "Unknown"}, c, chatId);
        await sendTelegram(env, chatId, msg, configKeyboard(c.config, c.hash, chatId));
      }
    } else {
      await sendTelegram(env, chatId, "No configs available yet.");
    }
  } else if (text === BUTTONS.BEST || text === "/best") {
    const stored = await getAllStoredConfigs(env);
    const sorted = stored
      .filter(c => (c.quality_score || 0) > 0 || c.test_result?.status === "active")
      .sort((a, b) => {
        if ((b.quality_score || 0) !== (a.quality_score || 0)) return (b.quality_score || 0) - (a.quality_score || 0);
        return (a.test_result?.latency || 9999) - (b.test_result?.latency || 9999);
      })
      .slice(0, 5);

    for (const c of sorted) {
      const msg = await formatMessage(env, c.config, c.test_result || {status: "unknown", message: "Unknown"}, c, chatId);
      await sendTelegram(env, chatId, msg, configKeyboard(c.config, c.hash, chatId));
    }
  } else if ((text === BUTTONS.LINKS || text.startsWith("/add_link ")) && isAdmin) {
    // If it's just the button, show the list. If it starts with /add_link, keep original logic.
    if (text === BUTTONS.LINKS) {
      const links = await kvGet(env, "source_links", []);
      await sendTelegram(env, chatId, "📋 *Links:*\n" + links.map((l, i) => `${i + 1}. \`${l}\``).join("\n"));
      return;
    }
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
  } else if ((text === BUTTONS.CHANNELS || text.startsWith("/add_channel ")) && isAdmin) {
    if (text === BUTTONS.CHANNELS) {
      const ch = await kvGet(env, "channel_ids", []);
      await sendTelegram(env, chatId, "📺 *Channels:*\n" + ch.map((c, i) => `${i + 1}. \`${c}\``).join("\n"));
      return;
    }
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
  } else if ((text === BUTTONS.STATUS || text === "/status") && isAdmin) {
    const links = await kvGet(env, "source_links", []);
    const channels = await kvGet(env, "channel_ids", []);
    const cache = await kvGet(env, "configs_cache", []);
    const stored = await getAllStoredConfigs(env);
    const subs = await kvGet(env, "submissions", []);
    const pending = subs.filter(s => s.status === "pending").length;
    await sendTelegram(env, chatId, `📊 *Status*\n\nLinks: ${links.length}\nChannels: ${channels.length}\nCache: ${cache.length}\nConfigs: ${stored.length}\nPending: ${pending}`);
  } else if (text === BUTTONS.TEMPLATES && isAdmin) {
    const templates = await kvGet(env, "message_templates", DEFAULT_TEMPLATES);
    const settings = await kvGet(env, "bot_settings", DEFAULT_SETTINGS);
    let msg = `📝 *Templates* (Active: \`${settings.activeTemplate}\`)\n\n`;
    for (const [key, val] of Object.entries(templates)) {
      msg += `🔹 *${key.toUpperCase()}*:\n\`\`\`\n${val}\n\`\`\`\n`;
    }
    await sendTelegram(env, chatId, msg);
  } else if (text === BUTTONS.SUBMISSIONS && isAdmin) {
    const subs = await kvGet(env, "submissions", []);
    const pending = subs.filter(s => s.status === "pending").slice(0, 10);
    if (pending.length) {
      for (const s of pending) {
        const id = s.id || hashConfig(s.configs?.[0] || "");
        const configsPreview = (s.configs || []).slice(0, 3).map(c => `\`${c.substring(0, 50)}...\``).join("\n");
        await sendTelegram(env, chatId, `📤 From @${s.username}\n📦 Total: ${s.configs?.length || 0} configs\nSource: ${s.provider || 'Unknown'}\n\n${configsPreview}`, {
          inline_keyboard: [[
            { text: "✅ Approve", callback_data: `approve_${id}` },
            { text: "❌ Reject", callback_data: `reject_${id}` }
          ]]
        });
      }
    } else { await sendTelegram(env, chatId, "No pending submissions."); }
  } else if (text === BUTTONS.BROADCAST && isAdmin) {
    await kvSet(env, `user_state_${chatId}`, "awaiting_broadcast");
    await sendTelegram(env, chatId, "📢 Send the message you want to broadcast to ALL users:");
  } else if (text.startsWith("/broadcast ") && isAdmin) {
    const msg = text.replace("/broadcast ", "").trim();
    if (msg) {
      await sendTelegram(env, chatId, "🚀 Starting broadcast...");
      const stats = await startBroadcast(env, msg);
      await sendTelegram(env, chatId, `✅ Broadcast complete!\nSent: ${stats.sent}\nFailed: ${stats.failed}`);
    }
  } else if (text === BUTTONS.APP_UPDATE && isAdmin) {
    const info = await kvGet(env, "app_update_info", { version: "1.0.0", description: "Default", link: "", force: false });
    await sendTelegram(env, chatId, `📱 *App Update Info*\n\nVersion: \`${info.version}\`\nLink: \`${info.link}\`\nForce Update: \`${info.force}\`\nDescription: ${info.description}`);
  } else if (text === BUTTONS.ANNOUNCEMENTS && isAdmin) {
    const ann = await kvGet(env, "app_announcement", { title: "", message: "", active: false });
    await sendTelegram(env, chatId, `📢 *App Announcement*\n\nActive: \`${ann.active}\`\nTitle: ${ann.title}\nMessage: ${ann.message}`);
  } else if (text === BUTTONS.ADD_CONFIG) {
    await kvSet(env, `user_state_${chatId}`, "sub_awaiting_config");
    await sendTelegram(env, chatId, "📤 Send your personal V2Ray config(s) now:");
  } else if (text === BUTTONS.SUB_LIST) {
    const subData = await kvGet(env, `sub_admin_data_${chatId}`);
    if (subData && subData.configs?.length) {
      await sendTelegram(env, chatId, "🗑️ *Your Personal Configs:*");
      for (let i = 0; i < subData.configs.length; i++) {
        const c = subData.configs[i];
        await sendTelegram(env, chatId, `\`${c.substring(0, 50)}...\``, {
          inline_keyboard: [[{ text: "🗑️ Delete", callback_data: `sub_del_config_${i}` }]]
        });
      }
    } else { await sendTelegram(env, chatId, "No personal configs yet."); }
  } else if (text === BUTTONS.SUB_CLIENTS) {
    const subData = await kvGet(env, `sub_admin_data_${chatId}`);
    if (subData) {
      let msg = `👥 *Manage Clients*\nAdmin ID: \`${subData.adminId}\`\n\n`;
      if (subData.clients?.length) {
        subData.clients.forEach((c, i) => {
          const code = `${subData.adminId}-${c.clientId}`;
          msg += `${i+1}. Code: \`${code}\`\n   Limit: ${c.limitVol}GB | Used: ${c.usedVol?.toFixed(2) || 0}GB\n   Acts: ${c.usedAct}/${c.limitAct}\n   [Delete /sub_del_client_${c.clientId}]\n\n`;
        });
      } else { msg += "No clients added yet."; }
      await sendTelegram(env, chatId, msg, { inline_keyboard: [[{ text: "➕ Add Client", callback_data: "sub_add_client" }]] });
    }
  } else if (text === BUTTONS.SUB_STATS) {
    const subData = await kvGet(env, `sub_admin_data_${chatId}`);
    if (subData) {
      const totalUsed = (subData.clients || []).reduce((sum, c) => sum + (c.usedVol || 0), 0);
      const msg = `📊 *Service Stats*\n\nAdmin ID: \`${subData.adminId}\`\nConfigs: ${subData.configs?.length || 0}\nClients: ${subData.clients?.length || 0}\nTotal Traffic: ${totalUsed.toFixed(2)} GB`;
      await sendTelegram(env, chatId, msg);
    }
  } else if (text === BUTTONS.HELP || text === "/help") {
    await sendTelegram(env, chatId, "ℹ️ *Help & Info*\n\n- This bot provides high-quality V2Ray configurations.\n- Use the menu below to get the latest or best-rated configs.\n- Tap a config to copy it instantly.\n- You can submit your own configs to help the community.");
  } else if (text === BUTTONS.STATS || text === "/stats") {
    const stored = await getAllStoredConfigs(env);
    const active = stored.filter(c => c.test_result?.status === "active").length;
    const totalLikes = stored.reduce((sum, c) => sum + (c.likes_count || 0), 0);
    await sendTelegram(env, chatId, `📊 *Bot Statistics*\n\nTotal Configs: ${stored.length}\nActive Configs: ${active}\nTotal Community Likes: ${totalLikes}`);
  }
}

export async function handleCallback(env, callback) {
  const chatId = String(callback.message.chat.id);
  const data = callback.data || "";
  const isAdmin = chatId === env.ADMIN_CHAT_ID;
  const userId = callback.from.id;

  await trackUser(env, userId);
  await answerCallback(env, callback.id, "Processing...");

  if (data.startsWith("like_") || data.startsWith("dislike_")) {
    const hash = data.replace(/^(like|dislike)_/, "");
    const voteType = data.startsWith("like_") ? "like" : "dislike";

    // We need configType to find the bucket efficiently. Let's try to detect it or search all.
    const res = await voteConfig(env, hash, userId, voteType);

    if (res) {
      const statusMsg = voteType === 'like' ? `Voted! Score: ${res.score}` : `Reported! Total reports: ${res.dislikes}`;
      await answerCallback(env, callback.id, statusMsg);

      const stored = await getAllStoredConfigs(env);
      const cfg = stored.find(c => c.hash === hash);
      if (cfg) {
        const newMsg = await formatMessage(env, cfg.config, cfg.test_result, cfg, chatId);
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
    await kvSet(env, `user_menu_state_${chatId}`, "SUB_ADMIN");
    await sendTelegram(env, chatId, "💎 *Subscription Management*\n\nHere you can manage your personal subscription service.", KEYBOARDS.SUB_ADMIN);
  } else if (data === "sub_init") {
    let subData = await kvGet(env, `sub_admin_data_${chatId}`);
    if (!subData) {
      const adminId = Math.random().toString(36).substring(2, 10).toUpperCase();
      subData = { adminId, configs: [], clients: [], created_at: new Date().toISOString() };
      await kvSet(env, `sub_admin_data_${chatId}`, subData);
      await kvSet(env, `sub_lookup_admin_${adminId}`, chatId);
      await sendTelegram(env, chatId, `✅ Service initialized!\nYour Admin ID: \`${adminId}\``);
    }
    await kvSet(env, `user_menu_state_${chatId}`, "SUB_ADMIN");
    await sendTelegram(env, chatId, "💎 *Subscription Management*", KEYBOARDS.SUB_ADMIN);
  } else if (data === "back_to_user") {
    await kvSet(env, `user_menu_state_${chatId}`, "MAIN");
    await sendTelegram(env, chatId, "🌐 *VPN Config Bot Pro*", KEYBOARDS.MAIN(isAdmin));
  } else if (data === "latest_configs") {
    const stored = await getAllStoredConfigs(env);
    const latest = stored.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);
    for (const c of latest) {
      const msg = await formatMessage(env, c.config, c.test_result || {status: "unknown", message: "Unknown"}, c, chatId);
      await sendTelegram(env, chatId, msg, configKeyboard(c.config, c.hash, chatId));
    }
    if (!latest.length) await sendTelegram(env, chatId, "No configs yet.");
  } else if (data === "best_rated") {
    const stored = await getAllStoredConfigs(env);
    const sorted = stored
      .filter(c => (c.quality_score || 0) > 0)
      .sort((a, b) => (b.quality_score || 0) - (a.quality_score || 0))
      .slice(0, 5);
    for (const c of sorted) {
      const msg = await formatMessage(env, c.config, c.test_result || {status: "unknown", message: "Unknown"}, c, chatId);
      await sendTelegram(env, chatId, msg, configKeyboard(c.config, c.hash, chatId));
    }
    if (!sorted.length) await sendTelegram(env, chatId, "No rated configs yet.");
  } else if (data === "bot_stats") {
    const stored = await getAllStoredConfigs(env);
    const active = stored.filter(c => c.test_result?.status === "active").length;
    const totalLikes = stored.reduce((sum, c) => sum + (c.likes_count || 0), 0);
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
  } else if (data === "admin_status" && isAdmin) {
    const links = await kvGet(env, "source_links", []);
    const channels = await kvGet(env, "channel_ids", []);
    const cache = await kvGet(env, "configs_cache", []);
    const stored = await getAllStoredConfigs(env);
    await sendTelegram(env, chatId, `📊 Links: ${links.length}, Ch: ${channels.length}, Cache: ${cache.length}, Configs: ${stored.length}`);
  } else if (data === "admin_submissions" && isAdmin) {
    const subs = await kvGet(env, "submissions", []);
    const pending = subs.filter(s => s.status === "pending").slice(0, 10);
    if (pending.length) {
      for (const s of pending) {
        const id = s.id || hashConfig(s.configs?.[0] || "");
        const configsPreview = (s.configs || []).slice(0, 3).map(c => `\`${c.substring(0, 50)}...\``).join("\n");
        await sendTelegram(env, chatId, `📤 From @${s.username}\n📦 Total: ${s.configs?.length || 0} configs\nSource: ${s.provider || 'Unknown'}\n\n${configsPreview}`, {
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

      // Add individually to shards
      for (const cfg of (sub.configs || [])) {
        const h = hashConfig(cfg);
        const type = detectType(cfg);
        const bucketKey = getBucket(type, h);
        const testResult = await testConfig(cfg);
        const currentStored = await kvGet(env, bucketKey, []);

        const newEntry = {
          config: cfg, hash: h, type, provider: sub.provider,
          test_result: testResult,
          country: testResult.country,
          countryCode: testResult.countryCode,
          flag: getFlag(testResult.countryCode),
          created_at: new Date().toISOString(),
          failed_tests: testResult.status === "dead" ? 1 : 0,
          likes_count: 0, dislikes_count: 0, vote_score: 0, recent_voters: [],
          ...extractServer(cfg)
        };
        newEntry.quality_score = calculateQualityScore(newEntry);

        const final = await manageStorage(env, [newEntry, ...currentStored], bucketKey);
        await kvSet(env, bucketKey, final);

        if (newEntry.countryCode && newEntry.countryCode !== "UN") {
          await updateCountryIndex(env, newEntry.countryCode);
        }
      }
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
