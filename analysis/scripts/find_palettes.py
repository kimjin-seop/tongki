"""ROM에서 메가드라이브 CRAM 워드(0000BBB0GGG0RRR0, 짝수 니블만) 연속 구간(>=16워드)을 탐색 -> analysis/palettes.txt"""
rom=open('rom/danpei.gen','rb').read()
out=[];i=0x200
while i<len(rom)-32:
    j=i
    while j<len(rom)-1:
        w=(rom[j]<<8)|rom[j+1]
        if w&~0x0eee:break
        j+=2
    n=(j-i)//2
    # 전부 0인 구간은 제외, 서로 다른 값 4개 이상
    ws=set((rom[k]<<8)|rom[k+1] for k in range(i,j,2))
    if n>=16 and len(ws)>=4:
        out.append((i,n,len(ws)));i=j
    else:i=j+2 if j>i else i+2
with open('analysis/palettes.txt','w') as f:
    for o,n,u in out:f.write("%06x words=%d uniq=%d\n"%(o,n,u))
print(len(out))
