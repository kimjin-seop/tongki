"""32_prematch_league_survey.md 조사용: t_md_step.py 를 그대로 재사용하되 저장 상태 출력 폴더만 바꾼다.
(조사 전용 지시라 analysis/state/ 에는 아무것도 쓰지 않는다. 기존 도구 파일도 고치지 않는다.)
사용: T32_OUT=<상태 저장 폴더> python -I -B analysis/scripts/t32_step.py <in> <out|-> <png 접두어> "<토큰>"
  <in>  : menuN | boot | <경로>.pkl   (이름만 주는 형식은 T32_OUT 폴더에서 찾는다. 기존 상태는 analysis/state/md/xxx.pkl 경로로 준다)
  토큰은 t_md_step.py 머리말 참조. 추가 토큰 없음."""
import numpy, inspect
import sys, os
out = os.environ.get('T32_OUT')
if not out:
    sys.exit('T32_OUT 환경변수(상태 저장 폴더)가 필요하다')
os.makedirs(out, exist_ok=True)
src = open('analysis/scripts/t_md_step.py', encoding='utf-8').read()
old = "SD='analysis/state/md'; os.makedirs(SD,exist_ok=True)"
assert old in src, 't_md_step.py 형식이 바뀌었다'
src = src.replace(old, 'SD=%r' % out)
exec(compile(src, 'analysis/scripts/t_md_step.py', 'exec'), {'__name__': '__main__'})
