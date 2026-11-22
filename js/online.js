/* 雾港棋馆 · 主菜单与联机流程（快速匹配 / 房间） */
'use strict';

function applyServerState(g) {
  GAME = g;
  GAME.lastDead = g.lastDead != null ? g.players[g.lastDead] : null;
}
function onNetStatus(text, kind) {
  const el = document.getElementById('netStatus');
  if (el) { el.textContent = text; el.className = 'net-status ' + (kind || ''); }
}
function setName(v) {
  const n = String(v || '').trim().slice(0, 12);
  try { localStorage.setItem('mh_name', n); } catch (e) { /* 忽略 */ }
  if (NET.ready) NET.send('setName', { name: n });
}
const SANDBOXED = /claude/.test(location.hostname) && !(() => { try { return localStorage.getItem('mh_server'); } catch (e) { return ''; } })();
const SANDBOX_MSG = '这个预览页面不能连接外部服务器。联机请打开部署在 Render 上的游戏网址。';
async function online(fn) {
  if (SANDBOXED) { toast(SANDBOX_MSG); return; }
  try { await NET.connect(); fn(); } catch (e) { toast(e.message || '无法连接服务器'); }
}

/* ---------------- 主菜单 ---------------- */
function openMenu() {
  UI.phase = 'select'; UI.backHero = false;
  if (MODE === 'online') { NET.stay = false; NET.send('leave'); }
  MODE = 'local'; UI.meId = 0;
  stopTimer();
  const saved = savedTurn();
  openModal(`<header class="lobby-nav"><div class="lobby-brand"><i class="compass" aria-hidden="true">✦</i><span>雾港棋馆</span></div>
    <nav aria-label="大厅导航"><button data-act="help">规则手册</button><button data-act="settings">设置</button></nav></header>
    <main class="lobby-main">
      <div class="lobby-hero"><div class="wordmark" lang="en">Mistharbor Tavern</div><h1>雾港棋馆</h1>
        <div class="filigree" aria-hidden="true"><i></i>✧<i></i></div>
        <p>招募随从，布阵交锋。八位旅人，争夺酒馆的最后一席。</p>
        ${saved ? `<button class="btn btn-brass" data-act="resume">继续单人游戏 · 第 ${saved} 回合　→</button>` : ''}</div>
      <section class="mode-section"><h2 class="ruled">选择对战模式</h2>
        <div class="menu-grid">
          <button class="mode-card solo" data-act="solo"><span class="mode-copy"><b>单人冒险</b><small>挑战七位 AI 对手</small></span><i aria-hidden="true">→</i></button>
          <button class="mode-card quick" data-act="quick"><span class="mode-copy"><b>快速匹配</b><small>与在线玩家同桌竞技</small></span><i aria-hidden="true">→</i></button>
          <button class="mode-card create" data-act="create"><span class="mode-copy"><b>创建房间</b><small>邀请好友，相聚酒馆</small></span><i aria-hidden="true">→</i></button>
        </div></section>
      <div class="lobby-social"><section><h2>旅人登记</h2>
        <div class="lobby-form"><label for="nameInput">昵称</label><input id="nameInput" class="inp" maxlength="12" placeholder="输入昵称" value="${esc(playerName())}">
        <label for="codeInput">加入房间</label><div class="join-field"><input id="codeInput" class="inp code-inp" maxlength="4" placeholder="房间号" autocomplete="off"><button class="btn" data-act="join">加入</button></div></div></section>
        <section><div class="room-heading"><h2>公开房间</h2><button class="text-action" data-act="refreshRooms">↻ 刷新</button></div>
        <div id="roomList" class="room-list"><span class="empty-hint">连接服务器后显示</span></div><div id="netStatus" class="net-status" role="status"></div></section></div>
    </main>`, 'menu', false);
  $('#nameInput').addEventListener('change', e => setName(e.target.value));
  $('#codeInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('[data-act=join]').click(); });
  if (SANDBOXED) onNetStatus(SANDBOX_MSG, 'bad');
  else if (NET.ready) { onNetStatus('已连接服务器', 'ok'); NET.send('listRooms'); }
  else if (!NET.connecting) NET.connect(false).then(() => NET.send('listRooms')).catch(() => {});
}
function renderRoomList(m) {
  const el = document.getElementById('roomList');
  if (!el) return;
  const extra = `<div class="room-meta">在线 ${m.online} 人 · 匹配队列 ${m.queue} 人</div>`;
  el.innerHTML = (m.rooms.length ? m.rooms.map(r => `<button class="room-item" data-act="joinCode" data-code="${r.code}"><b>${r.code}</b><span>${esc(r.host)} 的房间</span><span>${r.n}/8 · AI ${AI_LEVELS[r.aiLevel].name}</span></button>`).join('')
    : '<span class="empty-hint">暂时没有公开房间，创建一个吧</span>') + extra;
}

/* ---------------- 匹配 ---------------- */
function openQueue(m) {
  const txt = m.n >= 2 ? (m.startsIn != null ? `${m.startsIn} 秒后开局，空位由 AI 补齐` : '即将开局') : '等待其他玩家加入（至少 2 名真人才会开局）';
  if ($('#modal').dataset.kind === 'queue') { $('#queueN').textContent = m.n; $('#queueTxt').textContent = txt; return; }
  openModal(`<h2>快速匹配</h2><p class="lead">正在寻找对手。凑满 8 人立即开局。</p>
    <div class="queue-box"><div class="queue-n"><span id="queueN">${m.n}</span><small>/ 8</small></div><div id="queueTxt">${txt}</div></div>
    <div class="modal-actions"><button class="btn" data-act="queueCancel">取消匹配</button><button class="btn btn-ghost" data-act="solo">改玩单人</button></div>`, 'queue', false);
}

/* ---------------- 房间 ---------------- */
function openRoom(m) {
  NET.stay = true;
  if (m.state !== 'lobby') return;
  const ai = 8 - m.players.length;
  openModal(`<h2>房间 <span class="room-code">${m.code}</span></h2>
    <p class="lead">把房间号发给朋友，在主菜单输入即可加入。最多 8 人，空位由 AI 补齐。</p>
    <div class="room-players">${m.players.map(p => `<div class="rp ${p.you ? 'you' : ''}">${p.host ? '👑' : '👤'} ${esc(p.name)}${p.you ? '（你）' : ''}${p.online ? '' : ' · 离线'}</div>`).join('')}
      ${Array.from({ length: ai }, () => '<div class="rp ai">🤖 AI</div>').join('')}</div>
    <div class="set-row"><span>AI 难度</span><div class="lib-tabs">${['easy', 'normal', 'hard'].map(k => `<button class="btn ${m.aiLevel === k ? 'on' : ''}" data-act="roomAi" data-v="${k}" ${m.host ? '' : 'disabled'}>${AI_LEVELS[k].name}</button>`).join('')}</div></div>
    <div class="set-row"><span>公开房间</span><div class="lib-tabs"><button class="btn ${m.public ? 'on' : ''}" data-act="roomPublic" data-v="1" ${m.host ? '' : 'disabled'}>公开</button><button class="btn ${m.public ? '' : 'on'}" data-act="roomPublic" data-v="0" ${m.host ? '' : 'disabled'}>仅房间号</button></div></div>
    <div class="modal-actions">
      ${m.host ? `<button class="btn btn-brass" data-act="roomStart">开始游戏（${m.players.length} 人 + ${ai} 个 AI）</button>` : '<span class="empty-hint">等待房主开始…</span>'}
      <button class="btn" data-act="copyCode" data-code="${m.code}">复制房间号</button>
      <button class="btn btn-ghost" data-act="roomLeave">离开房间</button>
    </div>`, 'room', false);
}

/* ---------------- 选英雄 ---------------- */
function openOnlineHeroPick(m) {
  NET.stay = true;
  UI.pickDeadline = Date.now() + m.remaining;
  const picked = m.picked;
  openModal(`<h2>选择英雄</h2><p class="lead">本桌 ${m.players} 名真人玩家。<span id="pickLeft"></span></p>
    <div class="hero-grid">${m.options.map(id => { const h = HEROES[id]; return `<button class="hero-card ${picked === id ? 'chosen' : ''}" data-act="opick" data-hero="${id}" ${picked ? 'disabled' : ''}>
      <div class="hc-top">${heroPortrait(id)}<div><div class="hc-name">${esc(h.name)}</div><div class="hc-armor">生命 ${RULES.startHp} · 护甲 ${h.armor}</div></div></div>
      <div class="hc-pw"><b>${esc(h.power.name)}${h.power.passive ? '' : `（${h.power.cost}）`}</b>：${esc(h.power.text)}</div></button>`; }).join('')}</div>
    <p id="pickWait" class="lead" style="margin-top:14px">${picked ? '已选择，等待其他玩家…' : ''}</p>`, 'heroPick', false);
  clearInterval(UI.pickTmr);
  UI.pickTmr = setInterval(() => {
    const el = document.getElementById('pickLeft');
    if (!el) { clearInterval(UI.pickTmr); return; }
    el.textContent = `剩余 ${Math.max(0, Math.ceil((UI.pickDeadline - Date.now()) / 1000))} 秒，超时自动选择第一个。`;
  }, 250);
}

/* ---------------- 对局 ---------------- */
function onState(m) {
  MODE = 'online'; NET.stay = true;
  if (UI.phase === 'combat') { UI.pendingState = m; return; }
  const turnBefore = GAME && GAME.turn;
  applyServerState(m.g);
  UI.meId = m.meId;
  if (m.deltas) UI.lbDelta = m.deltas;
  UI.ready = (m.ready || []).includes(m.meId);
  if (m.waiting) {
    UI.phase = 'combat-wait';
    closeModal();
    showWaiting('本回合战斗进行中，下回合开始时继续');
    renderLeaderboard();
    return;
  }
  const kind = $('#modal').dataset.kind;
  if (['menu', 'room', 'queue', 'heroPick', 'hero', 'settings', 'help'].includes(kind)) closeModal();
  hideWaiting();
  const fresh = UI.phase !== 'recruit' || turnBefore !== GAME.turn;
  UI.phase = 'recruit';
  if (fresh) {
    UI.tkLater = false; UI.sel = null; UI.targeting = null;
    $('#shopRow').innerHTML = ''; $('#boardRow').innerHTML = ''; $('#handRow').innerHTML = '';
    if (GAME.turn === 1) toast('本局种族：' + GAME.tribes.map(t => TRIBES[t].name).join('、'), true);
    if (GAME.turn === 6) toast('饰品商人来了：选择一个次级饰品', true);
    if (GAME.turn === 9) toast('饰品商人来了：选择一个高级饰品', true);
  }
  render();
  startTimer(m.remaining);
}
function onlineEndTurn() {
  const me = ME();
  if (UI.ready) return;
  if (me.discoverQ.length) { openDiscover(); return; }
  if (me.trinketOffer && me.trinketOffer.some(id => TRINKETS[id].cost <= me.gold)) { openTrinkets(); return; }
  endTargeting(); UI.sel = null; hideActPop();
  NET.send('endTurn');
  UI.ready = true;
  SFX.play('buy');
  updateEndBtn();
}
async function onCombat(m) {
  if (UI.phase === 'combat') return;
  MODE = 'online';
  applyServerState(m.g);
  const before = {};
  GAME.players.forEach(p => { before[p.id] = p.hp + p.armor; });
  UI.phase = 'combat';
  clearInterval(UI.tmr);
  endTargeting(); UI.sel = null; hideActPop(); hideTip();
  if (['discover', 'trinket'].includes($('#modal').dataset.kind)) closeModal();
  hideWaiting();
  renderLeaderboard();
  await playCombat(m.p);
  NET.send('combatDone');
  UI.phase = 'combat-wait';
  if (UI.pendingOver) { const o = UI.pendingOver; UI.pendingOver = null; showOnlineOver(o); return; }
  if (UI.pendingState) { const s = UI.pendingState; UI.pendingState = null; onState(s); return; }
  showWaiting('等待其他玩家看完战斗…');
}
function showWaiting(text) {
  const rb = $('#resultBanner');
  rb.className = 'result-banner tie waiting-banner'; rb.textContent = text; rb.hidden = false;
  $('#btnEnd').disabled = true;
}
function hideWaiting() { const rb = $('#resultBanner'); if (rb.classList.contains('waiting-banner')) rb.hidden = true; }
function onOver(m) {
  applyServerState(m.g);
  if (m.deltas) UI.lbDelta = m.deltas;
  if (UI.phase === 'combat') { UI.pendingOver = m; return; }
  showOnlineOver(m);
}
function showOnlineOver(m) {
  UI.phase = 'over'; NET.stay = false; stopTimer(); hideWaiting();
  renderLeaderboard();
  const me = GAME.players[UI.meId];
  const win = m.place === 1;
  openModal(`<h2>${win ? '你是最后的赢家！' : '旅途到此为止'}</h2>
   <div style="display:flex;align-items:center;gap:22px;flex-wrap:wrap;margin:12px 0">
    <div class="over-place">#${m.place}</div>
    <div><p style="margin:0">英雄：${HEROES[me.hero].art} ${esc(HEROES[me.hero].name)}</p><p style="margin:0">坚持到第 ${GAME.turn} 回合 · 酒馆等级 ${me.lastTier || me.tier}</p>
    <p style="margin:0;color:var(--fog)">${m.final ? '本局已结束' : '其他玩家还在继续，可以在左侧排行榜看到战况'}</p></div></div>
   <h3>你的最终阵容</h3>
   <div class="board-view">${(me.lastBoard || []).map(x => staticMinion(x.id, x.golden, x.atk, x.hp, { kw: Object.assign({}, x.kw), dr: x.dr.length > 0 })).join('') || '<span class="empty-hint">空</span>'}</div>
   <div class="modal-actions"><button class="btn btn-brass" data-act="menu">返回主菜单</button></div>`, 'over', false);
  SFX.play(win ? 'win' : 'lose');
}

/* ---------------- 弹窗按钮 ---------------- */
function onlineModalAction(a, b) {
  switch (a) {
    case 'solo': if (MODE === 'local' && NET.ready) NET.send('queueLeave'); UI.backHero = true; openHeroSelect(); return true;
    case 'quick': setName($('#nameInput') ? $('#nameInput').value : playerName()); online(() => NET.send('queueJoin')); return true;
    case 'create': setName($('#nameInput') ? $('#nameInput').value : playerName()); online(() => NET.send('roomCreate', { public: true, aiLevel: SET.aiLevel || 'normal' })); return true;
    case 'join': {
      const code = ($('#codeInput').value || '').trim().toUpperCase();
      if (code.length !== 4) { toast('请输入 4 位房间号'); return true; }
      setName($('#nameInput').value);
      online(() => NET.send('roomJoin', { code }));
      return true;
    }
    case 'joinCode': setName($('#nameInput') ? $('#nameInput').value : playerName()); online(() => NET.send('roomJoin', { code: b.dataset.code })); return true;
    case 'refreshRooms': online(() => NET.send('listRooms')); return true;
    case 'queueCancel': NET.send('queueLeave'); openMenu(); return true;
    case 'roomAi': NET.send('roomSet', { aiLevel: b.dataset.v }); return true;
    case 'roomPublic': NET.send('roomSet', { public: b.dataset.v === '1' }); return true;
    case 'roomStart': NET.send('roomStart'); return true;
    case 'roomLeave': NET.stay = false; NET.send('leave'); openMenu(); return true;
    case 'copyCode': {
      const c = b.dataset.code;
      if (navigator.clipboard) navigator.clipboard.writeText(c).then(() => toast('已复制房间号 ' + c, true)).catch(() => toast('房间号：' + c, true));
      else toast('房间号：' + c, true);
      return true;
    }
    case 'opick': NET.send('pickHero', { hero: b.dataset.hero }); SFX.play('upgrade');
      document.querySelectorAll('[data-act=opick]').forEach(x => { x.disabled = true; x.classList.toggle('chosen', x === b); });
      $('#pickWait').textContent = '已选择，等待其他玩家…';
      return true;
    case 'quitOnline': NET.stay = false; NET.send('leave'); toast('已退出对局，你的座位由 AI 接管', true); openMenu(); return true;
    case 'saveServer': {
      const v = ($('#serverInput').value || '').trim();
      try { if (v) localStorage.setItem('mh_server', v); else localStorage.removeItem('mh_server'); } catch (e) { /* 忽略 */ }
      if (NET.ws) { NET.stay = false; NET.ws.close(); }
      toast('已保存服务器地址：' + NET.url(), true);
      return true;
    }
    default: return false;
  }
}

/* ---------------- 服务器消息 ---------------- */
NET.on('rooms', renderRoomList);
NET.on('queue', m => { NET.stay = true; openQueue(m); });
NET.on('room', openRoom);
NET.on('heroPick', openOnlineHeroPick);
NET.on('heroPicked', m => { const el = document.getElementById('pickWait'); if (el && m.waiting > 0 && el.textContent) el.textContent = `已选择，等待其他 ${m.waiting} 名玩家…`; });
NET.on('state', onState);
NET.on('ready', m => { UI.readyInfo = m; UI.ready = (m.ready || []).includes(UI.meId); if (UI.phase === 'recruit') updateEndBtn(); });
NET.on('combat', onCombat);
NET.on('over', onOver);
NET.on('final', m => toast(`本局结束，冠军：${m.champion}`, true));
NET.on('error', m => toast(m.msg));
NET.on('lobby', () => {
  NET.stay = false;
  if (MODE === 'online' && UI.phase !== 'over') { MODE = 'local'; toast('对局已结束或房间已关闭'); openMenu(); }
  else if (['queue', 'room', 'heroPick'].includes($('#modal').dataset.kind)) openMenu();
});

/* ---------------- 启动 ---------------- */
openMenu();
