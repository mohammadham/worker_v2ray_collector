import { kvGet, kvSet, kvDelete } from '../utils/kv.js';
import {
  hashConfig, detectType, extractServer, testConfig
} from '../utils/vpn.js';
import { getConfigVotes, voteConfig, calculateQualityScore } from '../services/voting.js';
import {
  manageStorage, cleanupConfigs, incrementUserStats
} from '../services/storage.js';
import { checkAndDistribute } from '../services/fetcher.js';
import { pushToQueue } from '../services/queue.js';
import { formatMessage } from '../handlers/formatter.js';
import { DEFAULT_SETTINGS, DEFAULT_TEMPLATES } from '../constants.js';
import { sendTelegram } from '../utils/telegram.js';

// ======== Dashboard API - COMPLETE VERSION ========
export async function handleDashboardAPI(env, request, path) {
  const url = new URL(request.url);
  const method = request.method;

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
      const token = btoa(JSON.stringify({ sub: username, exp: Date.now() + 86400000, salt: Math.random() }));
      return jsonResp({ token, username });
    }
    return jsonResp({ error: "Invalid username or password" }, 401);
  }

  // Auth check
  const auth = request.headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) return jsonResp({ error: "Unauthorized" }, 401);
  let userPayload;
  try {
    userPayload = JSON.parse(atob(auth.replace("Bearer ", "")));
    if (userPayload.exp < Date.now()) return jsonResp({ error: "Token expired" }, 401);
  } catch { return jsonResp({ error: "Invalid token" }, 401); }

  // Stats
  if (path === "/stats") {
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

  // Links
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

  // Channels
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

  // Configs
  if (path === "/configs" && method === "GET") {
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

  // Delete Config
  if (path.startsWith("/configs/") && method === "DELETE") {
    const hash = path.replace("/configs/", "");
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

  // Voting
  if (path === "/vote" && method === "POST") {
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

  // Templates
  if (path === "/templates" && method === "GET") {
    const templates = await kvGet(env, "message_templates", DEFAULT_TEMPLATES);
    const settings = await kvGet(env, "bot_settings", DEFAULT_SETTINGS);
    return jsonResp({ templates, activeTemplate: settings.activeTemplate });
  }
  if (path === "/templates" && method === "POST") {
    const { type, template } = await request.json();
    const templates = await kvGet(env, "message_templates", DEFAULT_TEMPLATES);
    templates[type] = template;
    await kvSet(env, "message_templates", templates);
    return jsonResp({ templates });
  }
  if (path === "/templates/reset" && method === "POST") {
    await kvSet(env, "message_templates", DEFAULT_TEMPLATES);
    return jsonResp({ templates: DEFAULT_TEMPLATES });
  }

  // Submissions
  if (path === "/submissions" && method === "GET") {
    const subs = await kvGet(env, "submissions", []);
    return jsonResp({ submissions: subs.filter(s => s.status === "pending").slice(0, 50) });
  }
  if (path === "/submissions/approve" && method === "POST") {
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
  if (path === "/submissions/reject" && method === "POST") {
    const { id } = await request.json();
    const subs = await kvGet(env, "submissions", []);
    const sub = subs.find(s => s.status === "pending" && (s.id === id || hashConfig(s.configs?.[0] || "") === id));
    if (sub) { sub.status = "rejected"; await kvSet(env, "submissions", subs); }
    return jsonResp({ status: "rejected" });
  }

  // Settings
  if (path === "/settings" && method === "GET") {
    const settings = await kvGet(env, "bot_settings", DEFAULT_SETTINGS);
    return jsonResp({ settings });
  }
  if (path === "/settings" && method === "POST") {
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

  // Fetch Now
  if (path === "/fetch-now" && method === "POST") {
    const result = await checkAndDistribute(env);
    return jsonResp(result);
  }

  // Cleanup
  if (path === "/cleanup" && method === "POST") {
    const result = await cleanupConfigs(env);
    return jsonResp(result);
  }

  // Retest All
  if (path === "/retest-all" && method === "POST") {
    const stored = await kvGet(env, "stored_configs", []);
    const limit = 5;

    const results = [];
    for (let i = 0; i < stored.length; i += limit) {
      const batch = stored.slice(i, i + limit);
      const batchResults = await Promise.all(batch.map(async (config) => {
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
      }));
      results.push(...batchResults);
      await new Promise(r => setTimeout(r, 100));
    }

    await kvSet(env, "stored_configs", results);
    return jsonResp({ tested: results.length });
  }

  // Test
  if (path === "/test" && method === "POST") {
    const { config } = await request.json();
    return jsonResp(await testConfig(config));
  }

  return jsonResp({ error: "Not found" }, 404);
}

export function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
}
