"""HUD 분석용 VDP 렌더러(numpy). vdprender.py 와 차이: 가로 스크롤 부호(plane_x = x - hscroll) 수정, 빠름,
레이어를 (팔레트인덱스, 우선순위) 단위로 반환 가능. 분석 전용."""
import numpy as np
from PIL import Image


def cram_rgb(w):
    return (((w >> 1) & 7) * 36, ((w >> 5) & 7) * 36, ((w >> 9) & 7) * 36)


def tiles_np(vram):
    v = np.frombuffer(bytes(vram), dtype=np.uint8).reshape(2048, 8, 4)
    t = np.zeros((2048, 8, 8), np.uint8)
    t[:, :, 0::2] = v >> 4
    t[:, :, 1::2] = v & 15
    return t


def plane_img(vram, base, pw, ph, T):
    """반환 (idx[H,W] 0~15, pal[H,W], prio[H,W])"""
    ent = np.frombuffer(bytes(vram[base:base + pw * ph * 2]), dtype='>u2').reshape(ph, pw)
    tile = (ent & 0x7FF).astype(np.int32)
    hf = ((ent >> 11) & 1).astype(bool)
    vf = ((ent >> 12) & 1).astype(bool)
    pal = ((ent >> 13) & 3).astype(np.uint8)
    pri = ((ent >> 15) & 1).astype(np.uint8)
    px = T[tile]  # ph,pw,8,8
    px = np.where(hf[:, :, None, None], px[:, :, :, ::-1], px)
    px = np.where(vf[:, :, None, None], px[:, :, ::-1, :], px)
    idx = px.transpose(0, 2, 1, 3).reshape(ph * 8, pw * 8)
    palf = np.repeat(np.repeat(pal, 8, 0), 8, 1)
    prif = np.repeat(np.repeat(pri, 8, 0), 8, 1)
    return idx, palf, prif


def render(md, W=320, H=224, layers=False):
    v = md.vdp
    r = v.reg
    vram = v.vram
    T = tiles_np(vram)
    cram = [cram_rgb(w) for w in v.cram]
    pw = [32, 64, 128, 128][r[16] & 3]
    ph = [32, 64, 128, 128][(r[16] >> 4) & 3]
    an = (r[2] & 0x38) << 10
    bn = (r[4] & 7) << 13
    sat = (r[5] & 0x7F) << 9
    hs = (r[13] & 0x3F) << 10
    hmode = r[11] & 3
    out_idx = np.zeros((H, W), np.uint8)
    out_pal = np.zeros((H, W), np.uint8)
    # layers: 0 B low, 1 A low, 2 spr low, 3 B high, 4 A high, 5 spr high
    L = [(np.zeros((H, W), np.uint8), np.zeros((H, W), np.uint8)) for _ in range(6)]
    ys = np.arange(H)
    for pl, (base, idx_) in enumerate(((bn, 1), (an, 0))):
        pi, pp, pr = plane_img(vram, base, pw, ph, T)
        PW, PH = pw * 8, ph * 8
        for y in range(H):
            if hmode == 0:
                a = hs + idx_ * 2
            elif hmode == 3:
                a = hs + y * 4 + idx_ * 2
            else:
                a = hs + (y & ~7) * 4 + idx_ * 2
            h = ((vram[a] << 8) | vram[a + 1]) & 0x3FF
            xs = (np.arange(W) - h) % PW
            if r[11] & 4:
                vs = np.array([v.vsram[(x >> 4) * 2 + idx_] & 0x3FF for x in range(W)])
            else:
                vs = v.vsram[idx_] & 0x3FF
            yy = (y + vs) % PH
            ii = pi[yy, xs] if np.isscalar(yy) or np.ndim(yy) == 0 else pi[yy, xs]
            ppx = pp[yy, xs]
            prx = pr[yy, xs]
            for lay_i, m in ((0 if idx_ == 1 else 1, prx == 0), (3 if idx_ == 1 else 4, prx == 1)):
                sel = m & (ii != 0)
                L[lay_i][0][y][sel] = ii[sel]
                L[lay_i][1][y][sel] = ppx[sel]
    # sprites
    spr = []
    i = 0
    cnt = 0
    while cnt < 80:
        a = sat + i * 8
        y = (((vram[a] << 8) | vram[a + 1]) & 0x3FF) - 128
        sz = vram[a + 2]
        nx = vram[a + 3] & 0x7F
        e = (vram[a + 4] << 8) | vram[a + 5]
        x = (((vram[a + 6] << 8) | vram[a + 7]) & 0x1FF) - 128
        spr.append((y, x, sz, e))
        cnt += 1
        if nx == 0:
            break
        i = nx
    for (y, x, sz, e) in reversed(spr):
        w = ((sz >> 2) & 3) + 1
        h = (sz & 3) + 1
        t0 = e & 0x7FF
        hf = (e >> 11) & 1
        vf = (e >> 12) & 1
        pl = (e >> 13) & 3
        li = 5 if e & 0x8000 else 2
        for cx in range(w):
            for cy in range(h):
                tx = (w - 1 - cx) if hf else cx
                ty = (h - 1 - cy) if vf else cy
                t = T[(t0 + tx * h + ty) & 0x7FF]
                if hf:
                    t = t[:, ::-1]
                if vf:
                    t = t[::-1, :]
                X = x + cx * 8
                Y = y + cy * 8
                for yy in range(8):
                    Yy = Y + yy
                    if not 0 <= Yy < H:
                        continue
                    for xx in range(8):
                        Xx = X + xx
                        if 0 <= Xx < W and t[yy, xx]:
                            L[li][0][Yy, Xx] = t[yy, xx]
                            L[li][1][Yy, Xx] = pl
    bgc = cram[r[7] & 0x3F]
    img = np.zeros((H, W, 3), np.uint8)
    img[:, :] = bgc
    pal_np = np.array(cram, np.uint8)
    for (ci, pi_) in L:
        m = ci != 0
        img[m] = pal_np[pi_[m] * 16 + ci[m]]
    im = Image.fromarray(img, 'RGB')
    if layers:
        return im, L
    return im
