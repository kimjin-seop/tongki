"""원작 BGM 곡별 허용 목록 → public/assets/manifest.json 의 bgm.* 키(verified:true) 생성. bgm.* 외에는
ROM 렌더 효과음(prefer:'rom')의 gain 만 1.0 으로 맞춘다(원작 칩 출력 비율 유지, analysis/27_bgm_status.md §5).

허용 조건(전부 충족):
 1. 루프 확정: tools/bgm/loop_exact.py 가 곡 진행 상태 반복(kind loop) 또는 종료(kind once)를 확인, 키 온·PSG 쓰기 열 1·2회차 일치
 2. 수치 대조 통과: tools/bgm/render.py 의 1·2회차 스펙트로그램 상관 >= MIN_CORR, 루프 길이 오차 |지연| <= MAX_LAG_MS, 클리핑 0, ogg 디코딩 길이 일치
 3. 장면 연결: 아래 SCENES(ROM 호출 지점이 [확인]/[코드] 이고 웹에 대응 장면이 있는 곡)만
허용되지 않은 곡은 키를 만들지 않는다(무음). 결과 표는 analysis/data/bgm_loops.json 의 status 에 기록.
사용: python tools/bgm/build_manifest.py
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MAN = os.path.join(ROOT, 'public', 'assets', 'manifest.json')
META = os.path.join(ROOT, 'analysis', 'data', 'bgm_loops.json')
MIN_CORR, MAX_LAG_MS = 0.9, 2.0
# 수치 조건과 별개로 결정이 날 때까지 켜지 않는 곡(곡 hex -> 사유). 결정되면 여기서 지우고 렌더를 public/assets/rom/bgm/ 에 둔 뒤 다시 실행한다.
HOLD = {
    '85': '보류: 루프 확정(전체 주기 33408틱 529.340초 = 11바퀴, 공개 에뮬 대조 통과). 전체 주기 파일이 9.9MB·디코딩 약 198MB 라 켜지 않음. '
          '후보 rom/bgm_cand/85.ogg(전체 주기), rom/bgm_cand_lap/85.ogg(한 바퀴 루프). analysis/35_bgm_port_plan.md §8',
}
ROMF = open(os.path.join(ROOT, 'rom', 'danpei.gen'), 'rb').read()
T50D2 = list(ROMF[0x50D2:0x50D2 + 16])   # 스토리 외: 인덱스 $E682 = ROM 스테이지
T50F2 = list(ROMF[0x50F2:0x50F2 + 15])   # 스토리: 인덱스 $E688 = 경기 번호(0~14)

# 키: (곡 ID, preload, 장면·근거)
SCENES = {
    'bgm.title': (0x8A, 'intro', '인트로 로고 드러남(f642)~타이틀. 68k 0xF042 [확인: 10 §4 큐 관측]'),
    'bgm.menu': (0x8C, 'menu', '모드 메뉴·팀 선택. 68k 0x109A6 [확인: 10 §4, 11 관측]'),
    'bgm.vs': (0x8B, 'menu', '라인업(VS)·편성 화면. 68k 0x14880 [확인: 11, 20 관측]'),
    'bgm.enter': (0x95, 'stage', '경기 시작 입장 행진(매치 서브상태 0x0C, f7). 68k 0x5ED2 [확인: 08 §1]'),
    'bgm.result.win': (0x8E, 'stage', '결과: 68k 0x40E2 - 사람 대 컴퓨터가 아니거나 승자가 1P 쪽($E68A==$E700) [코드]'),
    'bgm.result.lose': (0x93, 'stage', '결과: 68k 0x4100 - 사람 대 컴퓨터에서 1P 쪽 패배 [코드]'),
    # 2026-11-20 PENDING 에서 이동(53 §6-3: ROM 근거 충족). 웹 화면 연결(SCENE_BGM_ON)은 별도, 실화면 확인은 53 §9 검증에 포함
    'bgm.story.scene': (0x91, 'menu', '스토리 제목 카드(서브 2, 68k 0x11CA0) 시작 → 경기 전 대사·라인업·편성·맞대면까지 유지 → 맞대면 끝 0xE0(0x125DC) [판독 48 §2 + 실측 t48_story_scene.py 큐 0x91]'),
}
STAGES = json.load(open(os.path.join(ROOT, 'server', 'data', 'stages.json'), encoding='utf-8'))['stages']
for st in STAGES:
    rs = st['romStage']
    SCENES['bgm.stage.%02d' % st['id']] = (T50D2[rs], 'stage', '경기 곡(스토리 외): 68k 0x50C2 표 0x50D2[ROM 스테이지 %d] = 0x%02X [코드]. 시작 시점 0xDC6C(심판 복귀 완료)' % (rs, T50D2[rs]))
for k, v in enumerate(T50F2):
    SCENES['bgm.story.%02d' % k] = (v, 'stage', '경기 곡(스토리): 68k 0x50E2 표 0x50F2[경기 번호 %d] = 0x%02X [코드]' % (k, v))

# 등록 준비(48 §2·§10): 장면 근거(ROM 코드 위치)는 확정, 웹 화면은 2단계(윤프론) 구현 뒤 실화면 확인을 거쳐 SCENES 로 옮긴다.
# 여기 있는 키는 manifest 에 쓰지 않는다. 판정만 보려면: python tools/bgm/build_manifest.py --pending (아무 파일도 쓰지 않음)
PENDING = {
    'bgm.story.win': (0x98, 'menu', '스토리 경기 후 대사(서브 9) 승리 진입 68k 0x1268A, 패배는 0xE1 즉시 정지(0x12694) [판독 48 §2]'),
    'bgm.story.map': (0x90, 'menu', '세계 지도(서브 1, 68k 0x11A36), 8~14번째 경기 앞 [판독 + 32 실행 확인] — 2차 범위'),
    'bgm.story.ending': (0x92, 'menu', '엔딩 그림→스태프 롤(서브 12, 68k 0x12CDA), 1회 재생 [판독] — 2차 범위'),
}


def judge(s):
    """곡 1개 → (통과 여부, 사유)"""
    r = s.get('render')
    tag = s['id'][2:].lower()
    if tag in HOLD:
        return False, HOLD[tag]
    if s['kind'] == 'unknown':
        return False, '루프 미확정(%s)' % s.get('_note', '')
    if not r:
        return False, '렌더 없음'
    if r['clipped_samples']:
        return False, '클리핑 %d' % r['clipped_samples']
    if abs(r['ogg_decoded_sec'] - r['sec']) > 0.05 or r['ogg_vs_wav_corr'] < 0.95:
        return False, 'ogg 디코딩 불일치'
    if s['kind'] == 'once':
        return True, '1회 재생 곡: 드라이버 상태 정지 %.3f초, 마지막 소리 %.3f초' % (s['end_sec'], r['last_sound_sec'])
    if not (s['keyon_equal'] and s['psg_equal']):
        return False, '1·2회차 키 온/PSG 쓰기 열 불일치'
    if r['pass_corr'] < MIN_CORR or abs(r['best_lag_ms']) > MAX_LAG_MS:
        return False, '스펙트럼 대조 미달(상관 %.3f, 지연 %.2fms)' % (r['pass_corr'], r['best_lag_ms'])
    return True, '루프 %.3f~%.3f초(길이 %.3f초, %d틱), 키 온 %d개·PSG %d개 일치, 스펙트럼 상관 %.3f, 지연 %.2fms' % (
        s['loop_start_sec'], s['loop_end_sec'], s['loop_len_sec'], s['loop_ticks'], s['keyon_writes'], s['psg_writes'], r['pass_corr'], r['best_lag_ms'])


def main():
    meta = json.load(open(META, encoding='utf-8'))
    songs = meta['songs']
    man = json.load(open(MAN, encoding='utf-8'))
    for k in [k for k in man if k.startswith('bgm.')]:
        del man[k]
    status = {}
    for tag, s in sorted(songs.items()):
        ok, why = judge(s)
        status[tag] = {'id': s['id'], 'kind': s['kind'], 'numeric_pass': ok, 'detail': why, 'keys': [], 'enabled': False}
    added = []
    for key, (cid, pre, memo) in SCENES.items():
        tag = '%02x' % cid
        st = status.get(tag)
        if not st:
            continue
        st['keys'].append(key)
        if not st['numeric_pass']:
            continue
        s = songs[tag]; r = s['render']
        e = {'type': 'bgm', 'path': r['ogg'], 'alt': r['mp3'], 'prefer': 'rom', 'rom_id': s['id'], 'verified': True,
             'loop': bool(r['loop']), 'gain': 1.0, 'fade_sec': round(120 * s['tick_sec_last'], 3), 'preload': pre,
             'sec': r['sec'], 'bytes': r['ogg_bytes'], 'source': 'rom-render(tools/bgm/loop_exact.py + render.py)',
             'scene': memo, 'check': st['detail'] + ' / 청취 UNVERIFIED'}
        if r['loop']:
            e.update(loop_start=r['loop_start'], loop_end=r['loop_end'])
        man[key] = e
        st['enabled'] = True
        added.append(key)
    for tag, st in status.items():
        if not st['keys']:
            st['detail'] += ' / 장면 연결 미확정(키 없음)'
    n_sfx = 0
    for k, v in man.items():
        if k.startswith('sfx.') and isinstance(v, dict) and v.get('prefer') == 'rom' and v.get('gain') != 1.0:
            v['gain_before_mix_fix'] = v.get('gain'); v['gain'] = 1.0; n_sfx += 1
    meta['status'] = status
    meta['allow'] = sorted(t for t, st in status.items() if st['enabled'])
    json.dump(meta, open(META, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    with open(MAN, 'w', encoding='utf-8') as f:
        f.write(json.dumps(man, ensure_ascii=False, indent=1) + '\n')
    print('bgm keys', len(added), 'sfx gain -> 1.0:', n_sfx)
    for tag, st in status.items():
        print(tag, 'ON ' if st['enabled'] else 'off', st['kind'], ','.join(st['keys']) or '-', '|', st['detail'])


def pending_report():
    """PENDING 키의 수치 판정만 출력(파일 쓰기 없음)"""
    songs = json.load(open(META, encoding='utf-8'))['songs']
    for key, (cid, pre, memo) in PENDING.items():
        tag = '%02x' % cid
        s = songs.get(tag)
        ok, why = judge(s) if s else (False, '곡 정보 없음')
        r = (s or {}).get('render') or {}
        print('%-17s 0x%02X %s kind=%s file=%s %s | %s' % (key, cid, 'PASS' if ok else 'FAIL', (s or {}).get('kind'), r.get('ogg'), r.get('ogg_bytes'), why))


if __name__ == '__main__':
    import sys
    sys.stdout.reconfigure(encoding='utf-8')
    if '--pending' in sys.argv:
        pending_report()
    else:
        main()
