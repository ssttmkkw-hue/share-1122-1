/* 雾港棋馆 · 规则引擎（招募、奖池、三连、战斗模拟、AI） */
'use strict';

const RULES = {
  startHp: 30,
  boardMax: 7,
  handMax: 10,
  buyCost: 3,
  sellGain: 1,
  refreshCost: 1,
  maxIncome: 10,
  poolCopies: { 1: 16, 2: 15, 3: 13, 4: 11, 5: 9, 6: 7 },
  shopSize: [0, 3, 4, 4, 5, 5, 6],
  upgradeBase: [0, 0, 5, 7, 8, 9, 10], // 升到该等级的标价；之后每回合开始时-1
  lobbyTribes: 5,
};

let UID = 1;
const rnd = a => (a && a.length ? a[Math.floor(Math.random() * a.length)] : null);
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function sample(a, n) { return shuffle([...a]).slice(0, n); }
const isMinion = x => x && !x.spell && !x.reward;

/* ---------------- 随从实例 ---------------- */
function newMinion(id, golden = false) {
  const d = CARDS[id];
  const k = golden ? 2 : 1;
  const m = { uid: UID++, id, golden, atk: d.atk * k, hp: d.hp * k, kw: Object.assign({}, d.kw), dr: [], avc: 0 };
  delete m.kw.magnetic;
  if (d.deathrattle) m.dr.push({ id, mult: k, base: true });
  return m;
}
function auraBonus(board, m) {
  let b = 0;
  for (const o of board) {
    if (o === m || o.hp <= 0 || o.dead) continue;
    const a = CARDS[o.id].aura;
    if (a && isT(m, a.tribe)) b += a.atk * (o.golden ? 2 : 1);
  }
  return b;
}
function mergeGolden(copies) {
  const id = copies[0].id, d = CARDS[id];
  const g = newMinion(id, true);
  for (const c of copies) {
    g.atk += c.atk - d.atk; g.hp += c.hp - d.hp;
    for (const k in c.kw) if (c.kw[k]) g.kw[k] = 1;
    for (const e of c.dr) if (!e.base) g.dr.push(Object.assign({}, e));
  }
  return g;
}
function makeGoldenInPlace(m) {
  const d = CARDS[m.id];
  if (m.golden) return;
  m.golden = true; m.atk += d.atk; m.hp += d.hp;
  m.dr.forEach(e => { if (e.base) e.mult = 2; });
}

/* ---------------- 游戏 / 玩家 ---------------- */
let GAME = null;

function newPlayer(id, heroId, isHuman, name) {
  const h = HEROES[heroId];
  return {
    id, hero: heroId, isHuman, name: name || h.name,
    hp: RULES.startHp, armor: h.armor, tier: 1, gold: 0, maxGold: 0,
    upgradeCost: RULES.upgradeBase[2] + 1, board: [], hand: [], shop: [], shopSpell: null,
    frozen: false, alive: true, place: 0, lastOpp: null, powerUsed: false, freeRefreshes: 0,
    nextGold: 0, shopBonus: { atk: 0, hp: 0 }, lastBoard: [], discoverQ: [], history: [], trinkets: [], trinketOffer: null,
    ai: isHuman ? null : { levelBias: Math.random() * 2 - 1, greed: Math.random() },
  };
}

function heroChoices(n = 4) { return sample(Object.keys(HEROES), n); }

function newGame(humanHero) {
  UID = 1;
  const tribes = sample(TRIBE_KEYS, RULES.lobbyTribes);
  const g = { turn: 0, players: [], pool: {}, tribes, deadOrder: [], lastDead: null, over: false, log: [] };
  GAME = g;
  for (const id in CARDS) {
    const d = CARDS[id];
    if (!d.token && poolEligible(d)) g.pool[id] = RULES.poolCopies[d.tier];
  }
  const others = shuffle(Object.keys(HEROES).filter(h => h !== humanHero));
  g.players.push(newPlayer(0, humanHero, true, '你'));
  for (let i = 1; i < 8; i++) g.players.push(newPlayer(i, others[i - 1], false));
  startTurnAll();
  return g;
}
function poolEligible(d) {
  return !d.token && (d.tribes.length === 0 || d.tribes.some(t => t === 'all' || (GAME && GAME.tribes.includes(t))));
}
function alivePlayers() { return GAME.players.filter(p => p.alive); }

/* ---------------- 奖池 ---------------- */
function drawFromPool(maxTier, pred, exactTier) {
  const ids = [];
  let total = 0;
  for (const id in GAME.pool) {
    const c = GAME.pool[id], d = CARDS[id];
    if (c <= 0) continue;
    if (exactTier ? d.tier !== exactTier : d.tier > maxTier) continue;
    if (pred && !pred(d)) continue;
    ids.push([id, c]); total += c;
  }
  if (!total) return null;
  let r = Math.random() * total;
  for (const [id, c] of ids) { if ((r -= c) < 0) { GAME.pool[id]--; return id; } }
  const id = ids[ids.length - 1][0]; GAME.pool[id]--; return id;
}
function returnToPool(m) {
  if (!m || !isMinion(m) || CARDS[m.id].token) return;
  if (GAME.pool[m.id] != null) GAME.pool[m.id] += m.golden ? 3 : 1;
}
function shopMinion(p, id) {
  const m = newMinion(id);
  m.atk += p.shopBonus.atk; m.hp += p.shopBonus.hp;
  return m;
}
function trinketsOf(p) { return (p.trinkets || []).map(id => TRINKETS[id]); }
function trinketSum(p, key) { return trinketsOf(p).reduce((s, t) => s + (t[key] || 0), 0); }
function shopSize(p) { return RULES.shopSize[p.tier] + (HEROES[p.hero].power.extraSlot || 0) + trinketSum(p, 'extraSlot'); }
function rollShop(p) {
  p.shop.forEach(returnToPool);
  p.shop = [];
  const n = shopSize(p);
  for (let i = 0; i < n; i++) { const id = drawFromPool(p.tier); if (!id) break; p.shop.push(shopMinion(p, id)); }
  const spells = Object.values(SPELLS).filter(s => s.tier <= p.tier);
  p.shopSpell = rnd(spells).id;
}

/* ---------------- 招募上下文 ---------------- */
function rctx(p, self, mult = 1) {
  const ctx = {
    phase: 'recruit', p, self, mult, board: p.board,
    get selfAtk() { return self ? self.atk : 0; },
    rand: rnd, sample,
    buff(m, a, h) { if (!m) return; m.atk = Math.max(0, m.atk + a); m.hp = Math.max(1, m.hp + h); },
    giveKw(m, k) { if (m) m.kw[k] = 1; },
    friends(f = () => true) { return p.board.filter(m => m !== self && f(m)); },
    all(f = () => true) { return p.board.filter(f); },
    enemies() { return []; }, damage() {},
    summon(id, pos, golden) {
      const at = pos != null ? pos : (self && p.board.includes(self) ? p.board.indexOf(self) + 1 : p.board.length);
      return recruitSummon(p, id, at, golden);
    },
    summonRandom(pred) { const id = rnd(Object.values(CARDS).filter(d => poolEligible(d) && pred(d)).map(d => d.id)); return id ? ctx.summon(id) : null; },
    gainGold(n) { p.gold += n; },
    nextGold(n) { p.nextGold += n; },
    damageHero(n) { heroDamage(p, n, true); trigBoard(p, 'onHeroDamaged', null, n); },
    addReward() { addToHand(p, { uid: UID++, reward: true, tier: Math.min(6, p.tier + 1) }); },
    buffShop(a, h) { p.shop.forEach(m => { m.atk += a; m.hp += h; }); },
    shopBonus(a, h) { p.shopBonus.atk += a; p.shopBonus.hp += h; ctx.buffShop(a, h); },
    addToShop(pred) { const id = drawFromPool(p.tier, d => pred({ id: d.id })); if (id) p.shop.push(shopMinion(p, id)); },
    devourShop(mode, frac = 1) {
      if (!p.shop.length || !self) return false;
      const i = mode === 'best' ? p.shop.reduce((bi, m, j, a) => (m.atk + m.hp > a[bi].atk + a[bi].hp ? j : bi), 0)
        : Math.floor(Math.random() * p.shop.length);
      const v = p.shop.splice(i, 1)[0];
      if (frac) ctx.buff(self, Math.ceil(v.atk * frac) * mult, Math.ceil(v.hp * frac) * mult);
      returnToPool(v);
      return true;
    },
    devourFriend(t) {
      const i = p.board.indexOf(t); if (i < 0) return;
      p.board.splice(i, 1);
      ctx.buff(self, t.atk * mult, t.hp * mult);
      returnToPool(t);
    },
    addHand(id) { return addToHand(p, newMinion(id)); },
    addRandomToHand(pred) { const id = drawFromPool(6, pred); if (id) addToHand(p, newMinion(id)); },
    discover(tier, exact) { queueDiscover(p, tier); },
    takeShop(i) { const m = p.shop.splice(i, 1)[0]; if (m) addToHand(p, m); },
    makeGolden(t) { makeGoldenInPlace(t); addToHand(p, { uid: UID++, reward: true, tier: Math.min(6, p.tier + 1) }); },
    permBuffAll(pred, a, h) { p.board.filter(pred).forEach(m => ctx.buff(m, a, h)); },
  };
  return ctx;
}
function trigBoard(p, hook, exclude, ...args) {
  for (const m of [...p.board]) {
    if (m === exclude || !p.board.includes(m)) continue;
    const d = CARDS[m.id];
    if (d[hook]) d[hook](rctx(p, m, m.golden ? 2 : 1), ...args);
  }
}
function recruitSummon(p, id, pos, golden) {
  if (p.board.length >= RULES.boardMax) return null;
  const m = newMinion(id, golden);
  p.board.splice(Math.max(0, Math.min(pos, p.board.length)), 0, m);
  trigBoard(p, 'onSummon', m, m);
  return m;
}
function heroDamage(p, n, nonLethal) {
  if (p.ghost) return;
  const a = Math.min(p.armor, n); p.armor -= a; n -= a;
  p.hp -= n;
  if (nonLethal && p.hp < 1) p.hp = 1;
}
function addToHand(p, item) {
  if (p.hand.length >= RULES.handMax) return false;
  p.hand.push(item);
  if (isMinion(item)) checkTriple(p, item.id);
  return true;
}
function checkTriple(p, id) {
  if (CARDS[id].token) return false;
  const copies = [...p.hand, ...p.board].filter(x => isMinion(x) && x.id === id && !x.golden);
  if (copies.length < 3) return false;
  const use = copies.slice(0, 3);
  let boardPos = -1;
  for (const c of use) {
    let i = p.hand.indexOf(c);
    if (i >= 0) p.hand.splice(i, 1);
    else { i = p.board.indexOf(c); if (boardPos < 0) boardPos = i; p.board.splice(i, 1); }
  }
  const g = mergeGolden(use);
  if (p.hand.length < RULES.handMax) p.hand.push(g);
  else p.board.splice(Math.max(0, boardPos), 0, g);
  p.lastTriple = g.uid;
  return true;
}
function queueDiscover(p, tier) {
  const opts = [];
  const tried = new Set();
  for (let k = 0; k < 40 && opts.length < 3; k++) {
    const ids = Object.keys(GAME.pool).filter(id => GAME.pool[id] > 0 && CARDS[id].tier === tier && !tried.has(id));
    const id = rnd(ids); if (!id) break;
    tried.add(id); opts.push(id);
  }
  if (!opts.length) return;
  p.discoverQ.push({ tier, options: opts });
  if (!p.isHuman) aiResolveDiscover(p);
}
function resolveDiscover(p, idx) {
  const q = p.discoverQ.shift(); if (!q) return;
  const id = q.options[idx] || q.options[0];
  if (GAME.pool[id] > 0) GAME.pool[id]--;
  if (!addToHand(p, newMinion(id))) GAME.pool[id]++;
}
function echoCount(p) { return trinketSum(p, 'echo') + p.board.reduce((s, m) => s + (CARDS[m.id].echo ? (m.golden ? 2 : 1) : 0), 0); }

/* ---------------- 招募动作 ---------------- */
const ok = (extra) => Object.assign({ ok: true }, extra);
const fail = msg => ({ ok: false, msg });

function actBuy(p, uid) {
  const i = p.shop.findIndex(m => m.uid === uid);
  if (i < 0) return fail('该随从已不在酒馆中');
  if (p.gold < RULES.buyCost) return fail('铸币不足');
  if (p.hand.length >= RULES.handMax) return fail('手牌已满');
  const m = p.shop.splice(i, 1)[0];
  p.gold -= RULES.buyCost;
  p.hand.push(m);
  trigBoard(p, 'onBuy', null, m);
  const tripled = checkTriple(p, m.id);
  return ok({ tripled });
}
function actBuySpell(p) {
  const s = SPELLS[p.shopSpell];
  if (!s) return fail('没有法术');
  if (p.gold < s.cost) return fail('铸币不足');
  if (p.hand.length >= RULES.handMax) return fail('手牌已满');
  p.gold -= s.cost;
  p.hand.push({ uid: UID++, spell: s.id });
  p.shopSpell = null;
  return ok();
}
function actSell(p, uid) {
  const i = p.board.findIndex(m => m.uid === uid);
  if (i < 0) return fail('找不到该随从');
  const m = p.board.splice(i, 1)[0];
  p.gold += RULES.sellGain;
  const d = CARDS[m.id];
  if (d.onSell) d.onSell(rctx(p, m, m.golden ? 2 : 1));
  trigBoard(p, 'onSellFriendly', null, m);
  returnToPool(m);
  return ok();
}
function actMove(p, uid, to) {
  const i = p.board.findIndex(m => m.uid === uid);
  if (i < 0) return fail('');
  const [m] = p.board.splice(i, 1);
  p.board.splice(Math.max(0, Math.min(to, p.board.length)), 0, m);
  return ok();
}
function targetFilterOf(item) {
  if (item.spell) return SPELLS[item.spell].target || null;
  if (item.reward) return null;
  return CARDS[item.id].target || null;
}
/** 该手牌是否需要选择目标；返回可选目标列表（无需时为 null） */
function playTargets(p, item) {
  if (isMinion(item)) {
    const d = CARDS[item.id];
    const mags = d.kw.magnetic ? p.board.filter(m => isT(m, 'mech')) : [];
    const f = d.target;
    const bt = f && d.battlecry ? p.board.filter(f) : [];
    if (!bt.length && !mags.length) return null;
    return { battlecry: bt, magnetic: mags, optional: !!d.targetOptional || mags.length > 0 && !bt.length };
  }
  if (item.spell) {
    const f = SPELLS[item.spell].target;
    if (!f) return null;
    return { battlecry: p.board.filter(f), magnetic: [], optional: false, spell: true };
  }
  return null;
}
function actPlay(p, uid, pos, targetUid, opts = {}) {
  const hi = p.hand.findIndex(x => x.uid === uid);
  if (hi < 0) return fail('找不到该手牌');
  const item = p.hand[hi];
  const target = targetUid != null ? p.board.find(m => m.uid === targetUid) : null;

  if (item.reward) {
    p.hand.splice(hi, 1);
    queueDiscover(p, item.tier);
    return ok({ discover: true });
  }
  if (item.spell) {
    const s = SPELLS[item.spell];
    if (s.target) {
      if (!p.board.some(s.target)) return fail('没有可选的目标');
      if (!target || !s.target(target)) return fail('请选择一个目标');
    }
    p.hand.splice(hi, 1);
    s.cast(rctx(p, null, 1), target);
    trigBoard(p, 'onSpell', null, s);
    return ok({ spell: true });
  }
  const d = CARDS[item.id];
  // 磁力吸附
  if (d.kw.magnetic && opts.magnetize && target && isT(target, 'mech')) {
    p.hand.splice(hi, 1);
    magnetize(target, item);
    trigBoard(p, 'onPlay', target, item);
    if (item.golden) addToHand(p, { uid: UID++, reward: true, tier: Math.min(6, p.tier + 1) });
    return ok({ magnetized: true, host: target.uid });
  }
  if (p.board.length >= RULES.boardMax) return fail('战场已满（最多7个随从）');
  let bt = null;
  if (d.battlecry && d.target) {
    const valid = p.board.filter(d.target);
    if (target && valid.includes(target)) bt = target;
    else if (valid.length && !d.targetOptional) return fail('请为战吼选择一个目标');
  }
  p.hand.splice(hi, 1);
  p.board.splice(Math.max(0, Math.min(pos == null ? p.board.length : pos, p.board.length)), 0, item);
  if (d.battlecry) {
    const reps = 1 + echoCount(p);
    const mult = item.golden ? 2 : 1;
    for (let r = 0; r < reps; r++) {
      if (d.target && bt && !p.board.includes(bt)) break;
      d.battlecry(rctx(p, item, mult), bt);
    }
  }
  trigBoard(p, 'onPlay', item, item);
  trigBoard(p, 'onSummon', item, item);
  if (item.golden) addToHand(p, { uid: UID++, reward: true, tier: Math.min(6, p.tier + 1) });
  return ok();
}
function magnetize(host, part) {
  host.atk += part.atk; host.hp += part.hp;
  for (const k in part.kw) if (part.kw[k] && k !== 'magnetic') host.kw[k] = 1;
  for (const e of part.dr) host.dr.push(Object.assign({}, e, { base: false }));
  host.mags = (host.mags || 0) + 1;
}
function refreshCost(p) { return p.freeRefreshes > 0 ? 0 : RULES.refreshCost; }
function actRefresh(p) {
  const c = refreshCost(p);
  if (p.gold < c) return fail('铸币不足');
  p.gold -= c;
  if (p.freeRefreshes > 0) p.freeRefreshes--;
  p.frozen = false;
  rollShop(p);
  trigBoard(p, 'onRefresh', null);
  return ok();
}
function actFreeze(p) { p.frozen = !p.frozen; return ok(); }
function actUpgrade(p) {
  if (p.tier >= 6) return fail('已是最高等级');
  if (p.gold < p.upgradeCost) return fail('铸币不足');
  p.gold -= p.upgradeCost;
  p.tier++;
  p.upgradeCost = p.tier < 6 ? RULES.upgradeBase[p.tier + 1] : 0;
  const pw = HEROES[p.hero].power;
  if (pw.onUpgrade) pw.onUpgrade(rctx(p, null, 1));
  return ok();
}
function powerState(p) {
  const pw = HEROES[p.hero].power;
  if (pw.passive) return { passive: true };
  const can = !p.powerUsed && p.gold >= pw.cost && (!pw.canUse || pw.canUse(p)) && (!pw.target || p.board.some(pw.target));
  return { passive: false, can, needsTarget: !!pw.target };
}
function actPower(p, targetUid) {
  const pw = HEROES[p.hero].power;
  if (pw.passive) return fail('这是被动技能');
  if (p.powerUsed) return fail('本回合已使用过英雄技能');
  if (p.gold < pw.cost) return fail('铸币不足');
  if (pw.canUse && !pw.canUse(p)) return fail('现在无法使用');
  let t = null;
  if (pw.target) {
    t = p.board.find(m => m.uid === targetUid);
    if (!t || !pw.target(t)) return fail('请选择一个友方随从');
  }
  p.gold -= pw.cost;
  p.powerUsed = true;
  pw.use(rctx(p, null, 1), t);
  return ok();
}
function startTurn(p) {
  const g = GAME;
  p.maxGold = Math.min(RULES.maxIncome, 2 + g.turn);
  p.gold = p.maxGold + p.nextGold;
  p.nextGold = 0;
  if (p.tier < 6) p.upgradeCost = Math.max(0, p.upgradeCost - 1);
  p.powerUsed = false;
  p.freeRefreshes = (HEROES[p.hero].power.freeRefresh || 0) + trinketSum(p, 'freeRefresh');
  if (p.frozen) p.frozen = false; else rollShop(p);
  if (!p.shopSpell && p.shop.length === 0) rollShop(p);
  trigBoard(p, 'startTurn', null);
  for (const t of trinketsOf(p)) if (t.startTurn) t.startTurn(rctx(p, null, 1));
  if (g.turn === 6 || g.turn === 9) offerTrinkets(p, g.turn === 6 ? 'lesser' : 'greater');
}
function offerTrinkets(p, grade) {
  const all = Object.values(TRINKETS).filter(t => t.grade === grade && (!t.tribe || GAME.tribes.includes(t.tribe)));
  const tribal = sample(all.filter(t => t.tribe), 2);
  let opts = sample([...sample(all.filter(t => !t.tribe), 4), ...tribal], 4);
  if (!opts.some(t => t.cost <= p.gold)) opts[3] = all.reduce((a, b) => (b.cost < a.cost ? b : a));
  p.trinketOffer = opts.map(t => t.id);
  if (!p.isHuman) aiPickTrinket(p);
}
function actPickTrinket(p, id) {
  if (!p.trinketOffer || !p.trinketOffer.includes(id)) return fail('无法选择该饰品');
  const t = TRINKETS[id];
  if (p.gold < t.cost) return fail('铸币不足');
  p.gold -= t.cost;
  p.trinkets.push(id);
  p.trinketOffer = null;
  if (t.onGain) t.onGain(rctx(p, null, 1));
  if (t.freeRefresh) p.freeRefreshes += t.freeRefresh;
  if (t.extraSlot && !p.frozen) { const id2 = drawFromPool(p.tier); if (id2) p.shop.push(shopMinion(p, id2)); }
  return ok();
}
function aiPickTrinket(p) {
  const main = mainTribe(p);
  const score = t => (t.cost > p.gold ? -99 : 0) + (t.tribe ? (t.tribe === main ? 8 : -4) : 0) + (t.sot ? 3 : 0) + (t.echo || t.soul ? 2 : 0) + Math.random() * 4 - t.cost * 0.5;
  const best = p.trinketOffer.map(id => TRINKETS[id]).reduce((a, b) => (score(b) > score(a) ? b : a));
  actPickTrinket(p, best.id);
}
function endTurn(p) {
  trigBoard(p, 'endTurn', null);
  const pw = HEROES[p.hero].power;
  if (pw.endTurn) pw.endTurn(rctx(p, null, 1));
  for (const t of trinketsOf(p)) if (t.endTurn) t.endTurn(rctx(p, null, 1));
}
function startTurnAll() {
  GAME.turn++;
  for (const p of alivePlayers()) startTurn(p);
  GAME.nextPairs = makePairs().map(([a, b]) => [a.id, b.id]);
}
/** 本回合与该玩家配对的对手（id；-1 为幽灵） */
function nextOpponentOf(pid) {
  const pr = (GAME.nextPairs || []).find(x => x.includes(pid));
  return pr ? (pr[0] === pid ? pr[1] : pr[0]) : null;
}

/* ---------------- 战斗 ---------------- */
class Combat {
  constructor(pa, pb, record) {
    this.record = record;
    this.frames = [];
    this.sides = [pa, pb].map((p, i) => ({
      p, i, ptr: 0, perm: [],
      board: p.board.map(m => Object.assign({}, m, { kw: Object.assign({}, m.kw), dr: m.dr.map(e => Object.assign({}, e)), src: m.uid, avc: 0, side: i, dead: false })),
    }));
  }
  alive(m) { return m && m.hp > 0 && !m.dead; }
  atkOf(m) { return m.atk + auraBonus(this.sides[m.side].board, m); }
  snap() {
    return this.sides.map(S => S.board.map(m => ({
      uid: m.uid, src: m.src, id: m.id, atk: this.atkOf(m), hp: m.hp, golden: m.golden, kw: Object.assign({}, m.kw),
      dr: m.dr.length > 0, dead: !this.alive(m),
    })));
  }
  frame(type, extra) { if (this.record) this.frames.push(Object.assign({ type, s: this.snap() }, extra)); }
  ctx(si, self, mult, ex = {}) {
    const sim = this, S = this.sides[si], O = this.sides[1 - si];
    const alive = m => sim.alive(m);
    const ctx = {
      phase: 'combat', p: S.p, self, mult, board: S.board,
      get selfAtk() { return ex.atk != null ? ex.atk : sim.atkOf(self); },
      rand: rnd, sample,
      buff(m, a, h) { if (!m || !alive(m)) return; m.atk = Math.max(0, m.atk + a); m.hp += h; },
      giveKw(m, k) { if (m) m.kw[k] = 1; },
      friends(f = () => true) { return S.board.filter(m => m !== self && alive(m) && f(m)); },
      all(f = () => true) { return S.board.filter(m => alive(m) && f(m)); },
      enemies(f = () => true) { return O.board.filter(m => alive(m) && f(m)); },
      damage(t, n) { sim.damage(t, n, null); },
      summon(id, pos, golden) {
        let at = pos;
        if (at == null) {
          if (ex.pos != null) at = ex.pos;
          else if (self && S.board.includes(self)) at = S.board.indexOf(self) + 1;
          else at = S.board.length;
        }
        const m = sim.summon(si, id, at, golden);
        if (m && ex.pos != null && pos == null) ex.pos++;
        return m;
      },
      summonRandom(pred) { const id = rnd(Object.values(CARDS).filter(d => poolEligible(d) && pred(d)).map(d => d.id)); return id ? ctx.summon(id) : null; },
      permBuffAll(pred, a, h) { ctx.all(pred).forEach(m => ctx.buff(m, a, h)); S.perm.push({ pred, a, h }); },
      gainGold() {}, nextGold() {}, damageHero() {}, buffShop() {}, shopBonus() {}, addToShop() {},
      devourShop() { return false; }, devourFriend() {}, addHand() {}, addRandomToHand() {}, discover() {},
    };
    return ctx;
  }
  hook(m, name, ...args) {
    const d = CARDS[m.id];
    if (d[name]) d[name](this.ctx(m.side, m, m.golden ? 2 : 1), ...args);
  }
  insert(si, i, m) {
    const S = this.sides[si];
    if (S.board.length >= RULES.boardMax) return false;
    i = Math.max(0, Math.min(i, S.board.length));
    S.board.splice(i, 0, m);
    if (i < S.ptr) S.ptr++;
    return true;
  }
  remove(si, i) {
    const S = this.sides[si];
    S.board.splice(i, 1);
    if (i < S.ptr) S.ptr--;
  }
  summon(si, id, pos, golden) {
    const m = newMinion(id, golden);
    Object.assign(m, { side: si, src: null, dead: false });
    if (!this.insert(si, pos, m)) return null;
    for (const o of [...this.sides[si].board]) if (o !== m && this.alive(o)) this.hook(o, 'onSummon', m);
    return m;
  }
  damage(t, n, source) {
    if (n <= 0 || !this.alive(t)) return 0;
    if (t.kw.ds) {
      t.kw.ds = 0;
      for (const o of [...this.sides[t.side].board]) if (this.alive(o) || o === t) this.hook(o, 'onShieldLost', t);
      return 0;
    }
    t.hp -= n;
    if (source && (source.kw.poison || source.kw.venom)) { t.dead = true; if (source.kw.venom && !source.kw.poison) source.kw.venom = 0; }
    if (this.alive(t)) this.hook(t, 'onDamaged', n);
    return n;
  }
  findAttacker(S) {
    const n = S.board.length;
    if (!n) return null;
    const start = ((S.ptr % n) + n) % n;
    for (let k = 0; k < n; k++) {
      const m = S.board[(start + k) % n];
      if (this.alive(m) && this.atkOf(m) > 0) return m;
    }
    return null;
  }
  pickTarget(S) {
    const al = S.board.filter(m => this.alive(m));
    const ta = al.filter(m => m.kw.taunt);
    return rnd(ta.length ? ta : al);
  }
  attack(si, a) {
    const A = this.sides[si], D = this.sides[1 - si];
    A.ptr = A.board.indexOf(a) + 1;
    const n = a.kw.windfury ? 2 : 1;
    for (let k = 0; k < n; k++) {
      if (!this.alive(a) || !D.board.some(m => this.alive(m))) break;
      const t = this.pickTarget(D);
      this.hook(a, 'onAttack', t);
      for (const o of [...A.board]) if (o !== a && this.alive(o)) this.hook(o, 'onFriendlyAttack', a);
      if (!this.alive(a) || !this.alive(t)) { this.deaths(si); continue; }
      const aAtk = this.atkOf(a), tAtk = this.atkOf(t);
      const ti = D.board.indexOf(t);
      const nbs = a.kw.cleave ? [D.board[ti - 1], D.board[ti + 1]].filter(m => m && this.alive(m)) : [];
      this.damage(t, aAtk, a);
      nbs.forEach(m => this.damage(m, aAtk, a));
      this.damage(a, tAtk, t);
      this.frame('attack', { a: a.uid, t: t.uid, side: si, cleave: nbs.map(m => m.uid) });
      for (const o of [...A.board]) {
        if (!this.alive(o)) continue;
        if (o !== a || CARDS[o.id].selfToo) this.hook(o, 'afterFriendlyAttack', a);
      }
      this.deaths(si);
    }
  }
  soulCount(si) { return trinketSum(this.sides[si].p, 'soul') + this.sides[si].board.reduce((s, m) => s + (this.alive(m) && CARDS[m.id].soul ? (m.golden ? 2 : 1) : 0), 0); }
  deaths(active) {
    let any = false;
    for (let guard = 0; guard < 60; guard++) {
      const ds = [];
      for (const si of [active, 1 - active]) {
        const S = this.sides[si];
        for (let i = 0; i < S.board.length;) {
          const m = S.board[i];
          if (!this.alive(m)) { ds.push({ m, si, pos: i, atk: this.atkOf(m), soul: 0 }); this.remove(si, i); } else i++;
        }
      }
      if (!ds.length) break;
      any = true;
      for (const d of ds) d.soul = this.soulCount(d.si);
      for (const d of ds) {
        const ex = { pos: d.pos, atk: d.atk };
        for (const e of d.m.dr) {
          const def = CARDS[e.id];
          for (let r = 0; r <= d.soul; r++) def.deathrattle(this.ctx(d.si, d.m, e.mult, ex));
        }
        if (d.m.kw.reborn) {
          const r = this.summon(d.si, d.m.id, ex.pos, d.m.golden);
          if (r) { r.hp = 1; r.kw.reborn = 0; ex.pos++; }
        }
        for (const o of [...this.sides[d.si].board]) {
          if (!this.alive(o)) continue;
          this.hook(o, 'onFriendlyDeath', d.m);
          const def = CARDS[o.id];
          if (def.avenge) {
            o.avc++;
            if (o.avc >= def.avenge) { o.avc = 0; this.hook(o, 'onAvenge'); }
          }
        }
      }
      this.frame('deaths');
    }
    return any;
  }
  run() {
    const [A, B] = this.sides;
    this.frame('start');
    let first = A.board.length > B.board.length ? 0 : B.board.length > A.board.length ? 1 : (Math.random() < 0.5 ? 0 : 1);
    this.first = first;
    // 战斗开始时：英雄技能 → 随从
    for (const si of [first, 1 - first]) {
      const pw = HEROES[this.sides[si].p.hero].power;
      if (pw.sot && this.sides[si].board.length) {
        pw.sot(this.ctx(si, null, 1));
        this.frame('sot', { hero: si });
        this.deaths(si);
      }
    }
    for (const si of [first, 1 - first]) {
      for (const t of trinketsOf(this.sides[si].p)) {
        if (!t.sot || !this.sides[si].board.some(m => this.alive(m))) continue;
        t.sot(this.ctx(si, null, 1));
        this.frame('sot', { trinket: t.id, side: si });
        this.deaths(si);
      }
    }
    for (const si of [first, 1 - first]) {
      for (const m of [...this.sides[si].board]) {
        if (!this.alive(m) || !CARDS[m.id].sot) continue;
        this.hook(m, 'sot');
        this.frame('sot', { src: m.uid });
        this.deaths(si);
      }
    }
    let turn = first;
    for (let guard = 0; guard < 400; guard++) {
      if (!A.board.some(m => this.alive(m)) || !B.board.some(m => this.alive(m))) break;
      let a = this.findAttacker(this.sides[turn]);
      if (!a) {
        const o = this.findAttacker(this.sides[1 - turn]);
        if (!o) break;
        turn = 1 - turn; a = o;
      }
      this.attack(turn, a);
      turn = 1 - turn;
    }
    const la = A.board.filter(m => this.alive(m)), lb = B.board.filter(m => this.alive(m));
    let winner = -1;
    if (la.length && !lb.length) winner = 0;
    else if (lb.length && !la.length) winner = 1;
    let dmg = 0;
    if (winner >= 0) {
      const W = this.sides[winner];
      dmg = W.p.tier + W.board.filter(m => this.alive(m)).reduce((s, m) => s + CARDS[m.id].tier, 0);
      dmg = Math.min(dmg, damageCap());
    }
    this.result = { winner, dmg };
    this.frame('end');
    // 永久增益结算
    for (const S of this.sides) {
      if (S.p.ghost) continue;
      for (const pb of S.perm) S.p.board.filter(pb.pred).forEach(m => { m.atk += pb.a; m.hp += pb.h; });
    }
    return this.result;
  }
}
function damageCap() {
  const t = GAME.turn, n = alivePlayers().length;
  if (n <= 4) return 99;
  if (t <= 3) return 5;
  if (t <= 7) return 10;
  return 15;
}

/* ---------------- 回合流程 ---------------- */
function makePairs() {
  const al = alivePlayers();
  let best = null;
  for (let k = 0; k < 30; k++) {
    const s = shuffle([...al]);
    const pairs = [];
    for (let i = 0; i + 1 < s.length; i += 2) pairs.push([s[i], s[i + 1]]);
    const bad = al.length > 3 && pairs.some(([a, b]) => a.lastOpp === b.id || b.lastOpp === a.id);
    best = { pairs, odd: s.length % 2 ? s[s.length - 1] : null };
    if (!bad) break;
  }
  if (best.odd) best.pairs.push([best.odd, ghostOf(GAME.lastDead)]);
  return best.pairs;
}
function ghostOf(dead) {
  const src = dead || rnd(GAME.players.filter(p => !p.alive)) || GAME.players[0];
  return { id: -1, ghostOf: src.id, ghost: true, name: src.name + '（幽灵）', hero: src.hero, tier: src.lastTier || src.tier, hp: 0, armor: 0, trinkets: (src.trinkets || []).slice(),
    board: src.lastBoard.map(m => Object.assign({}, m, { kw: Object.assign({}, m.kw), dr: m.dr.map(e => Object.assign({}, e)) })) };
}
/** 玩家结束回合：AI 完成招募，生成全部对局结果（不立即结算伤害） */
function finishRecruit() {
  const g = GAME;
  for (const p of alivePlayers()) {
    if (!p.isHuman) aiRecruit(p);
    endTurn(p);
    p.lastBoard = p.board.map(m => Object.assign({}, m, { kw: Object.assign({}, m.kw), dr: m.dr.map(e => Object.assign({}, e)) }));
    p.lastTier = p.tier;
  }
  const byId = id => (id === -1 ? ghostOf(g.lastDead) : g.players[id]);
  const pairs = (g.nextPairs && g.nextPairs.every(pr => pr.every(id => id === -1 || g.players[id].alive)))
    ? g.nextPairs.map(([a, b]) => [byId(a), byId(b)]) : makePairs();
  return pairs.map(([a, b]) => {
    const human = a.isHuman || b.isHuman;
    const [x, y] = b.isHuman ? [b, a] : [a, b];
    const c = new Combat(x, y, human);
    c.run();
    return { a: x, b: y, combat: c, human };
  });
}
function applyResults(results) {
  const g = GAME;
  const died = [];
  for (const r of results) {
    const { winner, dmg } = r.combat.result;
    r.a.lastOpp = r.b.id; if (!r.b.ghost) r.b.lastOpp = r.a.id;
    const rec = (p, o, res, d) => { if (!p.ghost) p.history.push({ turn: g.turn, opp: o.name, oppHero: o.hero, res, dmg: d }); };
    if (winner === 0) { heroDamage(r.b, dmg); rec(r.a, r.b, 'win', dmg); rec(r.b, r.a, 'loss', dmg); }
    else if (winner === 1) { heroDamage(r.a, dmg); rec(r.a, r.b, 'loss', dmg); rec(r.b, r.a, 'win', dmg); }
    else { rec(r.a, r.b, 'tie', 0); rec(r.b, r.a, 'tie', 0); }
  }
  for (const p of alivePlayers()) if (p.hp <= 0) died.push(p);
  died.sort((a, b) => a.hp - b.hp);
  let place = alivePlayers().length;
  for (const p of died) {
    p.alive = false; p.place = place--;
    g.deadOrder.push(p.id); g.lastDead = p;
    p.board.forEach(returnToPool); p.hand.forEach(returnToPool); p.shop.forEach(returnToPool);
    p.board = []; p.hand = []; p.shop = [];
  }
  const al = alivePlayers();
  if (al.length <= 1) {
    if (al[0]) al[0].place = 1;
    g.over = true;
  }
  return died;
}
function nextTurn() { startTurnAll(); }

/* ---------------- AI ---------------- */
function minionValue(m, p) {
  const d = CARDS[m.id];
  let v = m.atk + m.hp + d.tier * 2.5 + (m.golden ? 6 : 0);
  if (m.kw.ds) v += 2 + m.atk * 0.4;
  if (m.kw.taunt) v += 1;
  if (m.kw.poison) v += 6;
  if (m.kw.venom) v += 3;
  if (m.kw.windfury) v += m.atk * 0.6;
  if (m.kw.reborn) v += 2 + d.tier;
  if (m.kw.cleave) v += 4;
  v += m.dr.length * (1 + d.tier);
  if (d.text) v += d.tier * 1.5;
  if (d.echo || d.soul) v += 6;
  if (p) {
    const tribeCount = t => p.board.filter(x => x !== m && isT(x, t)).length;
    for (const t of d.tribes) v += tribeCount(t) * 1.5;
  }
  return v;
}
function shopValue(m, p) {
  let v = minionValue(m, p);
  const copies = [...p.board, ...p.hand].filter(x => isMinion(x) && x.id === m.id && !x.golden).length;
  v += copies * 9;
  const main = mainTribe(p);
  if (main && isT(m, main)) v += 5;
  return v;
}
function mainTribe(p) {
  const c = {};
  for (const m of p.board) for (const t of CARDS[m.id].tribes) c[t] = (c[t] || 0) + 1;
  let best = null, bn = 1;
  for (const t in c) if (c[t] > bn) { bn = c[t]; best = t; }
  return best;
}
function desiredTier(p) {
  const t = GAME.turn + Math.round(p.ai.levelBias);
  return t <= 1 ? 1 : t <= 3 ? 2 : t <= 5 ? 3 : t <= 7 ? 4 : t <= 9 ? 5 : 6;
}
function aiPickTarget(p, item, list) {
  if (!list.length) return null;
  if (item.id === 'd_hound') {
    const weak = list.filter(m => CARDS[m.id].token || minionValue(m, p) < 8);
    return weak.length ? weak.reduce((a, b) => (a.atk + a.hp > b.atk + b.hp ? a : b)) : null;
  }
  return list.reduce((a, b) => (minionValue(a, p) >= minionValue(b, p) ? a : b));
}
function aiWeakest(p) {
  if (!p.board.length) return null;
  return p.board.reduce((a, b) => (minionValue(a, p) <= minionValue(b, p) ? a : b));
}
function aiPlayHand(p) {
  for (const item of [...p.hand]) {
    if (item.reward) { actPlay(p, item.uid); return true; }
    if (item.spell) {
      const s = SPELLS[item.spell];
      let t = null;
      if (s.target) { const l = p.board.filter(s.target); if (!l.length) continue; t = aiPickTarget(p, item, l); }
      if (actPlay(p, item.uid, null, t && t.uid).ok) return true;
      continue;
    }
    const d = CARDS[item.id];
    const tg = playTargets(p, item);
    if (d.kw.magnetic && tg && tg.magnetic.length) {
      const host = tg.magnetic.reduce((a, b) => (a.kw.ds && !b.kw.ds ? b : a));
      if (actPlay(p, item.uid, null, host.uid, { magnetize: true }).ok) return true;
    }
    if (p.board.length >= RULES.boardMax) {
      const w = aiWeakest(p);
      if (w && minionValue(item, p) > minionValue(w, p) + 3) actSell(p, w.uid);
      else continue;
    }
    let t = null;
    if (tg && tg.battlecry.length) t = aiPickTarget(p, item, tg.battlecry);
    const r = actPlay(p, item.uid, null, t ? t.uid : null);
    if (r.ok) return true;
  }
  return false;
}
function aiResolveDiscover(p) {
  while (p.discoverQ.length) {
    const q = p.discoverQ[0];
    let bi = 0, bv = -1;
    q.options.forEach((id, i) => { const v = shopValue(newMinion(id), p); if (v > bv) { bv = v; bi = i; } });
    resolveDiscover(p, bi);
  }
}
function aiRecruit(p) {
  const pw = HEROES[p.hero].power;
  if (p.trinketOffer) aiPickTrinket(p);
  if (p.tier < 6 && p.gold >= p.upgradeCost && (p.tier < desiredTier(p) || p.upgradeCost <= 1)) actUpgrade(p);
  for (let guard = 0; guard < 60; guard++) {
    aiResolveDiscover(p);
    if (aiPlayHand(p)) continue;
    if (p.gold >= RULES.buyCost && p.hand.length < RULES.handMax && p.shop.length) {
      const best = p.shop.reduce((a, b) => (shopValue(a, p) >= shopValue(b, p) ? a : b));
      const w = aiWeakest(p);
      const full = p.board.length >= RULES.boardMax;
      if (!full || (w && shopValue(best, p) > minionValue(w, p) + 4)) { actBuy(p, best.uid); continue; }
    }
    if (p.shopSpell) {
      const s = SPELLS[p.shopSpell];
      const useful = (!s.target || p.board.some(s.target)) && s.id !== 's_crate' && p.board.length > 0;
      if (useful && p.gold >= s.cost && p.gold - s.cost >= (p.gold >= 6 ? 3 : 0) && p.hand.length < RULES.handMax) { actBuySpell(p); continue; }
    }
    const ps = powerState(p);
    if (!ps.passive && ps.can && (p.gold - pw.cost >= 3 || p.gold < 3 + pw.cost)) {
      let t = null;
      if (pw.target) t = aiPickTarget(p, {}, p.board.filter(pw.target));
      if (actPower(p, t && t.uid).ok) continue;
    }
    if (p.tier < 6 && p.gold >= p.upgradeCost && p.tier < desiredTier(p) + (p.ai.levelBias > 0.5 ? 1 : 0) && p.gold - p.upgradeCost >= 0) {
      if (actUpgrade(p).ok) continue;
    }
    if (p.gold >= RULES.buyCost + refreshCost(p) || (refreshCost(p) === 0 && p.gold >= RULES.buyCost)) {
      if (actRefresh(p).ok) continue;
    }
    break;
  }
  // 有好东西没钱买时偶尔冻结
  if (p.shop.some(m => shopValue(m, p) > 30) && p.gold < 3 && Math.random() < 0.5) p.frozen = true;
  aiArrange(p);
}
function aiArrange(p) {
  const key = m => {
    const d = CARDS[m.id];
    if (d.aura || d.echo || d.soul || d.onFriendlyDeath || d.avenge) return 3; // 留在后面
    if (m.dr.length || m.kw.reborn) return 0;
    if (m.kw.ds || m.kw.cleave || m.kw.windfury) return 1;
    return 2;
  };
  p.board.sort((a, b) => key(a) - key(b));
}

/* ---------------- 存档 ---------------- */
function serializeGame() {
  const g = GAME;
  return JSON.stringify({ v: 1, uid: UID, g: Object.assign({}, g, { lastDead: g.lastDead ? g.lastDead.id : null }) });
}
function loadGame(str) {
  const d = JSON.parse(str);
  if (!d || d.v !== 1) return false;
  UID = d.uid;
  GAME = d.g;
  GAME.lastDead = d.g.lastDead != null ? GAME.players[d.g.lastDead] : null;
  return true;
}

if (typeof module !== 'undefined') module.exports = { RULES, CARDS, SPELLS, HEROES, TRIBES, newGame, finishRecruit, applyResults, nextTurn, alivePlayers, get GAME() { return GAME; }, actBuy, actPlay, actSell, actRefresh, actUpgrade, Combat };
