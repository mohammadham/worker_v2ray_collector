import { kvGet, kvSet } from '../utils/kv.js';
import { sendTelegram } from '../utils/telegram.js';
import {
  extractConfigs, hashConfig, extractChannelSource, testConfig,
  detectType, extractServer
} from '../utils/vpn.js';
import { getConfigVotes, calculateQualityScore } from './voting.js';
import { manageStorage } from './storage.js';
import { pushToQueue } from './queue.js';
import { formatMessage, configKeyboard } from '../handlers/formatter.js';
import { DEFAULT_SETTINGS } from '../constants.js';

// ======== Fetch & Distribute ========
export async function checkAndDistribute(env) {
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
