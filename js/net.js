/* 雾港棋馆 · 联机连接（WebSocket，自动重连） */
'use strict';

// 部署到 Render 后，如果服务名不同，改这里或在游戏“设置”里填写服务器地址
const DEFAULT_SERVER = 'wss://mistharbor-autochess.onrender.com';

const NET = {
  ws: null,
  ready: false,
  connecting: null,
  rid: 0,
  pending: new Map(),
  handlers: {},
  stay: false,        // 在房间 / 对局中时断线会自动重连
  retry: 0,
  token: (() => { try { return localStorage.getItem('mh_token') || ''; } catch (e) { return ''; } })(),

  url() {
    let u = '';
    try { u = (localStorage.getItem('mh_server') || '').trim(); } catch (e) { /* 忽略 */ }
    if (u) return u.replace(/^http/, 'ws').replace(/\/+$/, '');
    const h = location.hostname;
    if (/^https?:$/.test(location.protocol) && h && !/github\.io$/.test(h) && !/claude/.test(h)) {
      return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
    }
    return DEFAULT_SERVER;
  },
  on(t, fn) { this.handlers[t] = fn; },
  status(text, kind) { if (typeof onNetStatus === 'function') onNetStatus(text, kind); },

  /** patient=false 时只尝试一次（主菜单后台探测用） */
  connect(patient = true) {
    if (this.ready) return Promise.resolve();
    if (this.connecting) return this.connecting;
    const url = this.url();
    if (patient || !this.probed) this.status('正在连接服务器…（免费服务器休眠时，首次唤醒约需 30–60 秒）', 'wait');
    this.probed = true;
    // 先用 HTTP 唤醒 Render 上休眠的实例
    try { fetch(url.replace(/^ws/, 'http') + '/healthz', { mode: 'no-cors', cache: 'no-store' }).catch(() => {}); } catch (e) { /* 忽略 */ }
    this.connecting = new Promise((resolve, reject) => {
      let settled = false;
      const deadline = Date.now() + (patient ? 75000 : 0);
      const attempt = () => {
        let ws;
        try { ws = new WebSocket(url); } catch (e) { fail('服务器地址无效：' + url); return; }
        this.ws = ws;
        ws.onopen = () => {
          ws.send(JSON.stringify({ t: 'hello', token: this.token, name: playerName() }));
        };
        ws.onmessage = ev => {
          let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
          if (m.t === 'hello') {
            this.token = m.token;
            try { localStorage.setItem('mh_token', m.token); } catch (e) { /* 忽略 */ }
            this.ready = true; this.retry = 0;
            this.status('已连接服务器', 'ok');
            if (!settled) { settled = true; this.connecting = null; resolve(); }
          }
          this.dispatch(m);
        };
        ws.onclose = () => {
          const was = this.ready;
          this.ready = false;
          if (this.ws === ws) this.ws = null;
          for (const [, p] of this.pending) p.reject(new Error('closed'));
          this.pending.clear();
          if (!settled) {
            if (Date.now() < deadline) { setTimeout(attempt, 2500); return; }
            fail(patient ? '无法连接服务器：' + url : '联机服务器未连接，点击“快速匹配”或“创建房间”时会再次尝试');
            return;
          }
          if (was) this.onDrop();
        };
      };
      const fail = msg => { settled = true; this.connecting = null; this.status(msg, 'bad'); reject(new Error(msg)); };
      attempt();
    });
    return this.connecting;
  },
  onDrop() {
    if (!this.stay) { this.status('与服务器断开', 'bad'); return; }
    this.retry++;
    const wait = Math.min(10000, 1000 * this.retry);
    if (typeof toast === 'function') toast(`连接中断，${Math.round(wait / 1000)} 秒后重连…`);
    setTimeout(() => this.connect().catch(() => this.onDrop()), wait);
  },
  dispatch(m) {
    if (m.t === 'reply' && this.pending.has(m.rid)) {
      const p = this.pending.get(m.rid); this.pending.delete(m.rid); p.resolve(m); return;
    }
    const h = this.handlers[m.t];
    if (h) h(m);
  },
  send(t, data = {}) {
    if (!this.ws || this.ws.readyState !== 1) return false;
    this.ws.send(JSON.stringify(Object.assign({ t }, data)));
    return true;
  },
  request(t, data = {}) {
    return new Promise((resolve, reject) => {
      const rid = ++this.rid;
      if (!this.send(t, Object.assign({ rid }, data))) { reject(new Error('offline')); return; }
      this.pending.set(rid, { resolve, reject });
      setTimeout(() => { if (this.pending.has(rid)) { this.pending.delete(rid); reject(new Error('timeout')); } }, 10000);
    });
  },
};

function playerName() {
  try { return localStorage.getItem('mh_name') || ''; } catch (e) { return ''; }
}
