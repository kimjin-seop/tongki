"""게임 규칙 수치 테이블을 CSV/MD로 추출 (analysis/data/).
- 팀/선수 능력치: ROM 0x18836 (25팀 x 7선수 x 8바이트) -> 런타임 RAM $FF8000 로 복사 (code 0x3ae)
- AI 파라미터: ROM 0x18DAE (25팀 x 7선수 x 16바이트) -> RAM $FF8800
- 팀별 색/스프라이트 그룹 인덱스: ROM 0x18000 (팀당 4바이트, 코드 0x4cde)
- 코트 슬롯 좌표(0x4AC8 / 0x4AFC), 슬롯별 오브젝트 타입(0x4C0E), 히트박스(0x69D8)
"""
import struct,csv
rom=open('rom/danpei.gen','rb').read()
NT=25
with open('analysis/data/teams_players.csv','w',newline='') as f:
    w=csv.writer(f);w.writerow(['team','player','role','hp(s0)','defense(s1)','move_speed(s2)','s3_lob_or_arc','power(s4)','s5_timer','throw_speed(s6)','pass_speed(s7)'])
    for t in range(NT):
        for p in range(7):
            a=0x18836+t*56+p*8
            role='infield' if p<4 else ['outfield_top','outfield_bottom','outfield_back'][p-4]
            w.writerow([t,p,role]+list(rom[a:a+8]))
with open('analysis/data/ai_params.csv','w',newline='') as f:
    w=csv.writer(f);w.writerow(['team','player']+['b%d'%i for i in range(16)])
    for t in range(NT):
        for p in range(7):
            a=0x18dae+t*112+p*16
            w.writerow([t,p]+list(rom[a:a+16]))
with open('analysis/data/team_palette_groups.csv','w',newline='') as f:
    w=csv.writer(f);w.writerow(['team_idx','infield(slots0-3)','outfield_g1(slots4-6)','outfield_g2(slots7-9)','outfield_g3(slots10-12)'])
    for t in range(64):
        w.writerow([t]+list(rom[0x18000+t*4:0x18000+t*4+4]))
with open('analysis/data/court_slots.csv','w',newline='') as f:
    w=csv.writer(f);w.writerow(['slot','objtype(0x4C0E)','x_sideA','y_sideA','x_sideB(mirror)','y_sideB'])
    types=struct.unpack('>14H',rom[0x4c0e:0x4c0e+28])
    for s in range(13):
        a=struct.unpack('>hh',rom[0x4ac8+s*4:0x4ac8+s*4+4]);b=struct.unpack('>hh',rom[0x4afc+s*4:0x4afc+s*4+4])
        w.writerow([s,hex(types[s]),a[0],a[1],b[0],b[1]])
with open('analysis/data/hitboxes.csv','w',newline='') as f:
    w=csv.writer(f);w.writerow(['index','addr','xoff','w','yoff','h  (idx>=17 are probably court zone/bounds; unverified)'])
    for i in range(60):
        a=0x69d8+i*8;v=struct.unpack('>hhhh',rom[a:a+8]);w.writerow([i,hex(a)]+list(v))
# 통계
import statistics
print('stat ranges per column (s0..s7):')
for k in range(8):
    vals=[rom[0x18836+t*56+p*8+k] for t in range(NT) for p in range(7)]
    print(k,min(vals),max(vals),round(statistics.mean(vals),1))
