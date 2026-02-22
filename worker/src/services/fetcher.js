import { kvGet, kvSet } from '../utils/kv.js';
import { sendTelegram } from '../utils/telegram.js';
import {
  extractConfigs, hashConfig, extractChannelSource, testConfig,
  detectType, extractServer, getBucket, getFlag
} from '../utils/vpn.js';
import { calculateQualityScore } from './voting.js';
import { manageStorage, updateCountryIndex } from './storage.js';
import { pushToQueue } from './queue.js';
import { formatMessage, configKeyboard } from '../handlers/formatter.js';
import { DEFAULT_SETTINGS } from '../constants.js';

// ======== Fetch & Distribute ========
export async function checkAndDistribute(env) {
  const links = await kvGet(env, "source_links", []);
  const channels = await kvGet(env, "channel_ids", [env.CHANNEL_ID]);
  let cache = await kvGet(env, "configs_cache", []);
  const allNew = [];

  const settings = await kvGet(env, "bot_settings", DEFAULT_SETTINGS);
  const fallbackProvider = settings.channelUsername || "VPN Config Bot";

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
          const provider = extractChannelSource(text, config, fallbackProvider);
          allNew.push({ config, hash: h, provider });
          cache.push(h);
        }
      }
    } catch (e) { console.error(`Fetch error ${link}:`, e); }
  }

  if (cache.length > 500) cache = cache.slice(-500);
  await kvSet(env, "configs_cache", cache);

  let sentCount = 0;
  let invalidCount = 0;

  // Group new items by bucket
  const bucketGroups = {};
  const processedItems = allNew.slice(0, 12);

  for (const item of processedItems) {
    const type = detectType(item.config);
    const bucketKey = getBucket(type, item.hash);
    if (!bucketGroups[bucketKey]) bucketGroups[bucketKey] = [];

    const testResult = await testConfig(item.config);
    if (testResult.status !== "active" || testResult.latency >= 10000 || testResult.latency < 0) {
      invalidCount++;
      continue;
    }

    const configObj = {
      config: item.config,
      hash: item.hash,
      type,
      provider: item.provider,
      test_result: testResult,
      country: testResult.country,
      countryCode: testResult.countryCode,
      flag: getFlag(testResult.countryCode),
      created_at: new Date().toISOString(),
      failed_tests: 0,
      likes_count: 0,
      dislikes_count: 0,
      vote_score: 0,
      recent_voters: [],
      ...extractServer(item.config)
    };
    configObj.quality_score = calculateQualityScore(configObj);
    bucketGroups[bucketKey].push(configObj);

    // Distribution
    if (settings.enableQueue) {
      await pushToQueue(env, { type: "single", config: item.config, hash: item.hash, testResult });
    } else {
      for (const channel of channels) {
        try {
          const msg = await formatMessage(env, item.config, testResult, null, channel);
          const keyboard = await configKeyboard(env, item.config, item.hash, channel);
          await sendTelegram(env, channel, msg, keyboard);
          await new Promise(r => setTimeout(r, 500));
        } catch (e) { console.error(`Send error to ${channel}:`, e); }
      }
    }
    sentCount++;
  }

  // Save each bucket and update indexes
  for (const [bucketKey, newItems] of Object.entries(bucketGroups)) {
    if (newItems.length === 0) continue;
    const currentStored = await kvGet(env, bucketKey, []);
    const final = await manageStorage(env, [...newItems, ...currentStored], bucketKey);
    await kvSet(env, bucketKey, final);

    // Update country indexes for affected countries in this bucket
    const affectedCountries = new Set(newItems.map(c => c.countryCode).filter(cc => cc && cc !== "UN"));
    for (const cc of affectedCountries) {
      await updateCountryIndex(env, cc);
    }
  }

  const summary = `✅ Summary:\n- Distributed: ${sentCount}\n- Skipped (Invalid): ${invalidCount}\n- Total Scanned: ${processedItems.length}`;
  await sendTelegram(env, env.ADMIN_CHAT_ID, summary);

  return { new_configs: sentCount, invalid: invalidCount, total: processedItems.length };
}
