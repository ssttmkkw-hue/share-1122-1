/* 雾港棋馆 · 卡牌数据
 * 所有随从、法术、英雄均为原创设计，机制参考"酒馆自走棋"类游戏的通用玩法。
 * ctx 接口见 engine.js（招募阶段 rctx / 战斗阶段 cctx 共用同名方法）。
 */
'use strict';

const TRIBES = {
  beast:     { name: '野兽', color: '#6f9a3b' },
  mech:      { name: '机械', color: '#5f8fae' },
  demon:     { name: '恶魔', color: '#a2456b' },
  dragon:    { name: '龙',   color: '#c0563a' },
  elemental: { name: '元素', color: '#3fa59a' },
  pirate:    { name: '海盗', color: '#b8893a' },
  undead:    { name: '亡灵', color: '#7e74b8' },
  fish:      { name: '鱼人', color: '#3a7fc0' },
};
const TRIBE_KEYS = Object.keys(TRIBES);

const KW_NAMES = {
  taunt: '嘲讽', ds: '圣盾', poison: '剧毒', venom: '烈毒', windfury: '风怒',
  reborn: '复生', cleave: '顺劈', magnetic: '磁力',
};
const KW_HELP = {
  taunt: '敌人必须优先攻击具有嘲讽的随从。',
  ds: '抵挡下一次受到的伤害。',
  poison: '对随从造成伤害即将其消灭。',
  venom: '剧毒，但只生效一次。',
  windfury: '每次轮到时可以攻击两次。',
  reborn: '第一次死亡时以1点生命值复活。',
  cleave: '攻击时同时对目标两侧的随从造成伤害。',
  magnetic: '打出时可吸附到一个友方机械上，与其合为一体。',
};

const CARDS = {};
function C(id, tier, tribes, name, art, atk, hp, o = {}) {
  CARDS[id] = Object.assign({ id, tier, tribes, name, art, atk, hp, kw: {}, text: '' }, o);
}
const T = (id, tribes, name, art, atk, hp, o = {}) => C(id, 1, tribes, name, art, atk, hp, Object.assign({ token: true }, o));

/* ---------- 小工具 ---------- */
const times = (n, f) => { for (let i = 0; i < n; i++) f(i); };
const isT = (m, t) => { const d = CARDS[m.id]; return d.tribes.includes(t) || d.tribes.includes('all'); };

/* ===================== 1 级 ===================== */
C('n_peddler', 1, [], '拾荒小贩', '🎒', 2, 1, {
  text: '出售时：额外获得1枚铸币。',
  onSell(ctx) { ctx.gainGold(1 * ctx.mult); },
});
C('n_barrel', 1, [], '木桶守卫', '🛢️', 1, 3, { kw: { taunt: 1 }, text: '' });

C('b_ratmother', 1, ['beast'], '灰巷鼠母', '🐀', 2, 1, {
  text: '亡语：召唤等同于该随从攻击力数量的1/1鼠崽。',
  deathrattle(ctx) { times(Math.max(0, ctx.selfAtk), () => ctx.summon('tk_rat', null, ctx.mult > 1)); },
});
C('b_wolfcub', 1, ['beast'], '嚎月幼狼', '🐺', 1, 2, {
  text: '亡语：使一个随机友方随从获得+2/+1。',
  deathrattle(ctx) { times(ctx.mult, () => { const m = ctx.rand(ctx.friends()); if (m) ctx.buff(m, 2, 1); }); },
});
C('m_rivet', 1, ['mech'], '铆钉甲虫', '🪲', 2, 1, { kw: { ds: 1 } });
C('m_scrapspider', 1, ['mech'], '废铁蜘蛛', '🕷️', 1, 2, {
  text: '亡语：召唤一个1/1废铁小蛛。',
  deathrattle(ctx) { ctx.summon('tk_scrap', null, ctx.mult > 1); },
});
C('d_cinderimp', 1, ['demon'], '焚翼小魔', '👹', 3, 2, {
  text: '战吼：对你的英雄造成2点伤害。',
  battlecry(ctx) { ctx.damageHero(2); },
});
C('d_gnawer', 1, ['demon'], '噬魂幼鬼', '😈', 1, 2, {
  text: '回合结束时：吞噬酒馆中的一个随机随从，获得+1/+1。',
  endTurn(ctx) { if (ctx.devourShop('random')) ctx.buff(ctx.self, 1 * ctx.mult, 1 * ctx.mult); },
});
C('dr_redwhelp', 1, ['dragon'], '赤鳞雏龙', '🐲', 1, 3, {
  text: '战斗开始时：使你的其他龙获得+1攻击力。',
  sot(ctx) { ctx.friends(m => isT(m, 'dragon')).forEach(m => ctx.buff(m, 1 * ctx.mult, 0)); },
});
C('dr_egg', 1, ['dragon'], '沉睡龙蛋', '🥚', 0, 3, {
  kw: { taunt: 1 }, text: '回合结束时：获得+1攻击力。',
  endTurn(ctx) { ctx.buff(ctx.self, 1 * ctx.mult, 0); },
});
C('e_spark', 1, ['elemental'], '火苗精灵', '✨', 2, 1, {
  text: '战吼：使酒馆中的随从获得+1/+1。',
  battlecry(ctx) { ctx.buffShop(1 * ctx.mult, 1 * ctx.mult); },
});
C('e_ash', 1, ['elemental'], '灰烬游魂', '🌫️', 2, 2, {
  text: '出售时：将一个随机元素加入酒馆。',
  onSell(ctx) { times(ctx.mult, () => ctx.addToShop(m => isT(m, 'elemental'))); },
});
C('p_deckhand', 1, ['pirate'], '甲板水手', '🏴‍☠️', 2, 1, {
  text: '每当你购买一个海盗，获得+1/+1。',
  onBuy(ctx, bought) { if (isT(bought, 'pirate')) ctx.buff(ctx.self, ctx.mult, ctx.mult); },
});
C('p_parrot', 1, ['pirate'], '藏宝鹦鹉', '🦜', 2, 1, {
  text: '战吼：下回合获得1枚额外的铸币。',
  battlecry(ctx) { ctx.nextGold(1); },
});
C('u_skeleton', 1, ['undead'], '游荡骷髅', '💀', 2, 1, { kw: { reborn: 1 } });
C('u_ghoul', 1, ['undead'], '嗜血食尸鬼', '🧟', 2, 2, {
  avenge: 2, text: '复仇（2）：获得+1/+1。',
  onAvenge(ctx) { ctx.buff(ctx.self, ctx.mult, ctx.mult); },
});
C('f_scout', 1, ['fish'], '潮池斥候', '🐸', 2, 1, {
  text: '战吼：使一个友方鱼人获得+1/+1。', target: m => isT(m, 'fish'),
  battlecry(ctx, t) { if (t) ctx.buff(t, ctx.mult, ctx.mult); },
});
C('f_singer', 1, ['fish'], '珊瑚歌手', '🐟', 2, 1, {
  text: '战吼：召唤一个1/1鱼苗。',
  battlecry(ctx) { ctx.summon('tk_fry', null, ctx.mult > 1); },
});

/* ===================== 2 级 ===================== */
C('n_shield', 2, [], '持盾卫兵', '🛡️', 1, 4, { kw: { taunt: 1, ds: 1 } });
C('n_bard', 2, [], '回响诗人', '🪕', 2, 3, {
  text: '每当你打出一个随从，获得+1攻击力。',
  onPlay(ctx) { ctx.buff(ctx.self, ctx.mult, 0); },
});
C('b_hyena', 2, ['beast'], '腐食鬣狗', '🐕', 2, 2, {
  text: '每当一个友方野兽死亡，获得+2/+1。',
  onFriendlyDeath(ctx, dead) { if (isT(dead, 'beast')) ctx.buff(ctx.self, 2 * ctx.mult, ctx.mult); },
});
C('b_spider', 2, ['beast'], '巢穴蜘蛛', '🕸️', 2, 2, {
  text: '亡语：召唤两个1/1小蛛。',
  deathrattle(ctx) { times(2, () => ctx.summon('tk_spiderling', null, ctx.mult > 1)); },
});
C('m_shieldmod', 2, ['mech'], '护盾模组', '🔰', 1, 2, { kw: { ds: 1, magnetic: 1 } });
C('m_bomber', 2, ['mech'], '爆破机器人', '💣', 2, 2, {
  text: '亡语：对一个随机敌方随从造成4点伤害。',
  deathrattle(ctx) { times(ctx.mult, () => { const e = ctx.rand(ctx.enemies()); if (e) ctx.damage(e, 4); }); },
});
C('d_hound', 2, ['demon'], '吞噬恶犬', '🐾', 2, 2, {
  text: '战吼：吞噬一个其他友方随从，获得其属性值。', target: () => true, targetOptional: true,
  battlecry(ctx, t) { if (t && t !== ctx.self) ctx.devourFriend(t); },
});
C('d_overseer', 2, ['demon'], '小鬼工头', '🧌', 1, 3, {
  text: '回合结束时：召唤一个1/1小鬼。',
  endTurn(ctx) { ctx.summon('tk_imp', null, ctx.mult > 1); },
});
C('dr_gilded', 2, ['dragon'], '镀金雏龙', '🐉', 3, 2, {
  text: '战斗开始时：如果你控制另一条龙，获得圣盾。',
  sot(ctx) { if (ctx.friends(m => isT(m, 'dragon')).length) ctx.giveKw(ctx.self, 'ds'); },
});
C('dr_warden', 2, ['dragon'], '龙巢看守', '🏰', 1, 4, {
  text: '每当一个友方随从失去圣盾，获得+2攻击力。',
  onShieldLost(ctx) { ctx.buff(ctx.self, 2 * ctx.mult, 0); },
});
C('e_magma', 2, ['elemental'], '躁动熔岩', '🌋', 2, 2, {
  text: '每当你打出一个元素，获得+1/+1。',
  onPlay(ctx, m) { if (isT(m, 'elemental')) ctx.buff(ctx.self, ctx.mult, ctx.mult); },
});
C('e_gust', 2, ['elemental'], '阵风精灵', '🌪️', 3, 2, {
  text: '出售时：使酒馆中的随从获得+1/+2。',
  onSell(ctx) { ctx.buffShop(ctx.mult, 2 * ctx.mult); },
});
C('p_gambler', 2, ['pirate'], '赌徒海盗', '🎲', 3, 3, {
  text: '出售此随从可获得3枚铸币。',
  onSell(ctx) { ctx.gainGold(2 * ctx.mult); },
});
C('p_gunner', 2, ['pirate'], '甲板炮手', '🔫', 2, 3, {
  text: '在另一个友方海盗攻击后，对一个随机敌方随从造成1点伤害。',
  afterFriendlyAttack(ctx, a) { if (isT(a, 'pirate')) times(ctx.mult, () => { const e = ctx.rand(ctx.enemies()); if (e) ctx.damage(e, 1); }); },
});
C('u_collector', 2, ['undead'], '收尸人', '⚰️', 2, 3, {
  avenge: 2, text: '复仇（2）：召唤一个2/1骷髅。',
  onAvenge(ctx) { ctx.summon('tk_skel', null, ctx.mult > 1); },
});
C('u_abom', 2, ['undead'], '憎恶仆从', '🧟‍♂️', 2, 2, { kw: { taunt: 1, reborn: 1 } });
C('f_horn', 2, ['fish'], '鳞群号手', '📯', 3, 2, {
  text: '你的其他鱼人获得+1攻击力。', aura: { tribe: 'fish', atk: 1 },
});
C('f_venom', 2, ['fish'], '毒棘鱼人', '🐡', 1, 2, { kw: { poison: 1 } });

/* ===================== 3 级 ===================== */
C('n_ironclad', 3, [], '铁甲武士', '🤺', 3, 4, {
  kw: { taunt: 1 }, text: '每当该随从受到伤害并存活，获得+1攻击力。',
  onDamaged(ctx) { ctx.buff(ctx.self, ctx.mult, 0); },
});
C('n_minter', 3, [], '幸运铸币匠', '🪙', 2, 3, {
  text: '回合结束时：如果你还有未花费的铸币，使一个随机友方随从获得+1/+2。',
  endTurn(ctx) { if (ctx.p.gold > 0) times(ctx.mult, () => { const m = ctx.rand(ctx.friends()); if (m) ctx.buff(m, 1, 2); }); },
});
C('n_twinblade', 3, [], '双刃游侠', '⚔️', 2, 4, { kw: { windfury: 1 } });
C('b_packlead', 3, ['beast'], '猎群首领', '🦁', 3, 3, {
  text: '每当你召唤一个野兽，使其获得+1/+1。',
  onSummon(ctx, m) { if (isT(m, 'beast')) ctx.buff(m, ctx.mult, ctx.mult); },
});
C('b_bear', 3, ['beast'], '灰熊长老', '🐻', 3, 4, {
  kw: { taunt: 1 }, text: '亡语：使两个随机友方野兽获得+2/+2。',
  deathrattle(ctx) { ctx.sample(ctx.friends(m => isT(m, 'beast')), 2).forEach(m => ctx.buff(m, 2 * ctx.mult, 2 * ctx.mult)); },
});
C('m_armor', 3, ['mech'], '强化装甲件', '🦾', 2, 2, { kw: { taunt: 1, ds: 1, magnetic: 1 } });
C('m_twinbot', 3, ['mech'], '双生机甲', '🤖', 2, 4, {
  text: '亡语：召唤两个2/1机械小兵。',
  deathrattle(ctx) { times(2, () => ctx.summon('tk_minibot', null, ctx.mult > 1)); },
});
C('d_glutton', 3, ['demon'], '暴食魔犬', '👺', 3, 4, {
  text: '战吼：吞噬酒馆中属性最高的随从，获得其属性值。',
  battlecry(ctx) { ctx.devourShop('best', 1); },
});
C('d_painwalker', 3, ['demon'], '痛苦行者', '👿', 3, 4, {
  text: '回合结束时：对你的英雄造成1点伤害，并使你的其他恶魔获得+1/+1。',
  endTurn(ctx) { ctx.damageHero(1); ctx.friends(m => isT(m, 'demon')).forEach(m => ctx.buff(m, ctx.mult, ctx.mult)); },
});
C('dr_storm', 3, ['dragon'], '风暴幼龙', '🌩️', 3, 4, {
  text: '战斗开始时：对一个随机敌方随从造成等同于你的龙数量的伤害。',
  sot(ctx) { const n = ctx.all(m => isT(m, 'dragon')).length; times(ctx.mult, () => { const e = ctx.rand(ctx.enemies()); if (e) ctx.damage(e, n); }); },
});
C('dr_rider', 3, ['dragon'], '鳞甲骑手', '🏇', 2, 4, {
  text: '战吼：使你的其他龙获得+1/+1。',
  battlecry(ctx) { ctx.friends(m => isT(m, 'dragon')).forEach(m => ctx.buff(m, 1, 1)); },
});
C('e_bolt', 3, ['elemental'], '电光精魂', '⚡', 3, 3, {
  text: '战吼：使另一个友方元素获得+2/+2。', target: m => isT(m, 'elemental'),
  battlecry(ctx, t) { if (t) ctx.buff(t, 2, 2); },
});
C('e_thaw', 3, ['elemental'], '融冰元素', '🧊', 2, 4, {
  text: '回合开始时：使酒馆中的随从获得+1/+1。',
  startTurn(ctx) { ctx.buffShop(ctx.mult, ctx.mult); },
});
C('p_mate', 3, ['pirate'], '黑旗大副', '🚩', 3, 3, {
  text: '每当你购买一个海盗，使你的其他海盗获得+1/+1。',
  onBuy(ctx, b) { if (isT(b, 'pirate')) ctx.friends(m => isT(m, 'pirate')).forEach(m => ctx.buff(m, ctx.mult, ctx.mult)); },
});
C('p_hunter', 3, ['pirate'], '宝藏猎人', '🗺️', 2, 2, {
  text: '战吼：获得2枚铸币。',
  battlecry(ctx) { ctx.gainGold(2); },
});
C('u_wraith', 3, ['undead'], '怨灵', '👻', 3, 3, {
  avenge: 3, text: '复仇（3）：使你的其他亡灵获得+1/+1。',
  onAvenge(ctx) { ctx.friends(m => isT(m, 'undead')).forEach(m => ctx.buff(m, ctx.mult, ctx.mult)); },
});
C('u_stitched', 3, ['undead'], '缝合怪', '🪡', 2, 4, { kw: { taunt: 1, reborn: 1 } });
C('f_priest', 3, ['fish'], '潮汐祭司', '🐚', 2, 3, {
  text: '战吼：使你的其他鱼人获得+1/+1。',
  battlecry(ctx) { ctx.friends(m => isT(m, 'fish')).forEach(m => ctx.buff(m, 1, 1)); },
});
C('f_pearl', 3, ['fish'], '宝珠潜者', '🤿', 2, 4, {
  text: '战吼：使一个友方鱼人获得圣盾。', target: m => isT(m, 'fish'),
  battlecry(ctx, t) { if (t) ctx.giveKw(t, 'ds'); },
});

/* ===================== 4 级 ===================== */
C('n_whirl', 4, [], '旋风剑士', '🌀', 3, 3, { kw: { windfury: 1, ds: 1 } });
C('n_smith', 4, [], '精通铁匠', '⚒️', 4, 4, {
  text: '回合结束时：使一个随机友方随从获得+2/+2。',
  endTurn(ctx) { times(ctx.mult, () => { const m = ctx.rand(ctx.friends()); if (m) ctx.buff(m, 2, 2); }); },
});
C('b_houndking', 4, ['beast'], '猎犬王', '🐕‍🦺', 4, 4, {
  text: '战吼：使你的其他野兽获得+2/+1。',
  battlecry(ctx) { ctx.friends(m => isT(m, 'beast')).forEach(m => ctx.buff(m, 2, 1)); },
});
C('b_brood', 4, ['beast'], '母巢蜘蛛', '🦂', 3, 3, {
  text: '亡语：召唤两个1/1烈毒小蛛。',
  deathrattle(ctx) { times(2, () => ctx.summon('tk_venomling', null, ctx.mult > 1)); },
});
C('m_stormcore', 4, ['mech'], '风暴核心', '🔋', 2, 2, { kw: { windfury: 1, ds: 1, magnetic: 1 } });
C('m_mothership', 4, ['mech'], '机械母舰', '🛸', 3, 5, {
  text: '亡语：召唤两个随机的等级不高于2的机械。',
  deathrattle(ctx) { times(2 * ctx.mult, () => ctx.summonRandom(d => d.tier <= 2 && d.tribes.includes('mech') && !d.token)); },
});
C('d_devourer', 4, ['demon'], '吞星魔', '🌑', 3, 5, {
  text: '回合结束时：吞噬酒馆中的一个随机随从，获得其一半属性值。',
  endTurn(ctx) { ctx.devourShop('random', 0.5); },
});
C('d_summoner', 4, ['demon'], '炼狱召唤者', '🔥', 3, 5, {
  text: '亡语：召唤两个3/2恶魔猎犬。',
  deathrattle(ctx) { times(2, () => ctx.summon('tk_hound', null, ctx.mult > 1)); },
});
C('dr_flamewing', 4, ['dragon'], '炽翼巨龙', '🦅', 4, 5, {
  text: '战斗开始时：使你的其他龙获得+2/+2。',
  sot(ctx) { ctx.friends(m => isT(m, 'dragon')).forEach(m => ctx.buff(m, 2 * ctx.mult, 2 * ctx.mult)); },
});
C('dr_gilt', 4, ['dragon'], '镀金守卫龙', '🟡', 3, 6, {
  text: '战吼：使一条友方龙获得+2/+2和圣盾。', target: m => isT(m, 'dragon'),
  battlecry(ctx, t) { if (t) { ctx.buff(t, 2, 2); ctx.giveKw(t, 'ds'); } },
});
C('e_tuner', 4, ['elemental'], '元素调律者', '🎐', 3, 5, {
  text: '每当你打出一个元素，本局游戏中酒馆里的随从获得+1/+1。',
  onPlay(ctx, m) { if (isT(m, 'elemental')) ctx.shopBonus(ctx.mult, ctx.mult); },
});
C('e_fireking', 4, ['elemental'], '炎魔', '☄️', 4, 4, {
  text: '每当你打出一个元素，获得+2/+1。',
  onPlay(ctx, m) { if (isT(m, 'elemental')) ctx.buff(ctx.self, 2 * ctx.mult, ctx.mult); },
});
C('p_hook', 4, ['pirate'], '铁钩舰长', '🪝', 4, 4, {
  text: '每当另一个友方海盗攻击时，使其获得+2/+1。',
  onFriendlyAttack(ctx, a) { if (isT(a, 'pirate')) ctx.buff(a, 2 * ctx.mult, ctx.mult); },
});
C('p_vault', 4, ['pirate'], '金库守卫', '💰', 3, 5, {
  kw: { taunt: 1 }, text: '回合开始时：获得1枚铸币。',
  startTurn(ctx) { ctx.gainGold(ctx.mult); },
});
C('u_commander', 4, ['undead'], '幽魂指挥官', '🕯️', 3, 5, {
  avenge: 3, text: '复仇（3）：使你的亡灵永久获得+1攻击力。',
  onAvenge(ctx) { ctx.permBuffAll(m => isT(m, 'undead'), ctx.mult, 0); },
});
C('u_plague', 4, ['undead'], '瘟疫憎恶', '🦠', 4, 5, { kw: { taunt: 1, reborn: 1 } });
C('f_seer', 4, ['fish'], '珊瑚先知', '🔮', 3, 4, {
  text: '每当你打出一个鱼人，使一个随机友方鱼人获得+2/+2。',
  onPlay(ctx, m) { if (isT(m, 'fish')) times(ctx.mult, () => { const f = ctx.rand(ctx.all(x => isT(x, 'fish'))); if (f) ctx.buff(f, 2, 2); }); },
});
C('f_sting', 4, ['fish'], '暗礁毒刺', '🦈', 2, 3, { kw: { poison: 1, ds: 1 } });

/* ===================== 5 级 ===================== */
C('n_echo', 5, [], '回音法师', '📢', 2, 4, { text: '你的战吼会额外触发一次。', echo: true });
C('n_soul', 5, [], '灵魂歌者', '🎻', 2, 6, { text: '你的亡语会额外触发一次。', soul: true });
C('n_berserk', 5, [], '嗜血狂徒', '😤', 5, 5, {
  text: '每当一个友方随从死亡，获得+1/+1。',
  onFriendlyDeath(ctx) { ctx.buff(ctx.self, ctx.mult, ctx.mult); },
});
C('b_mother', 5, ['beast'], '百兽之母', '🦣', 4, 6, {
  text: '每当你召唤一个野兽，使其获得+3/+3。',
  onSummon(ctx, m) { if (isT(m, 'beast')) ctx.buff(m, 3 * ctx.mult, 3 * ctx.mult); },
});
C('m_chief', 5, ['mech'], '护盾总工', '👷', 3, 6, {
  text: '每当一个友方随从失去圣盾，使你的其他机械获得+2/+1。',
  onShieldLost(ctx) { ctx.friends(m => isT(m, 'mech')).forEach(m => ctx.buff(m, 2 * ctx.mult, ctx.mult)); },
});
C('d_lord', 5, ['demon'], '魂锁领主', '⛓️', 4, 7, {
  text: '回合结束时：使你的其他恶魔获得+2/+2。',
  endTurn(ctx) { ctx.friends(m => isT(m, 'demon')).forEach(m => ctx.buff(m, 2 * ctx.mult, 2 * ctx.mult)); },
});
C('dr_king', 5, ['dragon'], '金鳞龙王', '👑', 4, 7, {
  text: '回合结束时：使你的其他龙获得+2/+2。',
  endTurn(ctx) { ctx.friends(m => isT(m, 'dragon')).forEach(m => ctx.buff(m, 2 * ctx.mult, 2 * ctx.mult)); },
});
C('dr_doom', 5, ['dragon'], '毁灭幼龙', '🔥', 6, 5, {
  text: '战斗开始时：对一个随机敌方随从造成6点伤害。',
  sot(ctx) { times(ctx.mult, () => { const e = ctx.rand(ctx.enemies()); if (e) ctx.damage(e, 6); }); },
});
C('e_thunder', 5, ['elemental'], '雷霆领主', '⛈️', 4, 8, {
  text: '每当你打出一个元素，使你的其他元素获得+1/+1。',
  onPlay(ctx, p) { if (isT(p, 'elemental')) ctx.friends(m => isT(m, 'elemental')).forEach(m => ctx.buff(m, ctx.mult, ctx.mult)); },
});
C('p_fury', 5, ['pirate'], '狂怒船长', '⚓', 5, 6, {
  text: '每当一个友方海盗攻击时，使你的海盗获得+1/+1。',
  onFriendlyAttack(ctx, a) { if (isT(a, 'pirate')) ctx.all(m => isT(m, 'pirate')).forEach(m => ctx.buff(m, ctx.mult, ctx.mult)); },
});
C('u_necro', 5, ['undead'], '死灵领主', '☠️', 4, 6, {
  text: '战斗开始时：使你的其他亡灵获得复生。',
  sot(ctx) { ctx.friends(m => isT(m, 'undead')).forEach(m => { ctx.giveKw(m, 'reborn'); if (ctx.mult > 1) ctx.buff(m, 2, 2); }); },
});
C('f_tyrant', 5, ['fish'], '珊瑚暴君', '🦖', 3, 4, {
  text: '战吼：使你的其他鱼人获得剧毒。',
  battlecry(ctx) { ctx.friends(m => isT(m, 'fish')).forEach(m => ctx.giveKw(m, 'poison')); },
});

/* ===================== 6 级 ===================== */
C('n_giant', 6, [], '裂地巨人', '🗿', 7, 7, { kw: { cleave: 1 } });
C('n_priest', 6, [], '黄金祭司', '🌞', 5, 7, {
  text: '回合结束时：使你的所有其他随从获得+1/+1。',
  endTurn(ctx) { ctx.friends().forEach(m => ctx.buff(m, ctx.mult, ctx.mult)); },
});
C('b_lord', 6, ['beast'], '荒野主宰', '🦬', 6, 8, {
  text: '每当一个友方野兽死亡，使你的野兽获得+2/+2。',
  onFriendlyDeath(ctx, d) { if (isT(d, 'beast')) ctx.all(m => isT(m, 'beast')).forEach(m => ctx.buff(m, 2 * ctx.mult, 2 * ctx.mult)); },
});
C('m_doom', 6, ['mech'], '末日机甲', '🦿', 6, 6, {
  kw: { ds: 1 }, text: '亡语：对所有敌方随从造成3点伤害。',
  deathrattle(ctx) { times(ctx.mult, () => ctx.enemies().forEach(e => ctx.damage(e, 3))); },
});
C('m_colossus', 6, ['mech'], '磁力巨构', '🏗️', 5, 5, { kw: { taunt: 1, ds: 1, windfury: 1, magnetic: 1 } });
C('d_inferno', 6, ['demon'], '炼狱之主', '🌋', 5, 8, {
  kw: { taunt: 1 }, text: '每当另一个友方恶魔死亡，对一个随机敌方随从造成5点伤害。',
  onFriendlyDeath(ctx, d) { if (isT(d, 'demon')) times(ctx.mult, () => { const e = ctx.rand(ctx.enemies()); if (e) ctx.damage(e, 5); }); },
});
C('dr_eternal', 6, ['dragon'], '永恒巨龙', '🐉', 6, 8, {
  kw: { ds: 1 }, text: '战斗开始时：使你的其他龙获得圣盾。',
  sot(ctx) { ctx.friends(m => isT(m, 'dragon')).forEach(m => { ctx.giveKw(m, 'ds'); if (ctx.mult > 1) ctx.buff(m, 3, 3); }); },
});
C('e_source', 6, ['elemental'], '风暴之源', '🌀', 6, 8, {
  text: '回合结束时：使你的其他元素获得+3/+3。',
  endTurn(ctx) { ctx.friends(m => isT(m, 'elemental')).forEach(m => ctx.buff(m, 3 * ctx.mult, 3 * ctx.mult)); },
});
C('p_ghost', 6, ['pirate'], '幽灵炮舰', '⛵', 5, 7, {
  text: '在一个友方海盗攻击后，对一个随机敌方随从造成3点伤害。',
  afterFriendlyAttack(ctx, a) { if (isT(a, 'pirate')) times(ctx.mult, () => { const e = ctx.rand(ctx.enemies()); if (e) ctx.damage(e, 3); }); },
  selfToo: true,
});
C('u_king', 6, ['undead'], '亡者君王', '🦴', 6, 7, {
  kw: { reborn: 1 }, avenge: 2, text: '复仇（2）：使你的其他亡灵获得+3/+2。',
  onAvenge(ctx) { ctx.friends(m => isT(m, 'undead')).forEach(m => ctx.buff(m, 3 * ctx.mult, 2 * ctx.mult)); },
});
C('f_queen', 6, ['fish'], '潮汐女王', '🧜‍♀️', 5, 8, {
  text: '战吼：使你的其他鱼人获得+4/+4。',
  battlecry(ctx) { ctx.friends(m => isT(m, 'fish')).forEach(m => ctx.buff(m, 4, 4)); },
});

/* ===================== 衍生物 ===================== */
T('tk_rat', ['beast'], '鼠崽', '🐁', 1, 1);
T('tk_spiderling', ['beast'], '小蛛', '🕷️', 1, 1);
T('tk_venomling', ['beast'], '烈毒小蛛', '🐜', 1, 1, { kw: { venom: 1 } });
T('tk_scrap', ['mech'], '废铁小蛛', '⚙️', 1, 1);
T('tk_minibot', ['mech'], '机械小兵', '🔩', 2, 1);
T('tk_gear', ['mech'], '齿轮仆从', '⚙️', 1, 1, { kw: { ds: 1 } });
T('tk_imp', ['demon'], '小鬼', '👺', 1, 1);
T('tk_hound', ['demon'], '恶魔猎犬', '🐕', 3, 2);
T('tk_fry', ['fish'], '鱼苗', '🐠', 1, 1);
T('tk_skel', ['undead'], '骷髅', '💀', 2, 1);
// 仅作为"附加亡语"使用的伪卡（英雄技能）
T('dr_bone', [], '骨笛余音', '🦴', 0, 0, {
  hidden: true, text: '亡语：召唤一个2/1骷髅。',
  deathrattle(ctx) { ctx.summon('tk_skel', null, false); },
});

/* ===================== 酒馆法术 ===================== */
const SPELLS = {};
function S(id, tier, cost, name, art, text, o) { SPELLS[id] = Object.assign({ id, tier, cost, name, art, text, spell: true }, o); }
S('s_coin', 1, 0, '意外之财', '🪙', '获得1枚铸币。', { cast(ctx) { ctx.gainGold(1); } });
S('s_potion', 1, 1, '强化药剂', '🧪', '使一个随从获得+1/+2。', { target: () => true, cast(ctx, t) { ctx.buff(t, 1, 2); } });
S('s_whet', 1, 1, '磨刀石', '🗡️', '使一个随从获得+2/+1。', { target: () => true, cast(ctx, t) { ctx.buff(t, 2, 1); } });
S('s_crate', 1, 2, '补给箱', '📦', '获得一个随机的1级随从。', { cast(ctx) { ctx.addRandomToHand(d => d.tier === 1); } });
S('s_horn', 2, 1, '坚守号角', '📯', '使一个随从获得+1/+1和嘲讽。', { target: () => true, cast(ctx, t) { ctx.buff(t, 1, 1); ctx.giveKw(t, 'taunt'); } });
S('s_plan', 2, 1, '工匠图纸', '📐', '你的下一次酒馆升级费用减少3。', { cast(ctx) { ctx.p.upgradeCost = Math.max(0, ctx.p.upgradeCost - 3); } });
S('s_bless', 3, 3, '圣盾祝福', '🔆', '使一个随从获得圣盾。', { target: () => true, cast(ctx, t) { ctx.giveKw(t, 'ds'); } });
S('s_tome', 3, 3, '发现之书', '📖', '发现一个你当前酒馆等级的随从。', { cast(ctx) { ctx.discover(ctx.p.tier, true); } });
S('s_warsong', 4, 3, '战歌', '🥁', '使你的所有随从获得+1/+2。', { cast(ctx) { ctx.p.board.forEach(m => ctx.buff(m, 1, 2)); } });
S('s_reborn', 4, 2, '复生圣水', '💧', '使一个随从获得复生。', { target: () => true, cast(ctx, t) { ctx.giveKw(t, 'reborn'); } });
S('s_feast', 5, 4, '盛宴', '🍖', '使你的所有随从获得+2/+2。', { cast(ctx) { ctx.p.board.forEach(m => ctx.buff(m, 2, 2)); } });
S('s_golden', 6, 6, '黄金契约', '📜', '使一个非金色随从变为金色。', { target: m => !m.golden && !CARDS[m.id].token, cast(ctx, t) { ctx.makeGolden(t); } });

/* ===================== 英雄 ===================== */
const HEROES = {
  gren: { name: '锻炉匠人·葛伦', art: '🔨', armor: 8, power: {
    name: '锤炼', cost: 1, text: '使一个友方随从获得+1/+2。', target: () => true,
    use(ctx, t) { ctx.buff(t, 1, 2); } } },
  moss: { name: '灰烬女巫·莫丝', art: '🧙‍♀️', armor: 6, power: {
    name: '余烬', passive: true, text: '被动：回合结束时，使一个随机友方随从获得+1/+1。',
    endTurn(ctx) { const m = ctx.rand(ctx.p.board); if (m) ctx.buff(m, 1, 1); } } },
  pip: { name: '潮汐商人·皮普', art: '🧔', armor: 7, power: {
    name: '讨价还价', passive: true, text: '被动：你每回合的第一次刷新免费。', freeRefresh: 1 } },
  vel: { name: '骨笛术士·维尔', art: '🪈', armor: 6, power: {
    name: '骨笛', cost: 1, text: '使一个友方随从获得"亡语：召唤一个2/1骷髅"。', target: () => true,
    use(ctx, t) { t.dr.push({ id: 'dr_bone', mult: 1 }); } } },
  gear: { name: '齿轮婆婆', art: '👵', armor: 5, power: {
    name: '小发明', cost: 2, text: '将一个1/1并具有圣盾的齿轮仆从置入你的手牌。',
    use(ctx) { ctx.addHand('tk_gear'); } } },
  alu: { name: '驯兽人·阿露', art: '🏹', armor: 7, power: {
    name: '先锋号角', passive: true, text: '被动：战斗开始时，使你最左侧的随从获得+X/+X（X为你的酒馆等级）。',
    sot(ctx) { const m = ctx.board[0]; if (m) ctx.buff(m, ctx.p.tier, ctx.p.tier); } } },
  seline: { name: '龙裔·赛琳', art: '🧝‍♀️', armor: 5, power: {
    name: '龙之馈赠', passive: true, text: '被动：每当你升级酒馆，随机获得一个比新等级低一级的随从。',
    onUpgrade(ctx) { const t = Math.max(1, ctx.p.tier - 1); ctx.addRandomToHand(d => d.tier === t); } } },
  rat: { name: '窃贼·灰鼠', art: '🦹', armor: 8, power: {
    name: '顺手牵羊', cost: 2, text: '将酒馆中最左侧的随从置入你的手牌。',
    use(ctx) { ctx.takeShop(0); }, canUse(p) { return p.shop.length > 0 && p.hand.length < 10; } } },
  owen: { name: '星象师·欧文', art: '🔭', armor: 5, power: {
    name: '星辰指引', passive: true, text: '被动：你的酒馆多展示一个随从。', extraSlot: 1 } },
  karl: { name: '狂战士·卡尔', art: '🪓', armor: 10, power: {
    name: '战嚎', passive: true, text: '被动：战斗开始时，对一个随机敌方随从造成X点伤害（X为你的酒馆等级+1）。',
    sot(ctx) { const e = ctx.rand(ctx.enemies()); if (e) ctx.damage(e, ctx.p.tier + 1); } } },
  olly: { name: '金币女王·奥莉', art: '👸', armor: 6, power: {
    name: '利息', passive: true, text: '被动：回合结束时，如果你还有未花费的铸币，下回合获得1枚额外的铸币。',
    endTurn(ctx) { if (ctx.p.gold > 0) ctx.nextGold(1); } } },
  irene: { name: '圣光修女·艾琳', art: '😇', armor: 5, power: {
    name: '守护', cost: 2, text: '使一个友方随从获得圣盾。', target: m => !m.kw.ds,
    use(ctx, t) { ctx.giveKw(t, 'ds'); } } },
};
