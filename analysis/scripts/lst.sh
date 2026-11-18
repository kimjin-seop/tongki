#!/bin/sh
awk -v s=$((16#$1)) -v e=$((16#$2)) '{ad=substr($1,1,6); a=strtonum("0x" ad); if (a>=s && a<e) {t=$0; sub(/^[0-9a-f]+: [0-9a-f]+ +/,"",t); printf "%s %s\n", substr(ad,3,4), t}}' /c/Users/김진섭/Works/dodge-danpei/analysis/disasm_code.asm
