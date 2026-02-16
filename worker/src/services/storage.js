import { kvGet, kvSet } from '../utils/kv.js';
import { testConfig, ALL_BUCKETS } from '../utils/vpn.js';
import { calculateQualityScore } from './voting.js';
import { DEFAULT_SETTINGS } from '../constants.js';

// ======== Cleanup Logic (Per Bucket) ========
export async function manageStorage(env, configsArray, bucketKey) {
  const MAX_CONFIGS = 100;
  let stored = configsArray;

  if (stored.length <= MAX_CONFIGS) return stored;

  const target = MAX_CONFIGS;
  const now = Date.now();
  const TEN_DAYS = 10 * 24 * 60 * 60 * 1000;

  // Stage 0: Remove extremely low quality
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

  // Stage 3: Remove High Latency
  stored.sort((a, b) => (b.test_result?.latency || 9999) - (a.test_result?.latency || 9999));
  while (stored.length > target && (stored[0].test_result?.latency || 0) > 2000) {
    stored.shift();
  }
  if (stored.length <= target) return stored;

  // Stage 4: Retest oldest and remove failed
  stored.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  for (let i = 0; i < stored.length && stored.length > target; i++) {
    const testResult = await testConfig(stored[i].config);
    if (testResult.status === "dead") {
       stored.splice(i, 1);
       i--;
    } else {
      stored[i].test_result = testResult;
      stored[i].quality_score = calculateQualityScore(stored[i]);
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

export async function cleanupConfigs(env) {
  const settings = await kvGet(env, "bot_settings", DEFAULT_SETTINGS);
  const now = Date.now();
  let totalRemoved = 0;
  let totalKept = 0;

  for (const bucketKey of ALL_BUCKETS) {
    const stored = await kvGet(env, bucketKey, []);
    if (!stored.length) continue;

    const kept = [];
    const removed = [];

    for (const config of stored) {
      let shouldRemove = false;

      const created = new Date(config.created_at).getTime();
      if (!isNaN(created)) {
        const daysSinceCreated = (now - created) / (1000 * 60 * 60 * 24);
        const hasLikes = (config.likes_count || 0) >= (settings.minLikesToKeep || 1);

        if (daysSinceCreated > 10 && !hasLikes) {
          shouldRemove = true;
        } else if (daysSinceCreated > (settings.autoDeleteDays || 15) && !hasLikes) {
          shouldRemove = true;
        }
      }

      if (!shouldRemove && config.test_result?.timestamp) {
        const lastTest = new Date(config.test_result.timestamp).getTime();
        if (!isNaN(lastTest)) {
          const daysSinceTest = (now - lastTest) / (1000 * 60 * 60 * 24);
          if (daysSinceTest > (settings.staleDeleteDays || 14)) {
            shouldRemove = true;
          }
        }
      }

      if (!shouldRemove && config.failed_tests && config.failed_tests >= (settings.maxFailedTests || 50)) {
        shouldRemove = true;
      }

      if (shouldRemove) {
        removed.push(config);
      } else {
        kept.push(config);
      }
    }

    if (removed.length > 0) {
      await kvSet(env, bucketKey, kept);
      totalRemoved += removed.length;
    }
    totalKept += kept.length;
  }

  return { removed: totalRemoved, kept: totalKept };
}

export async function incrementUserStats(env, chatId, count) {
  const stats = await kvGet(env, `user_stats_${chatId}`, { approved_count: 0 });
  stats.approved_count += count;
  await kvSet(env, `user_stats_${chatId}`, stats);
}
