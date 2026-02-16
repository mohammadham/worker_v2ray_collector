import { kvGet, kvSet, kvDelete } from '../utils/kv.js';
import { sendTelegram, answerCallback, telegramApi } from '../utils/telegram.js';
import {
  extractConfigs, detectType, hashConfig, extractServer,
  extractChannelSource, testConfig
} from '../utils/vpn.js';
import { voteConfig, getConfigVotes, calculateQualityScore } from '../services/voting.js';
import { manageStorage, cleanupConfigs, incrementUserStats } from '../services/storage.js';
import { pushToQueue } from '../services/queue.js';
import { checkAndDistribute } from '../services/fetcher.js';
import { formatMessage, configKeyboard } from './formatter.js';
import { DEFAULT_TEMPLATES, DEFAULT_SETTINGS } from '../constants.js';

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

// ======== Webhook Handler ========
export async function handleWebhook(env, update) {
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

export async function handleCallback(env, callback) {
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
