"""오디오 키를 public/assets/manifest.json 에 추가/갱신한다(sfx.* / bgm.* 만 다룸, 다른 키는 건드리지 않음).

입력: public/assets/audio/audio_qa.json (tools/audio_synth.py), analysis/data/rom_audio.json (analysis/scripts/rom_audio_render.py)
규칙: path = 우선 파일, fallback = 대체 파일(없으면 생략). ROM 렌더는 public/assets/rom/ (gitignore) 이라
      다른 PC 에서는 없을 수 있다 → 재생기는 path 실패 시 fallback 을 쓴다. 키별 우선순위는 prefer 필드.
실행: python tools/audio_manifest.py
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAN = os.path.join(ROOT, 'public', 'assets', 'manifest.json')
SYN = json.load(open(os.path.join(ROOT, 'public', 'assets', 'audio', 'audio_qa.json'), encoding='utf-8'))
ROM_ONLY = True
RP = os.path.join(ROOT, 'analysis', 'data', 'rom_audio.json')
ROM = json.load(open(RP, encoding='utf-8')) if os.path.exists(RP) else {'sfx': {}, 'bgm': {}}

# key: (ROM 태그 또는 None, 서버 이벤트, 우선(rom/synth), gain, preload, 메모)
SFX = {
    'sfx.ui.cursor': ('a0', 'UI 커서 이동', 'rom', 0.7, 'boot', ''),
    'sfx.ui.confirm': ('a1', 'UI 결정', 'rom', 0.8, 'boot', ''),
    'sfx.ui.cancel': (None, 'UI 취소', 'synth', 0.6, 'boot', '원작은 취소음 없음(11 문서) - 자체 합성'),
    'sfx.ball.throw': ('a2', 'throw', 'rom', 1.0, 'stage', ''),
    'sfx.ball.pass': ('a3', 'pass(fm 아님)', 'rom', 0.9, 'stage', 'A3=패스 [추정]'),
    'sfx.ball.catch': ('a4', 'catch', 'rom', 1.0, 'stage', 'A4=위험 공 캐치 [추정]'),
    'sfx.ball.receive': ('a5', 'receive', 'rom', 0.8, 'stage', 'A5=공 받기 [관측+코드]'),
    'sfx.ball.pickup': ('a5', 'pickup', 'rom', 0.7, 'stage', '원작 전용음 미발견 - A5 공용 [추정]'),
    'sfx.ball.hit': ('aa', 'hit', 'rom', 1.0, 'stage', 'AA=피격 넉백 [추정]'),
    'sfx.ball.hit_strong': ('ab', 'hit(강, 선택)', 'rom', 1.0, 'stage', 'AB=$20>=0x100 분기 [추정]'),
    'sfx.ball.bounce': (None, 'bounce', 'synth', 0.5, 'stage', '원작 호출 미발견 - 과하면 끄기'),
    'sfx.ball.wall': (None, 'wall', 'synth', 0.5, 'stage', '원작 호출 미발견 - 과하면 끄기'),
    'sfx.player.jump': ('a6', 'jump', 'rom', 0.9, 'stage', ''),
    'sfx.player.land': (None, '(착지 이벤트 없음)', 'synth', 0.6, 'stage', '서버 land 이벤트 없음'),
    'sfx.player.dash': (None, 'dash', 'synth', 0.6, 'stage', ''),
    'sfx.player.out': (None, 'out', 'synth', 0.9, 'stage', '원작은 호루라기(AE)만 - 합성음은 선택'),
    'sfx.tip.swing': ('a2', 'tip_swing', 'rom', 0.9, 'stage', '08: 쳐내기 0xA2'),
    'sfx.ref.whistle': ('ae', 'ref_out', 'rom', 1.0, 'stage', ''),
    'sfx.start.enter': (None, 'enter', 'synth', 0.9, 'stage', '원작 0x95 는 곡(입장 행진) → bgm.enter (sfxmap.js matchBgm)'),
    'sfx.start.go': ('81v', 'go', 'rom', 1.0, 'stage', '원작 음성(DAC)'),
    'sfx.start.fight': ('82v', 'toss', 'rom', 1.0, 'stage', '원작 음성(DAC)'),
    'sfx.match.gameset': ('83v', 'end', 'rom', 1.0, 'stage', '원작 음성(DAC)'),
    'sfx.match.timeup': (None, 'timeup', 'synth', 0.8, 'stage', ''),
    'sfx.match.sudden_death': (None, 'sudden_death', 'synth', 0.8, 'stage', ''),
    'sfx.formation.start': (None, 'fm_start', 'synth', 0.9, 'stage', '원작은 창 열기 A1 → sfx.formation.open'),
    'sfx.formation.open': ('a1', 'fm_ready 또는 작전 창', 'rom', 0.8, 'stage', '14: 창 열기·결정 0xA1'),
    'sfx.formation.pass': ('c3', 'pass(fm=1)', 'rom', 1.0, 'stage', '14: 0xC3 [관측]'),
    'sfx.formation.receive': ('a5', 'receive(포메이션)', 'rom', 0.8, 'stage', '14: 0xA5 [관측]'),
}
for t in ('b7', 'b8', 'b9', 'ba', 'bb', 'bd', 'be', 'bf', 'c0', 'c1'):
    SFX['sfx.special.' + t] = (t, 'special(specialSfxKey)', 'rom', 1.0, 'stage', '06 ROM[0xB866+ID]')
SFX['sfx.player.catch_ready'] = (None, 'catch_start', 'synth', 0.5, 'stage', '원작 호출 미발견 - 합성')
SFX['sfx.player.crouch'] = (None, 'crouch', 'synth', 0.5, 'stage', '원작 호출 미발견 - 합성')
SFX['sfx.tip.hit'] = (None, 'tip_hit', 'synth', 0.9, 'stage', '원작 전용음 미발견(쳐내기 시작은 A2=sfx.tip.swing) - 합성')
for k, t in (('fireball', 'b0'), ('impact', 'b1'), ('flame', 'b2'), ('sublogo', 'b5'), ('wipe', 'b4'), ('flash', 'b3')):
    SFX['sfx.intro.' + k] = (t, 'intro CUES', 'rom', 1.0, 'intro', '10 §4')

SFX['sfx.player.run'] = ('a9', '대시+공 보유 6프레임마다(analysis/data/footsteps.json)', 'rom', 1.0, 'stage', '0x8BBA 표 0x8BDE [코드+실측]')
SFX['sfx.player.run_alt'] = ('c5', '위와 같음, romStage 5·9(웹 stage 8·4)', 'rom', 1.0, 'stage', '0x8BDE 표 [코드], 바닥 재질 의미 [추정]')

# 스토리 대사 타이핑음(48 §2-2·§10): 화자별 표 0x7528A, 가나(변환 타일 0x60~0xD0) 한 글자마다. 화면 연결은 2단계(윤프론). 건너뛰기 0xA0 = sfx.ui.cursor
SFX['sfx.story.type_b6'] = ('b6', '대사 타이핑(だんぺい, 화자 0x00)', 'rom', 1.0, 'menu', '48 §2-2 표 0x7528A [코드+실측]')
SFX['sfx.story.type_a7'] = ('a7', '대사 타이핑(대부분 화자)', 'rom', 1.0, 'menu', '48 §2-2 표 0x7528A [코드+실측]')
SFX['sfx.story.type_a8'] = ('a8', '대사 타이핑(キャサリン·はるか·みさと)', 'rom', 1.0, 'menu', '48 §2-2 표 0x7528A [코드+실측]')

# BGM: 원작 곡만(합성 사용 안 함). 루프가 확정(loop_confident)된 곡만 키를 만든다.
STAGES = json.load(open(os.path.join(ROOT, 'server', 'data', 'stages.json'), encoding='utf-8'))['stages']
T50D2 = ROM.get('stage_bgm_table_0x50D2', [])
T50F2 = ROM.get('story_bgm_table_0x50F2', [])
BGM = {
    'bgm.title': ('8a', 'intro', '0xF042 타이틀 [확인: 10 §4 큐 관측]'),
    'bgm.menu': ('8c', 'menu', '0x109A6 모드 메뉴 [확인]'),
    'bgm.menu.mode3': ('8d', 'menu', '0x14806: $E600==0xB4(모드3)면 8C 대신 8D [코드]'),
    'bgm.vs': ('8b', 'menu', '0x14880 라인업(VS) [확인: 11 관측]'),
    'bgm.enter': ('95', 'stage', '0x5ED2 경기 시작 연출(서브상태 0x0C) [확인]'),
    'bgm.result.win': ('8e', 'stage', '0x40E8: 승자 $E68A==$E700(1P 사이드)면 8E [코드, 1P=E700 은 추정]'),
    'bgm.result.lose': ('93', 'stage', '0x4100: 그 외 93 [코드]'),
}
for st in STAGES:
    rs = st['romStage']
    if rs < len(T50D2):
        BGM['bgm.stage.%02d' % st['id']] = (T50D2[rs][2:].lower(), 'stage', '0x50C2: 표 0x50D2[$E682=romStage %d]=%s (스토리 외 모드) [코드]' % (rs, T50D2[rs]))
for k, v in enumerate(T50F2):
    if v != '0x00':
        BGM['bgm.story.%02d' % k] = (v[2:].lower(), 'stage', '0x50E2: 스토리($E68E==0) 표 0x50F2[$E688=%d]=%s [코드, $E688=스토리 경기 번호는 추정]' % (k, v))


# 2026-11-18: bgm.* 키는 tools/bgm/build_manifest.py 가 관리한다(곡별 허용 목록, verified:true). 이 스크립트는 bgm.* 를 건드리지 않는다.
BGM = {}


def main():
    man = json.load(open(MAN, encoding='utf-8'))
    added, updated, unsure = [], [], []
    for key, (tag, ev, prefer, gain, pre, memo) in SFX.items():
        syn_key = key if key in SYN['sfx'] else None
        syn = SYN['sfx'].get(key)
        rom = ROM['sfx'].get(tag) if tag else None
        if prefer == 'rom' and rom:
            e = {'type': 'sfx', 'path': rom['path'], 'prefer': 'rom', 'rom_id': '0x' + tag[:2].upper() + (' (voice $1BFF)' if tag.endswith('v') else ''),
                 'source': 'rom-render(analysis/scripts/rom_audio_render.py)', 'sec': rom['sec'], 'bytes': rom['bytes']}
            if syn:
                e['fallback'] = syn['path']
        elif syn:
            e = {'type': 'sfx', 'path': syn['path'], 'prefer': 'synth', 'source': 'synth(tools/audio_synth.py)',
                 'sec': syn['sec'], 'bytes': syn['bytes']}
            if rom:
                e['alt_rom'] = rom['path']
        else:
            continue
        # ROM 렌더 효과음은 전부 같은 이득(1.0): 원작 칩 출력 비율 그대로(analysis/27_bgm_status.md §5). 표의 gain 은 합성음에만 적용
        e.update(gain=1.0 if e['prefer'] == 'rom' else gain, preload=pre, event=ev, qa='auto-pass(피크·클리핑·길이), 청취 UNVERIFIED')
        if memo:
            e['_note'] = memo
        if '[추정]' in memo:
            e['verify'] = True
        (updated if key in man else added).append(key)
        man[key] = e
    for key, (tag, pre, memo) in BGM.items():
        rom = ROM.get('bgm', {}).get(tag)
        if not rom or not rom.get('loop_confident'):
            unsure.append('%s(0x%s)' % (key, tag.upper()))
            man.pop(key, None)
            continue
        e = {'type': 'bgm', 'path': rom['ogg'], 'alt': rom['mp3'], 'prefer': 'rom', 'rom_id': '0x' + tag.upper(),
             'loop': rom['loop'], 'source': 'rom-render(analysis/scripts/rom_audio_render.py)', 'sec': rom['sec'],
             'bytes': rom['ogg_bytes']}
        if rom['loop']:
            e.update(loop_start=rom['loop_start'], loop_end=rom['loop_end'])
        e.update(gain=1.0, preload=pre, qa='auto-pass(채널별 루프 탐지+오디오 상관 %s), 청취 UNVERIFIED' % rom.get('audio_corr'), _note=memo)
        if '추정' in memo:
            e['verify'] = True
        (updated if key in man else added).append(key)
        man[key] = e
    if ROM_ONLY:  # 2026-11-17 사용자 결정: 효과음·BGM 모두 원작만. 원작에 없는 합성 전용음·합성 BGM·징글 키 제거(파일은 보관)
        drop = [k for k, v in man.items() if k.startswith('sfx.jingle.') or k == 'bgm.story'
                or (k.startswith(('sfx.', 'bgm.')) and v.get('prefer') == 'synth')]
        for k in drop:
            del man[k]
        print('removed', len(drop), drop)
        added = [k for k in added if k in man]; updated = [k for k in updated if k in man]
    with open(MAN, 'w', encoding='utf-8') as f:
        f.write(json.dumps(man, ensure_ascii=False, indent=1) + '\n')
    print('added', len(added), 'updated', len(updated))
    print('원작 BGM 루프 미확정(키 없음):', ', '.join(unsure) or '없음')
    print('\n'.join(added + updated))


if __name__ == '__main__':
    main()
