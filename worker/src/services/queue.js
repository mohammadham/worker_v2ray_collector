import { kvGet, kvSet } from '../utils/kv.js';
import { DEFAULT_SETTINGS } from '../constants.js';
import { formatMessage, configKeyboard } from '../handlers/formatter.js';
import { sendTelegram } from '../utils/telegram.js';
import { getConfigVotes } from './voting.js';

export async function pushToQueue(env, item) {
  const queue = await kvGet(env, "publish_queue", []);
  queue.push(item);
  await kvSet(env, "publish_queue", queue);
}

export async function processQueue(env) {
  const settings = await kvGet(env, "bot_settings", DEFAULT_SETTINGS);
  if (!settings.enableQueue) return;

  const lastRun = await kvGet(env, "last_queue_run", 0);
  const now = Date.now();
  const intervalMs = (settings.queueIntervalMin || 15) * 60 * 1000;

  if (now - lastRun < intervalMs) return;

  const queue = await kvGet(env, "publish_queue", []);
  if (queue.length === 0) return;

  const batchSize = settings.queueBatchSize || 1;
  const toProcess = queue.slice(0, batchSize);
  const remaining = queue.slice(batchSize);

  const channels = await kvGet(env, "channel_ids", [env.CHANNEL_ID]);

  for (const item of toProcess) {
    for (const ch of channels) {
      try {
        let msg, keyboard;
        if (item.type === "bundle") {
          msg = await formatMessage(env, null, null, null, ch, item.configs, item.userAttr);
          keyboard = { inline_keyboard: [[{ text: "📤 Share", url: `https://t.me/share/url?url=${encodeURIComponent(item.configs?.[0] || "")}` }]] };
        } else {
          const votes = await getConfigVotes(env, item.hash);
          msg = await formatMessage(env, item.config, item.testResult, votes, ch);
          keyboard = await configKeyboard(env, item.config, item.hash, ch);
        }
        await sendTelegram(env, ch, msg, keyboard);
        await new Promise(r => setTimeout(r, 1000));
      } catch (e) { console.error("Queue send error:", e); }
    }
  }

  await kvSet(env, "publish_queue", remaining);
  await kvSet(env, "last_queue_run", now);
}
