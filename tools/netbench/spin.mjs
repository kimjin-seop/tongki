// bench.mjs BENCH_PRECISE=1 전용: 이벤트 루프를 쉬지 않게 돌려 타이머가 제때 돌게 한다(측정용, 코어 하나 사용)
const spin = () => setImmediate(spin);
spin();
