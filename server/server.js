/* 雾港棋馆 · 联机服务器
 * - 同时托管静态页面（index.html / css / js）和 WebSocket
 * - 服务器权威：每个房间在独立的 vm 沙箱里运行与客户端完全相同的规则引擎
 * - 两种模式：快速匹配（人满或等待超时后补 AI 开局）、房间（房主手动开局）
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = +process.env.PORT || 10000;
const ROOT = path.join(__dirname, '..');
const QUEUE_WAIT = +process.env.QUEUE_WAIT || 20;      // 匹配：至少 2 人时，等待这么多秒后补 AI 开局
const HERO_PICK_SECS = +process.env.HERO_PICK_SECS || 25;
const TURN_BASE = +process.env.TURN_BASE || 40;        // 招募时间 = TURN_BASE + 回合 × 5，上限 90 秒
const MAX_ROOMS = 200;

/* ---------------- 引擎沙箱 ---------------- */
const ENGINE_SRC = ['js/data.js', 'js/engine.js'].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n') + `
;globalThis.API = {
  newGameSeats, finishRecruit, applyResults, nextTurn, viewFor, combatPayload, applyAction,
  autoResolvePending, alivePlayers, game: () => GAME, heroIds: () => Object.keys(HEROES), AI_LEVELS,
};`;
const ENGINE_SCRIPT = new vm.Script(ENGINE_SRC, { filename: 'engine-sandbox.js' });
function makeEngine() {
  const ctx = vm.createContext({ console });
  ENGINE_SCRIPT.runInContext(ctx, { timeout: 2000 });
  return ctx.API;
}

/* ---------------- 静态文件 ---------------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json' };
const ALLOWED = /^\/(index\.html|css\/[\w.-]+\.css|js\/[\w.-]+\.js|assets\/[\w-]+\.webp|favicon\.ico)$/;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ ok: true, rooms: rooms.size, online: wss.clients.size, queue: queue.length }));
  }
  const p = url.pathname === '/' ? '/index.html' : url.pathname;
  if (!ALLOWED.test(p)) { res.writeHead(404); return res.end('not found'); }
  fs.readFile(path.join(ROOT, p), (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(buf);
  });
});

/* ---------------- 会话 ---------------- */
const sessions = new Map(); // token -> session
const rooms = new Map();    // code -> room
let queue = [];             // token[]
let queueSince = 0;

function cleanName(s) {
  s = String(s || '').replace(/[\u0000-\u001f<>&"'`]/g, '').trim().slice(0, 12);
  return s || '旅人' + Math.floor(Math.random() * 900 + 100);
}
function send(sess, msg) {
  if (sess && sess.ws && sess.ws.readyState === 1) sess.ws.send(JSON.stringify(msg));
}
function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += A[crypto.randomInt(A.length)];
    if (!rooms.has(c)) return c;
  }
}

/* ---------------- 房间 ---------------- */
function createRoom(hostTok, opts = {}) {
  const room = {
    code: newCode(), host: hostTok, members: [], public: opts.public !== false, aiLevel: opts.aiLevel || 'normal',
    matchmade: !!opts.matchmade, state: 'lobby', engine: null, seatOf: new Map(), heroOpts: new Map(), heroPick: new Map(),
    phase: null, deadline: 0, ready: new Set(), acks: new Set(), results: null, timer: null, created: Date.now(), lastActive: Date.now(),
  };
  rooms.set(room.code, room);
  return room;
}
function roomInfo(room, forTok) {
  return {
    t: 'room', code: room.code, public: room.public, aiLevel: room.aiLevel, matchmade: room.matchmade, state: room.state,
    host: room.host === forTok,
    players: room.members.map(tok => { const s = sessions.get(tok); return { name: s ? s.name : '?', host: tok === room.host, you: tok === forTok, online: !!(s && s.ws) }; }),
  };
}
function broadcastRoom(room) { for (const tok of room.members) send(sessions.get(tok), roomInfo(room, tok)); }
function joinRoom(sess, room) {
  if (room.state !== 'lobby') return send(sess, { t: 'error', msg: '这个房间已经开局了' });
  if (room.members.length >= 8) return send(sess, { t: 'error', msg: '房间已满（8 人）' });
  leaveCurrent(sess);
  room.members.push(sess.token);
  sess.room = room.code;
  broadcastRoom(room);
}
function leaveCurrent(sess) {
  queueLeave(sess);
  const room = sess.room && rooms.get(sess.room);
  sess.room = null;
  if (!room) return;
  if (room.state === 'lobby') {
    room.members = room.members.filter(t => t !== sess.token);
    if (!room.members.length) { closeRoom(room); return; }
    if (room.host === sess.token) room.host = room.members[0];
    broadcastRoom(room);
  } else {
    // 对局中离开：座位交给 AI 托管
    const pid = room.seatOf.get(sess.token);
    if (room.engine && pid != null) { const p = room.engine.game().players[pid]; p.auto = true; p.online = false; }
    room.members = room.members.filter(t => t !== sess.token);
    room.seatOf.delete(sess.token);
    if (!room.members.length) { closeRoom(room); return; }
    checkAllReady(room);
    if (room.phase === 'combat') { room.acks.delete(pid); if (!room.acks.size) endCombat(room); }
  }
}
function closeRoom(room) { clearTimeout(room.timer); rooms.delete(room.code); for (const t of room.members) { const s = sessions.get(t); if (s && s.room === room.code) s.room = null; } }
function publicRooms() {
  return [...rooms.values()].filter(r => r.public && r.state === 'lobby' && !r.matchmade && r.members.length < 8)
    .slice(0, 30).map(r => ({ code: r.code, host: (sessions.get(r.host) || {}).name || '?', n: r.members.length, aiLevel: r.aiLevel }));
}

/* ---------------- 匹配 ---------------- */
function queueLeave(sess) {
  const before = queue.length;
  queue = queue.filter(t => t !== sess.token);
  if (queue.length !== before) broadcastQueue();
}
function broadcastQueue() {
  if (!queue.length) queueSince = 0;
  const left = queue.length >= 2 ? Math.max(0, Math.ceil(QUEUE_WAIT - (Date.now() - queueSince) / 1000)) : null;
  for (const t of queue) send(sessions.get(t), { t: 'queue', n: queue.length, startsIn: left });
}
setInterval(() => {
  queue = queue.filter(t => { const s = sessions.get(t); return s && s.ws; });
  if (queue.length >= 8 || (queue.length >= 2 && Date.now() - queueSince >= QUEUE_WAIT * 1000)) {
    const take = queue.splice(0, 8);
    queueSince = queue.length ? Date.now() : 0;
    const room = createRoom(take[0], { public: false, matchmade: true });
    for (const t of take) { const s = sessions.get(t); room.members.push(t); s.room = room.code; }
    startHeroPick(room);
  }
  broadcastQueue();
}, 1000);

/* ---------------- 对局流程 ---------------- */
function sessOfPid(room, pid) { for (const [tok, p] of room.seatOf) if (p === pid) return sessions.get(tok); return null; }
function startHeroPick(room) {
  room.state = 'heroPick';
  room.engine = makeEngine();
  const ids = room.engine.heroIds();
  const shuffled = ids.slice().sort(() => Math.random() - 0.5);
  const per = Math.max(2, Math.min(4, Math.floor(ids.length / room.members.length)));
  room.members.forEach((tok, i) => {
    const opts = [];
    for (let k = 0; k < per; k++) opts.push(shuffled[(i * per + k) % shuffled.length]);
    room.heroOpts.set(tok, [...new Set(opts)]);
  });
  room.deadline = Date.now() + HERO_PICK_SECS * 1000;
  for (const tok of room.members) send(sessions.get(tok), { t: 'heroPick', options: room.heroOpts.get(tok), remaining: HERO_PICK_SECS * 1000, players: room.members.length });
  room.timer = setTimeout(() => startGame(room), HERO_PICK_SECS * 1000);
}
function pickHero(sess, room, hero) {
  if (room.state !== 'heroPick') return;
  const opts = room.heroOpts.get(sess.token) || [];
  if (!opts.includes(hero)) return;
  room.heroPick.set(sess.token, hero);
  send(sess, { t: 'heroPicked', hero, waiting: room.members.length - room.heroPick.size });
  for (const tok of room.members) if (tok !== sess.token) send(sessions.get(tok), { t: 'heroPicked', waiting: room.members.length - room.heroPick.size });
  if (room.members.every(t => room.heroPick.has(t))) startGame(room);
}
function startGame(room) {
  if (room.state !== 'heroPick') return;
  clearTimeout(room.timer);
  const seatIdx = [0, 1, 2, 3, 4, 5, 6, 7].sort(() => Math.random() - 0.5);
  const seats = new Array(8).fill(null);
  room.members.forEach((tok, i) => {
    const s = sessions.get(tok);
    const hero = room.heroPick.get(tok) || room.heroOpts.get(tok)[0];
    seats[seatIdx[i]] = { name: s ? s.name : '旅人', hero };
    room.seatOf.set(tok, seatIdx[i]);
  });
  room.engine.newGameSeats(seats, room.aiLevel);
  const g = room.engine.game();
  for (const [tok, pid] of room.seatOf) { const s = sessions.get(tok); g.players[pid].online = !!(s && s.ws); if (!g.players[pid].online) g.players[pid].auto = true; }
  room.state = 'playing';
  beginRecruit(room);
}
function turnSecs(room) { return Math.min(90, TURN_BASE + room.engine.game().turn * 5); }
function sendState(room, tok, extra = {}) {
  const pid = room.seatOf.get(tok);
  if (pid == null) return;
  send(sessions.get(tok), Object.assign({
    t: 'state', g: room.engine.viewFor(pid), meId: pid, phase: room.phase,
    remaining: Math.max(0, room.deadline - Date.now()), ready: [...room.ready], code: room.code,
  }, extra));
}
function beginRecruit(room, extra) {
  room.phase = 'recruit';
  room.ready.clear();
  const secs = turnSecs(room);
  room.deadline = Date.now() + secs * 1000;
  clearTimeout(room.timer);
  room.timer = setTimeout(() => resolveTurn(room), secs * 1000);
  for (const tok of room.members) sendState(room, tok, extra);
  checkAllReady(room);
}
function humanSeats(room) {
  const g = room.engine.game();
  return [...room.seatOf.values()].filter(pid => g.players[pid].alive);
}
function readyCounts(room) {
  const g = room.engine.game();
  const seats = humanSeats(room);
  const need = seats.filter(pid => !g.players[pid].auto);
  return { n: need.filter(pid => room.ready.has(pid)).length, total: need.length, need };
}
function checkAllReady(room) {
  if (room.state !== 'playing' || room.phase !== 'recruit') return;
  const { n, total } = readyCounts(room);
  for (const tok of room.members) send(sessions.get(tok), { t: 'ready', n, total, ready: [...room.ready] });
  if (n >= total) resolveTurn(room);
}
function resolveTurn(room) {
  if (room.phase !== 'recruit') return;
  clearTimeout(room.timer);
  room.phase = 'combat';
  const E = room.engine, g = E.game();
  room.hpBefore = g.players.map(p => p.hp + p.armor);
  const results = E.finishRecruit();
  room.results = results;
  room.acks = new Set();
  let longest = 0;
  for (const r of results) {
    for (const side of [0, 1]) {
      const pl = side === 0 ? r.a : r.b;
      if (!pl.isHuman || pl.ghost) continue;
      const s = sessOfPid(room, pl.id);
      const payload = E.combatPayload(r, side);
      longest = Math.max(longest, payload.frames.length);
      if (s && s.ws && room.members.includes(s.token)) {
        room.acks.add(pl.id);
        send(s, { t: 'combat', p: payload, g: E.viewFor(pl.id) });
      }
    }
  }
  const maxWait = Math.min(75, 6 + longest * 0.75) * 1000;
  room.timer = setTimeout(() => endCombat(room), room.acks.size ? maxWait : 300);
}
function endCombat(room) {
  if (room.phase !== 'combat') return;
  clearTimeout(room.timer);
  room.phase = 'between';
  const E = room.engine, g = E.game();
  const died = E.applyResults(room.results);
  room.results = null;
  const deltas = {};
  g.players.forEach(p => { const d = room.hpBefore[p.id] - (p.hp + p.armor); if (d > 0) deltas[p.id] = d; });
  for (const p of died) {
    if (!p.isHuman) continue;
    const s = sessOfPid(room, p.id);
    if (s) send(s, { t: 'over', place: p.place, final: g.over, g: E.viewFor(p.id), deltas });
  }
  if (g.over) {
    room.state = 'over';
    const champ = g.players.find(p => p.place === 1);
    for (const tok of room.members) {
      const pid = room.seatOf.get(tok);
      const me = g.players[pid];
      if (me && me.alive || (champ && champ.id === pid)) send(sessions.get(tok), { t: 'over', place: 1, final: true, g: E.viewFor(pid), deltas });
      else send(sessions.get(tok), { t: 'final', champion: champ ? champ.name : '' });
    }
    setTimeout(() => closeRoom(room), 60000);
    return;
  }
  E.nextTurn();
  beginRecruit(room, { deltas });
}

/* ---------------- WebSocket ---------------- */
const wss = new WebSocketServer({ server, maxPayload: 8 * 1024 });
wss.on('connection', ws => {
  let sess = null;
  let bucket = 0, bucketAt = Date.now();
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', raw => {
    const now = Date.now();
    if (now - bucketAt > 1000) { bucket = 0; bucketAt = now; }
    if (++bucket > 40) return;
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    if (m.t === 'hello') {
      const tok = typeof m.token === 'string' && /^[a-f0-9]{32}$/.test(m.token) ? m.token : crypto.randomBytes(16).toString('hex');
      sess = sessions.get(tok);
      if (sess && sess.ws && sess.ws !== ws) { try { sess.ws.close(4000, 'replaced'); } catch (e) { /* 忽略 */ } }
      if (!sess) { sess = { token: tok, name: cleanName(m.name), ws, room: null }; sessions.set(tok, sess); }
      sess.ws = ws; sess.lastSeen = now;
      if (m.name) sess.name = cleanName(m.name);
      send(sess, { t: 'hello', token: tok, name: sess.name });
      resume(sess);
      return;
    }
    if (!sess) return;
    sess.lastSeen = now;
    handle(sess, m);
  });
  ws.on('close', () => {
    if (!sess || sess.ws !== ws) return;
    sess.ws = null;
    sess.lastSeen = Date.now();
    queueLeave(sess);
    const room = sess.room && rooms.get(sess.room);
    if (!room) return;
    if (room.state === 'lobby') { leaveCurrent(sess); return; }
    const pid = room.seatOf.get(sess.token);
    if (room.engine && pid != null && room.state === 'playing') {
      const p = room.engine.game().players[pid];
      p.auto = true; p.online = false;
      checkAllReady(room);
      if (room.phase === 'combat') { room.acks.delete(pid); if (!room.acks.size) endCombat(room); }
    }
    broadcastRoom(room);
  });
});
function resume(sess) {
  const room = sess.room && rooms.get(sess.room);
  if (!room) return send(sess, { t: 'lobby' });
  if (room.state === 'lobby') return broadcastRoom(room);
  if (room.state === 'heroPick') {
    const left = Math.max(0, room.deadline - Date.now());
    return send(sess, { t: 'heroPick', options: room.heroOpts.get(sess.token), remaining: left, picked: room.heroPick.get(sess.token) || null, players: room.members.length });
  }
  if (room.state === 'playing') {
    const pid = room.seatOf.get(sess.token);
    if (pid == null) return send(sess, { t: 'lobby' });
    const p = room.engine.game().players[pid];
    if (!p.alive) return send(sess, { t: 'over', place: p.place, final: false, g: room.engine.viewFor(pid) });
    p.auto = false; p.online = true;
    sendState(room, sess.token, room.phase === 'recruit' ? {} : { waiting: true });
    if (room.phase === 'recruit') checkAllReady(room);
    return;
  }
  send(sess, { t: 'lobby' });
}
function handle(sess, m) {
  const room = sess.room && rooms.get(sess.room);
  if (room) room.lastActive = Date.now();
  switch (m.t) {
    case 'setName': sess.name = cleanName(m.name); if (room && room.state === 'lobby') broadcastRoom(room); break;
    case 'listRooms': send(sess, { t: 'rooms', rooms: publicRooms(), queue: queue.length, online: wss.clients.size }); break;
    case 'queueJoin':
      leaveCurrent(sess);
      if (!queue.includes(sess.token)) { queue.push(sess.token); if (queue.length === 2 || !queueSince) queueSince = Date.now(); }
      broadcastQueue();
      break;
    case 'queueLeave': queueLeave(sess); send(sess, { t: 'lobby' }); break;
    case 'roomCreate': {
      if (rooms.size >= MAX_ROOMS) return send(sess, { t: 'error', msg: '服务器房间已满，请稍后再试' });
      leaveCurrent(sess);
      const r = createRoom(sess.token, { public: m.public !== false, aiLevel: ['easy', 'normal', 'hard'].includes(m.aiLevel) ? m.aiLevel : 'normal' });
      joinRoom(sess, r);
      break;
    }
    case 'roomJoin': {
      const r = rooms.get(String(m.code || '').toUpperCase().trim());
      if (!r || r.matchmade) return send(sess, { t: 'error', msg: '找不到这个房间号' });
      if (r.members.includes(sess.token)) return broadcastRoom(r);
      joinRoom(sess, r);
      break;
    }
    case 'roomSet':
      if (!room || room.state !== 'lobby' || room.host !== sess.token) return;
      if (['easy', 'normal', 'hard'].includes(m.aiLevel)) room.aiLevel = m.aiLevel;
      if (typeof m.public === 'boolean') room.public = m.public;
      broadcastRoom(room);
      break;
    case 'roomStart':
      if (!room || room.state !== 'lobby' || room.host !== sess.token) return;
      startHeroPick(room);
      break;
    case 'leave': leaveCurrent(sess); send(sess, { t: 'lobby' }); break;
    case 'pickHero': if (room) pickHero(sess, room, String(m.hero)); break;
    case 'act': {
      if (!room || room.state !== 'playing' || room.phase !== 'recruit') return send(sess, { t: 'reply', rid: m.rid, ok: false, msg: '现在不能操作' });
      const pid = room.seatOf.get(sess.token);
      if (pid == null) return;
      const res = room.engine.applyAction(pid, String(m.name), Array.isArray(m.args) ? m.args : []);
      const out = { t: 'reply', rid: m.rid, ok: !!res.ok, msg: res.msg || '', tripled: !!res.tripled, g: room.engine.viewFor(pid) };
      if (room.ready.has(pid) && res.ok) { room.ready.delete(pid); checkAllReady(room); }
      send(sess, out);
      break;
    }
    case 'endTurn': {
      if (!room || room.state !== 'playing' || room.phase !== 'recruit') return;
      const pid = room.seatOf.get(sess.token);
      if (pid == null) return;
      room.ready.add(pid);
      checkAllReady(room);
      break;
    }
    case 'combatDone': {
      if (!room || room.phase !== 'combat') return;
      const pid = room.seatOf.get(sess.token);
      room.acks.delete(pid);
      if (!room.acks.size) endCombat(room);
      break;
    }
    default: break;
  }
}

/* ---------------- 心跳与清理 ---------------- */
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) { /* 忽略 */ }
  }
  const now = Date.now();
  for (const room of rooms.values()) {
    const anyOnline = room.members.some(t => { const s = sessions.get(t); return s && s.ws; });
    if (!anyOnline && now - room.lastActive > 5 * 60000) closeRoom(room);
  }
  for (const [tok, s] of sessions) if (!s.ws && !s.room && now - (s.lastSeen || 0) > 30 * 60000) sessions.delete(tok);
}, 30000);

server.listen(PORT, () => console.log(`雾港棋馆服务器已启动：http://localhost:${PORT}`));
