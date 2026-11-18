import sys
sys.path.insert(0,'analysis/scripts')
from PIL import Image
rom=open('rom/danpei.gen','rb').read()
def sheet1(off,n,cols=32,scale=2):
    rows=(n+cols-1)//cols
    im=Image.new('L',(cols*8,rows*8),0)
    px=im.load()
    for t in range(n):
        for y in range(8):
            b=rom[off+t*8+y]
            for x in range(8):
                px[(t%cols)*8+x,(t//cols)*8+y]=255 if b&(0x80>>x) else 0
    return im.resize((im.width*scale,im.height*scale),Image.NEAREST)
if __name__=='__main__':
    o=int(sys.argv[1],16);n=int(sys.argv[2],0)
    sheet1(o,n).save(sys.argv[3])
