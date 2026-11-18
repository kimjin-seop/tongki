import numpy
"""ROM 팀/선수 이름 텍스트(0x74F8E 팀 12B 레코드, 0x753FA 선수 8B x7 x25)를 디코드해 analysis/teams_names.json 생성. 한국판 대응은 names_ko.md 근거.
사용: python -I analysis/scripts/build_team_names.py <chartab.pkl 경로>  (chartab 은 0x21C0 루틴을 에뮬레이터로 호출해 만든 바이트->타일/탁점표)"""
import sys, json, pickle
sys.path.insert(0, 'analysis/scripts')
rom = open('rom/danpei.gen', 'rb').read()
tab = pickle.load(open(sys.argv[1], 'rb'))
hira = "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん"
kata = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン"
T = {}
for i, c in enumerate(hira): T[0x60 + i] = c
for i, c in enumerate(kata): T[0x97 + i] = c
for i, c in enumerate("ァィゥェォッャュョ"): T[0xc5 + i] = c
T.update({0x93: 'っ', 0x94: 'ゃ', 0x95: 'ゅ', 0x96: 'ょ', 0x1d: 'ー'})   # 소문자/장음: 화면 대조로 확인(ゃゅょ 순, 0x1D=ー)
V = {}; P = {}
for k, v in zip("かきくけこさしすせそたちつてとはひふへほ", "がぎぐげござじずぜぞだぢづでどばびぶべぼ"):
    V[k] = v; V[chr(ord(k) + 96)] = chr(ord(v) + 96)
for k, v in zip("はひふへほ", "ぱぴぷぺぽ"):
    P[k] = v; P[chr(ord(k) + 96)] = chr(ord(v) + 96)
def ch(b):
    t, d = tab[b]
    if b == 0x20: return '　'
    c = T.get(t)
    if c is None: return chr(t) if 0x21 <= t < 0x7f else '<%02x>' % b
    if d == 0xce: return V.get(c, c)
    if d == 0xcf: return P.get(c, c)
    return c
s = lambda bs: ''.join(ch(b) for b in bs).strip('　')
# 한국판 이름 (names_ko.md [B] 근거; 수준)
KO = {'いちげきだんぺい': ('통키', '확인'), 'こぼとけちんねん': ('오맹태', '확인'), 'ひうら　たかし': ('권총탄', '확인'), 'かざみ　まさる': ('강철', '확인'),
      'はやみ　まなぶ': ('지상훈', '확인'), 'みかさキャプテン': ('황금산', '확인'), 'ひじかた　まさる': ('천일봉', '확인'),
      'たけだ　ゆういち': ('탁용칠', '확인'), 'たけだ　ゆうじ': ('탁용팔', '확인'), 'おざきキャプテン': ('오동도', '확인'), 'きのした　つよし': ('이봉원', '확인'), 'みうら　つとむ': ('서태지', '확인'),
      'にかいどうたいが': ('남타이거', '추정'), 'いがらし　ごう': ('장도끼', '확인'), 'みどう　あらし': ('민대풍', '추정'), 'たかやま　じゅん': ('나한상', '확인'),
      'うさみ　しゅん': ('우갑철', '확인'), 'りくおう　とうま': ('태백산', '추정'), 'こいずみ　あきら': ('강민철', '추정(게임판 표기 小泉晶=白川晶)')}
TEAM_KO = {0: ('태동 국민학교', '확인(球川小=たまがわ, 한국 방영명)', '球川小'), 22: ('태동 국민학교', '확인(후반부 로스터)', '球川小'), 1: ('상아 국민학교', '확인', '聖アローズ学院'),
           2: ('암산 국민학교', '확인', '荒崎小'), 3: ('백아 국민학교', '확인', 'ブラックアーマーズ')}
REGION = {4: '도쿄(都庁)', 5: '홋카이도(西北?)', 6: '교토(嵐山)', 7: '오키나와(西南?)', 8: '미국', 9: '칠레(이스터섬)', 10: '중국', 11: '러시아(소련 URS)', 12: '그리스', 13: '브라질', 14: '이집트',
          15: '미국(맨해튼)', 16: '칠레(모아이)', 17: '중국(베이징)', 18: '러시아(크렘린)', 19: '그리스(에게)', 20: '브라질(아마존)', 21: '이집트(피라미드)', 23: '초투구부(보스)', 24: '연습'}
SEL = {0: 0, 1: 1, 3: 2, 2: 3, 5: 4, 6: 5, 7: 6, 4: 7, 11: 9, 10: 8}  # 미사용
GRID = ['T.D', 'S.A', 'B.A', 'A.T', 'HOK', 'KYO', 'OKI', 'TOK', 'CHN', 'URS', 'EGY', 'GRE', 'BRA', 'CHI', 'USA']
out = {'_source': 'ROM 0x74F8E(팀명 12B x25: 약칭3+이름8+1) / 0x753FA(선수명 8B x7 x25), 글자 변환 ROM 0x21C0. 서버 미적용 제안안', 'teams': []}
for t in range(25):
    rec = rom[0x74f8e + 12 * t:0x74f8e + 12 * t + 12]
    abbr = ''.join(chr(b) for b in rec[:3]).strip()
    ja = s(rec[3:11])
    tk = TEAM_KO.get(t)
    pls = []
    for p in range(7):
        nm = s(rom[0x753fa + t * 56 + p * 8:0x753fa + t * 56 + p * 8 + 8])
        k = KO.get(nm)
        if t == 24 and p >= 5: k = ('연습생%d' % (p - 4), '추정(れんしゅう=연습)')
        pls.append({'idx': p, 'name_ja': nm, 'name_ko': k[0] if k else None, 'evidence': k[1] if k else '미확인'})
    out['teams'].append({'id': t, 'abbr': abbr, 'name_ja_rom': ja, 'name_ja_orig': tk[2] if tk else None, 'name_ko': tk[0] if tk else None,
                         'evidence': tk[1] if tk else '미확인(한국판 이름 불명)', 'note': REGION.get(t), 'select_screen_cell': GRID.index(abbr) if (t < 15 and abbr in GRID) else None, 'players': pls})
json.dump(out, open('analysis/teams_names.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('ok')
