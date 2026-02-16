import { kvGet, kvSet } from '../utils/kv.js';
import { getBucket } from '../utils/vpn.js';

// ======== Voting System ========
export async function voteConfig(env, configHash, userId, voteType, configType = null) {
  // If configType is not provided, we might need to find which bucket contains the hash
  // But usually we know the type from the context (e.g. callback query or API param)
  let bucketKey = null;
  let configs = [];
  let idx = -1;

  if (configType) {
    bucketKey = getBucket(configType, configHash);
    configs = await kvGet(env, bucketKey, []);
    idx = configs.findIndex(c => c.hash === configHash);
  } else {
    // Fallback: search all buckets if type is unknown (less efficient)
    const { ALL_BUCKETS } = await import('../utils/vpn.js');
    for (const b of ALL_BUCKETS) {
      const list = await kvGet(env, b, []);
      const i = list.findIndex(c => c.hash === configHash);
      if (i !== -1) {
        bucketKey = b;
        configs = list;
        idx = i;
        break;
      }
    }
  }

  if (idx === -1) return null;

  const cfg = configs[idx];
  if (cfg.likes_count === undefined) cfg.likes_count = 0;
  if (cfg.dislikes_count === undefined) cfg.dislikes_count = 0;
  if (!cfg.recent_voters) cfg.recent_voters = [];

  if (userId) {
    const sUserId = String(userId);
    const existingIdx = cfg.recent_voters.findIndex(v => String(v.id) === sUserId);

    if (existingIdx !== -1) {
      const oldVote = cfg.recent_voters[existingIdx].type;
      if (oldVote !== voteType) {
        if (oldVote === 'like') cfg.likes_count = Math.max(0, cfg.likes_count - 1);
        else cfg.dislikes_count = Math.max(0, cfg.dislikes_count - 1);

        if (voteType === 'like') cfg.likes_count++;
        else if (voteType === 'dislike') cfg.dislikes_count++;

        cfg.recent_voters[existingIdx].type = voteType;
      }
    } else {
      if (voteType === 'like') cfg.likes_count++;
      else if (voteType === 'dislike') cfg.dislikes_count++;

      cfg.recent_voters.push({ id: sUserId, type: voteType });
      if (cfg.recent_voters.length > 20) {
        cfg.recent_voters.shift();
      }
    }
  } else {
    // Android App (no ID)
    if (voteType === 'like') cfg.likes_count++;
    else if (voteType === 'dislike') cfg.dislikes_count++;
  }

  cfg.vote_score = (cfg.likes_count || 0) - (cfg.dislikes_count || 0);
  cfg.quality_score = calculateQualityScore(cfg);
  cfg.last_vote_at = new Date().toISOString();

  await kvSet(env, bucketKey, configs);

  // Update country index
  const cc = cfg.countryCode || cfg.test_result?.countryCode;
  if (cc) {
    const { updateCountryIndex } = await import('./storage.js');
    await updateCountryIndex(env, cc);
  }

  return { likes: cfg.likes_count, dislikes: cfg.dislikes_count, score: cfg.vote_score };
}

export function calculateQualityScore(config) {
  let score = 0;
  // 1. Voting weight (Internal data)
  score += (config.likes_count || 0) * 50;
  score -= (config.dislikes_count || 0) * 100;

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

  // 3. Age decay
  const ageDays = (Date.now() - new Date(config.created_at).getTime()) / (1000 * 60 * 60 * 24);
  score -= Math.floor(ageDays) * 5;

  return score;
}

// Deprecated: getConfigVotes is no longer needed for per-config KV reads
export async function getConfigVotes(env, configHash) {
  // Return internal data if possible, or dummy data for compatibility
  return { likes: [], dislikes: [], score: 0 };
}
