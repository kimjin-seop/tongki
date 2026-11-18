// 소리 관리자(WebAudio). 코드는 manifest 키(sfx.* / bgm.*)로만 부른다.
// - 브라우저 정책: AudioContext 는 첫 사용자 입력(터치·클릭·키) 안에서 만들고 resume. 그 전 효과음 요청은 버린다(BGM 은 기억했다가 시작).
//   iOS 사파리·카톡 인앱(WebView)은 제스처 안에서 무음 버퍼를 한 번 재생해야 풀리고, 통화·백그라운드 뒤 'interrupted'/'suspended' 가 되므로
//   입력 때마다 상태를 확인해 다시 resume 한다.
// - 키 → 버퍼: 처음 요청 때 fetch+decode 후 캐시(같은 파일은 경로 단위로 1번만 받는다). manifest 에 없는 키는 조용히 무시.
//   시도 순서: path → alt → fallback. path(원작 ROM 렌더, 다른 PC 엔 없을 수 있음)가 404·디코딩 실패면 fallback(합성음)으로 자동 전환.
//   ogg 를 못 트는 브라우저(canPlayType)는 같은 묶음 안에서 ogg 가 아닌 경로(mp3 alt)를 먼저 시도. 전부 실패하면 키마다 콘솔 경고 1번 후 무음.
//   manifest 항목 필드: gain(0~1, 구 vol), gap(같은 키 최소 간격 ms), alt(대체 경로 문자열|배열), fallback(문자열|배열),
//   BGM: loop(false 면 1회) + loop_start/loop_end(초, 구 loop:[시작,끝]). 루프 지점은 path/alt 로 받은 경우에만 적용(fallback 은 통째 반복)
// - BGM 은 원작 곡만, 곡별 허용 목록 = manifest 의 bgm.* 항목 중 verified:true (루프 확정 + 장면 연결 + 수치 대조 통과, analysis/27_bgm_status.md).
//   허용되지 않은 키는 무음. 전환은 원작 드라이버와 같게: 새 곡 명령 = 즉시 교체(겹침·페이드 인 없음),
//   정지(bgm(null)) = 원작 명령 0xE0 페이드 아웃(항목 fade_sec 동안 30dB 내려간 뒤 끊김), bgmStop() = 0xE1 즉시 정지
// - 동시 재생: 같은 키 gap(기본 60ms) 안 재발화는 버림(호출 측 group 으로 여러 키 묶음 가능), 같은 키 3개·전체 MAX_VOICES 초과 시 가장 오래된 소리를 끊는다
// - 출력 단(2026-11-18, analysis/27 §11): 버스 합 → master(음량) → out(MIX_TRIM) → 소프트 리미터 → 출력.
//   MIX_TRIM 은 렌더 때 곡·효과음에 똑같이 더한 +4.28dB 정규화를 출력에서 되돌려 원작 칩 출력 수준(기준 에뮬레이터 녹음과 같은 곡 음량)으로 맞춘다.
//   곡:효과음 비율은 그대로다. 리미터는 합이 0.9 를 넘는 순간에만 둥글게 눌러 1.0 을 넘지 않게 한다(그 아래는 그대로 통과)
// - 1회 재생 곡(loop:false)이 명령보다 늦게 시작되면(소리 잠금·로딩) 늦은 만큼 건너뛴 위치에서 시작한다. 이미 끝났을 시간이면 틀지 않는다
// - play 에 후보 배열을 주면 manifest 에 있는 키 중 실제로 받아진 첫 키를 재생(앞 키가 파일 없음이면 다음 키)
// - 설정: localStorage dd.audio = {muted, vol}. 탭이 숨으면 일시 정지, 보이면 재개.
//   멈춘 동안 받은 곡 명령은 wantBgm 에만 남고, 다시 동작할 때 syncBgm 이 재생 중인 곡과 맞춘다(정지 명령이면 0xE0 페이드)
// - 메모리: 경기 곡(bgm.stage.* / bgm.story.*)은 디코딩하면 곡당 수십 MB 라 재생이 끝나면 버퍼를 버리고 다시 필요할 때 받는다.
//   짧은 곡(타이틀·메뉴·편성·입장·결과)과 효과음은 계속 둔다
import { has, entry } from './game/assets.js';

const BASE = '/assets/';
const STORE = 'dd.audio';
const MAX_VOICES = 12, PER_KEY = 3, GAP_MS = 60;
/** 원작 0xE0 페이드: 곡 틱 3개마다 1단계(0.75dB) × 40단계 = 30dB, 길이 = 곡 틱 120개(항목 fade_sec, 없을 때 기본값) */
const FADE_SEC = 1.9, FADE_DB = 30, FADE_STEPS = 40;
export const VOLS = [1, 0.4]; // 버튼 단계: 크게 → 작게 → 끔
/** 출력 이득: 렌더 공통 정규화(+4.28dB, rom_audio.json sfx_gain_db)를 되돌린다. 1 로 바꾸면 이전 음량 */
export const MIX_TRIM = 10 ** (-4.28 / 20);
/** 소프트 리미터: |x| <= KNEE 는 그대로, 그 위는 tanh 로 1.0 에 수렴. RANGE = 곡선이 다루는 입력 범위(±) */
const LIMIT_KNEE = 0.9, LIMIT_RANGE = 4;
/** 1회 곡이 이만큼(초) 넘게 늦으면 건너뛴 위치에서 시작 */
const LATE_SEC = 0.25;
/** 리미터 입출력(검증용으로 공개) */
export function softLimit(x, knee = LIMIT_KNEE) {
  const a = Math.abs(x);
  return a <= knee ? x : Math.sign(x) * (knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee)));
}
/** WaveShaper 곡선: 입력 u(-1~1) = 실제 진폭 / LIMIT_RANGE */
export function limiterCurve(n = 8193) {
  return Float32Array.from({ length: n }, (_, i) => softLimit((i / (n - 1) * 2 - 1) * LIMIT_RANGE));
}
/** BGM 전체 스위치(2026-11-18: 원작 BGM 복원). 실제 재생 여부는 곡별 허용 목록(bgmAllowed)으로 정한다 */
export const BGM_ENABLED = true;
/** 곡별 허용: manifest 에 있고 type 'bgm' + verified:true 인 키만 */
export const bgmAllowed = (key) => typeof key === 'string' && has(key) && entry(key).type === 'bgm' && entry(key).verified === true;
/** 0xE0 페이드 곡선(계단식 dB 감소) */
/** 재생이 끝나면 디코딩 버퍼를 버리는 곡(경기 곡) */
const EVICT = /^bgm.(stage|story)./;
const FADE_CURVE = Float32Array.from({ length: FADE_STEPS + 1 }, (_, i) => 10 ** (-(FADE_DB * i / FADE_STEPS) / 20));

/** ogg(vorbis) 재생 가능 여부(구형 사파리 등은 '' → mp3 우선) */
const OGG = (() => { try { return !!document.createElement('audio').canPlayType?.('audio/ogg; codecs="vorbis"'); } catch { return false; } })();
const strs = (v) => (Array.isArray(v) ? v : [v]).filter((p) => typeof p === 'string' && p);
/** ogg 미지원이면 ogg 경로를 묶음 뒤로 보낸다(지우지는 않음: canPlayType 이 틀릴 수 있어 마지막에 시도) */
const order = (list) => (OGG ? list : [...list.filter((p) => !/\.ogg$/i.test(p)), ...list.filter((p) => /\.ogg$/i.test(p))]);
/** 항목 → {main: path·alt, fb: fallback} 시도 경로 */
function sources(e) { return { main: order(strs([e.path, ...strs(e.alt)])), fb: order(strs(e.fallback)) }; }
const gainOf = (e) => { const g = e.gain ?? e.vol ?? 1; return typeof g === 'number' && g >= 0 ? g : 1; };
/** BGM 반복 구간 [시작, 끝](없으면 null) */
function loopPts(e) {
  const [a, b] = Array.isArray(e.loop) ? e.loop : [e.loop_start, e.loop_end];
  const s = +a || 0, t = +b || 0;
  return t > s ? [s, t] : null;
}
/** 같은 곡 판정용 서명(파일·음량·반복) */
const bgmSig = (e) => JSON.stringify([e.path, strs(e.alt), strs(e.fallback), gainOf(e), e.loop, e.loop_start, e.loop_end, e.once]);

function loadPrefs() {
  try {
    const o = JSON.parse(localStorage.getItem(STORE) || '{}');
    return { muted: o.muted === true, vol: typeof o.vol === 'number' && o.vol >= 0 && o.vol <= 1 ? o.vol : 1 };
  } catch { return { muted: false, vol: 1 }; }
}

class SoundManager {
  constructor() {
    this.ctx = null; this.master = null; this.sfxBus = null; this.bgmBus = null;
    this.prefs = loadPrefs();
    this.bufs = new Map(); // key -> Promise<AudioBuffer|null>
    this.files = new Map(); // path -> Promise<AudioBuffer>(실패는 reject 로 캐시: 같은 404 를 다시 받지 않음)
    this.via = new Map(); // key -> 실제로 받은 경로(검증·루프 지점 판단용)
    this.viaFb = new Set(); // fallback 으로 받은 키
    this.warned = new Set();
    this.voices = []; // {key, src, t}
    this.lastAt = new Map();
    this.cur = null; // 재생 중 BGM {key, src, g}
    this.fading = null; // 0xE0 페이드 중인 이전 곡
    this.wantBgm = null; // 요청된 BGM 키(잠금 해제 전·로딩 중에도 기억)
    this.wantAt = 0; // 그 명령을 받은 시각(performance.now)
    this.pre = new Set(); // 미리 받아 둔 경기 곡 키(아직 재생 전: 버퍼 해제 대상에서 제외)
    this.subs = new Set();
    // 검증용 계수(window.__audio.stats)
    this.stats = { req: 0, played: 0, bgm: 0, missing: 0, locked: 0, muted: 0, debounced: 0, cut: 0, failed: 0, fallback: 0, log: [] };
  }

  get unlocked() { return this.ctx?.state === 'running'; }

  /** 앱 수명 동안 1회: 입력 시 잠금 해제, 탭 숨김 시 일시 정지 */
  install() {
    if (this.installed) return;
    this.installed = true;
    const kick = () => this.unlock();
    for (const t of ['pointerdown', 'touchend', 'mousedown', 'keydown', 'click']) addEventListener(t, kick, { capture: true, passive: true });
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend().catch(() => {});
      else this.ctx.resume().catch(() => {});
    });
    addEventListener('pagehide', () => { this.ctx?.suspend().catch(() => {}); });
  }

  /** 사용자 입력 안에서 호출: 컨텍스트 생성·resume(iOS 무음 버퍼 포함). 이미 동작 중이면 아무것도 안 함 */
  unlock() {
    if (document.hidden) return;
    if (this.ctx?.state === 'running') return;
    try {
      if (!this.ctx) {
        const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        // master(음량) → out(MIX_TRIM, 리미터 입력 범위로 축소) → 소프트 리미터 → 출력. WaveShaper 가 없으면 이득만
        this.out = this.ctx.createGain();
        this.master.connect(this.out);
        if (this.ctx.createWaveShaper) {
          this.limiter = this.ctx.createWaveShaper();
          this.limiter.curve = limiterCurve(); this.limiter.oversample = 'none';
          this.out.gain.value = MIX_TRIM / LIMIT_RANGE;
          this.out.connect(this.limiter); this.limiter.connect(this.ctx.destination);
        } else { this.out.gain.value = MIX_TRIM; this.out.connect(this.ctx.destination); }
        this.sfxBus = this.ctx.createGain(); this.sfxBus.connect(this.master);
        this.bgmBus = this.ctx.createGain(); this.bgmBus.connect(this.master);
        this.applyVol();
        this.ctx.addEventListener?.('statechange', () => { this.syncBgm(); this.emit(); });
      }
      const b = this.ctx.createBuffer(1, 1, 22050), s = this.ctx.createBufferSource();
      s.buffer = b; s.connect(this.ctx.destination); s.start(0);
      const p = this.ctx.resume();
      p?.then?.(() => { this.syncBgm(); this.emit(); }).catch(() => {});
    } catch (e) { this.warnOnce('ctx', '오디오 시작 실패', e); }
  }

  warnOnce(k, msg, e) { if (this.warned.has(k)) return; this.warned.add(k); console.warn('audio', msg, k, e?.message ?? e ?? ''); }

  /** 키 → AudioBuffer(실패·없음 null). 캐시 */
  load(key) {
    if (!this.ctx || !has(key)) return Promise.resolve(null);
    if (this.bufs.has(key)) return this.bufs.get(key);
    const { main, fb } = sources(entry(key));
    const p = (async () => {
      let last;
      for (const path of [...main, ...fb]) {
        try {
          const buf = await this.file(path);
          this.via.set(key, path);
          if (!main.includes(path)) { this.viaFb.add(key); this.stats.fallback++; }
          return buf;
        } catch (err) { last = err; }
      }
      this.stats.failed++;
      this.warnOnce(key, '불러오기 실패(무음)', last);
      return null;
    })();
    this.bufs.set(key, p);
    return p;
  }

  /** 경로 1개 받기+디코딩(경로 단위 캐시, 실패도 캐시) */
  file(path) {
    if (!this.files.has(path)) {
      const p = (async () => {
        const r = await fetch(BASE + path);
        if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + path);
        const ab = await r.arrayBuffer();
        // 구형 사파리는 콜백형 decodeAudioData 만 지원
        return await new Promise((res, rej) => { const q = this.ctx.decodeAudioData(ab, res, rej); q?.catch?.(rej); });
      })();
      p.catch(() => {}); // 실패는 load 에서 처리(미처리 거부 경고 방지)
      this.files.set(path, p);
    }
    return this.files.get(path);
  }

  /** 후보 키를 차례로 받아 첫 성공 {k, buf}(전부 실패 null) */
  async loadFirst(keys) {
    for (const k of keys) { const buf = await this.load(k); if (buf) return { k, buf }; }
    return null;
  }

  /** 미리 받기(잠금 해제 후에만 의미). 없는 키는 무시. 이전에 미리 받고 쓰지 않은 경기 곡은 버린다 */
  preload(keys) {
    if (!this.ctx) return;
    const list = strs(keys).filter((k) => has(k));
    const stale = [...this.pre].filter((k) => !list.includes(k));
    this.pre = new Set(list.filter((k) => EVICT.test(k)));
    for (const k of stale) this.release(k);
    for (const k of list) this.load(k);
  }

  /** 경기 곡 디코딩 버퍼 해제(재생·예약 중인 곡은 그대로). 다시 요청하면 load 가 새로 받는다 */
  release(k) {
    if (!k || !EVICT.test(k) || !this.bufs.has(k)) return;
    const live = [this.cur?.key, this.fading?.key, this.wantBgm, ...this.pre].filter(Boolean);
    if (live.includes(k)) return;
    const { main, fb } = sources(entry(k));
    const used = new Set(live.filter((o) => has(o)).flatMap((o) => { const q = sources(entry(o)); return [...q.main, ...q.fb]; }));
    for (const p of [...main, ...fb]) if (!used.has(p)) this.files.delete(p); // 같은 파일을 쓰는 다른 곡이 살아 있으면 파일 캐시는 유지
    this.bufs.delete(k); this.via.delete(k); this.viaFb.delete(k);
  }

  /** 효과음 1회. key = 키 또는 후보 배열(파일을 받은 첫 키 재생). bgm.* 키는 BGM 전환으로 넘긴다.
   *  opt: vol(배율), gap(ms, 항목 gap 대신), group(+groupGap ms: 여러 키가 같은 간격 제한 공유),
   *  solo(이름: 같은 이름으로 울리던 소리를 끊고 재생 = 원작처럼 새 효과음이 앞 효과음을 대신한다). 반환: 재생 요청 수락 여부 */
  play(key, { vol = 1, gap, group, groupGap = GAP_MS, solo } = {}) {
    const list = strs(key);
    if (!list.length) return false;
    if (list[0].startsWith('bgm.')) { this.bgm(list[0]); return true; }
    this.stats.req++;
    const keys = list.filter((k) => has(k));
    if (!keys.length) { this.stats.missing++; return false; }
    if (!this.unlocked) { this.stats.locked++; return false; }
    if (this.prefs.muted) { this.stats.muted++; return false; }
    const k0 = keys[0];
    const now = performance.now();
    const since = (dk) => now - (this.lastAt.get(dk) ?? -1e9);
    if (since(k0) < (gap ?? entry(k0).gap ?? GAP_MS) || (group && since('group:' + group) < groupGap)) { this.stats.debounced++; return false; }
    this.lastAt.set(k0, now);
    if (group) this.lastAt.set('group:' + group, now);
    this.loadFirst(keys).then((got) => {
      if (!got || !this.unlocked || this.prefs.muted) return;
      const { k, buf } = got;
      this.trim(k);
      if (solo) for (const o of this.voices.filter((x) => x.solo === solo)) { try { o.src.stop(); } catch { /* 이미 끝남 */ } this.voices.splice(this.voices.indexOf(o), 1); }
      const src = this.ctx.createBufferSource(), g = this.ctx.createGain();
      src.buffer = buf; g.gain.value = Math.max(0, Math.min(1, gainOf(entry(k)) * vol));
      src.connect(g); g.connect(this.sfxBus);
      const v = { key: k, src, t: now, solo };
      this.voices.push(v);
      src.onended = () => { const i = this.voices.indexOf(v); if (i >= 0) this.voices.splice(i, 1); };
      src.start();
      this.stats.played++;
      this.stats.log.push(k); if (this.stats.log.length > 50) this.stats.log.shift();
    });
    return true;
  }

  /** 상한 초과 시 가장 오래된 소리 정지(같은 키 PER_KEY, 전체 MAX_VOICES) */
  trim(key) {
    const same = this.voices.filter((v) => v.key === key);
    const cut = (v) => { try { v.src.stop(); } catch { /* 이미 끝남 */ } this.voices.splice(this.voices.indexOf(v), 1); this.stats.cut++; };
    if (same.length >= PER_KEY) cut(same[0]);
    while (this.voices.length >= MAX_VOICES) cut(this.voices[0]);
  }

  /** BGM 전환(같은 키면 유지). null 또는 허용 목록에 없는 키 = 0xE0 페이드 아웃 정지 */
  bgm(key) {
    if (!BGM_ENABLED) return;
    const k = bgmAllowed(key) ? key : null;
    if (k === this.wantBgm && (this.cur?.key === k || (!k && !this.cur))) return;
    if (k !== this.wantBgm) this.wantAt = performance.now(); // 같은 곡을 다시 요청해도(화면 전환의 이어 듣기) 처음 명령 시각을 유지
    this.wantBgm = k;
    if (!this.unlocked) return; // 잠금 해제·복귀 때 syncBgm 이 반영
    this.startBgm(k);
  }

  /** 컨텍스트가 다시 동작할 때: 멈춘 동안 바뀐 곡 명령(wantBgm)을 재생 중인 곡에 반영(null 이면 페이드 정지) */
  syncBgm() {
    if (this.unlocked && (this.cur?.key ?? null) !== this.wantBgm) this.startBgm(this.wantBgm);
  }

  async startBgm(k) {
    if (this.cur && this.cur.key === k) return;
    // 키만 다르고 같은 파일·음량·반복이면(예: bgm.menu → bgm.vs, bgm.match → bgm.stage.NN) 끊지 않고 이어 튼다
    if (this.cur && k && this.cur.sig === bgmSig(entry(k))) { this.cur.key = k; return; }
    if (!k) { const c = this.cur; this.cur = null; this.fadeOut(c); return; } // 0xE0
    const old = this.cur; // 새 곡이 준비될 때까지 이전 곡 유지 → 준비되면 즉시 교체(원작: 새 곡 명령이 이전 곡을 바로 끊는다)
    const buf = await this.load(k);
    if (this.wantBgm !== k || this.cur !== old || !this.unlocked) return; // 로딩 중 다른 요청
    const gone = [old?.key, this.fading?.key];
    this.cut(old); this.cut(this.fading); // 페이드 중이던 곡도 새 곡 명령에 끊긴다
    this.cur = null; this.fading = null;
    this.pre.delete(k);
    for (const o of gone) this.release(o);
    if (!buf) return; // 불러오기 실패: 무음
    const e = entry(k), t = this.ctx.currentTime;
    const loop = e.once !== true && e.loop !== false;
    // 1회 곡이 명령보다 늦게 시작(소리 잠금·로딩): 원작은 그동안 곡이 흘렀으므로 늦은 만큼 건너뛴다. 이미 끝났을 시간이면 틀지 않는다
    const late = loop ? 0 : (performance.now() - this.wantAt) / 1000;
    if (late >= buf.duration) { this.wantBgm = null; this.release(k); return; }
    const src = this.ctx.createBufferSource(), g = this.ctx.createGain();
    src.buffer = buf; src.loop = loop;
    const lp = this.viaFb.has(k) ? null : loopPts(e);
    if (src.loop && lp && lp[0] < buf.duration) { src.loopStart = lp[0]; src.loopEnd = Math.min(lp[1], buf.duration); }
    g.gain.setValueAtTime(Math.max(0, Math.min(1, gainOf(e))), t);
    src.connect(g); g.connect(this.bgmBus);
    if (late > LATE_SEC) src.start(0, late); else src.start();
    const c = { key: k, src, g, sig: bgmSig(e), fade: +e.fade_sec > 0 ? +e.fade_sec : FADE_SEC };
    this.cur = c;
    // 1회 재생 곡이 끝나면 비워 둔다(같은 키를 다시 요청하면 처음부터 재생).
    // 그 사이 다른 곡 명령이 남아 있으면(로딩이 곡보다 길었거나 멈춘 동안 받은 명령) 그 곡을 시작한다
    src.onended = () => {
      if (this.cur !== c) return;
      this.cur = null;
      if (this.wantBgm === k) this.wantBgm = null;
      else if (this.wantBgm && this.unlocked) this.startBgm(this.wantBgm);
      this.release(k);
    };
    this.stats.bgm++;
    this.stats.log.push(k); if (this.stats.log.length > 50) this.stats.log.shift();
  }

  /** 원작 0xE0: 곡 틱 120개 동안 30dB 내려간 뒤 끊김 */
  fadeOut(c, sec) {
    if (!c || !this.ctx) return;
    const t = this.ctx.currentTime, d = sec ?? c.fade ?? FADE_SEC, g0 = c.g.gain.value;
    try {
      c.g.gain.cancelScheduledValues(t);
      c.g.gain.setValueCurveAtTime(FADE_CURVE.map((v) => v * g0), t, d);
      c.src.stop(t + d);
      c.src.onended = () => { if (this.fading === c) this.fading = null; this.release(c.key); };
      this.fading = c;
    } catch { this.cut(c); this.release(c.key); }
  }

  /** 즉시 끊기(새 곡 교체·0xE1) */
  cut(c) {
    if (!c) return;
    try { c.src.onended = null; c.src.stop(); } catch { /* 이미 정지 */ }
    try { c.g.disconnect(); } catch { /* 무시 */ }
  }

  /** 원작 0xE1: 즉시 정지 */
  bgmStop() {
    this.wantBgm = null;
    const gone = [this.cur?.key, this.fading?.key];
    this.cut(this.cur); this.cut(this.fading); this.cur = null; this.fading = null;
    for (const o of gone) this.release(o);
  }

  applyVol() {
    if (!this.master) return;
    const v = this.prefs.muted ? 0 : this.prefs.vol;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t); this.master.gain.setTargetAtTime(v, t, 0.02);
  }

  save() { try { localStorage.setItem(STORE, JSON.stringify(this.prefs)); } catch { /* 저장 불가: 이번 탭만 */ } }

  set(p) {
    Object.assign(this.prefs, p);
    this.applyVol(); this.save(); this.emit();
  }

  toggleMute() { this.set({ muted: !this.prefs.muted }); }

  /** 버튼: 크게 → 작게 → 끔 → 크게 */
  cycle() {
    const { muted, vol } = this.prefs;
    if (muted) return this.set({ muted: false, vol: VOLS[0] });
    const i = VOLS.findIndex((x) => Math.abs(x - vol) < 0.01);
    if (i >= 0 && i < VOLS.length - 1) return this.set({ vol: VOLS[i + 1] });
    this.set({ muted: true });
  }

  on(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }
  emit() { for (const fn of this.subs) { try { fn(this.prefs); } catch (e) { console.error(e); } } }
}

export const audio = new SoundManager();

/** 소리 버튼(로비·경기 공용). 화면이 사라지면 구독도 자동 정리 */
export function soundButton(h, cls = 'button.btn.small.snd') {
  const b = h(cls, { type: 'button', title: '소리 (M)', onclick: () => { audio.cycle(); b.blur(); } });
  const paint = () => {
    if (!b.isConnected && b.dataset.mounted) { off(); return; }
    const { muted, vol } = audio.prefs;
    b.dataset.mounted = '1';
    b.setAttribute('aria-pressed', String(!muted));
    b.textContent = muted ? '소리 끔' : vol < VOLS[0] - 0.01 ? '소리 작게' : '소리';
  };
  const off = audio.on(paint);
  paint();
  return b;
}
