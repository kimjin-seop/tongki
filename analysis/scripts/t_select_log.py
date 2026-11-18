import numpy as np
import sys,pickle; sys.path.insert(0,"analysis/scripts")
import intro_lib as I
rec=I.load(sys.argv[1])
def w(b,o): return (b[o]<<8)|b[o+1]
prev=None
for fr in rec['fr']:
    o=fr['obj']
    k=(fr['st'],)+tuple((w(o,b),w(o,b+0x16),w(o,b+0x20),w(o,b+0x24)) for b in (0,0x80,0x300,0x380))+(fr['e7'][5],fr['e7'][0x85],w(fr['e4'],0x22))
    if k!=prev: print(fr['f'],fr['pad'],['%x'%x for x in fr['st']],k[1:])
    prev=k
