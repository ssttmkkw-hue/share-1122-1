/* 雾港棋馆 · 设置与音效（WebAudio 合成，无外部音频文件） */
'use strict';

const SET = (() => {
  const def = { sfx: true, timer: false, speed: 1 };
  let s = def;
  try { s = Object.assign({}, def, JSON.parse(localStorage.getItem('mh_settings') || '{}')); } catch (e) { /* 无存储 */ }
  return new Proxy(s, {
    set(o, k, v) { o[k] = v; try { localStorage.setItem('mh_settings', JSON.stringify(o)); } catch (e) { /* 忽略 */ } return true; },
  });
})();

const SFX = (() => {
  let ac = null;
  function ctx() {
    if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }
  function tone(f, dur, type = 'sine', vol = 0.12, when = 0, slide = 0) {
    const c = ac, t = c.currentTime + when;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol = 0.1, freq = 1500, when = 0) {
    const c = ac, t = c.currentTime + when;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = buf; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 0.8;
    g.gain.value = vol;
    src.connect(f).connect(g).connect(c.destination);
    src.start(t);
  }
  const lib = {
    buy() { tone(1320, 0.07, 'triangle', 0.1); tone(1760, 0.14, 'triangle', 0.09, 0.06); },
    sell() { tone(990, 0.07, 'triangle', 0.09); tone(1320, 0.07, 'triangle', 0.08, 0.05); tone(1760, 0.12, 'triangle', 0.07, 0.1); },
    play() { tone(170, 0.16, 'sine', 0.28, 0, -90); noise(0.07, 0.07, 700); },
    refresh() { noise(0.28, 0.09, 2600); tone(600, 0.2, 'sine', 0.03, 0, 500); },
    upgrade() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, 'triangle', 0.1, i * 0.08)); },
    freeze() { tone(2200, 0.35, 'sine', 0.05, 0, 900); tone(2900, 0.3, 'sine', 0.03, 0.06); },
    hit() { noise(0.11, 0.2, 1100); tone(130, 0.12, 'square', 0.06, 0, -70); },
    shield() { tone(2100, 0.22, 'sine', 0.07, 0, -1200); noise(0.09, 0.05, 5200); },
    death() { tone(240, 0.32, 'sawtooth', 0.05, 0, -170); },
    triple() { [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.28, 'triangle', 0.11, i * 0.09)); },
    win() { [523, 784, 1046].forEach((f, i) => tone(f, 0.35, 'triangle', 0.11, i * 0.12)); },
    lose() { [392, 330, 262].forEach((f, i) => tone(f, 0.4, 'sine', 0.1, i * 0.14)); },
    heroHit() { noise(0.25, 0.22, 400); tone(90, 0.3, 'square', 0.07, 0, -40); },
    tick() { tone(1250, 0.04, 'square', 0.035); },
    deny() { tone(220, 0.09, 'square', 0.04); tone(180, 0.12, 'square', 0.04, 0.08); },
  };
  return {
    play(name) {
      if (!SET.sfx || !lib[name]) return;
      if (!ctx()) return;
      try { lib[name](); } catch (e) { /* 忽略 */ }
    },
    unlock() { if (SET.sfx) ctx(); },
  };
})();
