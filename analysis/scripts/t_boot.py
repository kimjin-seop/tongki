import sys
sys.path.insert(0,'analysis/scripts')
from m68k import *
from vdprender import render
md=MD('rom/danpei.gen')
for f in range(150): md.run_frame()
render(md).save('analysis/gfx/emu_title.png')
