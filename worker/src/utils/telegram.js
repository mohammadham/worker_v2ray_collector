// ======== Rate Limiter for Telegram API ========
export class RateLimiter {
  constructor(maxPerSecond = 30) {
    this.queue = [];
    this.processing = false;
    this.minInterval = 1000 / maxPerSecond;
    this.lastSent = 0;
  }

  async add(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject, retries: 0 });
      this.process();
    });
  }

  async process() {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const now = Date.now();
      const waitTime = Math.max(0, this.minInterval - (now - this.lastSent));

      if (waitTime > 0) {
        await new Promise(r => setTimeout(r, waitTime));
      }

      const item = this.queue.shift();
      this.lastSent = Date.now();

      try {
        const result = await item.task();
        item.resolve(result);
      } catch (e) {
        if (e.status === 429 && item.retries < 3) {
          item.retries++;
          const delay = (e.retryAfter || 1) * 1000 * Math.pow(2, item.retries);
          setTimeout(() => {
            this.queue.unshift(item);
            this.process();
          }, delay);
        } else {
          item.reject(e);
        }
      }
    }

    this.processing = false;
  }
}

export const telegramRateLimiter = new RateLimiter(25);

// ======== Telegram API with Rate Limiting ========
export function telegramApi(token) {
  return `https://api.telegram.org/bot${token}`;
}

export async function sendTelegramWithRateLimit(env, chatId, text, replyMarkup = null, parseMode = "Markdown") {
  return telegramRateLimiter.add(async () => {
    const body = { chat_id: chatId, text, parse_mode: parseMode };
    if (replyMarkup) body.reply_markup = replyMarkup;

    const resp = await fetch(`${telegramApi(env.BOT_TOKEN)}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    if (resp.status === 429) {
      const data = await resp.json();
      const error = new Error("Rate limited");
      error.status = 429;
      error.retryAfter = data.parameters?.retry_after || 1;
      throw error;
    }

    return await resp.json();
  });
}

export async function sendTelegram(env, chatId, text, replyMarkup = null, parseMode = "Markdown") {
  try {
    return await sendTelegramWithRateLimit(env, chatId, text, replyMarkup, parseMode);
  } catch (e) {
    console.error("Send error:", e);
    return null;
  }
}

export async function answerCallback(env, callbackId, text = "") {
  try {
    await fetch(`${telegramApi(env.BOT_TOKEN)}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackId, text, show_alert: false })
    });
  } catch {}
}
