import { kvGet, kvSet } from './src/utils/kv.js';
import { handleWebhook } from './src/handlers/bot.js';
import { handleDashboardAPI, jsonResp } from './src/handlers/dashboard.js';
import { dashboardHTML, portfolioHTML } from './src/templates/html.js';
import { checkAndDistribute } from './src/services/fetcher.js';
import { cleanupConfigs } from './src/services/storage.js';
import { processQueue } from './src/services/queue.js';
import { telegramApi } from './src/utils/telegram.js';
import { hashConfig, detectType, getBucket } from './src/utils/vpn.js';
import { calculateQualityScore } from './src/services/voting.js';
import {
  DEFAULT_TEMPLATES, DEFAULT_SETTINGS
} from './src/constants.js';

async function migrateData(env) {
  const oldStored = await env.VPN_CACHE.get("stored_configs", "json");
  if (oldStored && Array.isArray(oldStored)) {
    console.log(`Migrating ${oldStored.length} configs to sharded storage...`);

    // Group configs by bucket first to minimize KV writes
    const groups = {};
    for (const cfg of oldStored) {
      const h = cfg.hash || hashConfig(cfg.config);
      const type = cfg.type || detectType(cfg.config);
      const bucket = getBucket(type, h);
      if (!groups[bucket]) groups[bucket] = [];

      // Try to fetch old votes (Note: this might be slow, but it's a one-time migration)
      const oldVotes = await env.VPN_CACHE.get(`votes_${h}`, "json");
      if (oldVotes) {
        cfg.likes_count = (oldVotes.likes || []).length;
        cfg.dislikes_count = (oldVotes.dislikes || []).length;
        cfg.recent_voters = [
          ...(oldVotes.likes || []).slice(-10).map(id => ({ id, type: 'like' })),
          ...(oldVotes.dislikes || []).slice(-10).map(id => ({ id, type: 'dislike' }))
        ].slice(-20);
      }
      cfg.quality_score = calculateQualityScore(cfg);
      groups[bucket].push(cfg);
    }

    for (const [bucket, configs] of Object.entries(groups)) {
      const current = await kvGet(env, bucket, []);
      const merged = [...configs, ...current].slice(0, 100);
      await kvSet(env, bucket, merged);
    }

    await env.VPN_CACHE.delete("stored_configs");
    console.log("Migration complete.");
  }
}

async function getCachedResponse(env, key) {
  try {
    return await env.VPN_CACHE.get(`cache:${key}`, "json");
  } catch { return null; }
}

async function setCacheResponse(env, key, data, ttl = 300) {
  try {
    await env.VPN_CACHE.put(`cache:${key}`, JSON.stringify(data), { expirationTtl: ttl });
  } catch {}
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,Authorization"
      }});
    }

    // Migration and Init
    const initialized = await kvGet(env, "_sharded_init");
    if (!initialized) {
      await migrateData(env);

      const setupDone = await kvGet(env, "_initialized");
      if (!setupDone) {
        await kvSet(env, "source_links", ["https://raw.githubusercontent.com/arshiacomplus/v2rayExtractor/refs/heads/main/mix/sub.html"]);
        await kvSet(env, "channel_ids", [env.CHANNEL_ID]);
        await kvSet(env, "configs_cache", []);
        await kvSet(env, "submissions", []);
        await kvSet(env, "message_templates", DEFAULT_TEMPLATES);
        await kvSet(env, "bot_settings", DEFAULT_SETTINGS);
        await kvSet(env, "_initialized", true);
      }
      await kvSet(env, "_sharded_init", true);
    }

    // Webhook
    if (url.pathname === "/webhook" && request.method === "POST") {
      try {
        const update = await request.json();
        await handleWebhook(env, update, ctx);
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

      // Check Cache
      const cacheKey = `configs:${limit}:${country}:${minQuality}:${sortBy}`;
      const cached = await getCachedResponse(env, cacheKey);
      if (cached) return jsonResp(cached);

      let filtered = [];

      // Optimization: Use Country Index if available
      if (country && sortBy === "best" && minQuality <= 0) {
        filtered = await kvGet(env, `top:country:${country}`, []);
      } else {
        // Fallback: Aggregate from all buckets
        const { ALL_BUCKETS } = await import('./src/utils/vpn.js');
        for (const bucketKey of ALL_BUCKETS) {
          const list = await kvGet(env, bucketKey, []);
          filtered.push(...list.filter(c => c.test_result?.status === "active" && (c.quality_score || 0) >= minQuality));
        }

        if (country) {
          filtered = filtered.filter(c => (c.countryCode === country || c.test_result?.countryCode === country));
        }

        if (sortBy === "best") {
          filtered.sort((a, b) => (b.quality_score || 0) - (a.quality_score || 0));
        } else {
          filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        }
      }

      const active = filtered.slice(0, limit);
      const result = {
        count: active.length,
        country: country || "ALL",
        min_quality: minQuality,
        sort: sortBy,
        configs: active.map(c => c.config)
      };

      await setCacheResponse(env, cacheKey, result, 300);
      return jsonResp(result);
    }

    // Subscription API (Base64 for V2Ray clients)
    if (url.pathname === "/api/sub") {
      const limit = Math.min(parseInt(url.searchParams.get("limit")) || 100, 1000);
      const country = url.searchParams.get("country")?.toUpperCase();
      const minQuality = parseInt(url.searchParams.get("min_quality")) || 0;
      const sortBy = url.searchParams.get("sort") || "best";

      // Check Cache
      const cacheKey = `sub:${limit}:${country}:${minQuality}:${sortBy}`;
      const cached = await getCachedResponse(env, cacheKey);
      if (cached) return new Response(cached.content, { headers: { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" } });

      let filtered = [];

      if (country && sortBy === "best" && minQuality <= 0) {
        filtered = await kvGet(env, `top:country:${country}`, []);
      } else {
        const { ALL_BUCKETS } = await import('./src/utils/vpn.js');
        for (const bucketKey of ALL_BUCKETS) {
          const list = await kvGet(env, bucketKey, []);
          filtered.push(...list.filter(c => c.test_result?.status === "active" && (c.quality_score || 0) >= minQuality));
        }

        if (country) filtered = filtered.filter(c => (c.countryCode === country || c.test_result?.countryCode === country));

        if (sortBy === "best") filtered.sort((a, b) => (b.quality_score || 0) - (a.quality_score || 0));
        else filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      }

      const active = filtered.slice(0, limit);
      const subContent = btoa(active.map(c => c.config).join("\n"));

      await setCacheResponse(env, cacheKey, { content: subContent }, 300);

      return new Response(subContent, {
        headers: { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" }
      });
    }

    // Countries List API
    if (url.pathname === "/api/countries") {
      const { ALL_BUCKETS } = await import('./src/utils/vpn.js');
      const counts = {};
      for (const bucketKey of ALL_BUCKETS) {
        const list = await kvGet(env, bucketKey, []);
        list.filter(c => c.test_result?.status === "active").forEach(c => {
          const code = c.test_result?.countryCode || "UN";
          const name = c.test_result?.country || "Unknown";
          if (!counts[code]) counts[code] = { country: name, countryCode: code, count: 0 };
          counts[code].count++;
        });
      }
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
      return new Response(btoa(configs.join("\n")), {
        headers: { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" }
      });
    }

    // App Update API (Public)
    if (url.pathname === "/api/app-update" && request.method === "GET") {
      const info = await kvGet(env, "app_update_info", { version: "1.0.0", description: "Default", link: "", force: false });
      return jsonResp(info);
    }

    // App Announcement API (Public)
    if (url.pathname === "/api/announcements" && request.method === "GET") {
      const announcement = await kvGet(env, "app_announcement", { title: "", message: "", active: false });
      return jsonResp(announcement);
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

    // Dashboard API
    if (url.pathname.startsWith("/dashboard/api")) {
      const apiPath = url.pathname.replace("/dashboard/api", "");
      return handleDashboardAPI(env, request, apiPath);
    }

    // Dashboard HTML
    if (url.pathname === "/dashboard" || url.pathname === "/dashboard/") {
      return new Response(dashboardHTML(env), { headers: { "Content-Type": "text/html;charset=UTF-8" } });
    }

    // Set Webhook
    if (url.pathname === "/set-webhook") {
      const workerUrl = url.origin;
      const resp = await fetch(`${telegramApi(env.BOT_TOKEN)}/setWebhook?url=${workerUrl}/webhook`);
      const data = await resp.json();
      return jsonResp(data);
    }

    // Redirect/Template Logic
    if (url.pathname === "/" || url.pathname === "") {
      const settings = await kvGet(env, "bot_settings", DEFAULT_SETTINGS);
      if (settings.enableRedirect && settings.redirectUrl) {
        return Response.redirect(settings.redirectUrl, 302);
      }
      return new Response(portfolioHTML(env), { 
        headers: { "Content-Type": "text/html;charset=UTF-8" } 
      });
    }

    return new Response("VPN Config Bot Pro is running. Dashboard: /dashboard", { headers: { "Content-Type": "text/plain" } });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkAndDistribute(env));
    ctx.waitUntil(cleanupConfigs(env));
    ctx.waitUntil(processQueue(env));
  }
};
