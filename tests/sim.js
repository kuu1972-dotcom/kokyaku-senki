// 鋼脚戦記 自動テスト(ブラウザ不要)。使い方: node tests/sim.js
// index.html の最後の <script> を取り出し、画面描画を空の偽物に差し替えて
// ゲームの中身(戦闘・地図・格納庫・セーブ)を高速で動かして壊れていないか確かめる。
'use strict';
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
let js = scripts[scripts.length - 1][1].trimEnd();
// スクリプト全体は { ... } のブロック。最後の } の直前にテスト用の出口を差し込む
js = js.slice(0, -1) + `;globalThis.T={get S(){return S},get G(){return G},get BT(){return BT},
 startStage,startDuel,step,draw,hud,act,hit,afterDuel,mapView,hangar,pre,newGame,flee,setArm,toggleEv,avail,stats,
 scopeGeom,hitTest,retPt,get WEAP(){return WEAP},get BASE(){return BASE},get NODES(){return NODES},get mode(){return mode}}}`;

// ---- ブラウザの代わり(何もしない偽物) ----
const ctx = new Proxy({}, {
  get: (t, k) => ['createLinearGradient', 'createRadialGradient'].includes(k) ? () => ({ addColorStop() {} }) : (k in t ? t[k] : () => {}),
  set: (t, k, v) => { t[k] = v; return true; }
});
const els = {};
const el = id => els[id] || (els[id] = {
  id, style: {}, children: [], classList: { toggle() {} }, addEventListener() {},
  querySelector: () => ({ classList: { toggle() {} } }), getContext: () => ctx,
  getBoundingClientRect: () => ({ width: 800, height: 340 }), width: 800,
  innerHTML: '', hidden: false, parentElement: {}, textContent: '', value: ''
});
global.document = { getElementById: el, activeElement: null };
global.window = { devicePixelRatio: 1 };
global.ResizeObserver = class { observe() {} };
global.requestAnimationFrame = () => {};
global.performance = { now: () => 0 };
global.addEventListener = () => {};
global.localStorage = { _: {}, getItem(k) { return this._[k] || null; }, setItem(k, v) { this._[k] = v; } };
global.setTimeout = f => f();
eval(js);

let failed = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'OK  ' : 'NG  '} ${msg}`); if (!cond) failed++; };
const DT = 0.033;
// 簡単な自動操縦: 撃てるなら狙撃開始、照準85%で発射
function fight(maxSteps = 9000) {
  let n = 0;
  while (T.G.run && n < maxSteps) {
    T.step(DT); T.draw(DT); T.hud(0.1);
    const P = T.G.P;
    if (!P.aiming && P.reload <= 0 && !T.G.follow) T.act();
    else if (P.aiming && P.aim >= 85) T.act();
    n++;
  }
  return T.G.E.hp <= 0 ? 'win' : T.G.P.hp <= 0 ? 'lose' : 'other';
}

// 1) 作戦を最初から最後まで(毎回全快させて)通せるか
T.newGame(); T.mapView();
for (let guard = 0; guard < 400 && !T.S.done; guard++) {
  const av = T.avail(); if (!av.length) break;
  T.startStage(av[0]);
  while (T.mode === 'pre') { T.startDuel(T.S.roster.findIndex(m => m.hp > 0)); fight(); T.afterDuel(); }
  T.S.funds += 2000; T.S.roster.forEach(m => { m.hp = T.stats(m).max; }); T.hangar();
}
ok(T.S.done, `全${T.NODES.length}拠点の作戦を最後まで通せる`);

// 2) すべての機体×武器で戦闘が最後まで動く
let crashes = 0;
for (const fr of Object.keys(T.BASE)) for (const w of Object.keys(T.WEAP)) {
  try {
    T.newGame(); const m = T.S.roster[0]; m.id = fr; m.wL = w; m.hp = T.stats(m).max;
    T.startStage(1); T.startDuel(0); T.setArm('L'); fight(4000);
  } catch (e) { crashes++; console.log('  ', fr, w, e.message); }
}
ok(crashes === 0, `全機体×全武器(${Object.keys(T.BASE).length * Object.keys(T.WEAP).length}通り)でエラーなし`);

// 3) 戦闘離脱
T.newGame(); T.startStage(0); T.startDuel(0); for (let i = 0; i < 30; i++) T.step(DT);
T.flee(); let i = 0; while (T.G.run && i < 3000) { T.step(DT); i++; }
ok(!!T.G.escaped || T.G.P.hp <= 0, '戦闘離脱が終わる');

// 4) ゲームオーバーで乗員Lvと分隊★を引き継ぐ
T.newGame(); T.S.roster[0].crew.gun.lv = 4; T.S.roster[1].sq[0].lv = 3; T.S.cleared = [0, 1]; T.S.at = 1;
T.startStage(2); T.S.roster.forEach(m => { m.hp = 0; }); T.afterDuel();
ok(T.S.runs === 2 && T.S.roster[0].crew.gun.lv === 4 && T.S.roster[1].sq[0].lv === 3 && T.S.cleared.length === 0, 'ゲームオーバー後も乗員Lv・分隊★を引き継ぐ');

// 5) 制圧済み拠点の再戦は報酬半額で、進行は変わらない
T.newGame(); T.S.cleared = [0]; T.S.at = 0; const f0 = T.S.funds;
T.startStage(0); T.BT.foes.forEach(f => { f.hp = 0; }); T.afterDuel();
ok(T.S.funds - f0 === Math.round(T.NODES[0].pay * 0.5) && T.S.at === 0, '再戦は報酬半額・進行は変わらない');

// 6) 照準100%で動かさずに撃つと、ほぼ胴体に当たる
T.newGame(); let hits = 0, shots = 0;
for (let k = 0; k < 6; k++) {
  T.startStage(4); T.startDuel(k % 3); let n = 0;
  while (T.G.run && n < 4000) {
    T.step(DT); const P = T.G.P;
    if (!P.aiming && P.reload <= 0) T.act();
    if (P.aiming && P.aim >= 99.5) { const p = T.retPt(); if (T.hitTest(p.x, p.y)) hits++; shots++; T.act(); }
    n++;
  }
}
ok(shots > 0 && hits / shots >= 0.85, `照準100%の命中率 ${shots ? Math.round(hits / shots * 100) : 0}%(85%以上)`);

// 7) 大ボスは半分削ると暴走する
T.newGame(); const m = T.S.roster[2]; m.id = 'ishi'; m.wR = 'lcannon'; m.up = { armor: 3, gun: 3, sight: 3, legs: 0, loader: 3 }; m.hp = T.stats(m).max;
const fin = T.NODES.findIndex(n => n.final); T.startStage(fin); T.BT.foes.forEach((f, j) => { if (j < T.BT.foes.length - 1) f.hp = 0; });
T.startDuel(2); T.G.E.hp = T.G.E.max * 0.45; T.step(DT);
ok(!!T.G.E.enraged, '大ボスが装甲半分で暴走する');

// 8) 撃破後の描画だけで連鎖爆発が進み、停止中には進まない
T.newGame(); T.startStage(0); T.startDuel(0);
const {P, E} = T.G;
T.hit(P, E, 1, 'legs', false, null, 'auto');
ok(!T.G.wreck && T.G.parts.some(p => p.k === 'ring' && p.y === 32 * E.size), '通常命中は被弾部位に衝撃波を出す');
T.hit(P, E, E.hp, 'body', true, null, 'heavy'); T.step(0);
T.draw(0); const atStart = T.G.wreck.next;
for (let j = 0; j < 4; j++) T.draw(.025);
const first = T.G.wreck.next;
for (let j = 0; j < 6; j++) T.draw(.025);
ok(!T.G.run && atStart === 0 && first === 1 && T.G.wreck.next === 2, '撃破後に二段階の追撃爆発を描画する');

console.log(failed ? `\n${failed}件 失敗` : '\nすべて成功');
process.exit(failed ? 1 : 0);
