import { kvGet, kvSet } from './src/utils/kv.js';
import { handleWebhook } from './src/handlers/bot.js';
import { handleDashboardAPI, jsonResp } from './src/handlers/dashboard.js';
import { dashboardHTML, portfolioHTML } from './src/templates/html.js';
import { checkAndDistribute } from './src/services/fetcher.js';
import { cleanupConfigs } from './src/services/storage.js';
import { processQueue } from './src/services/queue.js';
import { telegramApi } from './src/utils/telegram.js';
import {
  DEFAULT_TEMPLATES, DEFAULT_SETTINGS
} from './src/constants.js';

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

    // Webhook
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
      const subContent = btoa(active.map(c => c.config).join("\n"));

      return new Response(subContent, {
        headers: { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" }
      });
    }

    // Countries List API
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
      return new Response(btoa(configs.join("\n")), {
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
