/* 图集按画稿中的行、列定位。与规则数据的声明顺序无关。 */
'use strict';

const unitSheets = [
  [
    'n_peddler n_barrel b_ratmother b_wolfcub m_rivet m_scrapspider',
    'd_cinderimp d_gnawer dr_redwhelp dr_egg e_spark e_ash',
    'p_deckhand p_parrot u_skeleton u_ghoul f_scout f_singer',
    'n_shield n_bard b_hyena b_spider m_shieldmod m_bomber',
  ],
  [
    'd_hound d_overseer dr_gilded dr_warden e_magma e_gust',
    'p_gambler p_gunner u_collector u_abom f_horn f_venom',
    'n_ironclad n_minter n_twinblade b_packlead b_bear m_armor',
    'm_twinbot d_glutton d_painwalker dr_storm dr_rider e_bolt',
  ],
  [
    'e_thaw p_mate p_hunter u_wraith u_stitched f_priest',
    'f_pearl n_whirl n_smith b_houndking b_brood m_stormcore',
    'm_mothership d_devourer d_summoner dr_flamewing dr_gilt e_tuner',
    'e_fireking p_hook p_vault u_commander u_plague f_seer',
  ],
  [
    'f_sting n_echo n_soul n_berserk b_mother m_chief',
    'd_lord dr_king dr_doom e_thunder p_fury u_necro',
    'f_tyrant n_giant n_priest b_lord m_doom m_colossus',
    'd_inferno dr_eternal e_source p_ghost u_king f_queen',
  ],
  [
    'tk_rat tk_spiderling tk_venomling tk_scrap tk_minibot tk_gear',
    'tk_imp tk_hound tk_fry tk_skel dr_bone b_badger',
    'm_squirrel d_pactimp f_bugler dr_amber p_shipwright m_drone',
    'n_quarter b_mammoth e_rover u_colossus n_master',
  ],
];
const unitArt = new Map();
unitSheets.forEach((rows, sheet) => rows.join(' ').split(' ').forEach((id, index) => {
  unitArt.set(id, tileStyle('units' + sheet * 24, index, 6, 4));
}));
const heroArt = 'gren moss pip vel gear alu seline rat owen karl olly irene'.split(' ');
const spellArt = 's_coin s_potion s_whet s_crate s_horn s_plan s_bless s_tome s_warsong s_reborn s_feast s_golden reward'.split(' ');

function tilePosition(index, columns, rows) {
  return (index % columns) * 100 / (columns - 1) + '% ' + Math.floor(index / columns) * 100 / (rows - 1) + '%';
}
function tileStyle(sheet, index, columns, rows) {
  return `background-image:url(assets/${sheet}.webp);background-size:${columns * 100}% ${rows * 100}%;background-position:${tilePosition(index, columns, rows)}`;
}
function cardArt(id, symbol, spell = false) {
  const index = spellArt.indexOf(id);
  const style = spell && index >= 0 ? tileStyle('spells', index, 4, 4) : unitArt.get(id);
  return style ? `<div class="unit-art" aria-hidden="true" style="${style}"></div>` : `<div class="art">${symbol}</div>`;
}
function portraitPosition(id) { return tilePosition(heroArt.indexOf(id), 4, 3); }
function heroPortrait(id) {
  return `<div class="lb-hero portrait" aria-hidden="true" style="--portrait-pos:${portraitPosition(id)}"></div>`;
}
