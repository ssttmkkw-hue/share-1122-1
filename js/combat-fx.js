/* 回放只读取引擎快照。所有飞行与粒子均可加速、跳过和清理。 */
'use strict';

const replayAnimations = new Set();
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function replayMotion(el, frames, duration, easing = 'ease-out') {
  const animation = el.animate(frames, { duration, easing });
  animation.playbackRate = UI.speed;
  replayAnimations.add(animation);
  return animation.finished.catch(() => {}).finally(() => replayAnimations.delete(animation));
}
function stopReplayMotion() {
  for (const animation of replayAnimations) animation.cancel();
}
function centerOf(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
function effectNode(type, point) {
  const el = document.createElement('i');
  el.className = 'replay-fx ' + type;
  el.style.left = point.x + 'px';
  el.style.top = point.y + 'px';
  $('#fx').appendChild(el);
  return el;
}
function hitEffect(target, kind) {
  if (!target || UI.skip || reducedMotion.matches) return;
  const at = centerOf(target);
  const halo = effectNode('impact-ring ' + kind, at);
  replayMotion(halo, [
    { transform: 'scale(.24)', opacity: 1 },
    { transform: 'scale(1.45)', opacity: 0 },
  ], 340).then(() => halo.remove());
  const count = kind === 'shield' ? 10 : 6;
  for (let i = 0; i < count; i++) {
    const particle = effectNode('impact-shard ' + kind, at);
    const angle = (i + .3) * 360 / count;
    const reach = (i % 2 ? 23 : 39) + target.offsetWidth * .16;
    replayMotion(particle, [
      { transform: `rotate(${angle}deg) translateX(5px)`, opacity: 1 },
      { transform: `rotate(${angle}deg) translateX(${reach}px) scale(.35)`, opacity: 0 },
    ], 380).then(() => particle.remove());
  }
}
function effectTrail(from, to, kind) {
  if (!from || !to || UI.skip || reducedMotion.matches) return Promise.resolve();
  const src = centerOf(from), dst = centerOf(to);
  const dx = dst.x - src.x, dy = dst.y - src.y;
  const angle = Math.atan2(dy, dx);
  const bolt = effectNode('effect-trail ' + kind, src);
  return replayMotion(bolt, [
    { transform: `rotate(${angle}rad) scaleX(.1)`, opacity: .4 },
    { transform: `translate(${dx * .42}px,${dy * .42}px) rotate(${angle}rad)`, opacity: 1, offset: .48 },
    { transform: `translate(${dx}px,${dy}px) rotate(${angle}rad) scaleX(.4)`, opacity: .85 },
  ], kind === 'finisher' ? 410 : 180, 'ease-in').finally(() => bolt.remove());
}
function departCard(el) {
  if (UI.skip || reducedMotion.matches) return;
  const rect = el.getBoundingClientRect();
  const ghost = el.cloneNode(true);
  ghost.removeAttribute('data-zone');
  ghost.removeAttribute('data-uid');
  ghost.className += ' departed';
  ghost.style.setProperty('--cw', rect.width + 'px');
  ghost.style.left = rect.left + 'px';
  ghost.style.top = rect.top + 'px';
  $('#fx').appendChild(ghost);
  replayMotion(ghost, [
    { opacity: .95, transform: 'scale(1)', filter: 'saturate(.45)' },
    { opacity: .85, transform: 'scale(1.05) rotate(-3deg)', offset: .25 },
    { opacity: 0, transform: 'translateY(12px) scale(.48) rotate(7deg)', filter: 'grayscale(1) brightness(.4)' },
  ], 320).then(() => ghost.remove());
}
async function lunge(aUid, tUid, onImpact) {
  const a = cbEl(aUid), t = cbEl(tUid);
  if (!a || !t || reducedMotion.matches) { onImpact(); return; }
  const src = centerOf(a), dst = centerOf(t);
  const dx = dst.x - src.x, dy = dst.y - src.y;
  const k = 1 - Math.min(.45, a.offsetHeight * .55 / Math.max(1, Math.hypot(dx, dy)));
  const contact = `translate(${dx * k}px,${dy * k}px) scale(1.07)`;
  SFX.play('swing');
  a.style.zIndex = 21;
  t.classList.add('under-attack');
  await replayMotion(a, [
    { transform: 'none' },
    { transform: `translate(${-dx * .055}px,${-dy * .09}px) scale(1.12) rotate(-3deg)`, offset: .58 },
    { transform: contact },
  ], 290, 'ease-in');
  if (!UI.skip) {
    a.style.transform = contact;
    onImpact();
    await replayMotion(a, [
      { transform: contact, offset: .15 },
      { transform: 'none' },
    ], 285);
  }
  a.style.transform = ''; a.style.zIndex = '';
  t.classList.remove('under-attack');
}
