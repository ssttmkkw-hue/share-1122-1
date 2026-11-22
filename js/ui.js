/* 雾港棋馆 · 界面层：渲染、拖拽、选目标、战斗回放 */
'use strict';

const $ = s => document.querySelector(s);
const ME = () => GAME.players[UI.meId];
let MODE = 'local'; // local | online
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const UI = {
  phase: 'select',     // select | recruit | combat | over
  sel: null,           // { zone, uid }
  targeting: null,     // { kind, uid, pos, list, mags, optional }
  press: null, drag: null,
  speed: 1, skip: false,
  lbDelta: {},
  touch: false,
  lastSnap: null,
  meId: 0, ready: false, readyInfo: null,
};

/* ================= 卡牌渲染 ================= */
function tribeLabel(d) {
  if (!d.tribes.length) return '';
  return d.tribes.map(t => TRIBES[t].name).join(' / ');
}
function minionView(m, board) {
  return { uid: m.uid, id: m.id, atk: m.atk + (board ? auraBonus(board, m) : 0), hp: m.hp, golden: m.golden, kw: m.kw, dr: m.dr.length > 0, xdr: m.dr.filter(e => !e.base).map(e => e.id), mags: m.mags || 0, dead: m.dead };
}
function cardSig(v) { return JSON.stringify([v.id, v.atk, v.hp, v.golden, v.kw, v.dr, v.mags, v.price, v.spell, v.reward, v.tier, v.xdr]); }
function cardInner(v) {
  if (v.spell) {
    const s = SPELLS[v.spell];
    return `<div class="frame">${cardArt(s.id, s.art, true)}<div class="nm">${esc(s.name)}</div></div><div class="price">${s.cost}</div>`;
  }
  if (v.reward) {
    return `<div class="frame">${cardArt('reward', '🎁', true)}<div class="nm">三连奖励</div></div><div class="tier">${v.tier}</div>`;
  }
  const d = CARDS[v.id];
  const kw = v.kw || {};
  const b = [];
  if (v.dr) b.push('💀');
  if (kw.poison) b.push('🧪');
  if (kw.venom) b.push('💧');
  if (kw.windfury) b.push('🌀');
  if (kw.cleave) b.push('🪓');
  if (d.avenge) b.push('⏳');
  if (d.sot) b.push('⚔️');
  return `<div class="frame">${cardArt(v.id, d.art)}<div class="nm">${esc(d.name)}</div></div>` +
    (d.token ? '' : `<div class="tier">${d.tier}</div>`) +
    (v.price != null ? `<div class="price">${v.price}</div>` : '') +
    (v.mags ? `<div class="mag" title="已吸附">🧲${v.mags > 1 ? v.mags : ''}</div>` : '') +
    `<div class="stat atk">${v.atk}</div><div class="stat hp">${v.hp}</div>` +
    (b.length ? `<div class="badges">${b.join('')}</div>` : '') +
    (kw.ds ? '<div class="bubble"></div>' : '');
}
function applyCardClasses(el, v) {
  const d = v.spell || v.reward ? null : CARDS[v.id];
  el.className = 'card';
  if (v.spell) el.classList.add('spell');
  if (v.reward) el.classList.add('reward');
  if (d) {
    el.style.setProperty('--tc', d.tribes.length ? TRIBES[d.tribes[0]].color : '#7a7466');
    if (v.golden) el.classList.add('golden');
    if (v.kw.taunt) el.classList.add('taunt');
    if (v.kw.reborn) el.classList.add('reborn');
    if (v.dead) el.classList.add('dying');
  }
}
function makeCard(v, zone) {
  const el = document.createElement('div');
  el.dataset.uid = v.uid;
  el.dataset.zone = zone;
  applyCardClasses(el, v);
  el.innerHTML = cardInner(v);
  el._sig = cardSig(v);
  el._v = v;
  return el;
}
/** 按 uid 键控的增量渲染，保证动画元素不被销毁 */
/* FLIP：记录变更前各卡牌在屏幕上的中心点，变更后让移动了的卡牌从旧位置平滑滑到新位置。
   以中心点计算，避免入场缩放动画干扰；正在冲锋的攻击者（带内联 transform）不参与。 */
const motionOff = window.matchMedia('(prefers-reduced-motion: reduce)');
function flipMeasure(row) {
  const pos = new Map();
  for (const c of row.children) {
    if (!c.dataset.uid || c.style.transform) continue;
    const r = c.getBoundingClientRect();
    pos.set(c, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
  }
  return pos;
}
function flipPlay(first, ms) {
  const moved = [];
  for (const [el, f] of first) {
    if (!el.isConnected) continue;
    if (el._flip) { el._flip.cancel(); el._flip = null; }
    moved.push([el, f]);
  }
  if (UI.skip || motionOff.matches) return;
  for (const [el, f] of moved) {
    const r = el.getBoundingClientRect();
    const dx = f.x - (r.left + r.width / 2), dy = f.y - (r.top + r.height / 2);
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    const a = el.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'translate(0,0)' }],
      { duration: ms, easing: 'cubic-bezier(.3,.6,.25,1)', composite: 'add' });
    el._flip = a;
    if (typeof replayAnimations !== 'undefined' && zoneIsReplay(el)) { a.playbackRate = UI.speed; replayAnimations.add(a); }
    a.onfinish = a.oncancel = () => { if (el._flip === a) el._flip = null; if (typeof replayAnimations !== 'undefined') replayAnimations.delete(a); };
  }
}
function zoneIsReplay(el) { return el.dataset.zone === 'cb'; }
function reconcile(row, views, zone, opts = {}) {
  const first = opts.flip ? flipMeasure(row) : null;
  reconcileDom(row, views, zone, opts);
  if (first) flipPlay(first, opts.flip);
}
function reconcileDom(row, views, zone, opts) {
  const old = new Map();
  const wanted = new Set(views.map(v => String(v.uid)));
  // 先移除离场的卡牌，否则后面每张卡都会被 insertBefore 挪动一次，重播入场动画造成抖动
  [...row.children].forEach(c => {
    if (c.dataset.uid && wanted.has(c.dataset.uid)) old.set(c.dataset.uid, c);
    else c.remove();
  });
  views.forEach((v, i) => {
    const key = String(v.uid);
    let el = old.get(key);
    if (!el) {
      el = makeCard(v, zone);
      if (opts.animateNew) {
        el.classList.add('enter');
        el.addEventListener('animationend', e => { if (e.animationName === 'pop') el.classList.remove('enter'); });
      }
    } else {
      old.delete(key);
      el.dataset.zone = zone;
      const sig = cardSig(v);
      const keep = ['sel', 'targetable', 'enter', 'lit', 'cant', 'dim'].filter(c => el.classList.contains(c));
      applyCardClasses(el, v);
      keep.forEach(c => el.classList.add(c));
      if (sig !== el._sig) { el.innerHTML = cardInner(v); el._sig = sig; }
      el._v = v;
    }
    if (row.children[i] !== el) row.insertBefore(el, row.children[i] || null);
  });
  old.forEach(el => el.remove());
  if (!views.length && opts.empty) {
    const h = document.createElement('div'); h.className = 'empty-hint'; h.textContent = opts.empty; row.appendChild(h);
  }
}

/* ================= 主渲染 ================= */
function render() {
  if (!GAME) return;
  renderLeaderboard();
  if (UI.phase === 'recruit') renderRecruit();
  positionActPop();
  layout();
}
function renderRecruit() {
  const p = ME();
  $('#recruitCtl').hidden = false; $('#oppCtl').hidden = true;
  $('#shopZone').classList.remove('combat');
  $('#arena').classList.remove('in-combat');
  $('#phaseTitle').textContent = '招募阶段';
  $('#boardLabel').textContent = `我方战场 · ${p.board.length}/${RULES.boardMax}`;
  $('#handLabel').textContent = `手牌 · ${p.hand.length}/${RULES.handMax}`;
  $('#combatCtl').hidden = true; $('#btnEnd').hidden = false; $('#handZone').style.visibility = '';
  // 酒馆栏
  $('#tierBadge').innerHTML = `${p.tier}<small>酒馆</small>`;
  const up = $('#btnUpgrade');
  if (p.tier >= 6) { up.innerHTML = '<span class="lbl">已满级</span>'; up.disabled = true; }
  else { up.innerHTML = `<span class="lbl">升级</span>⬆ <span class="cost">${p.upgradeCost}</span>`; up.disabled = p.gold < p.upgradeCost; }
  const rc = refreshCost(p);
  $('#btnRefresh').innerHTML = `<span class="lbl">刷新</span>⟳ <span class="cost">${rc || '免费'}</span>`;
  $('#btnRefresh').disabled = p.gold < rc;
  const fz = $('#btnFreeze');
  fz.innerHTML = `❄ <span class="lbl">${p.frozen ? '已冻结' : '冻结'}</span>`;
  fz.classList.toggle('on', p.frozen);
  // 酒馆
  const shopViews = p.shop.map(m => Object.assign(minionView(m), { price: RULES.buyCost }));
  if (p.shopSpell) shopViews.push({ uid: 'spell-' + p.shopSpell + '-' + GAME.turn, spell: p.shopSpell });
  reconcile($('#shopRow'), shopViews, 'shop', { animateNew: true, flip: 220, empty: '酒馆空空如也' });
  $('#shopRow').classList.toggle('frozen', p.frozen);
  $('#shopLabel').textContent = p.frozen ? '酒馆随从 · 已冻结' : '酒馆随从';
  [...$('#shopRow').children].forEach(el => {
    const v = el._v; if (!v) return;
    const cost = v.spell ? SPELLS[v.spell].cost : RULES.buyCost;
    el.classList.toggle('cant', p.gold < cost);
  });
  // 战场
  reconcile($('#boardRow'), p.board.map(m => minionView(m, p.board)), 'board', { animateNew: true, flip: 220, empty: '把随从拖到这里，或点击手牌打出' });
  // 手牌
  const hand = p.hand.map(x => x.spell ? { uid: x.uid, spell: x.spell } : x.reward ? { uid: x.uid, reward: true, tier: x.tier } : minionView(x));
  reconcile($('#handRow'), hand, 'hand', { animateNew: true, flip: 220 });
  // 英雄栏
  renderHeroBar(p);
  $('#btnEnd').disabled = false;
  markSelection();
  if (p.discoverQ.length && !$('#modal').dataset.kind) openDiscover();
  else if (p.trinketOffer && !UI.tkLater && !$('#modal').dataset.kind) openTrinkets();
  saveSoon();
}
function renderHeroBar(p) {
  const h = HEROES[p.hero];
  $('#heroPortrait').classList.add('portrait');
  $('#heroPortrait').style.setProperty('--portrait-pos', portraitPosition(p.hero));
  $('#heroPortrait').innerHTML = `<span class="hhp">${p.hp}</span>${p.armor > 0 ? `<span class="harm">${p.armor}</span>` : ''}`;
  $('#heroPortrait').title = h.name;
  const pb = $('#btnPower');
  const ps = powerState(p);
  pb.className = 'power-btn';
  if (ps.passive) { pb.classList.add('passive'); pb.innerHTML = esc(h.power.name); pb.disabled = false; }
  else {
    pb.innerHTML = `<span class="pcost">${h.power.cost}</span>${esc(h.power.name)}`;
    pb.disabled = UI.phase !== 'recruit' || !ps.can;
    if (p.powerUsed) pb.classList.add('used'); else if (ps.can) pb.classList.add('ready');
  }
  $('#goldBox').innerHTML = `<span class="coin"></span><span class="gv">${p.gold}</span><span class="gm">/ ${p.maxGold}</span>`;
  $('#trinketBox').innerHTML = (p.trinkets || []).map(id => `<span class="trinket" data-tk="${id}">${TRINKETS[id].art}</span>`).join('') +
    (p.trinketOffer && UI.phase === 'recruit' ? '<button class="btn btn-brass pick-tk" data-act="pickTrinket">选择饰品</button>' : '');
}
function renderLeaderboard() {
  const g = GAME;
  $('#lbTurn').textContent = `第 ${g.turn} 回合`;
  const list = [...g.players].sort((a, b) => (b.alive - a.alive) || (a.alive ? (b.hp + b.armor) - (a.hp + a.armor) : a.place - b.place));
  const me = ME();
  $('#lbList').innerHTML = list.map(p => {
    const h = HEROES[p.hero];
    const last = p.history[p.history.length - 1];
    const res = last && last.turn === g.turn - (UI.phase === 'recruit' ? 1 : 0) ? `<span class="lb-res ${last.res}">${last.res === 'win' ? '胜' : last.res === 'loss' ? '负' : '平'}</span>` : '';
    const delta = UI.lbDelta[p.id] ? `<span class="lb-delta">-${UI.lbDelta[p.id]}</span>` : '';
    const right = p.alive ? `<div class="lb-hp">${p.hp}${p.armor > 0 ? `<small>+${p.armor}护甲</small>` : ''}</div>` : `<div class="lb-place">第${p.place}名</div>`;
    let nx = UI.phase === 'recruit' ? nextOpponentOf(UI.meId) : null;
    if (nx === -1 && g.lastDead) nx = g.lastDead.id;
    const isNext = nx === p.id;
    const isMe = p.id === UI.meId;
    const cls = ['lb-item', isMe ? 'me' : '', p.isHuman && !isMe ? 'human' : '', p.alive ? '' : 'dead', isNext ? 'next' : (UI.phase !== 'recruit' && me.lastOpp === p.id ? 'opp' : '')].join(' ');
    return `<li class="${cls}" data-pid="${p.id}" title="${esc(p.name)}">${heroPortrait(p.hero)}
      <div class="lb-info"><div class="lb-name">${isMe ? '你 · ' + esc(h.name) : p.isHuman ? `👤 ${esc(p.name)}${p.auto ? ' <span class="lb-off">托管</span>' : ''}` : esc(h.name)}</div>
      <div class="lb-sub">酒馆 ${p.lastTier || p.tier} ${res}${isNext ? `<span class="lb-next">${p.alive ? '下个对手' : '幽灵对手'}</span>` : ''}</div></div>${right}${delta}</li>`;
  }).join('');
  $('#lbTribes').innerHTML = '<span class="lb-turn" style="width:100%">本局种族</span>' + g.tribes.map(t => `<span class="chip" style="--tc:${TRIBES[t].color}">${TRIBES[t].name}</span>`).join('');
}
function markSelection() {
  document.querySelectorAll('.card.sel, .card.targetable, .card.dim').forEach(c => c.classList.remove('sel', 'targetable', 'dim'));
  if (UI.sel) {
    const el = document.querySelector(`.card[data-zone="${UI.sel.zone}"][data-uid="${UI.sel.uid}"]`);
    if (el) el.classList.add('sel'); else UI.sel = null;
  }
  const t = UI.targeting;
  if (t) {
    const ok = new Set([...t.list, ...t.mags].map(String));
    document.querySelectorAll('#boardRow .card').forEach(c => c.classList.add(ok.has(c.dataset.uid) ? 'targetable' : 'dim'));
  }
}

/* ================= 布局 ================= */
function layout() {
  const tb = $('#table');
  const W = $('#handRow').clientWidth - 16;
  const combat = UI.phase === 'combat';
  const slots = combat ? UI.replaySlots : Math.max($('#shopRow').children.length, $('#boardRow').children.length);
  const columns = Math.max(4, slots || 4);
  const cwW = ($('#shopRow').clientWidth - 16) / (columns * 1.16);
  const cwH = $('#arena').clientHeight / 3.35;
  const cw = Math.max(24, Math.min(118, cwH, cwW));
  tb.style.setProperty('--cw', cw.toFixed(1) + 'px');
  tb.classList.toggle('compact', cw < 62);
  const n = GAME ? ME().hand.length : 0;
  const hw = Math.max(21, Math.min(cw * .8, ($('#handZone').clientHeight - 12) / 1.34));
  let gap = hw * 0.1;
  const need = n * hw + (n - 1) * gap;
  if (n > 1 && need > W) gap = (W - n * hw) / (n - 1);
  const hr = $('#handRow');
  hr.style.setProperty('--hw', hw.toFixed(1) + 'px');
  hr.style.setProperty('--hgap', gap.toFixed(1) + 'px');
}
window.addEventListener('resize', () => { layout(); hideTip(); positionActPop(); });

/* ================= 提示 / 浮动文字 ================= */
function toast(msg, info) {
  const t = $('#toast');
  t.textContent = msg; t.classList.toggle('info', !!info); t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 1800);
}
function tipHTML(v) {
  if (v.spell) { const s = SPELLS[v.spell]; return `<h4>${s.art} ${esc(s.name)}</h4><div class="meta"><span>酒馆法术</span><span>${s.cost} 铸币</span><span>等级 ${s.tier}</span></div><div class="txt">${esc(s.text)}</div>`; }
  if (v.reward) return `<h4>🎁 三连奖励</h4><div class="txt">打出：从 ${v.tier} 级随从中发现一张。</div>`;
  const d = CARDS[v.id];
  const kws = Object.keys(v.kw || {}).filter(k => v.kw[k] && KW_NAMES[k]);
  if (d.kw.magnetic) kws.push('magnetic');
  const meta = [d.token ? '衍生物' : `等级 ${d.tier}`, tribeLabel(d) || '中立', `${v.atk}/${v.hp}`];
  return `<h4>${d.art} ${esc(d.name)}${v.golden ? ' ✦' : ''}</h4><div class="meta">${meta.map(x => `<span>${esc(x)}</span>`).join('')}</div>` +
    (d.text ? `<div class="txt">${esc(d.text)}</div>` : '') +
    (v.xdr && v.xdr.length ? v.xdr.map(id => `<div class="txt" style="color:#cfe3ff">附加 · ${esc(CARDS[id].text || '')}</div>`).join('') : '') +
    (kws.length ? `<div class="kw">${[...new Set(kws)].map(k => `<b>${KW_NAMES[k]}</b>：${KW_HELP[k]}`).join('<br>')}</div>` : '') +
    (v.golden && d.text ? `<div class="gold-note">金色：效果翻倍</div>` : '') +
    (v.golden ? '' : '');
}
function showTip(el) {
  const v = el._v; if (!v) return;
  $('#tip').innerHTML = tipHTML(v);
  placeTip(el);
}
function placeTip(el) {
  const tip = $('#tip');
  tip.hidden = false;
  const r = el.getBoundingClientRect();
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  let x = r.right + 10, y = r.top + r.height / 2 - th / 2;
  if (x + tw > innerWidth - 8) x = r.left - tw - 10;
  if (x < 8) { x = Math.min(innerWidth - tw - 8, Math.max(8, r.left + r.width / 2 - tw / 2)); y = r.top - th - 12; if (y < 8) y = r.bottom + 12; }
  y = Math.max(8, Math.min(innerHeight - th - 8, y));
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}
function hideTip() { $('#tip').hidden = true; }
function trinketTip(id) { const t = TRINKETS[id]; return `<h4>${t.art} ${esc(t.name)}</h4><div class="meta"><span>${t.grade === 'lesser' ? '次级饰品' : '高级饰品'}</span><span>${t.cost} 铸币</span></div><div class="txt">${esc(t.text)}</div>`; }
function showTipHTML(el, html) { $('#tip').innerHTML = html; placeTip(el); }
document.addEventListener('pointerover', e => {
  const t = e.target.closest('[data-tk]');
  if (t) showTipHTML(t, trinketTip(t.dataset.tk));
});
document.addEventListener('pointerout', e => { const t = e.target.closest('[data-tk]'); if (t && !t.contains(e.relatedTarget)) hideTip(); });
function fxAt(el, text, cls) {
  if (!el || !el.isConnected) return;
  const r = el.getBoundingClientRect();
  const s = document.createElement('div');
  s.className = 'float ' + cls;
  s.textContent = text;
  s.style.left = (r.left + r.width / 2) + 'px';
  s.style.top = (r.top + r.height * (cls === 'buff' ? .25 : .45)) + 'px';
  $('#fx').appendChild(s);
  const speed = UI.phase === 'combat' ? UI.speed : 1;
  s.style.animationDuration = (850 / speed) + 'ms';
  setTimeout(() => s.remove(), 900 / speed);
}

/* ================= 动作封装 ================= */
/** 所有招募操作的唯一入口：单机直接调用引擎，联机发给服务器 */
function act(name, args = [], snd, after) {
  if (MODE === 'online') {
    NET.request('act', { name, args }).then(res => {
      if (res.g) applyServerState(res.g);
      if (UI.phase !== 'recruit') return;
      doAct(res, null, snd);
      if (after) after(res);
    }).catch(() => toast('与服务器的连接中断'));
    return;
  }
  const res = applyAction(UI.meId, name, args);
  doAct(res, null, snd);
  if (after) after(res);
}
function doAct(res, okMsg, snd) {
  if (!res.ok) { if (res.msg) toast(res.msg); SFX.play('deny'); return false; }
  SFX.play(res.tripled ? 'triple' : snd);
  if (res.tripled) toast('三连！获得一张金色随从', true);
  if (okMsg) toast(okMsg, true);
  UI.sel = null;
  render();
  return true;
}
function buyItem(uid) {
  const p = ME();
  if (String(uid).startsWith('spell-')) return act('buySpell', [], 'buy');
  return act('buy', [+uid], 'buy');
}
/** 打出手牌（必要时进入选目标模式） */
function playItem(uid, pos, dropTargetUid) {
  const p = ME();
  const item = p.hand.find(x => x.uid === +uid);
  if (!item) return;
  if (isMinion(item) && p.board.length >= RULES.boardMax && !(CARDS[item.id].kw.magnetic && p.board.some(m => isT(m, 'mech')))) return toast('战场已满（最多7个随从）');
  const tg = playTargets(p, item);
  if (tg) {
    const dropT = dropTargetUid != null ? p.board.find(m => m.uid === +dropTargetUid) : null;
    if (dropT && tg.magnetic.includes(dropT)) return act('play', [item.uid, pos, dropT.uid, { magnetize: true }], 'play');
    if (dropT && tg.battlecry.includes(dropT)) return act('play', [item.uid, pos, dropT.uid], 'play');
    if (tg.battlecry.length || tg.magnetic.length) { startTargeting({ kind: 'play', uid: item.uid, pos, list: tg.battlecry.map(m => m.uid), mags: tg.magnetic.map(m => m.uid), optional: tg.optional, spell: tg.spell }); return; }
  }
  if (p.board.length >= RULES.boardMax && isMinion(item)) return toast('战场已满（最多7个随从）');
  act('play', [item.uid, pos], 'play');
}
function startTargeting(t) {
  UI.targeting = t; UI.sel = null; hideActPop();
  const b = $('#targetBanner');
  const p = ME();
  const item = t.kind === 'power' ? null : p.hand.find(x => x.uid === t.uid);
  let msg = '选择一个友方随从作为目标';
  if (t.kind === 'play' && item && isMinion(item)) {
    if (t.mags.length && !t.list.length) msg = '选择一个机械进行磁力吸附';
    else if (t.mags.length) msg = '选择战吼目标，或点击机械进行吸附';
    else msg = '选择战吼目标';
  }
  b.innerHTML = `<span>🎯 ${msg}</span>` +
    (t.optional ? `<button class="btn" data-act="noTarget">${t.mags.length ? '作为独立随从打出' : '不选目标直接打出'}</button>` : '') +
    `<button class="btn btn-ghost" data-act="cancelTarget">取消</button>`;
  b.hidden = false;
  markSelection();
}
function endTargeting() { UI.targeting = null; $('#targetBanner').hidden = true; markSelection(); }
function completeTarget(uid) {
  const t = UI.targeting; if (!t) return;
  const p = ME();
  endTargeting();
  if (t.kind === 'power') return act('power', [uid], 'play');
  const isMag = uid != null && t.mags.includes(uid) && !t.list.includes(uid);
  act('play', [t.uid, t.pos, uid, { magnetize: isMag }], 'play');
}
function usePower() {
  const p = ME();
  const pw = HEROES[p.hero].power;
  if (pw.passive) { toast(pw.text, true); return; }
  const ps = powerState(p);
  if (!ps.can) { toast(p.powerUsed ? '本回合已使用过英雄技能' : p.gold < pw.cost ? '铸币不足' : '现在无法使用'); return; }
  if (pw.target) {
    startTargeting({ kind: 'power', list: p.board.filter(pw.target).map(m => m.uid), mags: [], optional: false });
    $('#targetBanner span').textContent = `🎯 ${pw.name}：选择一个友方随从`;
    return;
  }
  act('power', [], 'play');
}

/* ================= 行动菜单（选中卡牌） ================= */
function select(zone, uid) {
  UI.sel = { zone, uid: String(uid) };
  markSelection();
  positionActPop();
}
function positionActPop() {
  const pop = $('#actPop');
  if (!UI.sel || UI.phase !== 'recruit' || UI.targeting) { pop.hidden = true; return; }
  const el = document.querySelector(`.card[data-zone="${UI.sel.zone}"][data-uid="${UI.sel.uid}"]`);
  if (!el) { pop.hidden = true; return; }
  const p = ME();
  let html = '';
  if (UI.sel.zone === 'board') {
    const i = p.board.findIndex(m => String(m.uid) === UI.sel.uid);
    const d = p.board[i] && CARDS[p.board[i].id];
    const extra = d && d.id === 'p_gambler' ? 2 * (p.board[i].golden ? 2 : 1) : d && d.id === 'n_peddler' ? (p.board[i].golden ? 2 : 1) : 0;
    html = `<button class="btn" data-act="left" ${i <= 0 ? 'disabled' : ''}>◀</button><button class="btn btn-brass" data-act="sell">出售 <span class="cost">+${1 + extra}</span></button><button class="btn" data-act="right" ${i >= p.board.length - 1 ? 'disabled' : ''}>▶</button>`;
  } else if (UI.sel.zone === 'shop') {
    const spell = UI.sel.uid.startsWith('spell-');
    html = `<button class="btn btn-brass" data-act="buy">购买 <span class="cost">${spell ? SPELLS[p.shopSpell].cost : RULES.buyCost}</span></button>`;
  } else if (UI.sel.zone === 'hand') {
    html = `<button class="btn btn-brass" data-act="play">打出</button>`;
  }
  pop.innerHTML = html;
  pop.hidden = false;
  const r = el.getBoundingClientRect();
  pop.style.left = Math.max(80, Math.min(innerWidth - 80, r.left + r.width / 2)) + 'px';
  pop.style.top = Math.max(50, r.top - 8) + 'px';
  if (UI.sel.zone === 'hand') { pop.style.top = Math.max(50, r.top - 8) + 'px'; }
}
function hideActPop() { $('#actPop').hidden = true; }
$('#actPop').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]'); if (!b || !UI.sel) return;
  const p = ME(); const uid = UI.sel.uid;
  const kind = b.dataset.act;
  if (kind === 'sell') act('sell', [+uid], 'sell');
  else if (kind === 'buy') buyItem(uid);
  else if (kind === 'play') { UI.sel = null; hideActPop(); playItem(uid); }
  else if (kind === 'left' || kind === 'right') {
    const i = p.board.findIndex(m => String(m.uid) === uid);
    act('move', [+uid, i + (kind === 'left' ? -1 : 1)], null, () => select('board', uid));
  }
});

/* ================= 指针：点击 + 拖拽 ================= */
function ensureView(c) {
  if (c._v || !c.dataset.cid) return c._v;
  const id = c.dataset.cid;
  c._v = { id, atk: +c.dataset.atk, hp: +c.dataset.hp, golden: c.dataset.golden === '1', kw: JSON.parse(c.dataset.kw || '{}'), dr: c.dataset.dr === '1', mags: 0 };
  return c._v;
}
document.addEventListener('pointerover', e => {
  if (e.pointerType !== 'mouse' || UI.drag) return;
  const c = e.target.closest('.card');
  if (c && ensureView(c)) showTip(c);
});
document.addEventListener('pointerout', e => {
  if (e.pointerType !== 'mouse') return;
  const c = e.target.closest('.card');
  if (c && !c.contains(e.relatedTarget)) hideTip();
});
document.addEventListener('pointerdown', e => {
  UI.touch = e.pointerType !== 'mouse';
  const mc = e.target.closest('.modal .card');
  if (mc && UI.touch && ensureView(mc)) { showTip(mc); return; }
  const c = e.target.closest('#table .card[data-zone]');
  if (!c) {
    if (!e.target.closest('#actPop, #targetBanner, .modal, #btnPower') && UI.sel) { UI.sel = null; markSelection(); hideActPop(); }
    if (UI.touch && !e.target.closest('.card')) hideTip();
    return;
  }
  if (UI.phase !== 'recruit') { if (UI.touch) showTip(c); return; }
  UI.press = { el: c, zone: c.dataset.zone, uid: c.dataset.uid, x: e.clientX, y: e.clientY, pid: e.pointerId };
});
document.addEventListener('pointermove', e => {
  const pr = UI.press;
  if (!pr || pr.pid !== e.pointerId) return;
  if (!UI.drag) {
    if (Math.hypot(e.clientX - pr.x, e.clientY - pr.y) < 8 || UI.targeting) return;
    startDrag(pr, e);
  }
  moveDrag(e);
});
document.addEventListener('pointerup', e => {
  const pr = UI.press;
  if (!pr || pr.pid !== e.pointerId) return;
  UI.press = null;
  if (UI.drag) { endDrag(e); return; }
  onCardClick(pr.zone, pr.uid, pr.el);
});
document.addEventListener('pointercancel', () => { if (UI.drag) cancelDrag(); UI.press = null; });

function onCardClick(zone, uid, el) {
  const p = ME();
  if (UI.targeting) {
    const t = UI.targeting;
    if (zone === 'board' && [...t.list, ...t.mags].map(String).includes(uid)) completeTarget(+uid);
    return;
  }
  if (UI.touch) {
    showTip(el);
    if (!(UI.sel && UI.sel.zone === zone && UI.sel.uid === uid)) { select(zone, uid); return; }
    if (zone === 'board') { UI.sel = null; markSelection(); hideActPop(); hideTip(); return; }
    hideTip();
  }
  if (zone === 'shop') buyItem(uid);
  else if (zone === 'hand') { UI.sel = null; hideActPop(); hideTip(); playItem(uid); }
  else if (zone === 'board') {
    if (UI.sel && UI.sel.zone === 'board' && UI.sel.uid === uid) { UI.sel = null; markSelection(); hideActPop(); }
    else select('board', uid);
  }
}
function startDrag(pr, e) {
  hideTip(); hideActPop(); UI.sel = null; markSelection();
  const g = pr.el.cloneNode(true);
  g.classList.add('drag-ghost');
  g.classList.remove('sel', 'enter', 'targetable', 'dim');
  g.style.setProperty('--cw', getComputedStyle(pr.el).getPropertyValue('--cw') || '');
  g.style.width = pr.el.offsetWidth + 'px'; g.style.height = pr.el.offsetHeight + 'px';
  document.body.appendChild(g);
  pr.el.classList.add('dragging-src');
  UI.drag = { ...pr, ghost: g, marker: null };
  if (pr.zone === 'board') $('#shopZone').classList.add('drop-sell');
  if (pr.zone === 'hand' || pr.zone === 'board') $('#boardZone').classList.add('drop-ok');
  if (pr.zone === 'shop') { $('#boardZone').classList.add('drop-ok'); $('#handZone').classList.add('drop-ok'); }
}
function zoneAt(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return { zone: null };
  const card = el.closest('#boardRow .card');
  const z = el.closest('#shopZone') ? 'shop' : el.closest('#boardZone') ? 'board' : el.closest('#handZone') ? 'hand' : null;
  return { zone: z, card };
}
function boardIndexAt(x, exclude) {
  const cards = [...$('#boardRow').children].filter(c => c.classList.contains('card') && c.dataset.uid !== exclude);
  let i = 0;
  for (const c of cards) { const r = c.getBoundingClientRect(); if (x > r.left + r.width / 2) i++; }
  return i;
}
function moveDrag(e) {
  const d = UI.drag;
  d.ghost.style.left = e.clientX + 'px'; d.ghost.style.top = e.clientY + 'px';
  const { zone } = zoneAt(e.clientX, e.clientY);
  const showMarker = zone === 'board' && (d.zone === 'hand' || d.zone === 'board');
  if (showMarker) {
    if (!d.marker) { d.marker = document.createElement('div'); d.marker.className = 'slot-marker'; }
    const idx = boardIndexAt(e.clientX, d.uid);
    const row = $('#boardRow');
    const cards = [...row.children].filter(c => c.classList.contains('card') && c.dataset.uid !== d.uid);
    const before = cards[idx] || null;
    if (d.marker.nextSibling !== before || !d.marker.isConnected) row.insertBefore(d.marker, before);
    d.pos = idx;
  } else if (d.marker && d.marker.isConnected) d.marker.remove();
}
function cleanupDrag() {
  const d = UI.drag; if (!d) return;
  d.ghost.remove(); if (d.marker) d.marker.remove();
  d.el.classList.remove('dragging-src');
  document.querySelectorAll('.drop-ok, .drop-sell').forEach(z => z.classList.remove('drop-ok', 'drop-sell'));
  UI.drag = null;
}
function cancelDrag() { cleanupDrag(); render(); }
function endDrag(e) {
  const d = UI.drag;
  d.ghost.style.display = 'none';
  const { zone, card } = zoneAt(e.clientX, e.clientY);
  const pos = d.pos;
  cleanupDrag();
  const p = ME();
  if (d.zone === 'shop') {
    if (zone === 'board' || zone === 'hand') buyItem(d.uid); else render();
  } else if (d.zone === 'hand') {
    if (zone === 'board') {
      const item = p.hand.find(x => String(x.uid) === d.uid);
      const onCard = card && card.dataset.uid !== d.uid ? card.dataset.uid : null;
      if (item && item.spell && SPELLS[item.spell].target && onCard) {
        const t = p.board.find(m => String(m.uid) === onCard);
        if (t && SPELLS[item.spell].target(t)) return act('play', [item.uid, null, t.uid], 'play');
      }
      const magHost = item && isMinion(item) && CARDS[item.id].kw.magnetic && onCard && isT(p.board.find(m => String(m.uid) === onCard) || { id: 'n_barrel' }, 'mech') ? onCard : null;
      playItem(d.uid, pos, magHost);
    } else render();
  } else if (d.zone === 'board') {
    if (zone === 'shop') act('sell', [+d.uid], 'sell');
    else if (zone === 'board' && pos != null) act('move', [+d.uid, pos]);
    else render();
  }
}

/* ================= 按钮 ================= */
$('#btnUpgrade').addEventListener('click', () => { if (UI.phase === 'recruit') act('upgrade', [], 'upgrade'); });
$('#btnRefresh').addEventListener('click', () => { if (UI.phase === 'recruit') act('refresh', [], 'refresh'); });
$('#btnFreeze').addEventListener('click', () => { if (UI.phase === 'recruit') act('freeze', [], 'freeze'); });
$('#btnPower').addEventListener('click', () => { if (UI.phase === 'recruit') usePower(); });
$('#btnEnd').addEventListener('click', () => endTurnClick());
$('#btnHelp').addEventListener('click', () => openHelp());
$('#btnLib').addEventListener('click', () => openLibrary(1));
$('#btnSpeed').addEventListener('click', () => {
  UI.speed = UI.speed >= 4 ? 1 : UI.speed * 2;
  replayAnimations.forEach(a => a.updatePlaybackRate(UI.speed));
  $('#btnSpeed').textContent = `速度 ${UI.speed}×`;
});
$('#btnSkip').addEventListener('click', () => { UI.skip = true; stopReplayMotion(); });
$('#targetBanner').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  if (b.dataset.act === 'cancelTarget') endTargeting();
  if (b.dataset.act === 'noTarget') completeTarget(null);
});
$('#lbList').addEventListener('click', e => { const li = e.target.closest('.lb-item'); if (li) openPlayer(+li.dataset.pid); });
$('#heroPortrait').addEventListener('click', () => { if (GAME) openPlayer(UI.meId); });
document.addEventListener('keydown', e => {
  if (e.target.closest('input, textarea') || UI.phase !== 'recruit' || !$('#modal').hidden) {
    if (e.key === 'Escape' && !$('#modal').hidden && $('#modal').dataset.closable) closeModal();
    return;
  }
  if (e.key === 'Escape') { endTargeting(); UI.sel = null; markSelection(); hideActPop(); }
  else if (e.key === 'r' || e.key === 'R') $('#btnRefresh').click();
  else if (e.key === 'f' || e.key === 'F') $('#btnFreeze').click();
  else if (e.key === 'u' || e.key === 'U') $('#btnUpgrade').click();
  else if (e.key === ' ') { e.preventDefault(); endTurnClick(); }
});

/* ================= 回合结束 & 战斗回放 ================= */
async function endTurnClick() {
  if (UI.phase !== 'recruit') return;
  if (MODE === 'online') return onlineEndTurn();
  const me = ME();
  if (me.discoverQ.length) { openDiscover(); return; }
  if (me.trinketOffer) {
    if (me.trinketOffer.some(id => TRINKETS[id].cost <= me.gold)) { openTrinkets(); return; }
    me.trinketOffer = null;
  }
  stopTimer();
  UI.phase = 'combat';
  endTargeting(); UI.sel = null; hideActPop(); hideTip();
  $('#btnEnd').disabled = true;
  const before = {};
  GAME.players.forEach(p => { before[p.id] = p.hp + p.armor; });
  const results = finishRecruit();
  const mine = results.find(r => r.human);
  await playCombat(combatPayload(mine, 0));
  applyResults(results);
  UI.lbDelta = {};
  GAME.players.forEach(p => { const dlt = before[p.id] - (p.hp + p.armor); if (dlt > 0) UI.lbDelta[p.id] = dlt; });
  renderLeaderboard();
  if (!ME().alive || GAME.over) { UI.phase = 'over'; clearSave(); await sleep(700); openGameOver(); return; }
  nextTurn();
  UI.phase = 'recruit';
  UI.tkLater = false;
  render();
  startTimer();
  if (GAME.turn === 6) toast('饰品商人来了：选择一个次级饰品', true);
  if (GAME.turn === 9) toast('饰品商人来了：选择一个高级饰品', true);
  if (GAME.turn === 2) toast('提示：拖动随从可以调整站位，拖回酒馆可以出售', true);
}
function setCombatView(P) {
  const o = P.opp;
  $('#recruitCtl').hidden = true;
  const oc = $('#oppCtl');
  oc.hidden = false;
  renderHeroBar(ME());
  oc.innerHTML = `${heroPortrait(o.hero)}<div><div class="opp-name">${esc(o.name)}</div>
    <div class="opp-sub">${o.ghost ? '幽灵 · ' : `生命 ${o.hp}${o.armor ? ' +' + o.armor : ''} · `}酒馆 ${o.tier}</div></div>`;
  $('#shopZone').classList.add('combat');
  $('#arena').classList.add('in-combat');
  $('#phaseTitle').textContent = '战斗阶段';
  $('#shopLabel').textContent = '敌方战场';
  $('#boardLabel').textContent = '我方战场';
  $('#combatCtl').hidden = false; $('#btnEnd').hidden = true;
  $('#handZone').style.visibility = 'hidden';
  $('#btnPower').disabled = true;
  $('#btnSpeed').textContent = `速度 ${UI.speed}×`;
}
function snapViews(list) { return list.map(m => ({ uid: 'c' + m.uid, id: m.id, atk: m.atk, hp: m.hp, golden: m.golden, kw: m.kw, dr: m.dr, dead: m.dead })); }
function renderSnap(s, prev, reborn = []) {
  if (prev) {
    const present = new Set(s.flat().map(m => m.uid));
    for (const m of prev.flat()) {
      const el = !present.has(m.uid) && cbEl(m.uid);
      if (el) {
        if (m.dr) fxAt(el, '亡语', 'info');
        departCard(el);
      }
    }
  }
  reconcile($('#shopRow'), snapViews(s[1]), 'cb', { animateNew: true, flip: 340 });
  reconcile($('#boardRow'), snapViews(s[0]), 'cb', { animateNew: true, flip: 340 });
  $('#shopRow').classList.remove('frozen');
  if (prev) diffFx(prev, s, reborn);
}
function cbEl(uid) { return document.querySelector(`.card[data-zone="cb"][data-uid="c${uid}"]`); }
function diffFx(prev, s, reborn) {
  const pm = new Map(); prev.flat().forEach(m => pm.set(m.uid, m));
  for (const m of s.flat()) {
    const el = cbEl(m.uid); if (!el) continue;
    const o = pm.get(m.uid);
    if (!o) {
      const revived = reborn.includes(m.uid);
      hitEffect(el, revived ? 'reborn' : 'summon');
      fxAt(el, revived ? '复生' : '召唤', 'info');
      continue;
    }
    if (m.hp < o.hp) { fxAt(el, '-' + (o.hp - m.hp), 'dmg'); el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit'); }
    if (o.kw.ds && !m.kw.ds) { hitEffect(el, 'shield'); fxAt(el, '破盾', 'info'); SFX.play('shield'); }
    if (m.dead && !o.dead && m.hp >= o.hp) fxAt(el, '☠', 'dmg');
    const da = m.atk - o.atk, dh = m.hp - o.hp;
    if ((da > 0 && dh >= 0) || (dh > 0 && da >= 0)) fxAt(el, `+${da}/+${Math.max(0, dh)}`, 'buff');
  }
}
async function wait(ms) {
  let elapsed = 0, last = performance.now();
  while (elapsed < ms && !UI.skip) {
    await sleep(16);
    const now = performance.now();
    elapsed += (now - last) * UI.speed;
    last = now;
  }
}
async function playCombat(P) {
  UI.skip = false;
  const fr = P.frames;
  UI.replaySlots = fr.reduce((n, f) => Math.max(n, f.s[0].length, f.s[1].length), 0);
  setCombatView(P);
  let prev = fr[0].s;
  renderSnap(prev);
  layout();
  const rb = $('#resultBanner');
  rb.className = 'result-banner duel';
  rb.innerHTML = `<strong>交锋</strong><small>${esc(HEROES[P.heroes[0]].name)}　对阵　${esc(P.opp.name)}</small>`;
  rb.hidden = false;
  await wait(920);
  rb.hidden = true;
  for (let i = 1; i < fr.length && !UI.skip; i++) {
    const f = fr[i];
    if (f.type === 'attack') {
      await lunge(f.a, f.t, () => {
        const target = cbEl(f.t);
        SFX.play('hit');
        hitEffect(target, 'strike');
        for (const uid of f.cleave || []) effectTrail(target, cbEl(uid), 'cleave');
        renderSnap(f.s, prev);
      });
      await wait(160);
    } else if (f.type === 'sot') {
      const el = f.src ? cbEl(f.src) : null;
      if (el) { el.classList.add('lit'); fxAt(el, '战斗开始时', 'info'); }
      else if (f.hero != null) toast(`${HEROES[P.heroes[f.hero]].power.name}（英雄技能）`, true);
      else if (f.trinket) toast(`${f.side === 0 ? '你的' : '对手的'}饰品：${TRINKETS[f.trinket].art} ${TRINKETS[f.trinket].name}`, true);
      await wait(380);
      renderSnap(f.s, prev);
      await wait(420);
      if (el) el.classList.remove('lit');
    } else if (f.type === 'deaths') {
      SFX.play('death');
      renderSnap(f.s, prev, f.reborn);
      await wait(380);
    } else {
      renderSnap(f.s, prev);
    }
    prev = f.s;
  }
  if (UI.skip) renderSnap(fr[fr.length - 1].s);
  const { winner, dmg } = P.result;
  const ending = winner === 0 ? '胜利' : winner === 1 ? '败北' : '平局';
  const summary = winner === 0 ? `对 ${P.opp.name} 造成 ${dmg} 点伤害` : winner === 1 ? `受到 ${dmg} 点伤害` : '双方英雄均未受伤';
  if (winner >= 0 && !UI.skip) {
    const tgt = winner === 0 ? $('#oppCtl .lb-hero') : $('#heroPortrait');
    const src = winner === 0 ? $('#heroPortrait') : $('#oppCtl .lb-hero');
    await effectTrail(src, tgt, 'finisher');
    if (!UI.skip) { SFX.play('heroHit'); hitEffect(tgt, 'strike'); fxAt(tgt, '-' + dmg, 'dmg big'); }
  }
  rb.className = 'result-banner ' + (winner === 0 ? 'win' : winner === 1 ? 'loss' : 'tie');
  rb.innerHTML = `<strong>${ending}</strong><small>${esc(summary)}</small>`;
  rb.hidden = false;
  SFX.play(winner === 0 ? 'win' : winner === 1 ? 'lose' : 'death');
  if (UI.skip) await sleep(330);
  else await wait(1380);
  UI.skip = false;
  stopReplayMotion();
  $('#fx').replaceChildren();
  rb.hidden = true;
  // 清空战斗行，回到招募
  $('#shopRow').innerHTML = ''; $('#boardRow').innerHTML = '';
}

/* ================= 弹窗 ================= */
function openModal(html, kind, closable) {
  const m = $('#modal');
  $('#modalBody').innerHTML = (closable ? '<button class="btn btn-ghost modal-close" data-act="close">关闭</button>' : '') + html;
  m.hidden = false; m.dataset.kind = kind || ''; m.dataset.closable = closable ? '1' : '';
  $('#app').inert = true;
  $('#modalBody').scrollTop = 0;
  hideTip(); hideActPop();
}
function closeModal() {
  const m = $('#modal');
  m.hidden = true; m.dataset.kind = ''; $('#app').inert = false;
  hideTip();
}
$('#modal').addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (e.target === $('#modal') && $('#modal').dataset.closable) return closeModal();
  if (!b) return;
  const a = b.dataset.act;
  if (a === 'close') closeModal();
  else if (a === 'hero') startGame(b.dataset.hero);
  else if (a === 'disc') { closeModal(); act('discover', [+b.dataset.i], 'play', () => { if (ME().discoverQ.length) openDiscover(); }); }
  else if (a === 'libtier') openLibrary(+b.dataset.t);
  else if (a === 'again') openMenu();
  else if (a === 'help') openHelp(true);
  else if (a === 'back') (UI.backHero ? openHeroSelect() : openMenu());
  else if (a === 'resume') resumeGame();
  else if (a === 'aiLevel') { SET.aiLevel = b.dataset.v; SFX.play('buy'); document.querySelectorAll('[data-act=aiLevel]').forEach(x => x.classList.toggle('on', x === b)); }
  else if (a === 'menu') openMenu();
  else if (onlineModalAction(a, b, e)) { /* 联机界面按钮 */ }
  else if (a === 'settings') openSettings();
  else if (a === 'set') { const k = b.dataset.k; SET[k] = k === 'speed' ? +b.dataset.v : b.dataset.v === '1'; if (k === 'speed') UI.speed = SET.speed; if (k === 'timer') { if (UI.phase === 'recruit') startTimer(); } SFX.play('buy'); openSettings(); }
  else if (a === 'tk') { closeModal(); act('trinket', [b.dataset.id], 'upgrade', r => { if (!r.ok) openTrinkets(); }); }
  else if (a === 'tkLater') { UI.tkLater = true; closeModal(); render(); }
});
function staticCard(v) { const el = makeCard(v, 'static'); return el.outerHTML; }
function staticMinion(id, golden, atk, hp, extra = {}) {
  const d = CARDS[id];
  const v = Object.assign({ uid: 's' + id + Math.random().toString(36).slice(2, 6), id, atk: atk != null ? atk : d.atk * (golden ? 2 : 1), hp: hp != null ? hp : d.hp * (golden ? 2 : 1), golden, kw: Object.assign({}, d.kw), dr: !!d.deathrattle }, extra);
  delete v.kw.magnetic;
  const el = makeCard(v, 'static');
  el.dataset.cid = id; el.dataset.atk = v.atk; el.dataset.hp = v.hp; el.dataset.golden = golden ? '1' : '0';
  el.dataset.kw = JSON.stringify(v.kw); el.dataset.dr = v.dr ? '1' : '0';
  return el.outerHTML;
}

function openHeroSelect() {
  UI.phase = 'select'; UI.backHero = true;
  const opts = heroChoices(4);
  openModal(`<h2>选择英雄</h2><p class="lead">每位英雄拥有不同的护甲与技能。选择一位入席。</p>
    <div class="hero-grid">${opts.map(id => { const h = HEROES[id]; return `<button class="hero-card" data-act="hero" data-hero="${id}">
      <div class="hc-top">${heroPortrait(id)}<div><div class="hc-name">${esc(h.name)}</div><div class="hc-armor">生命 ${RULES.startHp} · 护甲 ${h.armor}</div></div></div>
      <div class="hc-pw"><b>${esc(h.power.name)}${h.power.passive ? '' : `（${h.power.cost}）`}</b>：${esc(h.power.text)}</div></button>`; }).join('')}</div>
    <div class="set-row"><span>AI 难度</span><div class="lib-tabs">${['easy', 'normal', 'hard'].map(k => `<button class="btn ${(SET.aiLevel || 'normal') === k ? 'on' : ''}" data-act="aiLevel" data-v="${k}">${AI_LEVELS[k].name}</button>`).join('')}</div></div>
    <div class="modal-actions">${savedTurn() ? `<button class="btn btn-brass" data-act="resume">继续上一局（第 ${savedTurn()} 回合）</button>` : ''}<button class="btn btn-ghost" data-act="menu">返回主菜单</button><button class="btn btn-ghost" data-act="help">规则</button></div>`, 'hero', false);
}
function startGame(heroId) {
  MODE = 'local'; UI.meId = 0;
  newGame(heroId, SET.aiLevel || 'normal');
  closeModal();
  UI.phase = 'recruit'; UI.lbDelta = {}; UI.sel = null; UI.targeting = null;
  $('#shopRow').innerHTML = ''; $('#boardRow').innerHTML = ''; $('#handRow').innerHTML = '';
  render();
  startTimer();
  SFX.play('upgrade');
  toast('本局种族：' + GAME.tribes.map(t => TRIBES[t].name).join('、'), true);
}
function openDiscover() {
  const p = ME(); const q = p.discoverQ[0]; if (!q) return;
  openModal(`<h2>发现</h2><p class="lead">选择一张 ${q.tier} 级随从加入手牌。</p><div class="disc-grid">${q.options.map((id, i) => {
    const d = CARDS[id];
    return `<button class="disc-opt" data-act="disc" data-i="${i}">${staticMinion(id, false)}<div class="li-name">${esc(d.name)}</div><div class="dt">${esc(tribeLabel(d) || '中立')}${d.text ? ' · ' + esc(d.text) : ''}</div></button>`;
  }).join('')}</div>`, 'discover', false);
}
function openHelp(fromSelect) {
  openModal(`<h2>规则说明</h2>
  <p class="lead">一局 8 人，每人 ${RULES.startHp} 点生命加英雄护甲。每回合先在酒馆招募，然后与一名随机对手自动战斗。</p>
  <h3>招募阶段</h3><ul>
   <li>铸币：第 1 回合 3 枚，之后每回合 +1，最多 10 枚。</li>
   <li>购买随从 3 枚，出售得 1 枚；刷新酒馆 1 枚；冻结后下回合保留酒馆。</li>
   <li>升级酒馆可以看到更高等级的随从。升级费用每回合自动降低 1。</li>
   <li>酒馆每次会展示一个酒馆法术，价格写在左上角。</li>
   <li>战场最多 7 个随从，手牌最多 10 张。所有玩家共享同一个随从卡池。</li>
   <li><b>三连</b>：集齐 3 张相同随从会合成一张金色随从（属性翻倍、效果翻倍）。打出金色随从可获得三连奖励，从更高一级中发现一张随从。</li>
   <li>每局随机启用 ${RULES.lobbyTribes} 个种族，另外 3 个种族的随从不会出现。</li>
   <li><b>饰品</b>：第 6 回合可以花铸币购买一个次级饰品，第 9 回合购买一个高级饰品，效果持续整局。</li>
   <li>排行榜上标着“下个对手”的就是你这回合要对战的玩家。</li>
  </ul>
  <h3>战斗阶段</h3><ul>
   <li>随从数量多的一方先攻，相同则随机。双方从左到右轮流派出随从攻击随机敌人（嘲讽优先）。</li>
   <li>一方随从全部阵亡即落败，受到伤害 = 对手酒馆等级 + 对手存活随从的等级之和。前期有伤害上限。</li>
   <li>落单的玩家会与最近出局玩家的“幽灵”对战。</li>
  </ul>
  <h3>联机</h3><ul>
   <li><b>快速匹配</b>：和其他在线玩家自动凑桌。凑满 8 人立即开局；至少 2 人时等待约 20 秒后开局，空位由 AI 补齐。</li>
   <li><b>房间</b>：创建后把 4 位房间号发给朋友，房主可以设置 AI 难度并随时开局。公开房间会出现在主菜单列表里。</li>
   <li>联机时每回合有招募时限，所有真人都点“结束回合”后立即开战。断线后重新打开页面会自动回到对局，期间由 AI 托管。</li>
  </ul>
  <h3>关键词</h3><ul class="kw-list">${Object.keys(KW_NAMES).map(k => `<li><b>${KW_NAMES[k]}</b>：${KW_HELP[k]}</li>`).join('')}
   <li><b>战吼</b>：从手牌打出时触发。</li><li><b>亡语</b>：死亡时触发。💀</li>
   <li><b>战斗开始时</b>：在第一次攻击前触发。⚔️</li><li><b>复仇（X）</b>：每有 X 个友方随从死亡触发一次。⏳</li></ul>
  <h3>操作</h3><ul>
   <li>点击酒馆中的随从购买，点击手牌打出；也可以直接拖拽。手机上先点一下查看，再点一下执行。</li>
   <li>点击战场上的随从可以出售或调整站位，或直接拖动排序、拖回酒馆出售。</li>
   <li>快捷键：R 刷新、F 冻结、U 升级、空格 结束回合。</li>
  </ul>
  ${fromSelect ? '<div class="modal-actions"><button class="btn btn-brass" data-act="back">返回选择英雄</button></div>' : ''}`, 'help', !fromSelect);
}
function openLibrary(tier) {
  const ids = Object.values(CARDS).filter(d => !d.token && d.tier === tier);
  const spells = Object.values(SPELLS).filter(s => s.tier === tier);
  openModal(`<h2>卡牌图鉴</h2><p class="lead">半透明的卡牌属于本局未启用的种族。</p>
   <div class="lib-tabs">${[1, 2, 3, 4, 5, 6].map(t => `<button class="btn ${t === tier ? 'on' : ''}" data-act="libtier" data-t="${t}">${t} 级</button>`).join('')}<button class="btn ${tier === 7 ? 'on' : ''}" data-act="libtier" data-t="7">饰品</button></div>
   ${tier === 7 ? `<div class="lib-grid">${Object.values(TRINKETS).filter(t => !t.tribe || !GAME || GAME.tribes.includes(t.tribe)).map(t => `<div class="lib-item"><div class="tk-big">${t.art}</div><div><div class="li-name">${esc(t.name)}</div><div class="li-meta">${t.grade === 'lesser' ? '次级饰品（第 6 回合）' : '高级饰品（第 9 回合）'} · ${t.cost} 铸币</div><div class="li-txt">${esc(t.text)}</div></div></div>`).join('')}</div>` : ''}
   <div class="lib-grid">${ids.map(d => `<div class="lib-item ${GAME && !poolEligible(d) ? 'off' : ''}">${staticMinion(d.id, false)}<div><div class="li-name">${esc(d.name)}</div>
     <div class="li-meta">${esc(tribeLabel(d) || '中立')} · ${d.atk}/${d.hp}${GAME && GAME.pool[d.id] != null ? ` · 卡池剩余 ${GAME.pool[d.id]}` : ''}</div>
     <div class="li-txt">${esc([...Object.keys(d.kw).map(k => KW_NAMES[k]), d.text].filter(Boolean).join('。'))}</div></div></div>`).join('')}
   ${spells.map(s => `<div class="lib-item"><div class="card spell" style="--cw:62px"><div class="frame">${cardArt(s.id, s.art, true)}<div class="nm">${esc(s.name)}</div></div><div class="price">${s.cost}</div></div><div><div class="li-name">${esc(s.name)}</div><div class="li-meta">酒馆法术 · ${s.cost} 铸币</div><div class="li-txt">${esc(s.text)}</div></div></div>`).join('')}</div>`, 'lib', true);
}
function openPlayer(pid) {
  const p = GAME && GAME.players[pid]; if (!p) return;
  const h = HEROES[p.hero];
  const mine = p.id === UI.meId;
  const board = mine && UI.phase === 'recruit' ? p.board : (p.lastBoard || []);
  openModal(`<h2>${h.art} ${esc(mine ? '你 · ' + h.name : p.isHuman ? p.name + ' · ' + h.name : h.name)}</h2>
   <p class="lead">生命 ${p.hp}${p.armor ? ` · 护甲 ${p.armor}` : ''} · 酒馆 ${p.lastTier || p.tier}${p.alive ? '' : ` · 第 ${p.place} 名`}<br><b style="color:var(--lantern);font-weight:500">${esc(h.power.name)}</b>：${esc(h.power.text)}</p>
   ${(p.trinkets || []).length ? `<h3>饰品</h3><div class="tk-list">${p.trinkets.map(id => `<div><b>${TRINKETS[id].art} ${esc(TRINKETS[id].name)}</b>：${esc(TRINKETS[id].text)}</div>`).join('')}</div>` : ''}
   <h3>${mine && UI.phase === 'recruit' ? '当前战场' : '上一场战斗的阵容'}</h3>
   <div class="board-view">${board.length ? board.map(m => staticMinion(m.id, m.golden, m.atk, m.hp, { kw: Object.assign({}, m.kw), dr: m.dr.length > 0, mags: m.mags || 0 })).join('') : '<span class="empty-hint">暂无</span>'}</div>
   <h3>战绩</h3><div class="hist">${p.history.length ? p.history.slice().reverse().map(x => `<div class="${x.res}">第 ${x.turn} 回合 · ${x.res === 'win' ? '胜' : x.res === 'loss' ? '负' : '平'} · ${esc(x.opp)}${x.dmg ? ` · ${x.res === 'win' ? '造成' : '受到'} ${x.dmg} 伤害` : ''}</div>`).join('') : '<span class="empty-hint">还没有战斗</span>'}</div>`, 'player', true);
}
function openGameOver() {
  const me = ME();
  const win = me.place === 1;
  const champ = GAME.players.find(p => p.place === 1);
  openModal(`<h2>${win ? '你是最后的赢家！' : '旅途到此为止'}</h2>
   <div style="display:flex;align-items:center;gap:22px;flex-wrap:wrap;margin:12px 0">
    <div class="over-place">#${me.place}</div>
    <div><p style="margin:0">英雄：${HEROES[me.hero].art} ${esc(HEROES[me.hero].name)}</p><p style="margin:0">坚持到第 ${GAME.turn} 回合 · 酒馆等级 ${me.lastTier || me.tier}</p>
    ${!win && champ ? `<p style="margin:0;color:var(--fog)">${GAME.over ? '冠军' : '目前领先'}：${HEROES[champ.hero].art} ${esc(champ.name)}</p>` : ''}</div></div>
   <h3>你的最终阵容</h3>
   <div class="board-view">${me.lastBoard.map(m => staticMinion(m.id, m.golden, m.atk, m.hp, { kw: Object.assign({}, m.kw), dr: m.dr.length > 0 })).join('') || '<span class="empty-hint">空</span>'}</div>
   <div class="modal-actions"><button class="btn btn-brass" data-act="again">再来一局</button></div>`, 'over', false);
}

/* ================= 饰品 / 设置 / 计时 / 存档 ================= */
$('#trinketBox').addEventListener('click', e => { if (e.target.closest('[data-act=pickTrinket]')) { UI.tkLater = false; openTrinkets(); } });
$('#btnSet').addEventListener('click', () => openSettings());
document.addEventListener('pointerdown', () => SFX.unlock(), { once: true });
function openTrinkets() {
  const p = ME(); if (!p.trinketOffer) return;
  const grade = TRINKETS[p.trinketOffer[0]].grade;
  openModal(`<h2>${grade === 'lesser' ? '次级饰品' : '高级饰品'}</h2><p class="lead">花费铸币购买一个饰品，效果持续整局。你现在有 ${p.gold} 枚铸币。</p>
   <div class="tk-grid">${p.trinketOffer.map(id => { const t = TRINKETS[id]; const can = p.gold >= t.cost;
     return `<button class="tk-opt" data-act="tk" data-id="${id}" ${can ? '' : 'disabled'}><span class="tk-cost">${t.cost}</span><span class="tk-big">${t.art}</span><span class="li-name">${esc(t.name)}</span><span class="dt">${esc(t.text)}</span></button>`; }).join('')}</div>
   <div class="modal-actions"><button class="btn btn-ghost" data-act="tkLater">先看看酒馆，稍后再选</button></div>`, 'trinket', false);
}
function openSettings() {
  const opt = (k, v, label) => `<button class="btn ${String(SET[k]) === String(v) || (SET[k] === true && v === '1') || (SET[k] === false && v === '0') ? 'on' : ''}" data-act="set" data-k="${k}" data-v="${v}">${label}</button>`;
  openModal(`<h2>设置</h2>
   <div class="set-row"><span>音效</span><div class="lib-tabs">${opt('sfx', '1', '开')}${opt('sfx', '0', '关')}</div></div>
   <div class="set-row"><span>回合计时</span><div class="lib-tabs">${opt('timer', '1', '开')}${opt('timer', '0', '关')}</div><small>开启后每回合有 40–90 秒的招募时间，时间到会自动结束回合。</small></div>
   <div class="set-row"><span>默认战斗速度</span><div class="lib-tabs">${opt('speed', 1, '1×')}${opt('speed', 2, '2×')}${opt('speed', 4, '4×')}</div></div>
   <div class="set-row"><span>联机服务器</span><input id="serverInput" class="inp" style="flex:1;min-width:200px" placeholder="${esc(NET.url())}" value="${esc((() => { try { return localStorage.getItem('mh_server') || ''; } catch (e) { return ''; } })())}"><button class="btn" data-act="saveServer">保存</button><small>留空使用默认地址：${esc(NET.url())}</small></div>
   ${MODE === 'online' && UI.phase !== 'over' ? '<div class="modal-actions"><button class="btn" data-act="quitOnline">退出联机对局（座位交给 AI）</button></div>' : ''}
   ${UI.phase === 'select' ? '<div class="modal-actions"><button class="btn btn-brass" data-act="back">返回</button></div>' : ''}`, 'settings', UI.phase !== 'select');
}
function stopTimer() { clearInterval(UI.tmr); UI.deadline = null; updateEndBtn(); }
function startTimer(remainingMs) {
  clearInterval(UI.tmr); UI.deadline = null;
  if (MODE === 'online' && remainingMs != null) {
    UI.deadline = Date.now() + remainingMs;
    UI.lastTick = null;
    UI.tmr = setInterval(tickTimer, 200);
  } else if (MODE === 'local' && SET.timer && UI.phase === 'recruit') {
    const secs = Math.min(90, 35 + GAME.turn * 5);
    UI.deadline = Date.now() + secs * 1000;
    UI.lastTick = null;
    UI.tmr = setInterval(tickTimer, 200);
  }
  updateEndBtn();
}
function updateEndBtn() {
  const b = $('#btnEnd');
  if (MODE === 'online' && UI.ready) {
    const ri = UI.readyInfo;
    const left = UI.deadline ? Math.max(0, Math.ceil((UI.deadline - Date.now()) / 1000)) : 0;
    b.innerHTML = `等待其他玩家<small>${ri ? `${ri.n}/${ri.total} 已就绪 · ` : ''}${left} 秒</small>`;
    b.classList.remove('urgent'); b.classList.add('waiting');
    return;
  }
  b.classList.remove('waiting');
  if (!UI.deadline) { b.innerHTML = '结束回合'; b.classList.remove('urgent'); return; }
  const left = Math.max(0, Math.ceil((UI.deadline - Date.now()) / 1000));
  b.innerHTML = `结束回合<small>${left} 秒</small>`;
  b.classList.toggle('urgent', left <= 10);
  if (left <= 5 && left !== UI.lastTick && left > 0) { UI.lastTick = left; SFX.play('tick'); }
}
function tickTimer() {
  if (UI.phase !== 'recruit' || !UI.deadline) { clearInterval(UI.tmr); return; }
  updateEndBtn();
  if (Date.now() >= UI.deadline && MODE === 'online') { clearInterval(UI.tmr); $('#btnEnd').innerHTML = '结算中…'; return; }
  if (Date.now() >= UI.deadline) {
    clearInterval(UI.tmr);
    const p = ME();
    if (UI.drag) cancelDrag();
    endTargeting();
    while (p.discoverQ.length) resolveDiscover(p, 0);
    if (p.trinketOffer) { const c = p.trinketOffer.filter(id => TRINKETS[id].cost <= p.gold); if (c.length) actPickTrinket(p, c[0]); else p.trinketOffer = null; }
    closeModal();
    toast('时间到，自动结束回合', true);
    endTurnClick();
  }
}
let saveTimer = null;
function saveNow() { clearTimeout(saveTimer); if (MODE === 'local' && UI.phase === 'recruit' && GAME && !GAME.over && ME().alive) { try { localStorage.setItem('mh_save', serializeGame()); } catch (e) { /* 忽略 */ } } }
function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 300); }
window.addEventListener('pagehide', saveNow);
document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });
function clearSave() { try { localStorage.removeItem('mh_save'); } catch (e) { /* 忽略 */ } }
function savedTurn() { try { const s = localStorage.getItem('mh_save'); if (!s) return 0; return JSON.parse(s).g.turn || 0; } catch (e) { return 0; } }
function resumeGame() {
  let ok = false;
  try { ok = loadGame(localStorage.getItem('mh_save')); } catch (e) { ok = false; }
  MODE = 'local'; UI.meId = 0;
  if (!ok || !ME().alive) { clearSave(); toast('存档无法读取，已重新开始'); openHeroSelect(); return; }
  closeModal();
  UI.phase = 'recruit'; UI.lbDelta = {}; UI.sel = null; UI.targeting = null; UI.tkLater = false;
  $('#shopRow').innerHTML = ''; $('#boardRow').innerHTML = ''; $('#handRow').innerHTML = '';
  render(); startTimer();
  toast(`已继续第 ${GAME.turn} 回合`, true);
}
UI.speed = SET.speed || 1;

/* ================= 启动 ================= */
layout();
