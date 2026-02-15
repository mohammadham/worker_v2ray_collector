# راهنمای تنظیم GitHub Actions برای دیپلوی خودکار

## مرحله ۱: ایجاد ریپازیتوری

1. یک ریپازیتوری جدید در GitHub بسازید
2. فایل‌های پوشه `/app/worker` را push کنید:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/USERNAME/REPO.git
   git push -u origin main
   ```

## مرحله ۲: تنظیم Secrets در GitHub

به Settings → Secrets and variables → Actions بروید و این secrets را اضافه کنید:

| Secret Name | مقدار | توضیح |
|------------|-------|-------|
| `CLOUDFLARE_API_TOKEN` | توکن API کلودفلر | از dash.cloudflare.com → API Tokens |
| `CF_ACCOUNT_SUBDOMAIN` | ساب‌دامین اکانت | مثلاً `abc123` از workers.dev |
| `KV_NAMESPACE_ID` | آیدی KV Namespace | از دستور `wrangler kv:namespace create` |
| `BOT_TOKEN` | `8401999862:AAEKLblOg2kfCAG3L87L4Nmc79Mu9EY5Buw` | توکن ربات تلگرام |
| `ADMIN_CHAT_ID` | `599762196` | آیدی چت ادمین |
| `CHANNEL_ID` | `-1002296795477` | آیدی کانال هدف |
| `DASHBOARD_USER` | `admin` | نام کاربری داشبورد |
| `DASHBOARD_PASS` | `vpnbot2024` | رمز داشبورد |

## مرحله ۳: ایجاد API Token در Cloudflare

1. به [Cloudflare Dashboard](https://dash.cloudflare.com) بروید
2. My Profile → API Tokens → Create Token
3. از تمپلیت **Edit Cloudflare Workers** استفاده کنید
4. دسترسی‌ها:
   - Account: Cloudflare Workers KV Storage - Edit
   - Zone: Workers Routes - Edit
5. توکن را کپی و در GitHub Secrets ذخیره کنید

## مرحله ۴: ایجاد KV Namespace

```bash
# نصب wrangler
npm install -g wrangler

# لاگین
wrangler login

# ایجاد KV Namespace
wrangler kv:namespace create VPN_CACHE
```

خروجی مثل این خواهد بود:
```
🌀 Creating namespace with title "vpn-config-bot-VPN_CACHE"
✨ Success!
Add the following to your configuration file:
[[kv_namespaces]]
binding = "VPN_CACHE"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

مقدار `id` را در `KV_NAMESPACE_ID` قرار دهید.

## مرحله ۵: ساختار پوشه

مطمئن شوید ساختار ریپازیتوری به این شکل است:

```
├── .github/
│   └── workflows/
│       └── deploy.yml
├── worker/
│   ├── worker.js
│   └── wrangler.toml
└── README.md
```

## نحوه کار

✅ با هر push به branch `main` که فایل‌های `worker/**` تغییر کند:
1. Worker به کلودفلر دیپلوی می‌شود
2. Webhook تلگرام تنظیم می‌شود

✅ می‌توانید از **Actions → Run workflow** دستی هم اجرا کنید.

## تست

بعد از دیپلوی:
- داشبورد: `https://vpn-config-bot.YOUR-SUBDOMAIN.workers.dev/dashboard`
- ربات: `/start` در تلگرام بزنید

## عیب‌یابی

| مشکل | راه‌حل |
|------|-------|
| `Error: Authentication failed` | API Token را بررسی کنید |
| `KV namespace not found` | KV_NAMESPACE_ID صحیح است؟ |
| `Webhook not responding` | BOT_TOKEN صحیح است؟ |