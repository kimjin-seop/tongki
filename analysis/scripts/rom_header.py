"""ROM 헤더/벡터/체크섬 분석 -> analysis/01_header_vectors.md"""
import struct
rom=open('rom/danpei.gen','rb').read()
def sj(b):return b.decode('cp932','replace').rstrip()
L=[]
L.append("# 01. ROM 헤더 / 벡터 / 체크섬 / 엔트리\n")
L.append("자동 생성: `analysis/scripts/rom_header.py` (ROM 크기 %d 바이트 = 0x%X)\n"%(len(rom),len(rom)))
L.append("## 헤더 (0x100-0x1FF)\n")
f=[('0x100','시스템 타입',rom[0x100:0x110]),('0x110','저작권/날짜',rom[0x110:0x120]),('0x120','국내명(일본어)',rom[0x120:0x150]),('0x150','해외명',rom[0x150:0x180]),('0x180','시리얼/버전',rom[0x180:0x18e])]
for a,n,b in f:L.append("- `%s` %s: `%s`"%(a,n,sj(b)))
L.append("- `0x18E` 체크섬(헤더): 0x%04X"%struct.unpack('>H',rom[0x18e:0x190])[0])
L.append("- `0x190` 지원 디바이스: `%s`"%sj(rom[0x190:0x1a0]))
rs,re_,ra,rb=struct.unpack('>4I',rom[0x1a0:0x1b0])
L.append("- `0x1A0` ROM 범위: 0x%X - 0x%X"%(rs,re_))
L.append("- `0x1A8` RAM 범위: 0x%X - 0x%X"%(ra,rb))
L.append("- `0x1B0` 외부 메모리 헤더: `%s` = %s  (-> 'RA' + 0xE840 + 0x200001..0x200001 ; 0xE840 은 **EEPROM** 타입 표기. 코드 0x152BC 가 $200001 의 bit0/bit1 을 SCL/SDA 로 비트뱅잉(확인) = X24C01 계열 직렬 EEPROM 세이브)"%(rom[0x1b0:0x1bc].hex(' '),sj(rom[0x1b0:0x1b2])))
L.append("- `0x1F0` 지역: `%s`"%sj(rom[0x1f0:0x200]))
cs=sum(struct.unpack('>%dH'%((len(rom)-0x200)//2),rom[0x200:]))&0xffff
L.append("\n## 체크섬\n\n- 0x200 이후 워드 합 = 0x%04X, 헤더 값 0x%04X -> **%s**."%(cs,struct.unpack('>H',rom[0x18e:0x190])[0],'일치' if cs==struct.unpack('>H',rom[0x18e:0x190])[0] else '불일치'))
L.append("- 부팅 코드(0x32C-0x358)가 실제로 이 체크섬을 계산해 비교하며, 불일치 시 0x490(화면을 단색으로 채우고 무한 루프)으로 분기.\n")
L.append("## 벡터 테이블 (0x000-0x0FF)\n")
v=struct.unpack('>64I',rom[:256])
names=['SSP(초기 스택)','Reset(PC)','Bus error','Address error','Illegal instr','Div by zero','CHK','TRAPV','Privilege','Trace','Line A','Line F']+['Reserved']*12+['Spurious','Level1','Level2 (EXT)','Level3','Level4 (HBlank)','Level5','Level6 (VBlank)','Level7']+['TRAP #%d'%i for i in range(16)]+['Reserved']*16
L.append("| idx | 주소 | 이름 | 값 |\n|---|---|---|---|")
for i,x in enumerate(v):
    if i<len(names) and (x!=0x200 or i<2 or i in (28,30)):
        L.append("| %d | 0x%03X | %s | 0x%06X |"%(i,i*4,names[i],x))
L.append("\n나머지 벡터는 모두 0x200 (`nop; nop; bra.b $200` 무한 루프 = 사실상 정지)으로 채워져 있음.\n")
L.append("- Reset PC = **0x000206** (헤더 뒤 표준 SEGA 초기화: TMSS 'SEGA' 기록, Z80 리셋, VDP/PSG 초기화 테이블 0x294~, 0x300으로 점프).")
L.append("- VBlank = 0x000914, HBlank = 0x000200(정지 루프; SR=0x2500으로 마스크되어 실제 발생하지 않음).")
L.append("- 부팅 후 메인 엔트리: 0x300 -> (VDP 대기, 체크섬 검증, 콘솔/패드 포트 초기화, RAM 0xFF0000-0xFFFFFF 클리어, 'init' 마커($FFFC) 검사, 팀/AI 테이블 ROM->RAM 복사) -> 0x3EA 이후 게임 초기화 -> **메인 루프 0x458**.\n")
open('analysis/01_header_vectors.md','w',encoding='utf-8').write("\n".join(L))

