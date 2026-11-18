"""선수 이름: ROM 가나 이름(analysis/teams_names.json) -> 한국어 음차(원작 동일 원칙). 확인된 한국판 이름(팀0/22/24, 상아 장도끼, 백아 나한상·우갑철)은 유지.
산출: public/assets/data/team_names.json(players 교체), analysis/data/names_rename_map.json(옛->새). 사용: python -I analysis/scripts/build_names_ko.py [--apply]"""
import json,sys
sys.stdout.reconfigure(encoding='utf-8')
J=json.load(open('analysis/teams_names.json',encoding='utf-8'))['teams']
cur=json.load(open('public/assets/data/team_names.json',encoding='utf-8'))
norm=lambda s:s.replace('　',' ').replace('<1d>','ー')
T={
1:{0:'니카이도 다이가',2:'히가시야마',3:'사카키바라 료',4:'구스노키 슌',5:'고바야카와 마코토',6:'미타무라 후토시'},
2:{0:'리쿠오 도마',1:'사카마키 겐',2:'다키 쇼지',3:'쓰노다 유키오',4:'미사와 다쿠미',5:'사카마키 고',6:'고이즈미 아키라'},
3:{0:'미도 아라시',2:'후와류노스케',3:'오가타 겐지',4:'핫토리 가즈키',6:'유키 다케시'},
4:['미타카 하야토','가마타 요시로','요쓰야 마나부','오쿠타마 미쓰루','쓰키지 소시','긴시 다로','산차 가쓰야'],
5:['기타노 다이치','소야 유키히코','도카치 유지','데이네 고지','아칸 히데키','후라노 도루','이시카리 마나오'],
6:['고쇼 마사키','기요미즈 데라오','가와라 마치오','야와타 히로히사','야마시로 하야타','사가노 미치오','우지 차노스케'],
7:['이시가키 신','만자 고지','시마부쿠로 겐','구메시마 데쓰야','나고 유이치','미야코 시마오','요론 도타'],
8:['줄리안','조지','녹스','데인저','브라운','데이비드','하퍼스'],
9:['아레나스','하이리그','아게르','안데스','사포','파이스트','린진'],
10:['미얀','샹친','퐁리스','차오치','샹닝','판쯔','이순'],
11:['바제스키','키키르스크','아이에프','크루시초프','쿠나하르트','아바르스크','스탈리아'],
12:['스코피온','제미니','오리온','아킬레스','사지타리아스','라이브라','레오'],
13:['포루타','난토스','산타스','코로리나','잔리아','톤키스','다다르'],
14:['아멘데','토류크','사도라','마바네크','발칸','제미스트','다일'],
15:['캐서린','데이비스','존스','에디','점핀','월더','킹'],
16:['세프시온','조니','아크시아','로스안','나타레스','코르델라','데파블로'],
17:['레이판','니하오','춘차오','치카이슌','샤오판','호이소','페야오'],
18:['오라데노프','도테칸스키','나발킨','파파프','키메료프','마날린','트로스코프'],
19:['제우스','포세이돈','하데스','아폴론','넵튠','켄타우로스','그리포스'],
20:['골도르','마룬바','루이스','살바다르','산타나','리베론','카이아스'],
21:['아바도라','바스람','모하마드','조빌','스림','스비비','아스웬'],
}
def fix(d,t): return d if isinstance(d,list) else None
new=[];ren={};chg=[]
for t in cur['teams']:
    i=t['id']; old=list(t['players']); nw=list(old)
    spec=T.get(i)
    if spec is not None:
        for k in range(7):
            v=spec[k] if isinstance(spec,list) else spec.get(k)
            if v is not None: nw[k]=v
    if i==23:
        nw[0]=T[1][0]; nw[1:]=T[15][:6]
    for k in range(7):
        if nw[k]!=old[k]: chg.append((i,k,norm(J[i]['players'][k]['name_ja']),old[k],nw[k]))
    new.append(nw)
if '--apply' in sys.argv:
    for t,nw in zip(cur['teams'],new): t['players']=nw
    json.dump(cur,open('public/assets/data/team_names.json','w',encoding='utf-8'),ensure_ascii=False,indent=1)
json.dump([dict(team=a,idx=b,kana=c,old=d,new=e) for a,b,c,d,e in chg],open('analysis/data/names_rename_map.json','w',encoding='utf-8'),ensure_ascii=False,indent=1)
print(len(chg),'changed')
