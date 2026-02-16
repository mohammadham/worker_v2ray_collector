import { kvGet, kvSet } from '../utils/kv.js';

// ======== Voting System ========
export async function voteConfig(env, configHash, userId, voteType) {
  const votes = await kvGet(env, `votes_${configHash}`, { likes: [], dislikes: [], score: 0 });

  votes.likes = votes.likes.filter(id => id !== userId);
  votes.dislikes = votes.dislikes.filter(id => id !== userId);

  if (voteType === 'like') {
    votes.likes.push(userId);
  } else if (voteType === 'dislike') {
    votes.dislikes.push(userId);
  }

  votes.score = votes.likes.length - votes.dislikes.length;
  votes.lastVote = new Date().toISOString();

  await kvSet(env, `votes_${configHash}`, votes);
  await updateConfigQualityScore(env, configHash);
  return votes;
}

export async function getConfigVotes(env, configHash) {
  return await kvGet(env, `votes_${configHash}`, { likes: [], dislikes: [], score: 0 });
}

export function calculateQualityScore(config, votes) {
  let score = 0;
  // 1. Voting weight (High impact)
  score += (votes.likes?.length || 0) * 50;
  score -= (votes.dislikes?.length || 0) * 100;

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

  // 3. Age decay (Slightly favor newer configs if scores are equal)
  const ageDays = (Date.now() - new Date(config.created_at).getTime()) / (1000 * 60 * 60 * 24);
  score -= Math.floor(ageDays) * 5;

  return score;
}

export async function updateConfigQualityScore(env, configHash) {
  const stored = await kvGet(env, "stored_configs", []);
  const idx = stored.findIndex(c => c.hash === configHash);
  if (idx === -1) return null;

  const votes = await getConfigVotes(env, configHash);
  stored[idx].quality_score = calculateQualityScore(stored[idx], votes);

  await kvSet(env, "stored_configs", stored);
  return stored[idx].quality_score;
}
