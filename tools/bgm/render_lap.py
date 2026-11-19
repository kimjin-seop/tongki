"""'한 바퀴 루프' 후보 렌더(비교·청취용, 제품 파일·manifest 를 건드리지 않는다). analysis/35_bgm_port_plan.md §8
전체 주기가 여러 바퀴인 곡(0x85: 11바퀴)에서 첫 바퀴만 잘라 반복하는 안의 파일. 음표는 원작과 같고,
템포 지연(N 틱마다 1틱 쉼)의 위치가 2바퀴째부터 원작과 최대 1틱(15.8ms) 다르다.
출력: public/assets/rom/bgm_cand_lap/XX.ogg|mp3, analysis/data/bgm_loops.json 곡 항목의 render_bgm_cand_lap
사용: python -I tools/bgm/render_lap.py <id_hex>   (long_period.py·long_to_cache.py 를 먼저 실행)
"""
import importlib.util
import json
import os
import pickle
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ['BGM_OUT_DIR'] = 'bgm_cand_lap'
_s = importlib.util.spec_from_file_location('render', os.path.join(ROOT, 'tools', 'bgm', 'render.py'))
R = importlib.util.module_from_spec(_s); _s.loader.exec_module(R)


def main():
    tag = sys.argv[1].lower()
    per = json.load(open(os.path.join(ROOT, 'analysis', 'data', '35_bgm_oracle', 'period_%s.json' % tag), encoding='utf-8'))
    c = pickle.load(open(os.path.join(R.CACHE, 'exact_%s.pkl' % tag), 'rb'))
    a, b, d = per['lap']['first_ticks'][:3]          # 첫 바퀴 시작, 둘째 바퀴 시작, 셋째 바퀴 시작(틱)
    T = c['T']; zc = R.Z.Z_CLK
    info = dict(c['info'])
    info.update(loop_start_tick=a, loop_ticks=b - a, loop_start_sec=round(T[a] / zc, 5), loop_end_sec=round(T[b] / zc, 5), loop2_end_sec=round(T[d] / zc, 5),
                loop_len_sec=round((T[b] - T[a]) / zc, 5), pass2_len_sec=round((T[d] - T[b]) / zc, 5))
    tmp = tempfile.mkdtemp(prefix='bgm_lap_')
    pickle.dump({'log': c['log'], 'total_t': c['total_t'], 'T': T, 'L': c['L'], 'info': info}, open(os.path.join(tmp, 'exact_%s.pkl' % tag), 'wb'))
    R.CACHE = tmp
    os.makedirs(R.OUT_BGM, exist_ok=True)
    _, r = R.render(int(tag, 16))
    r.update(lap_ticks=[b - a, d - b], lap_start_tick=a, note='한 바퀴 루프 후보. 2회차 대조(pass_corr, best_lag_ms)는 첫 바퀴 대 둘째 바퀴')
    meta = json.load(open(R.META, encoding='utf-8'))
    meta['songs'][tag]['render_bgm_cand_lap'] = r
    json.dump(meta, open(R.META, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
