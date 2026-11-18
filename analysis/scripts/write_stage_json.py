import numpy
"""stage_NN.json / stages_index.json 작성(기존 stage_00.json 은 건드리지 않음). 입력: extract_stages.py run <pkl>. cwd=프로젝트 루트."""
import sys, json, pickle
sys.path.insert(0, 'analysis/scripts')
import extract_stages as E
sm = pickle.load(open(sys.argv[1], 'rb'))
THEME = {1: '석상(천사상) 담장 + 점토색 코트', 2: '축구장식 스타디움(파란 코트·녹색 잔디)', 3: '목장(젖소·초원)', 7: '황혼 초원/사막(울타리, 석양)',
         9: '중국풍 문·사자상(야자수)', 8: '대도시 옥상(철조망·고층빌딩)', 4: '안개 낀 돌바닥 야외(녹회색)', 10: '러시아풍 건물(레닌 간판)·눈/얼음 코트',
         5: '이집트(스핑크스·피라미드)', 11: '그리스 신전(파르테논)', 12: '정글', 0: '이스터 섬 모아이상', 6: '야경 도시·고가도로(벽돌 바닥)',
         13: '유리창 건물 + 근육 조각상, 모래색 코트(모드4/특수 $E682=0xD)'}
def runs(rows):
    out = []
    for r, (err, f, rd) in enumerate(rows):
        if out and out[-1]['factor'] == f and out[-1]['rounding'] == rd: out[-1]['rows'][1] = r
        else: out.append(dict(rows=[r, r], factor=f, rounding=rd))
    return out
index = {}
for nn, d in sm.items():
    rs = d['rom']
    story = [k for k in range(15) if E.STORY_STAGE[k] == rs]
    teams_vs = [t for t in range(24) if E.VS_STAGE[t] == rs]
    prio = rs in E.PRIO_CLEAR
    far_rows = runs(d['rowsB']); near_rows = runs(d['rowsA'])
    J = {
     'key': 'bg.stage.%02d' % nn,
     'source': 'rom-extract: ROM 직접 디코드(타일 0x1126 / 타일맵 Enigma 0x1356 / 팔레트 0x1A598). 에뮬레이터로 ROM 로더(0x4DCC,0x4DEA,0x4E82) 실행 후 VRAM/CRAM 과 전수 일치 확인(analysis/scripts/extract_stages.py)',
     'rom_stage_index': rs,
     'rom_refs': {'stage_palette': hex(d['refs']['palette']), 'tiles': hex(d['refs']['tiles']), 'tilemaps': [hex(d['refs']['map_a']), hex(d['refs']['map_b'])],
                  'note': '$E682=%d. 표: 팔레트 0x1A598 / 평면A 맵 0x1A778 / 평면B 맵 0x1A798 / 타일 0x1FCBE. 타일 %d개(VRAM 0x730~)' % (rs, d['nt'])},
     'theme_guess': THEME[rs],
     'logical_screen': [320, 224], 'image_size': [512, 224], 'full_scroll_width_included': True,
     'layers': {
      'flat': {'path': 'rom/bg/stage_%02d.png' % nn, 'size': [512, 224], 'alpha': False, 'note': '원경(far)을 카메라 96 정렬로 합친 단일 이미지. 카메라 96일 때만 원작과 일치(행별 시차 스테이지는 특히)'},
      'far': {'path': 'rom/bg/stage_%02d_far.png' % nn, 'size': [512, 96], 'alpha': False, 'y': 0, 'wrap_x': 512, 'note': 'VDP 평면 B (64x12 타일). near 의 투명 영역으로만 보임'},
      'near': {'path': 'rom/bg/stage_%02d_near.png' % nn, 'size': [512, 224], 'alpha': True, 'y': 0, 'wrap_x': 512, 'note': 'VDP 평면 A (64x28 타일, 색 0 = 투명)'}},
     'draw_order': ['far', 'near', 'sprites(선수·공·그림자: 모두 배경 위)'],
     'camera': {'x_range': [0, 192], 'center': 96, 'y': 0, 'vertical_scroll': 0},
     'parallax': {
       'hscroll_mode': 'full_screen' if d['hmode'] == 0 else 'per_8px_row',
       'vdp_reg11': d['hmode'], 'code': '0x2F6C 의 $E682 별 점프표(0x2F7E) / 모드는 0x48D8 이 $E643(reg11 섀도) 에 표 0x48F8[$E682] 로 설정',
       'formula': 'shift(cam) = 96 + rounding((cam-96)*factor);  near_draw_x = -shift_near,  far_draw_x = -shift_far  (512 폭 반복). 평면 x = 화면 x + shift',
       'rows_unit': '8px 행(0..27). full_screen 이면 모든 행이 0행 값을 공유',
       'near_rows': near_rows, 'far_rows': far_rows,
       'fit_max_error_px': 0, 'evidence': 'ROM 0x2F6C 루틴을 에뮬레이터로 cam=0..191 전수 호출해 얻은 행별 이동량과 위 식이 모두 일치(오차 0)'},
     'near_priority': {'top_rows_cleared': 8 if prio else 0, 'note': '평면 A 타일 우선순위 비트를 0x5010 가 상단 8행(타일맵 반쪽 앞 256워드)에서 해제하는 스테이지 = %s. PNG 는 우선순위를 담지 않음(스프라이트가 모두 위라는 기존 규약 유지)' % ('예' if prio else '아니오')},
     'physics': {'friction_E22C': hex(E.FRIC[rs]), 'bounce_shift_E22A': E.BOUNCE[rs], 'note': '표 0x54BA / 0x54E8 ($E682 인덱스). 스토리 최종전($E688=0xE, $E68E=0)은 마찰 0x4000 으로 덮어씀(0x54B2)'},
     'bgm_cmd_versus': hex(E.BGM[rs]), 'bgm_note': '표 0x50D2[$E682] -> jsr $16B6 (모드 1~4). 스토리($E68E=0)는 0x50F2[$E688] 표 사용',
     'scoreboard_slot': {'tile': [34, 9], 'size_tiles': [4, 1], 'px': [272, 72, 32, 8], 'note': ('PNG 에 광고판 글자(SEGA, UI 타일 0x593~0x596, 팔레트 라인2)를 구워 둠(stage_00 과 동일 규약). 시간제한 규칙($E680=1)에서는 이 자리에 M:SS 타이머가 그려짐(0x53A4). 위치는 전 스테이지 공통(0xC4C4, 표 0x5416)' if rs != 13 else '이 스테이지는 로고 미적용(모드4 전용, 위치 미검증)')},
     'used_by': {'story_match_index_E688': story, 'versus_teams_0x1257A': teams_vs},
     'world_to_image': {'x': 'img_x = world.x', 'y': 'img_y = world.y / 2 - world.z + 96', 'screen': 'screen = img - (cam, 0)', 'evidence': 'stage_00 과 동일 공식(엔진 좌표는 스테이지 무관) [추정: 다른 스테이지의 코트 선이 같은 위치에 있음은 시각 확인(코트 사다리꼴·중앙선 x=256 동일)]'},
     'qa': 'pass(ROM 로더 결과와 타일 데이터·평면 A/B 타일맵·팔레트 전수 일치; 스크롤 식 오차 0)',
     'verify': ['플립 비트 순서: 헤더 bit1=vflip(0x1000) 비트를 먼저, bit0=hflip(0x800) 를 나중에 읽음(analysis/scripts/enigma.py 는 이름이 뒤바뀌어 있어 03_graphics.md 서술과 다름)',
                '카메라 추적 규칙(공 따라감)·경기 연출 중 수직 스크롤($E00E)은 미분석', '팔레트 애니메이션/페이드 여부는 미확인(정적 팔레트만 추출)']}
    json.dump(J, open('public/assets/rom/bg/stage_%02d.json' % nn, 'w', encoding='utf-8'), indent=1, ensure_ascii=False) if nn != 0 else None
    index['stage_%02d' % nn] = dict(rom_stage_index=rs, theme_guess=THEME[rs], story_match_index=story, versus_teams=teams_vs, hscroll_mode=J['parallax']['hscroll_mode'])
    if nn == 0: json.dump(J, open(sys.argv[2], 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
index['_note'] = 'stage_NN 의 NN = 스토리 첫 등장 순(00=스토리1전). stage_00 은 기존 파일(ROM 스테이지 1)로 유지. 13 = ROM 13(모드4 특수).'
index['_rom_tables'] = {'story_stage_by_match(0x11EC2)': E.STORY_STAGE, 'story_opponent_team_by_match+1(0x11ED2)': E.STORY_OPP, 'versus_team_to_stage(0x1257A)': E.VS_STAGE}
json.dump(index, open('public/assets/rom/bg/stages_index.json', 'w', encoding='utf-8'), indent=1, ensure_ascii=False)
