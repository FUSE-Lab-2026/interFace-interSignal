# 프로젝트 문서 유지 규칙

- 루트의 `project.md`는 데이터 규격, MVP 범위, 현재 구현 및 검증 상태의 단일 기준
  문서다.
- 데이터 처리, 신호 공식, 카드 구성, UI 동작, 테스트 상태, 하드웨어 검증 상태가
  바뀌면 같은 commit에서 `project.md`를 한국어로 갱신한다.
- 큰 범위 개정 전에는 기존 `project.md`를
  `backup/project-YYYY-MM-DD-vN.md`로 보관한다.
- `PROCESSING.md`는 상세 계산 기록으로 유지하며 `project.md`와 서로 모순되지
  않게 갱신한다.
