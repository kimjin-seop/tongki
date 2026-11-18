# 원작 장시간 트레이스(컴퓨터 대 컴퓨터): 선수 14명의 타입·서브·좌표·속도와 공 상태를 프레임마다 압축 기록한다.
# 용도: 외야 대기 선수(타입 0x24/0x28)의 이동 비율·최장 정지 구간 실측 (analysis/25 §11).
# 실행: python -I tools/diff/oracle_long.py <이름> [프레임=6000] [시드 poke(16진 1바이트, $E622)] [상태=play0]
# 출력: tools/diff/traces/long/<이름>.json  { frames:[ {f, e602, b:[type,sub,x,y,z,owner슬롯|-1], ctrl:[a,b], p:[[type,sub,x,y,vx,vy,f1e,tmr,tx,ty,slot] x14] } ] }
# 프레임 경계·진행 방식은 oracle_trace.py 와 같다(대기 루프 경계). $E717/$E797=0 으로 양 사이드를 컴퓨터로 둔다(analysis/scripts/t_cpu_idle.py 와 같은 조작).
import sys, os, json, time
sys.stdout.reconfigure(encoding='utf-8')
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import oracle_trace as T  # noqa: E402  (ROOT 로 chdir, drv 로드)
from drv import load, ramw, raml, peekb, pokeb, s32  # noqa: E402


def main():
    name = sys.argv[1]
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 6000
    seed = sys.argv[3] if len(sys.argv) > 3 else ''
    state = sys.argv[4] if len(sys.argv) > 4 else 'play0'
    md = load(state); md.hook = None
    if T.to_sync(md) < 0: raise SystemExit('초기 동기화 실패')
    pokeb(md, 0xE717, 0); pokeb(md, 0xE797, 0)
    if seed and seed != '-': pokeb(md, 0xE622, int(seed, 16))
    frames, lag, t0 = [], 0, time.time()
    for f in range(1, n + 1):
        if T.frame(md, 0, 0) < 0: lag += 1
        ps = []
        for k in range(14):
            a = 0xC000 + k * 0x80
            ps.append([ramw(md, a) & 0x7FFC, peekb(md, a + 0x17), s32(raml(md, a + 0x20)) >> 16, s32(raml(md, a + 0x24)) >> 16,
                       s32(raml(md, a + 0x30)), s32(raml(md, a + 0x34)), peekb(md, a + 0x1E), ramw(md, a + 0x18), ramw(md, a + 0x60), ramw(md, a + 0x62), ramw(md, a + 0x1A)])
        b = 0xC700
        own = ramw(md, b + 0x1C)
        frames.append(dict(f=f, e602=ramw(md, 0xE602), ctrl=[ramw(md, 0xE718), ramw(md, 0xE798)],
                           b=[ramw(md, b) & 0x7FFC, peekb(md, b + 0x17), s32(raml(md, b + 0x20)) >> 16, s32(raml(md, b + 0x24)) >> 16, s32(raml(md, b + 0x28)) >> 16,
                              (own - 0xC000) // 0x80 if 0xC000 <= own < 0xC700 else -1], p=ps))
        if f % 500 == 0: print(name, f, '%.0fs' % (time.time() - t0), 'lag', lag, flush=True)
    out = os.path.join(HERE, 'traces', 'long'); os.makedirs(out, exist_ok=True)
    json.dump(dict(name=name, state=state, seed=seed, lagFrames=lag, frames=frames), open(os.path.join(out, name + '.json'), 'w', encoding='utf8'), separators=(',', ':'))
    print('ok', name, n, 'f', '%.0fs' % (time.time() - t0), 'lag', lag)


if __name__ == '__main__':
    main()
