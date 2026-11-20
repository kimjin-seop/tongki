"""48 문서 구현 1단계: t48_story_scene.py 기록(라운드 0~14)에서 대사 장면 40x40 초상을 모아 시트로 만든다.
사용: python -I -B analysis/scripts/t48_story_scene.py ... 로 15라운드 기록 뒤
      python -I -B analysis/scripts/t48_story_portraits.py <기록 폴더> [출력 폴더(기본 public/assets/rom/story)]
출력: portraits.png(RGBA 시트, 칸 40x40, 행 = 인물, 열 = 닫힘·열림(·깜빡임 1~3)), portraits.json(칸 좌표·경기별 배치·입/깜빡임 규칙·근거)
초상은 스프라이트(SAT)라 VRAM 타일 + CRAM 팔레트로 직접 합성했다(t48_story_scene.py portrait_png, 투명 = 색 번호 0)."""
import json, os, sys, hashlib, collections
from PIL import Image

src = sys.argv[1]
out = sys.argv[2] if len(sys.argv) > 2 else os.path.join('public', 'assets', 'rom', 'story')
R = open('rom/danpei.gen', 'rb').read()
NAME_TAB = 0x750BA


def jp_name(i):
    import importlib.util
    spec = importlib.util.spec_from_file_location('rt', 'analysis/scripts/romtext.py'); rt = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rt)
    return ''.join(rt.conv(b) or '' for b in R[NAME_TAB + 10 * i:NAME_TAB + 10 * i + 10] if b not in (0, 0x20))


def h(img):
    return hashlib.md5(img.tobytes()).hexdigest()


def anim_sprites(an):
    """애니 표 0x72DCA[an] -> (칸0 스프라이트, 칸1 스프라이트). 객체가 켜진 첫 화면은 칸1(0x19EC 가 같은 프레임에 1틱 진행)"""
    t = 0x72DCA; off = int.from_bytes(R[t + an:t + an + 2], 'big', signed=True); a = t + off
    assert R[a] == 2 and R[a + 1] == 4, hex(an)
    return int.from_bytes(R[a + 2:a + 6], 'big'), int.from_bytes(R[a + 6:a + 10], 'big')


def load(fn):
    return Image.open(fn).convert('RGBA')


rows = collections.OrderedDict()   # 이름 -> [이미지...]
evidence = {}
L_closed = collections.Counter(); L_imgs = {}; L_open = {}; L_blink = collections.OrderedDict()
matches = []
for k in range(15):
    d = json.load(open(os.path.join(src, 'r%02d.json' % k)))
    shots = []
    for key, fn in d['shots'].items():
        t = eval(key)  # ((type, spr) x4, e688, e464, e43c>0, e402)
        fn = os.path.join(src, os.path.basename(fn.replace('\\', '/')))
        shots.append((t, fn))
    segs = sorted(set(t[7] for t, _ in shots if t[5] == 0 and t[6]))
    m = dict(k=k, chapter=k + 1, right=[])
    for sg in segs:
        closed = [(t, fn) for t, fn in shots if t[7] == sg and t[5] == 0 and t[6] and t[0][0] == 0 and t[1][0] == 0 and t[2][0] == 0]
        on_r = [(t, fn) for t, fn in shots if t[7] == sg and t[5] == 0 and t[1][0]]
        on_l = [(t, fn) for t, fn in shots if t[7] == sg and t[5] == 0 and t[0][0]]
        assert closed, (k, sg)
        rc = load(closed[0][1][:-4] + '_Rb.png')  # 바탕 4장만 = 입 객체 꺼짐 상태
        byspr = {}
        for t, fn in on_r:
            byspr.setdefault(t[1][1], (load(fn[:-4] + '_R.png'), os.path.basename(fn)))
        ro = [v for v in byspr.values() if h(v[0]) != h(rc)]
        same = [hex(sp) for sp, v in byspr.items() if h(v[0]) == h(rc)]
        spk_anim = None
        for r_ in d['frames']:
            if r_.get('e402') == sg and r_['slots'][1]['t']:
                spk_anim = r_['slots'][1]['anim']; break
        name = 'opp_%02d' % (k + 1) if not (k == 14 and sg == 3) else 'taiga_15'
        if k == 14 and sg == 2:
            name = 'opp_15'
        s0, s1 = anim_sprites(spk_anim)
        assert s0 in byspr and s1 in byspr, (k, sg)
        rows[name] = [rc, byspr[s1][0], byspr[s0][0]]
        evidence[name] = dict(closed=os.path.basename(closed[0][1]) + ' (_Rb)', mouthA=byspr[s1][1], mouthB=byspr[s0][1], mouthAnim=hex(spk_anim), mouthSlot='C800',
                              mouthA_sprite=hex(s1), mouthB_sprite=hex(s0), equalsClosed=[x for x, sp in (('mouthA', s1), ('mouthB', s0)) if h(byspr[sp][0]) == h(rc)])
        m['right'].append(dict(seg=sg, portrait=name))
        for t, fn in closed:
            li = load(fn[:-4] + '_L.png'); L_closed[h(li)] += 1; L_imgs[h(li)] = (li, os.path.basename(fn), t[3])
        for t, fn in on_l:
            li = load(fn[:-4] + '_L.png'); L_open[h(li)] = (li, os.path.basename(fn), t[0][1])
    matches.append(m)
# 통키(왼쪽): 깜빡임 객체(0x12C, $C780)가 꺼져 있는 닫힘 칸 중 가장 흔한 그림 = 기본
base_h = None
for hh, (li, fn, c780) in sorted(L_imgs.items(), key=lambda kv: -L_closed[kv[0]]):
    if c780[0] == 0:
        base_h = hh; break
base_h = base_h or L_closed.most_common(1)[0][0]
base = L_imgs[base_h][0]
s0, s1 = anim_sprites(0)
tk = {spr: v for hh, v in L_open.items() for spr in [v[2]]}
assert s0 in tk and s1 in tk
blinks = collections.OrderedDict()
for hh, (li, fn, c780) in L_imgs.items():
    if c780[0] and c780[1] in (0x72FE2, 0x72FEA):
        blinks.setdefault(c780[1], (li, fn))
assert list(sorted(blinks)) == [0x72FE2, 0x72FEA], [hex(x) for x in blinks]
rows = collections.OrderedDict([('danpei', [base, tk[s1][0], tk[s0][0], blinks[0x72FE2][0], blinks[0x72FEA][0]])] + list(rows.items()))
evidence['danpei'] = dict(closed=L_imgs[base_h][1], mouthA=tk[s1][1], mouthB=tk[s0][1], mouthAnim='0x0', mouthSlot='C700',
                          mouthA_sprite=hex(s1), mouthB_sprite=hex(s0), equalsClosed=[x for x, sp in (('mouthA', s1), ('mouthB', s0)) if h(tk[sp][0]) == base_h],
                          blink1=blinks[0x72FE2][1] + ' (0x72FE2)', blink2=blinks[0x72FEA][1] + ' (0x72FEA)')

cols = max(len(v) for v in rows.values())
sheet = Image.new('RGBA', (cols * 40, len(rows) * 40), (0, 0, 0, 0))
frames = {}
for ri, (name, imgs) in enumerate(rows.items()):
    labels = ['closed', 'mouthA', 'mouthB', 'blink1', 'blink2'][:len(imgs)]
    for ci, im in enumerate(imgs):
        sheet.alpha_composite(im, (ci * 40, ri * 40))
        frames['%s.%s' % (name, labels[ci])] = dict(x=ci * 40, y=ri * 40, w=40, h=40)
os.makedirs(out, exist_ok=True)
sheet.save(os.path.join(out, 'portraits.png'))
meta = dict(
    schema='tongki.story_portraits/1', generatedBy='analysis/scripts/t48_story_scene.py + t48_story_portraits.py',
    source='원작 실행(자작 에뮬, 디버그 라운드 선택 → 서브 3) VRAM 타일 + CRAM 팔레트 직접 합성. 48 문서 §10',
    cell=dict(w=40, h=40), frames=frames,
    screen=dict(left=dict(x=16, y=160), right=dict(x=264, y=160), size=320, note='원작 화면(320x224) 위 초상 상자 좌상단. 왼쪽 = 통키, 오른쪽 = 상대'),
    matches=matches,
    mouth=dict(object='0x118 (처리 0x15146 → 공용 애니 0x19EC, 애니 표 0x72DCA)', framesPerAnim=2, holdFrames=5, cycleFrames=10,
               order='애니 스크립트 2칸(칸당 대기 바이트 4 = 5f). 객체가 처음 켜지면 같은 프레임에 1틱 진행해 칸1(mouthA)부터 보인다 → mouthA 5f → mouthB 5f → 반복. 객체 꺼짐 = closed(바탕). 인물에 따라 mouthA/mouthB 중 하나가 closed 와 같은 그림(evidence.equalsClosed), 둘 다 다른 인물도 있다', displayLag='VRAM 스프라이트 표는 1프레임 늦게 화면에 반영(기록으로 확인)', pause='가나 아닌 글자·」 앞·페이지 끝에서 객체만 끄고(닫힘 그림) 애니 위상은 유지, 다음 가나에서 이어서 진행(재시작 아님)',
               evidence='t48_story_scene.py 15라운드 기록: 연속 구간 5프레임 422회, 끊긴 구간 1~5f, 재개 시 프레임·카운터가 리셋되지 않음'),
    blink=dict(object='0x12C ($C780, 처리 0x116BE)', who='통키(왼쪽)만, 통키가 말하지 않을 때($C700==0)',
               rule='대기 $E43A 를 매 프레임 1 감소, 0 아래면 난수 하위 바이트(8 미만이면 8)로 다시 채움. $E43A<=7 인 동안 애니 0x22(3칸 0x72FDA·0x72FE2·0x72FEA, 칸마다 3f) 진행. 실측 화면: blink1(0x72FE2) 3f → blink2(0x72FEA) 3f → 평소(0x72FDA) 난수 간격(실측 3~139f)',
               evidence='코드 0x116BE~0x11722 [판독] + 기록의 $C780 스프라이트 변화 [실측]'),
    evidence=evidence,
    notExtracted=['3번째 경기 승리 후 이어지는 팀 그림(0x60FB6, 서브 9 0x128AC)', '15번째 경기 승리 후 엄마 그림(0x60FB2+0x6385E, 0x127DC)', '맞대면(서브 7) 화면 배치'],
)
json.dump(meta, open(os.path.join(out, 'portraits.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('rows', list(rows), 'sheet', sheet.size)
