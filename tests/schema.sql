PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS players (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 login TEXT NOT NULL COLLATE NOCASE UNIQUE,
 display_name TEXT NOT NULL,
 password_hash TEXT,
 telegram_id TEXT UNIQUE,
 telegram_username TEXT,
 balance INTEGER NOT NULL DEFAULT 25000 CHECK (balance >= 0),
 experience INTEGER NOT NULL DEFAULT 0 CHECK (experience >= 0),
 equipped_item_id INTEGER,
 last_daily_at INTEGER NOT NULL DEFAULT 0,
 last_work_at INTEGER NOT NULL DEFAULT 0,
 work_day INTEGER NOT NULL DEFAULT 0,
 work_count INTEGER NOT NULL DEFAULT 0,
 last_free_spin_at INTEGER NOT NULL DEFAULT 0,
 free_spin_day INTEGER NOT NULL DEFAULT 0,
 free_spin_count INTEGER NOT NULL DEFAULT 0,
 last_casino_at INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY,
 csrf_token TEXT NOT NULL,
 player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
 expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_player ON sessions(player_id);
CREATE TABLE IF NOT EXISTS items (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 handle TEXT NOT NULL COLLATE NOCASE UNIQUE,
 owner_id INTEGER NOT NULL REFERENCES players(id),
 tier TEXT NOT NULL CHECK (tier IN ('common','uncommon','rare','epic','legendary')),
 appraisal INTEGER NOT NULL CHECK (appraisal >= 0),
 buyback INTEGER NOT NULL CHECK (buyback >= 0),
 created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_owner ON items(owner_id);
CREATE INDEX IF NOT EXISTS idx_items_tier ON items(tier);
CREATE TABLE IF NOT EXISTS generated_handles (
 handle TEXT PRIMARY KEY COLLATE NOCASE,
 generated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS listings (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 item_id INTEGER NOT NULL UNIQUE REFERENCES items(id) ON DELETE CASCADE,
 seller_id INTEGER NOT NULL REFERENCES players(id),
 price INTEGER NOT NULL CHECK(price BETWEEN 100 AND 100000000),
 created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_listings_created ON listings(created_at DESC);
CREATE TABLE IF NOT EXISTS transactions_log (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 kind TEXT NOT NULL,
 actor_id INTEGER NOT NULL REFERENCES players(id),
 other_id INTEGER REFERENCES players(id),
 item_id INTEGER,
 item_handle TEXT,
 amount INTEGER NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_log_actor ON transactions_log(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_log_sales ON transactions_log(kind, created_at DESC);


CREATE TABLE IF NOT EXISTS work_state (
 player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
 day TEXT NOT NULL,
 count INTEGER NOT NULL DEFAULT 0,
 last_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sales (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 seller_id INTEGER NOT NULL REFERENCES players(id),
 buyer_id INTEGER REFERENCES players(id),
 handle TEXT NOT NULL,
 tier TEXT NOT NULL,
 price INTEGER NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('game','market')),
 created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sales_kind ON sales(kind,id DESC);
CREATE INDEX IF NOT EXISTS idx_sales_seller ON sales(seller_id,id DESC);

-- Update 2.2: server-wide chat and personal item-sale offers.
CREATE TABLE IF NOT EXISTS chat_messages (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
 message TEXT NOT NULL CHECK(length(message) BETWEEN 1 AND 280),
 created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_recent ON chat_messages(id DESC);
CREATE TABLE IF NOT EXISTS trade_offers (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
 seller_id INTEGER NOT NULL REFERENCES players(id),
 buyer_id INTEGER NOT NULL REFERENCES players(id),
 price INTEGER NOT NULL CHECK(price BETWEEN 1 AND 1000000000),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined','cancelled','expired')),
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_trade_received ON trade_offers(buyer_id,status,id DESC);
CREATE INDEX IF NOT EXISTS idx_trade_sent ON trade_offers(seller_id,status,id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_offer_unique_pending ON trade_offers(item_id) WHERE status='pending';

-- v2.3: Referral codes and immutable per-invitee reward records.
CREATE TABLE IF NOT EXISTS referral_codes (
 player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
 code TEXT NOT NULL UNIQUE,
 created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS referral_rewards (
 invited_player_id INTEGER PRIMARY KEY REFERENCES players(id),
 inviter_id INTEGER NOT NULL REFERENCES players(id),
 reward INTEGER NOT NULL CHECK(reward = 100000),
 created_at INTEGER NOT NULL,
 CHECK(invited_player_id <> inviter_id)
);
CREATE INDEX IF NOT EXISTS idx_referral_inviter ON referral_rewards(inviter_id,created_at DESC);
