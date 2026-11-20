"""48 문서 구현 1단계: 원작 스토리 경기 전 대사 장면(서브 3)을 자작 에뮬로 실행해 프레임별로 기록한다.
- 입 애니 객체(0x118) 슬롯 $C700(통키 쪽)·$C800(상대 쪽)·$CA80 과 객체 0x12C 슬롯 $C780 의 종류·애니 번호(+6)·프레임 번호(+$10)·남은 대기(+$11)·스프라이트 정의(+$C)
- 글자 포인터 $E434, 글자 대기 $E40A, 페이지 상태 $E42D, 화자 $E45E, 사운드 큐($E610~) 기록
- 입 상태 조합이 처음 나올 때마다 전체 화면 PNG(320x224) 저장
사용: python -I -B analysis/scripts/t48_story_scene.py <rs0.pkl> <라운드 0~14> <출력 폴더>
  rs0.pkl = t32_step.py menu0 ... "pb:E6A4:1 S w60 shot S w60 shot" 로 만든 디버그 라운드 선택 상태(32 문서 §방법).
ROM·analysis/state 는 읽기만 한다. 출력은 인자로 준 폴더에만 쓴다."""
import numpy, inspect  # noqa: F401  (drv/vdprender 가 numpy 를 먼저 요구)
import sys, os, json, pickle
sys.path.insert(0, 'analysis/scripts')
from drv import *  # noqa: F401,F403
from t_md_step import render_w  # 윈도 플레인 합성 렌더

src, rnd, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
os.makedirs(out, exist_ok=True)
md = pickle.load(open(src, 'rb'))
F0 = md.frame
snd = []
_w = md.write


def w(addr, size, val):
    a = addr & 0xFFFFFF
    if a >= 0xFF0000 and (a & 0xFFFF) in range(0xE610, 0xE618) and size == 0:
        snd.append((md.frame - F0, '%02x' % val))
    return _w(addr, size, val)


md.write = w


def run(n, m0=0):
    for _ in range(n):
        md.pad = [m0, 0]
        md.run_frame()


for _ in range(rnd):
    run(3, U); run(12)
run(3, S); run(12)
# 서브 3 진입까지: 진입 컷(서브 13, 라운드 1)만 20f 주기 START 로 넘기고, 세계 지도·제목 카드(서브 1·2)는 무입력 자연 진행
for i in range(4000):
    sub = ramw(md, 0xE400)
    if ramw(md, 0xE600) == 0x9C and sub == 3:
        break
    run(1, S if (sub not in (1, 2) and i % 20 < 3) else 0)
enter = md.frame - F0
SLOTS = (0xC700, 0xC800, 0xCA80, 0xC780)  # C780 = 객체 0x12C(화자 바꿈·페이지 끝에 켜짐, 0x12238/0x12214)


def slot(a):
    return dict(t=ramw(md, a), anim=ramw(md, a + 6), tab=raml(md, a + 8), fr=md.ram[(a + 0x10) & 0xFFFF],
                cnt=md.ram[(a + 0x11) & 0xFFFF], spr=raml(md, a + 0xC))


def portrait_cells():
    """플레인 A·B·윈도 이름표에서 초상 VRAM 영역(타일 0x4C0~0x5FF) 칸의 범위(셀 단위)를 돌려준다."""
    v = md.vdp; r = v.reg; vr = v.vram
    pw = [32, 64, 128, 128][r[16] & 3]
    bases = dict(A=((r[2] & 0x38) << 10, pw), B=((r[4] & 7) << 13, pw), W=((r[3] & 0x3E) << 10, 64))
    res = {}
    for nm, (b, w_) in bases.items():
        hit = []
        for cy in range(32):
            for cx in range(w_ if w_ <= 64 else 64):
                o = (b + (cy * w_ + cx) * 2) & 0xFFFF
                t = ((vr[o] << 8) | vr[(o + 1) & 0xFFFF]) & 0x7FF
                if 0x4C0 <= t < 0x600:
                    hit.append((cx, cy, t))
        if hit:
            xs = [h[0] for h in hit]; ys = [h[1] for h in hit]
            res[nm] = dict(n=len(hit), x0=min(xs), x1=max(xs), y0=min(ys), y1=max(ys),
                           tiles=sorted(set(h[2] for h in hit))[:4] + ['...'])
    # 스프라이트 표(SAT): 링크 순서대로 (화면 x, y, 폭칸, 높이칸, 타일, 팔레트, 뒤집기)
    sat = (r[5] & 0x7F) << 9; spr = []; i = 0
    for _ in range(80):
        o = sat + i * 8
        y = ((vr[o] << 8) | vr[o + 1]) & 0x3FF; sz = vr[o + 2]; ln = vr[o + 3] & 0x7F
        a = (vr[o + 4] << 8) | vr[o + 5]; x = ((vr[o + 6] << 8) | vr[o + 7]) & 0x1FF
        spr.append(dict(x=x - 128, y=y - 128, w=((sz >> 2) & 3) + 1, h=(sz & 3) + 1, tile=a & 0x7FF,
                        pal=(a >> 13) & 3, hf=(a >> 11) & 1, vf=(a >> 12) & 1, pri=a >> 15))
        if ln == 0:
            break
        i = ln
    res['sprites'] = [s_ for s_ in spr if -32 < s_['x'] < 320 and -32 < s_['y'] < 224]
    return res


def col(wd):
    return (((wd >> 1) & 7) * 36, ((wd >> 5) & 7) * 36, ((wd >> 9) & 7) * 36)  # render_stages.py 와 같은 변환


def portrait_png(sprites, x0, y0, fn):
    """(x0,y0) 40x40 상자 안의 스프라이트를 SAT 뒤쪽부터(앞쪽이 위) 투명 바탕 RGBA 로 합성해 저장."""
    from PIL import Image
    v = md.vdp; vr = v.vram
    im = Image.new('RGBA', (40, 40), (0, 0, 0, 0)); px = im.load()
    for s_ in reversed(sprites):
        if not (x0 <= s_['x'] < x0 + 40 and y0 <= s_['y'] < y0 + 40):
            continue
        for cx in range(s_['w']):
            for cy in range(s_['h']):
                t = s_['tile'] + cx * s_['h'] + cy  # 스프라이트 칸은 세로 우선
                for yy in range(8):
                    for xx in range(8):
                        b = vr[(t * 32 + yy * 4 + (xx >> 1)) & 0xFFFF]
                        c = (b & 15) if xx & 1 else (b >> 4)
                        if c == 0:
                            continue
                        dx = s_['x'] - x0 + ((s_['w'] - 1 - cx) * 8 + 7 - xx if s_['hf'] else cx * 8 + xx)
                        dy = s_['y'] - y0 + ((s_['h'] - 1 - cy) * 8 + 7 - yy if s_['vf'] else cy * 8 + yy)
                        if 0 <= dx < 40 and 0 <= dy < 40:
                            px[dx, dy] = col(v.cram[s_['pal'] * 16 + c]) + (255,)
    im.save(fn)


cells = {}
rows = []
seen = {}
wait_pg = 0
f = 0
press = 0
while ramw(md, 0xE400) == 3 and f < 12000:
    pg = md.ram[0xE42D]
    if pg in (0x18, 0x19):
        wait_pg += 1
    else:
        wait_pg = 0
    m0 = 0
    if wait_pg >= 60 and press == 0:
        press = 3
    if press:
        m0 = A; press -= 1
        if press == 0:
            wait_pg = -10
    md.pad = [m0, 0]
    md.run_frame()
    f += 1
    s = [slot(a) for a in SLOTS]
    row = dict(f=f, ptr=raml(md, 0xE434), wt=ramw(md, 0xE40A), pg=md.ram[0xE42D], spk=md.ram[0xE45E],
               e43c=ramw(md, 0xE43C), e688=ramw(md, 0xE688), e464=ramw(md, 0xE464), e402=ramw(md, 0xE402), btn=m0,
               slots=s)
    rows.append(row)
    # VRAM 스프라이트 표는 한 프레임 늦게 반영된다(이 프레임 화면 = 직전 프레임의 객체 상태: 입 켜진 첫 프레임에 오버레이 없음,
    # 꺼진 첫 프레임에 직전 오버레이가 남음으로 확인). 그래서 그림 이름표(key)는 직전 프레임 상태로 단다
    pr = rows[-2] if len(rows) > 1 else row
    key = tuple((x['t'], x['spr'] if x['t'] else 0) for x in pr['slots']) + (pr['e688'], pr['e464'], pr['e43c'] > 0, pr['e402'])
    if key not in seen:
        fn = os.path.join(out, 'r%02d_f%05d.png' % (rnd, f))
        im = render_w(md)
        im.save(fn)
        seen[key] = fn
        cells[fn] = portrait_cells()
        portrait_png(cells[fn]['sprites'], 16, 160, fn[:-4] + '_L.png')   # 통키 쪽(왼쪽) 초상 상자 x16,y160
        portrait_png(cells[fn]['sprites'], 264, 160, fn[:-4] + '_R.png')  # 상대 쪽(오른쪽) 초상 상자 x264,y160
        base4 = [s_ for s_ in cells[fn]['sprites'] if (s_['x'] - 16, s_['y']) in ((0, 160), (32, 160), (0, 192), (32, 192))
                 or (s_['x'] - 264, s_['y']) in ((0, 160), (32, 160), (0, 192), (32, 192))]
        portrait_png(base4, 264, 160, fn[:-4] + '_Rb.png')  # 오버레이 없는 바탕 4장(40x40 = 32x32+8x32+32x8+8x8)만
json.dump(dict(round=rnd, enter_frame=enter, frames=rows, snd=snd,
               shots={repr(k): v for k, v in seen.items()}, cells=cells),
          open(os.path.join(out, 'r%02d.json' % rnd), 'w'), indent=0)
print('round', rnd, 'enter', enter, 'frames', f, 'shots', len(seen), 'snd', len(snd), flush=True)
