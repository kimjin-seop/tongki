import re
d=open('rom/danpei.gen','rb').read()
out=open('analysis/strings_sjis.txt','w',encoding='utf-8')
for m in re.finditer(rb'(?:[\x81-\x9f\xe0-\xef][\x40-\x7e\x80-\xfc]|[\x20-\x7e\xa1-\xdf]){3,}',d):
    s=m.group()
    if not re.search(rb'[\x81-\x9f\xe0-\xef][\x40-\xfc]',s):continue
    try:t=s.decode('cp932')
    except:continue
    out.write("%06x %s\n"%(m.start(),t))
