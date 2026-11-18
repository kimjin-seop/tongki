// 감사용 캡처: 우리 화면을 headless Edge 로 캡처. node analysis/scripts/audit_shots.mjs PORT OUTDIR PROFILE
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const [, , APP_PORT, OUT, PROFILE] = process.argv;
const CDP_PORT = 9417;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
fs.mkdirSync(OUT, { recursive: true });
const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${PROFILE}`, '--window-size=1194,672', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, id = 0; const pend = new Map();
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
setTimeout(() => { edge.kill(); process.exit(2); }, 200000);
for (let i = 0; i < 60; i++) { try { const l = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json(); const pg = l.find((t) => t.type === 'page'); if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); break; } } catch {} await sleep(200); }
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
const shot = async (n) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, n + '.png'), Buffer.from(r.result.data, 'base64')); console.log('shot', n, await ev('window.__app.view')); };
const kd = (code, key, vk) => send('Input.dispatchKeyEvent', { type: 'keyDown', code, key, windowsVirtualKeyCode: vk });
const ku = (code, key, vk) => send('Input.dispatchKeyEvent', { type: 'keyUp', code, key, windowsVirtualKeyCode: vk });
const K = { right: ['ArrowRight', 'ArrowRight', 39], left: ['ArrowLeft', 'ArrowLeft', 37], up: ['ArrowUp', 'ArrowUp', 38], A: ['KeyA', 'a', 65], S: ['KeyS', 's', 83], D: ['KeyD', 'd', 68] };
const hold = async (k, ms) => { await kd(...K[k]); await sleep(ms); await ku(...K[k]); };
await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: `http://127.0.0.1:${APP_PORT}/` }); await sleep(2500);
await shot('t00_intro');
await kd('Space', ' ', 32); await sleep(80); await ku('Space', ' ', 32); await sleep(1500);
await shot('t01_title_or_nick');
await ev(`(()=>{ const i = document.querySelector('#nick'); i.focus(); i.value=''; return true; })()`);
await send('Input.insertText', { text: 'aud' + Math.floor(Math.random() * 900 + 100) });
await ev(`document.querySelector('form.nick-card button[type=submit]').click(), true`); await sleep(2000);
await shot('t02_lobby');
await ev(`window.__net.send('create_room',{vsCpu:true,cpuLevel:2}), true`);
await sleep(1500); await shot('t03_room'); await ev(`document.querySelector('[data-cmd="start"]').click(), true`);
for (let i = 0; i < 40; i++) { await sleep(300); const v = await ev('window.__app.view'); if (v === 'game') break; }
for (const [n, d] of [['g00_entry', 600], ['g01_hud', 1200], ['g02_ref', 1500], ['g03_go', 1200], ['g04_fight', 1000], ['g05_tipoff', 900]]) { await sleep(d); await shot(n); }
// 조작
await sleep(1500); await shot('g06_play');
await hold('right', 500); await shot('g07_move');
await hold('D', 300); await shot('g08_jump');
for (let i = 0; i < 12; i++) { await sleep(2500); await shot('g1' + String(i).padStart(2, '0')); }
edge.kill(); process.exit(0);
