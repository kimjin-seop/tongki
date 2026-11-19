"""BGM 공개 에뮬 대조 결과 요약 표. 입력: analysis/data/35_bgm_oracle/state_XX.json, audio_XX.json
출력: analysis/data/35_bgm_oracle/summary.json + 표(표준 출력, 마크다운)
사용: python -I tools/bgm/oracle/summary.py
"""
import glob
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
OUTD = os.path.join(ROOT, 'analysis', 'data', '35_bgm_oracle')


def main():
    rows = []
    for p in sorted(glob.glob(os.path.join(OUTD, 'state_*.json'))):
        tag = os.path.basename(p)[6:-5]
        s = json.load(open(p, encoding='utf-8'))
        ap = os.path.join(OUTD, 'audio_%s.json' % tag)
        a = json.load(open(ap, encoding='utf-8')) if os.path.exists(ap) else None
        n = s['frames_compared']
        r = {'song': s['song'], 'kind': s.get('kind', 'loop'), 'method': 'natural(menu)' if s.get('dump', 'z80_1c00.bin') == 'z80_1c00.bin' else 'cmd($1C0A)',
             'tracks': len(s['song_tracks']), 'frames': n,
             'exact_pct': round(100 * s['exact'] / n, 1), 'between_pct': round(100 * s['between_two_ticks'] / n, 1), 'miss_pct': round(100 * s['miss'] / n, 1),
             'miss_max_run': s['miss_detail']['max_consecutive'], 'miss_tick_gap_max': s['miss_detail']['tick_gap_between_neighbors_max'],
             'miss_midstate_tracks_max': max([int(k) for k in s['miss_detail']['tracks_in_midstate_hist']] or [0]),
             'tick_range': s['ours_tick_range'], 'passes': s['loop']['passes_covered'],
             'tempo_ratio': s['tempo_ratio_measured_over_expected'], 'resid_seg_mean': s.get('tick_residual_segment_mean_range'),
             'other_tracks_on': s['biz_other_tracks_active_frames']}
        if a:
            r.update(file_corr_min=a['file_corr_min'], file_corr_med=a['file_corr_median'], ctrl=a['control_shift500ms_corr'],
                     file_lag=a['file_local_lag_ms_range'], ref_loop_lag=[x['lag_ms_vs_pass1'] for x in a['ref_loop_passes']],
                     looped_corr_min=a['web_looped_corr_min'], looped_lag=a['web_looped_local_lag_ms_range'],
                     web_len=(a['web_loop'] or {}).get('len'), oracle_len=(a['web_loop'] or {}).get('oracle_len'),
                     start_lag_ms=a['start_lag_ms'], gain_db=a['gain_db_ours_over_ref_median'],
                     hi1=round(a['band_db_ours_over_ref']['4000-10000Hz'] - a['gain_db_ours_over_ref_median'], 1),
                     hi2=round(a['band_db_ours_over_ref']['10000-20000Hz'] - a['gain_db_ours_over_ref_median'], 1))
        rows.append(r)
    json.dump(rows, open(os.path.join(OUTD, 'summary.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('| 곡 | 종류 | 트랙 | 비교 프레임 | exact % | 틱 사이 % | 미대응 %(최대 연속) | 범위(틱) | 루프 회 | 템포 비 | 구간 잔차 평균(틱) | 다른 트랙 |')
    print('|---|---|---|---|---|---|---|---|---|---|---|---|')
    for r in rows:
        print('| %s | %s | %d | %d | %.1f | %.1f | %.1f (%d) | %d~%d | %s | %.6f | %s | %s |' % (
            r['song'], r['kind'], r['tracks'], r['frames'], r['exact_pct'], r['between_pct'], r['miss_pct'], r['miss_max_run'],
            r['tick_range'][0], r['tick_range'][1], r['passes'] if r['passes'] is not None else '-', r['tempo_ratio'],
            '%.3f~%.3f' % tuple(r['resid_seg_mean']) if r['resid_seg_mean'] else '-', r['other_tracks_on'] or '없음'))
    print()
    print('| 곡 | 파일 상관(최소/중앙) | 대조군 | 창별 지연(ms) | 기준 녹음 루프 길이 오차(ms) | 웹 루프 이어 붙임 상관(최소)/지연 | 웹 루프 길이 = 원작 | 시작 지연(ms) | 음량 차(dB) | 4~10k / 10~20k(dB) |')
    print('|---|---|---|---|---|---|---|---|---|---|')
    for r in rows:
        if 'file_corr_min' not in r:
            continue
        print('| %s | %.3f / %.3f | %.3f | %s~%s | %s | %s | %s | %.1f | %+.2f | %+.1f / %+.1f |' % (
            r['song'], r['file_corr_min'], r['file_corr_med'], r['ctrl'], r['file_lag'][0], r['file_lag'][1],
            ','.join(str(v) for v in r['ref_loop_lag']) or '-',
            ('%.3f / %s~%s' % (r['looped_corr_min'], r['looped_lag'][0], r['looped_lag'][1])) if r['looped_corr_min'] is not None else '-',
            ('%.5f = %.5f' % (r['web_len'], r['oracle_len'])) if r['web_len'] else '-', r['start_lag_ms'], r['gain_db'], r['hi1'], r['hi2']))


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
