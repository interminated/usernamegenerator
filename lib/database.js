'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function openDatabase(file = path.join(__dirname,'..','data','game.sqlite')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  // Existing SQLite databases are upgraded in place; never delete player data.
  db.exec(fs.readFileSync(path.join(__dirname,'..','schema.sql'), 'utf8'));
  const cols=db.prepare('PRAGMA table_info(players)').all().map(c=>c.name);
  if(!cols.includes('telegram_username'))db.exec('ALTER TABLE players ADD COLUMN telegram_username TEXT');
  const columns=(table)=>new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row=>row.name));
  const playerCols=columns('players');
  for(const [name,type] of Object.entries({
    telegram_username:'TEXT',last_work_at:'INTEGER NOT NULL DEFAULT 0',
    work_day:'INTEGER NOT NULL DEFAULT 0',work_count:'INTEGER NOT NULL DEFAULT 0',
    last_free_spin_at:'INTEGER NOT NULL DEFAULT 0',free_spin_day:'INTEGER NOT NULL DEFAULT 0',
    free_spin_count:'INTEGER NOT NULL DEFAULT 0',last_casino_at:'INTEGER NOT NULL DEFAULT 0'
  }))if(!playerCols.has(name))db.exec(`ALTER TABLE players ADD COLUMN ${name} ${type}`);
  if(!columns('items').has('special'))db.exec('ALTER TABLE items ADD COLUMN special TEXT');
  if(!columns('transactions_log').has('item_handle'))db.exec('ALTER TABLE transactions_log ADD COLUMN item_handle TEXT');
  // Migration: existing owned names remain permanently reserved.
  db.exec('INSERT OR IGNORE INTO generated_handles(handle,generated_at) SELECT handle,created_at FROM items');
  return db;
}
function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
module.exports={openDatabase,transaction};
