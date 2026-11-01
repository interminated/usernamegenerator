'use strict';
const crypto = require('node:crypto');
const {transaction} = require('./database');
const {error} = require('./auth');

// Game-only rubles. Referral credit is awarded ONLY to the inviter on the first
// verified Telegram login of a brand-new Telegram account, never via local signup.
const REFERRAL_BONUS = 100000;
const REF_PREFIX = 'ref_';
const CODE_RE = /^[A-Za-z0-9_-]{16}$/;

function ensureCode(db, playerId) {
  if(!Number.isSafeInteger(playerId)||playerId<=0)throw error('Игрок не найден',404);
  const existing=db.prepare('SELECT code FROM referral_codes WHERE player_id=?').get(playerId);
  if(existing)return existing.code;
  for(let attempt=0;attempt<5;attempt++){
    const code=crypto.randomBytes(12).toString('base64url');
    const added=db.prepare('INSERT OR IGNORE INTO referral_codes(player_id,code,created_at) VALUES(?,?,?)').run(playerId,code,Math.floor(Date.now()/1000));
    if(added.changes)return code;
  }
  throw error('Не получилось создать приглашение. Попробуйте ещё раз.',503);
}

function validatedMiniAppBase(raw) {
  if(typeof raw!=='string'||!raw.trim())return null;
  try{
    const url=new URL(raw.trim());
    if(url.protocol!=='https:'||!['t.me','telegram.me'].includes(url.hostname.toLowerCase())||url.username||url.password||url.port||url.hash)return null;
    if(!/^\/[A-Za-z0-9_]{5,32}(?:\/[A-Za-z0-9_]{1,64})?\/?$/.test(url.pathname))return null;
    url.search='';
    return url;
  }catch{return null;}
}

function referralUrl(miniAppUrl,code){
  const url=validatedMiniAppBase(miniAppUrl);
  if(!url)return null;
  url.searchParams.set('startapp',REF_PREFIX+code);
  return url.toString();
}

function overview(db,playerId,miniAppUrl='') {
  return transaction(db,()=>{
    const code=ensureCode(db,playerId);
    const stats=db.prepare('SELECT COUNT(*) AS invited, COALESCE(SUM(reward),0) AS earned FROM referral_rewards WHERE inviter_id=?').get(playerId);
    const recent=db.prepare(`SELECT r.created_at,r.reward,p.id AS player_id,p.display_name,p.telegram_username
      FROM referral_rewards r JOIN players p ON p.id=r.invited_player_id
      WHERE r.inviter_id=? ORDER BY r.created_at DESC,r.invited_player_id DESC LIMIT 20`).all(playerId);
    return {code,link:referralUrl(miniAppUrl,code),bonus:REFERRAL_BONUS,invited:stats.invited,earned:stats.earned,recent};
  });
}

// Must be called inside the SAME IMMEDIATE transaction as creating the invitee.
// Trusted start_param must be extracted from cryptographically verified initData.
function awardNewTelegramUser(db,inviteeId,signedStartParam) {
  if(typeof signedStartParam!=='string'||!signedStartParam.startsWith(REF_PREFIX))return false;
  const code=signedStartParam.slice(REF_PREFIX.length);
  if(!CODE_RE.test(code))return false;
  const inviter=db.prepare('SELECT player_id FROM referral_codes WHERE code=?').get(code);
  if(!inviter || inviter.player_id===inviteeId)return false;
  if(db.prepare('SELECT 1 FROM referral_rewards WHERE invited_player_id=?').get(inviteeId))return false;
  const now=Math.floor(Date.now()/1000);
  const claimed=db.prepare('INSERT OR IGNORE INTO referral_rewards(invited_player_id,inviter_id,reward,created_at) VALUES(?,?,?,?)').run(inviteeId,inviter.player_id,REFERRAL_BONUS,now);
  if(!claimed.changes)return false;
  db.prepare('UPDATE players SET balance=balance+? WHERE id=?').run(REFERRAL_BONUS,inviter.player_id);
  db.prepare('INSERT INTO transactions_log(kind,actor_id,other_id,amount,created_at) VALUES(?,?,?,?,?)')
    .run('referral',inviter.player_id,inviteeId,REFERRAL_BONUS,now);
  return true;
}

module.exports={REFERRAL_BONUS,ensureCode,validatedMiniAppBase,referralUrl,overview,awardNewTelegramUser};
