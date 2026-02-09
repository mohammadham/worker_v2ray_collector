from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import re
import json
import hashlib
import asyncio
import httpx
import socket
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime, timezone
from jose import jwt

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

BOT_TOKEN = os.environ.get('BOT_TOKEN', '')
ADMIN_CHAT_ID = os.environ.get('ADMIN_CHAT_ID', '')
CHANNEL_ID = os.environ.get('CHANNEL_ID', '')
DASHBOARD_USER = os.environ.get('DASHBOARD_USER', 'admin')
DASHBOARD_PASS = os.environ.get('DASHBOARD_PASS', 'vpnbot2024')
JWT_SECRET = 'vpnbot-secret-key-2024'

app = FastAPI()
api_router = APIRouter(prefix="/api")
security = HTTPBearer(auto_error=False)
logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

TELEGRAM_API = f"https://api.telegram.org/bot{BOT_TOKEN}"

CONFIG_PATTERNS = [
    r'vless://[^\s<>"]+',
    r'vmess://[^\s<>"]+',
    r'trojan://[^\s<>"]+',
    r'ss://[^\s<>"]+',
]

DEFAULT_SOURCE_LINKS = [
    "https://raw.githubusercontent.com/arshiacomplus/v2rayExtractor/refs/heads/main/mix/sub.html"
]

# --- Models ---
class LoginRequest(BaseModel):
    username: str
    password: str

class SourceLink(BaseModel):
    url: str
    name: Optional[str] = ""

class ChannelEntry(BaseModel):
    channel_id: str
    name: Optional[str] = ""

class TemplateUpdate(BaseModel):
    config_type: str
    template: str

class ConfigSubmission(BaseModel):
    config: str
    submitted_by: Optional[str] = "anonymous"

# --- Auth ---
def create_token(username: str):
    return jwt.encode({"sub": username, "exp": datetime.now(timezone.utc).timestamp() + 86400}, JWT_SECRET, algorithm="HS256")

async def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=["HS256"])
        return payload["sub"]
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

# --- Telegram helpers ---
async def send_telegram(chat_id, text, reply_markup=None, parse_mode="Markdown"):
    async with httpx.AsyncClient(timeout=30) as client_http:
        body = {"chat_id": chat_id, "text": text, "parse_mode": parse_mode}
        if reply_markup:
            body["reply_markup"] = json.dumps(reply_markup)
        try:
            resp = await client_http.post(f"{TELEGRAM_API}/sendMessage", json=body)
            return resp.json()
        except Exception as e:
            logger.error(f"Telegram send error: {e}")
            return None

async def answer_callback(callback_query_id, text=""):
    async with httpx.AsyncClient(timeout=10) as client_http:
        try:
            await client_http.post(f"{TELEGRAM_API}/answerCallbackQuery",
                json={"callback_query_id": callback_query_id, "text": text, "show_alert": False})
        except Exception:
            pass

# --- Config extraction ---
def extract_configs(text):
    configs = []
    for pattern in CONFIG_PATTERNS:
        found = re.findall(pattern, text)
        configs.extend(found)
    return list(set(configs))

def detect_config_type(config):
    if config.startswith("vless://"):
        return "vless"
    elif config.startswith("vmess://"):
        return "vmess"
    elif config.startswith("trojan://"):
        return "trojan"
    elif config.startswith("ss://"):
        return "ss"
    return "unknown"

def get_config_hash(config):
    return hashlib.md5(config.encode()).hexdigest()

def extract_server_from_config(config):
    config_type = detect_config_type(config)
    try:
        if config_type == "vmess":
            b64 = config.replace("vmess://", "")
            import base64
            padding = 4 - len(b64) % 4
            if padding != 4:
                b64 += "=" * padding
            data = json.loads(base64.b64decode(b64).decode())
            return data.get("add", ""), int(data.get("port", 443))
        elif config_type in ("vless", "trojan"):
            part = config.split("://")[1]
            at_split = part.split("@")
            if len(at_split) > 1:
                host_port = at_split[1].split("?")[0].split("#")[0]
                if ":" in host_port:
                    host, port = host_port.rsplit(":", 1)
                    host = host.strip("[]")
                    return host, int(port.split("/")[0])
        elif config_type == "ss":
            part = config.replace("ss://", "")
            if "@" in part:
                at_split = part.split("@")
                host_port = at_split[1].split("?")[0].split("#")[0]
                if ":" in host_port:
                    host, port = host_port.rsplit(":", 1)
                    return host, int(port.split("/")[0])
    except Exception:
        pass
    return None, None

# --- Config testing ---
async def test_config(config):
    host, port = extract_server_from_config(config)
    if not host or not port:
        return {"status": "error", "message": "Cannot parse server", "latency": -1}

    result = {"host": host, "port": port, "tcp": False, "dns": False, "latency": -1}

    # DNS test
    try:
        loop = asyncio.get_event_loop()
        addr = await loop.run_in_executor(None, lambda: socket.getaddrinfo(host, port, socket.AF_UNSPEC, socket.SOCK_STREAM))
        if addr:
            result["dns"] = True
    except Exception:
        result["dns"] = False

    # TCP connection test
    if result["dns"]:
        try:
            start = asyncio.get_event_loop().time()
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(host, port), timeout=5
            )
            end = asyncio.get_event_loop().time()
            result["tcp"] = True
            result["latency"] = round((end - start) * 1000)
            writer.close()
            await writer.wait_closed()
        except Exception:
            result["tcp"] = False

    if result["tcp"]:
        result["status"] = "active"
        result["message"] = f"Online - {result['latency']}ms"
    elif result["dns"]:
        result["status"] = "dns_only"
        result["message"] = "DNS OK, TCP failed"
    else:
        result["status"] = "dead"
        result["message"] = "Offline"

    return result

# --- KV-like MongoDB helpers ---
async def kv_get(key, default=None):
    doc = await db.kv_store.find_one({"key": key}, {"_id": 0})
    return doc["value"] if doc else default

async def kv_set(key, value):
    await db.kv_store.update_one({"key": key}, {"$set": {"key": key, "value": value}}, upsert=True)

# --- Initialize defaults ---
async def init_defaults():
    links = await kv_get("source_links")
    if links is None:
        await kv_set("source_links", DEFAULT_SOURCE_LINKS)
    channels = await kv_get("channel_ids")
    if channels is None:
        await kv_set("channel_ids", [CHANNEL_ID])
    cache = await kv_get("configs_cache")
    if cache is None:
        await kv_set("configs_cache", [])
    templates = await kv_get("message_templates")
    if templates is None:
        await kv_set("message_templates", {
            "vless": "VLESS Config\nType: {type}\nServer: {server}\nStatus: {status}",
            "vmess": "VMess Config\nType: {type}\nServer: {server}\nStatus: {status}",
            "trojan": "Trojan Config\nType: {type}\nServer: {server}\nStatus: {status}",
            "ss": "Shadowsocks Config\nType: {type}\nServer: {server}\nStatus: {status}",
            "default": "VPN Config\nType: {type}\nServer: {server}\nStatus: {status}"
        })

@app.on_event("startup")
async def startup():
    await init_defaults()
    logger.info("Bot initialized with defaults")

# --- Format message ---
async def format_config_message(config, test_result):
    templates = await kv_get("message_templates", {})
    config_type = detect_config_type(config)
    template = templates.get(config_type, templates.get("default", "{type} - {server} - {status}"))
    host, port = extract_server_from_config(config)
    server_str = f"{host}:{port}" if host else "Unknown"
    status_emoji = "✅" if test_result["status"] == "active" else "⚠️" if test_result["status"] == "dns_only" else "❌"
    status_str = f'{status_emoji} {test_result["message"]}'
    msg = template.format(type=config_type.upper(), server=server_str, status=status_str)
    return msg

def create_inline_keyboard(config):
    config_type = detect_config_type(config)
    return {
        "inline_keyboard": [
            [{"text": f"📋 Copy {config_type.upper()} Config", "callback_data": f"copy_{get_config_hash(config)}"}],
            [{"text": "📤 Share", "callback_data": f"share_{get_config_hash(config)}"},
             {"text": "📱 Open in App", "url": f"https://t.me/share/url?url={config[:100]}"}]
        ]
    }

# --- Main menu for regular users ---
def get_user_menu():
    return {
        "inline_keyboard": [
            [{"text": "📤 Submit Config", "callback_data": "submit_config"}],
            [{"text": "📋 Latest Configs", "callback_data": "latest_configs"}],
            [{"text": "📊 Bot Stats", "callback_data": "bot_stats"}],
            [{"text": "ℹ️ Help", "callback_data": "user_help"}]
        ]
    }

def get_admin_menu():
    return {
        "inline_keyboard": [
            [{"text": "🔍 Check Now", "callback_data": "admin_check_now"}],
            [{"text": "📋 Source Links", "callback_data": "admin_links"}, {"text": "📺 Channels", "callback_data": "admin_channels"}],
            [{"text": "📝 Templates", "callback_data": "admin_templates"}, {"text": "📊 Status", "callback_data": "admin_status"}],
            [{"text": "👥 Submissions", "callback_data": "admin_submissions"}],
            [{"text": "📤 Submit Config", "callback_data": "submit_config"}],
        ]
    }

# --- Fetch and distribute configs ---
async def fetch_and_distribute():
    links = await kv_get("source_links", [])
    channels = await kv_get("channel_ids", [CHANNEL_ID])
    cache = await kv_get("configs_cache", [])
    all_new = []

    for link in links:
        try:
            async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client_http:
                resp = await client_http.get(link, headers={"User-Agent": "Mozilla/5.0"})
                text = resp.text
                configs = extract_configs(text)
                for config in configs:
                    config_hash = get_config_hash(config)
                    if config_hash not in cache:
                        all_new.append(config)
                        cache.append(config_hash)
        except Exception as e:
            logger.error(f"Error fetching {link}: {e}")

    if len(cache) > 500:
        cache = cache[-500:]
    await kv_set("configs_cache", cache)

    sent_count = 0
    for config in all_new[:20]:
        test_result = await test_config(config)
        msg = await format_config_message(config, test_result)
        full_msg = f"{msg}\n\n`{config}`"
        keyboard = create_inline_keyboard(config)

        # Store config in DB
        await db.configs.update_one(
            {"hash": get_config_hash(config)},
            {"$set": {
                "config": config,
                "hash": get_config_hash(config),
                "type": detect_config_type(config),
                "test_result": test_result,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "host": test_result.get("host", ""),
                "port": test_result.get("port", 0),
            }},
            upsert=True
        )

        for channel in channels:
            try:
                await send_telegram(channel, full_msg, keyboard)
                await asyncio.sleep(1)
            except Exception as e:
                logger.error(f"Error sending to channel {channel}: {e}")
        sent_count += 1

    if sent_count > 0 and ADMIN_CHAT_ID:
        await send_telegram(ADMIN_CHAT_ID, f"✅ {sent_count} new configs distributed to {len(channels)} channel(s).")

    return {"new_configs": sent_count, "total_checked": len(all_new)}

# --- Webhook handler ---
async def handle_webhook(update):
    if "callback_query" in update:
        return await handle_callback(update["callback_query"])

    message = update.get("message", {})
    chat_id = str(message.get("chat", {}).get("id", ""))
    text = message.get("text", "")
    is_admin = chat_id == ADMIN_CHAT_ID

    if not text:
        return

    # Check if user is in submission mode
    user_state = await kv_get(f"user_state_{chat_id}")
    if user_state == "awaiting_config":
        await kv_set(f"user_state_{chat_id}", None)
        configs = extract_configs(text)
        if configs:
            for cfg in configs:
                await db.submissions.insert_one({
                    "config": cfg,
                    "type": detect_config_type(cfg),
                    "submitted_by": chat_id,
                    "username": message.get("from", {}).get("username", "unknown"),
                    "status": "pending",
                    "created_at": datetime.now(timezone.utc).isoformat()
                })
            await send_telegram(chat_id, f"✅ {len(configs)} config(s) submitted for review!\nThey will be tested and published after admin approval.")
        else:
            await send_telegram(chat_id, "❌ No valid V2Ray config found in your message.\nSupported: vless://, vmess://, trojan://, ss://")
        return

    if text == "/start":
        welcome = "🌐 *VPN Config Bot*\n\nWelcome! Choose an option:"
        menu = get_admin_menu() if is_admin else get_user_menu()
        await send_telegram(chat_id, welcome, menu)

    elif text == "/help":
        help_text = "📖 *Bot Commands*\n\n"
        if is_admin:
            help_text += "/start - Main menu\n/check - Fetch configs now\n/links - List source links\n/channels - List channels\n/status - Bot status\n/add\\_link URL - Add source\n/remove\\_link URL - Remove source\n/add\\_channel ID - Add channel\n/remove\\_channel ID - Remove channel"
        else:
            help_text += "/start - Main menu\n/submit - Submit a config\n/latest - Latest configs\n/help - This help"
        await send_telegram(chat_id, help_text)

    elif text == "/check" and is_admin:
        await send_telegram(chat_id, "🔄 Fetching configs...")
        result = await fetch_and_distribute()
        await send_telegram(chat_id, f"✅ Done!\nNew configs: {result['new_configs']}\nTotal checked: {result['total_checked']}")

    elif text == "/links" and is_admin:
        links = await kv_get("source_links", [])
        msg = "📋 *Source Links:*\n\n" + "\n".join([f"{i+1}. `{l}`" for i, l in enumerate(links)]) if links else "No links configured."
        await send_telegram(chat_id, msg)

    elif text == "/channels" and is_admin:
        channels = await kv_get("channel_ids", [])
        msg = "📺 *Channels:*\n\n" + "\n".join([f"{i+1}. `{c}`" for i, c in enumerate(channels)]) if channels else "No channels configured."
        await send_telegram(chat_id, msg)

    elif text == "/status" and is_admin:
        links = await kv_get("source_links", [])
        channels = await kv_get("channel_ids", [])
        cache = await kv_get("configs_cache", [])
        total_configs = await db.configs.count_documents({})
        pending = await db.submissions.count_documents({"status": "pending"})
        msg = f"📊 *Bot Status*\n\nSource Links: {len(links)}\nChannels: {len(channels)}\nCache Size: {len(cache)}\nTotal Configs: {total_configs}\nPending Submissions: {pending}"
        await send_telegram(chat_id, msg)

    elif text.startswith("/add_link ") and is_admin:
        url = text.replace("/add_link ", "").strip()
        links = await kv_get("source_links", [])
        if url not in links:
            links.append(url)
            await kv_set("source_links", links)
            await send_telegram(chat_id, f"✅ Link added: `{url}`")
        else:
            await send_telegram(chat_id, "⚠️ Link already exists.")

    elif text.startswith("/remove_link ") and is_admin:
        url = text.replace("/remove_link ", "").strip()
        links = await kv_get("source_links", [])
        if url in links:
            links.remove(url)
            await kv_set("source_links", links)
            await send_telegram(chat_id, f"✅ Link removed.")
        else:
            await send_telegram(chat_id, "⚠️ Link not found.")

    elif text.startswith("/add_channel ") and is_admin:
        cid = text.replace("/add_channel ", "").strip()
        channels = await kv_get("channel_ids", [])
        if cid not in channels:
            channels.append(cid)
            await kv_set("channel_ids", channels)
            await send_telegram(chat_id, f"✅ Channel added: `{cid}`")
        else:
            await send_telegram(chat_id, "⚠️ Channel already exists.")

    elif text.startswith("/remove_channel ") and is_admin:
        cid = text.replace("/remove_channel ", "").strip()
        channels = await kv_get("channel_ids", [])
        if cid in channels:
            channels.remove(cid)
            await kv_set("channel_ids", channels)
            await send_telegram(chat_id, f"✅ Channel removed.")
        else:
            await send_telegram(chat_id, "⚠️ Channel not found.")

    elif text == "/submit":
        await kv_set(f"user_state_{chat_id}", "awaiting_config")
        await send_telegram(chat_id, "📤 *Submit Config*\n\nPlease send your V2Ray config (vless://, vmess://, trojan://, ss://):")

    elif text == "/latest":
        configs = await db.configs.find({}, {"_id": 0}).sort("created_at", -1).limit(5).to_list(5)
        if configs:
            for cfg in configs:
                msg = f"🔰 *{cfg['type'].upper()}*\nServer: {cfg.get('host', 'N/A')}:{cfg.get('port', 'N/A')}\nStatus: {cfg.get('test_result', {}).get('message', 'Unknown')}\n\n`{cfg['config']}`"
                await send_telegram(chat_id, msg)
        else:
            await send_telegram(chat_id, "No configs available yet.")

    elif not is_admin:
        configs = extract_configs(text)
        if configs:
            for cfg in configs:
                await db.submissions.insert_one({
                    "config": cfg,
                    "type": detect_config_type(cfg),
                    "submitted_by": chat_id,
                    "username": message.get("from", {}).get("username", "unknown"),
                    "status": "pending",
                    "created_at": datetime.now(timezone.utc).isoformat()
                })
            await send_telegram(chat_id, f"✅ {len(configs)} config(s) submitted for review!")
        else:
            await send_telegram(chat_id, "Use /start to see the menu.", get_user_menu())

async def handle_callback(callback):
    chat_id = str(callback["message"]["chat"]["id"])
    data = callback.get("data", "")
    callback_id = callback["id"]
    is_admin = chat_id == ADMIN_CHAT_ID

    await answer_callback(callback_id, "Processing...")

    if data == "submit_config":
        await kv_set(f"user_state_{chat_id}", "awaiting_config")
        await send_telegram(chat_id, "📤 *Submit Config*\n\nSend your V2Ray config now:")

    elif data == "latest_configs":
        configs = await db.configs.find({}, {"_id": 0}).sort("created_at", -1).limit(5).to_list(5)
        if configs:
            for cfg in configs:
                msg = f"🔰 *{cfg['type'].upper()}*\nServer: {cfg.get('host', 'N/A')}:{cfg.get('port', 'N/A')}\nStatus: {cfg.get('test_result', {}).get('message', 'Unknown')}\n\n`{cfg['config']}`"
                await send_telegram(chat_id, msg)
        else:
            await send_telegram(chat_id, "No configs available yet.")

    elif data == "bot_stats":
        total = await db.configs.count_documents({})
        active = await db.configs.count_documents({"test_result.status": "active"})
        await send_telegram(chat_id, f"📊 *Stats*\n\nTotal Configs: {total}\nActive: {active}")

    elif data == "user_help":
        await send_telegram(chat_id, "📖 Send /start for menu.\nSend any V2Ray config to submit it.\nUse /latest to see recent configs.")

    elif data == "admin_check_now" and is_admin:
        await send_telegram(chat_id, "🔄 Fetching configs...")
        result = await fetch_and_distribute()
        await send_telegram(chat_id, f"✅ Done! {result['new_configs']} new configs sent.")

    elif data == "admin_links" and is_admin:
        links = await kv_get("source_links", [])
        msg = "📋 *Source Links:*\n\n" + "\n".join([f"{i+1}. `{l}`" for i, l in enumerate(links)])
        await send_telegram(chat_id, msg)

    elif data == "admin_channels" and is_admin:
        channels = await kv_get("channel_ids", [])
        msg = "📺 *Channels:*\n\n" + "\n".join([f"{i+1}. `{c}`" for i, c in enumerate(channels)])
        await send_telegram(chat_id, msg)

    elif data == "admin_templates" and is_admin:
        templates = await kv_get("message_templates", {})
        msg = "📝 *Message Templates:*\n\n"
        for k, v in templates.items():
            msg += f"*{k}:*\n`{v}`\n\n"
        await send_telegram(chat_id, msg)

    elif data == "admin_status" and is_admin:
        links = await kv_get("source_links", [])
        channels = await kv_get("channel_ids", [])
        cache = await kv_get("configs_cache", [])
        total = await db.configs.count_documents({})
        pending = await db.submissions.count_documents({"status": "pending"})
        msg = f"📊 *Status*\n\nLinks: {len(links)}\nChannels: {len(channels)}\nCache: {len(cache)}\nConfigs: {total}\nPending: {pending}"
        await send_telegram(chat_id, msg)

    elif data == "admin_submissions" and is_admin:
        subs = await db.submissions.find({"status": "pending"}, {"_id": 0}).limit(10).to_list(10)
        if subs:
            for sub in subs:
                msg = f"📤 *Submission*\nFrom: @{sub.get('username', 'unknown')}\nType: {sub['type']}\n\n`{sub['config']}`"
                keyboard = {
                    "inline_keyboard": [
                        [{"text": "✅ Approve", "callback_data": f"approve_{get_config_hash(sub['config'])}"},
                         {"text": "❌ Reject", "callback_data": f"reject_{get_config_hash(sub['config'])}"}]
                    ]
                }
                await send_telegram(chat_id, msg, keyboard)
        else:
            await send_telegram(chat_id, "No pending submissions.")

    elif data.startswith("approve_") and is_admin:
        config_hash = data.replace("approve_", "")
        sub = await db.submissions.find_one({"status": "pending"}, {"_id": 0})
        if sub and get_config_hash(sub["config"]) == config_hash:
            test_result = await test_config(sub["config"])
            msg = await format_config_message(sub["config"], test_result)
            full_msg = f"{msg}\n\n`{sub['config']}`"
            keyboard = create_inline_keyboard(sub["config"])
            channels = await kv_get("channel_ids", [CHANNEL_ID])
            for channel in channels:
                await send_telegram(channel, full_msg, keyboard)
                await asyncio.sleep(1)
            await db.submissions.update_one(
                {"config": sub["config"], "status": "pending"},
                {"$set": {"status": "approved"}}
            )
            await db.configs.update_one(
                {"hash": config_hash},
                {"$set": {"config": sub["config"], "hash": config_hash, "type": sub["type"],
                          "test_result": test_result, "created_at": datetime.now(timezone.utc).isoformat()}},
                upsert=True
            )
            await send_telegram(chat_id, "✅ Config approved and published!")

    elif data.startswith("reject_") and is_admin:
        config_hash = data.replace("reject_", "")
        await db.submissions.update_one(
            {"status": "pending"},
            {"$set": {"status": "rejected"}}
        )
        await send_telegram(chat_id, "❌ Config rejected.")

    elif data.startswith("copy_"):
        config_hash = data.replace("copy_", "")
        cfg = await db.configs.find_one({"hash": config_hash}, {"_id": 0})
        if cfg:
            await send_telegram(chat_id, f"`{cfg['config']}`")
        else:
            await send_telegram(chat_id, "Config not found in database.")

    elif data.startswith("share_"):
        config_hash = data.replace("share_", "")
        cfg = await db.configs.find_one({"hash": config_hash}, {"_id": 0})
        if cfg:
            await send_telegram(chat_id, f"Share this config:\n\n`{cfg['config']}`")

# === API Routes ===

@api_router.post("/webhook")
async def webhook_endpoint(request: Request):
    try:
        update = await request.json()
        await handle_webhook(update)
        return {"ok": True}
    except Exception as e:
        logger.error(f"Webhook error: {e}")
        return {"ok": False, "error": str(e)}

@api_router.post("/auth/login")
async def login(req: LoginRequest):
    if req.username == DASHBOARD_USER and req.password == DASHBOARD_PASS:
        token = create_token(req.username)
        return {"token": token, "username": req.username}
    raise HTTPException(status_code=401, detail="Invalid credentials")

@api_router.get("/dashboard/stats")
async def dashboard_stats(user: str = Depends(verify_token)):
    total_configs = await db.configs.count_documents({})
    active_configs = await db.configs.count_documents({"test_result.status": "active"})
    links = await kv_get("source_links", [])
    channels = await kv_get("channel_ids", [])
    cache = await kv_get("configs_cache", [])
    pending = await db.submissions.count_documents({"status": "pending"})
    return {
        "total_configs": total_configs,
        "active_configs": active_configs,
        "source_links": len(links),
        "channels": len(channels),
        "cache_size": len(cache),
        "pending_submissions": pending
    }

@api_router.get("/dashboard/links")
async def get_links(user: str = Depends(verify_token)):
    links = await kv_get("source_links", [])
    return {"links": links}

@api_router.post("/dashboard/links")
async def add_link(link: SourceLink, user: str = Depends(verify_token)):
    links = await kv_get("source_links", [])
    if link.url not in links:
        links.append(link.url)
        await kv_set("source_links", links)
    return {"links": links}

@api_router.delete("/dashboard/links")
async def remove_link(link: SourceLink, user: str = Depends(verify_token)):
    links = await kv_get("source_links", [])
    if link.url in links:
        links.remove(link.url)
        await kv_set("source_links", links)
    return {"links": links}

@api_router.get("/dashboard/channels")
async def get_channels(user: str = Depends(verify_token)):
    channels = await kv_get("channel_ids", [])
    return {"channels": channels}

@api_router.post("/dashboard/channels")
async def add_channel(ch: ChannelEntry, user: str = Depends(verify_token)):
    channels = await kv_get("channel_ids", [])
    if ch.channel_id not in channels:
        channels.append(ch.channel_id)
        await kv_set("channel_ids", channels)
    return {"channels": channels}

@api_router.delete("/dashboard/channels")
async def remove_channel(ch: ChannelEntry, user: str = Depends(verify_token)):
    channels = await kv_get("channel_ids", [])
    if ch.channel_id in channels:
        channels.remove(ch.channel_id)
        await kv_set("channel_ids", channels)
    return {"channels": channels}

@api_router.get("/dashboard/configs")
async def get_configs(user: str = Depends(verify_token), limit: int = 50, skip: int = 0):
    configs = await db.configs.find({}, {"_id": 0}).sort("created_at", -1).skip(skip).limit(limit).to_list(limit)
    total = await db.configs.count_documents({})
    return {"configs": configs, "total": total}

@api_router.get("/dashboard/templates")
async def get_templates(user: str = Depends(verify_token)):
    templates = await kv_get("message_templates", {})
    return {"templates": templates}

@api_router.post("/dashboard/templates")
async def update_template(t: TemplateUpdate, user: str = Depends(verify_token)):
    templates = await kv_get("message_templates", {})
    templates[t.config_type] = t.template
    await kv_set("message_templates", templates)
    return {"templates": templates}

@api_router.get("/dashboard/submissions")
async def get_submissions(user: str = Depends(verify_token), status: str = "pending"):
    subs = await db.submissions.find({"status": status}, {"_id": 0}).sort("created_at", -1).limit(50).to_list(50)
    return {"submissions": subs}

@api_router.post("/dashboard/submissions/{action}")
async def handle_submission(action: str, sub: ConfigSubmission, user: str = Depends(verify_token)):
    if action == "approve":
        test_result = await test_config(sub.config)
        msg = await format_config_message(sub.config, test_result)
        full_msg = f"{msg}\n\n`{sub.config}`"
        keyboard = create_inline_keyboard(sub.config)
        channels = await kv_get("channel_ids", [CHANNEL_ID])
        for channel in channels:
            await send_telegram(channel, full_msg, keyboard)
            await asyncio.sleep(1)
        await db.submissions.update_one(
            {"config": sub.config, "status": "pending"},
            {"$set": {"status": "approved"}}
        )
        await db.configs.update_one(
            {"hash": get_config_hash(sub.config)},
            {"$set": {"config": sub.config, "hash": get_config_hash(sub.config),
                      "type": detect_config_type(sub.config), "test_result": test_result,
                      "created_at": datetime.now(timezone.utc).isoformat()}},
            upsert=True
        )
        return {"status": "approved", "test_result": test_result}
    elif action == "reject":
        await db.submissions.update_one(
            {"config": sub.config, "status": "pending"},
            {"$set": {"status": "rejected"}}
        )
        return {"status": "rejected"}
    raise HTTPException(400, "Invalid action")

@api_router.post("/dashboard/fetch-now")
async def fetch_now(user: str = Depends(verify_token)):
    result = await fetch_and_distribute()
    return result

@api_router.post("/dashboard/test-config")
async def test_single_config(sub: ConfigSubmission, user: str = Depends(verify_token)):
    result = await test_config(sub.config)
    return result

@api_router.get("/dashboard/worker-script")
async def get_worker_script(user: str = Depends(verify_token)):
    try:
        with open("/app/worker/worker.js", "r") as f:
            return {"script": f.read()}
    except Exception:
        return {"script": "Worker script not found. Check /app/worker/worker.js"}

app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
