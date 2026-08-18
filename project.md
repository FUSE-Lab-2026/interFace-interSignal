# interFace / interSignal 프로젝트 문서

## 문서 정보

- 마지막 업데이트: 2026-08-18
- 현재 단계: 6-card Signals와 4-card 연속형 Record UI, 30초/1분 동시 녹화 MVP 구현 완료, 실제 TGAM/카메라 통합 검증 전
- 저장소: `FUSE-Lab-2026/interFace-interSignal`
- 기준 브랜치: `main`
- 문서 역할: 데이터 규격, MVP 범위, 구현 상태, 검증 상태를 관리하는 단일 기준 문서
- 직전 규격: `backup/project-2026-08-11-v1.md`
- 초기 문서: `backup/project-2026-08-11-legacy-tgam-eeg-webviz.md`

이 파일은 데이터 계약, 신호 계산, UI 범위, 완료 상태가 바뀔 때 코드와 함께
업데이트한다. 큰 방향 변경 전의 문서는 `backup/`에 날짜와 버전을 붙여 보관한다.

## 프로젝트 목적

TGAM EEG를 처음 접하는 워크숍 참여자가 용어를 먼저 배우기보다 직접 움직이고
관찰하면서 각 신호가 무엇을 나타내는지 추측하도록 돕는 브라우저 기반 도구다.

- 프로젝터용 MacBook에서 TGAM 시리얼 데이터를 직접 수신한다.
- 신호 이름과 공식 설명을 숨긴 상태로 여섯 개의 시각화를 제공한다.
- 참여자는 카드를 켜고 끄며 신호의 반응 차이를 비교한다.
- 같은 session의 TGAM frame, raw EEG, 저용량 webcam 영상을 함께 기록한다.
- 의료 진단, 임상 판정, 정량 뇌 상태 측정을 목적으로 하지 않는다.

## 현재 MVP

### MVP에 포함

- 데스크톱 Chrome/Chromium Web Serial을 통한 TGAM 직접 연결
- ThinkGear 패킷 동기화, 길이 확인, checksum 검증 및 필드 파싱
- raw EEG를 브라우저 콜백에서 빠짐없이 순서대로 처리
- 6개 카드의 실시간 표시
- `01`부터 `06`까지 각 카드를 독립적으로 표시/숨김
- 카드 제목과 공식 설명을 숨기는 블라인드 탐색 UI
- 3열, 2열, 1열 반응형 레이아웃과 좁은 화면 세로 스크롤
- raw sample rate와 checksum failure 상태 표시
- parser 및 mock Web Serial 자동 테스트
- 신호 계산과 시각 매핑 기록
- 같은 페이지 안의 `Signals`, `Record` tab
- 사용자 지정 폴더에 TGAM frame NDJSON과 raw EEG TXT streaming 저장
- 134 x 100, 8 FPS, audio 없는 저용량 webcam WebM 저장
- 30초 또는 1분 고정 길이 녹화와 자동 finalize
- session 설정과 parser 통계를 담은 JSON manifest 저장

### MVP에서 제외

- 녹화 파일 재생
- Node 기반 시리얼 수신 및 EEG 전처리
- WebSocket EEG 전송
- 휴대폰 리모컨 또는 다중 기기 동기화
- 여러 TGAM 헤드셋 동시 연결
- 사용자 이름이나 참가자 profile 저장
- 의료적 또는 임상적 분류

## 시스템 구성

```text
TGAM serial bytes
  -> Desktop Chromium Web Serial
  -> ThinkGear framing/checksum parser
  -> checksum-valid physical-frame callbacks
     -> browser-derived signals -> p5.js cards
     -> frame NDJSON + raw EEG TXT writer

Web camera -> preview -> 134 x 100 canvas -> MediaRecorder -> WebM writer
```

Node는 `public/`을 `localhost`에 제공하는 정적 서버 역할만 한다. Node가 시리얼
포트를 열거나 TGAM 패킷을 처리하지 않는다.

## 데이터 규격

### 시리얼 연결

| 항목 | 현재 규격 |
|---|---|
| Baud rate | 57,600 |
| Data bits | 8 |
| Stop bits | 1 |
| Parity | none |
| Flow control | none |
| 요청 buffer size | 65,536 bytes |
| 예상 raw sample rate | 약 512 Hz |
| 실행 환경 | 데스크톱 Chrome/Chromium의 `localhost` 또는 HTTPS |

브라우저의 `reader.read()`가 반환하는 chunk는 TGAM 패킷 경계와 일치한다고
가정하지 않는다. 모든 byte를 parser 상태 머신에 연속으로 전달한다.

### ThinkGear 패킷

```text
0xAA 0xAA | payload length | payload | checksum
```

- 최대 payload 길이: 169 bytes
- checksum: payload byte 합의 하위 8 bit를 반전한 값
- checksum이 맞는 패킷만 시각화와 계산 모듈에 전달
- 브라우저에 표시하는 진단값: 추정 raw samples/second, checksum failures

### 현재 사용하는 TGAM 필드

| Code | 데이터 | 범위/형식 | 사용 위치 |
|---|---|---|---|
| `0x02` | Poor Signal | 0-200, 0이 가장 좋은 접촉 | 카드 01, 파생 신호 gate |
| `0x04` | Attention | 0-100 | 카드 06 |
| `0x05` | Meditation | 0-100 | 카드 06 |
| `0x16` | Blink Strength | 0-255 | parser에서 보존, 현재 카드 미사용 |
| `0x80` | Raw Wave | signed 16-bit | 카드 02-04 계산/표시 |
| `0x81` | Legacy EEG Power | 8 x big-endian float | parser 지원 |
| `0x83` | ASIC EEG Power | 8 x unsigned 24-bit | 카드 05 |

ASIC band 순서는 `delta`, `theta`, `lowAlpha`, `highAlpha`, `lowBeta`,
`highBeta`, `lowGamma`, `midGamma`다.

## 녹화 데이터 규격

`Signals`와 `Record`는 같은 페이지의 in-app tab이며 하나의 Web Serial 연결을
공유한다. 별도 browser tab이 같은 serial port를 다시 열지 않는다.

### 출력 파일

| 파일 | 규격 |
|---|---|
| `*-tgam-packets.ndjson` | checksum-valid physical frame, timestamp, frame hex, decoded fields, transport stats |
| `*-raw-eeg.txt` | unfiltered raw EEG, tab-separated sample/timestamp/value rows |
| `*-camera-100p.webm` | 134 x 100, 8 FPS, requested 50 kbps, audio 없음 |
| `*-session.json` | 설정, 파일명, 시간, count, video bytes, parser stats, stop reason |

Base name은 `YYYY-MM-DD_HHmmss_SSS` 형식이다. 파일은 `Choose Folder`에서
선택한 폴더에 File System Access API로 직접 쓴다.

### TGAM frame NDJSON

- `tgam_frame`: `frame_index`, `unix_ms`, `elapsed_ms`, `payload_length`,
  `checksum`, `frame_hex`, `decoded`
- `frame_hex`: `AA AA`, length, payload, checksum을 포함한 전체 frame의 lowercase hex
- `transport_stats`: 약 1초마다 parser counters와 raw sample rate 기록
- `recording_start`, `recording_stop`: session 경계와 stop reason 기록
- checksum-invalid frame은 frame event에서 제외하고 failure count로 남김

### Raw EEG TXT

- header: format version, session ID, start time, expected 512 Hz, preprocessing 없음
- columns: `sample_index`, `elapsed_ms`, `unix_ms`, `raw`
- delimiter: tab
- TGAM raw 값에 filtering, smoothing, interpolation, resampling을 적용하지 않음

### Webcam WebM

| 항목 | 규격 |
|---|---|
| camera 입력 요청 | ideal 640 x 480, ideal 15 FPS, max 30 FPS |
| 출력 frame | 정확히 134 x 100 canvas |
| frame rate | 8 FPS |
| 요청 bitrate | 50,000 bits/second |
| audio | capture 및 output 모두 없음 |
| codec 우선순위 | WebM VP8, WebM VP9, WebM fallback |

카메라 hardware 입력 해상도와 무관하게 recording canvas에서 134 x 100으로
downsample한다. 실제 encoder bitrate는 browser 판단으로 요청값과 다를 수 있다.
Video chunk는 메모리에 전체 누적하지 않고 writable file에 순서대로 기록한다.
preview는 최대 8초 동안 실제 frame을 기다린다. permission 거부, insecure context,
camera 없음, 다른 앱의 camera 점유를 구분해 Record card에 오류를 표시한다.

### 녹화 시간

- 시작 옵션은 30초와 1분 두 가지다.
- 선택한 시간은 NDJSON `recording_start.planned_duration_ms`와 manifest
  `plannedDurationMs`에 기록한다.
- 선택 시간이 끝나면 `duration_complete` 사유로 자동 finalize한다.
- `Stop`으로 선택 시간 전에 수동 종료할 수 있다.

## 카드 규격

UI에는 카드 번호만 표시한다. 아래 이름은 운영자와 개발자를 위한 내부 매핑이다.

### 01 Signal Contact

- 입력: TGAM Poor Signal `q`
- 공식: `100 * (1 - clamp(q, 0, 200) / 200)`
- 출력: 0-100 연속값
- 전처리: 없음
- 시각화: 아래에서 위로 채워지는 세로 막대, 값이 클수록 진한 opacity
- 정책: `q != 0`이면 카드 02와 03의 값을 `--`로 숨김

### 02 Movement

- 입력: 최신 raw EEG 512 samples, 약 1초
- 전처리: 평균 제거, Hann window, 512-point FFT
- hop: 128 samples, 약 0.25초
- 공식: `100 * Power(30-45 Hz) / Power(4-45 Hz)`
- 출력: 0-100 연속값
- 시각화: 9개 수평 layer의 흔들림 거리와 opacity에 매핑
- 해석 제한: 얼굴 근육, 눈꺼풀, 턱, cable/electrode 움직임 등에 반응할 수
  있으며 얼굴 움직임만 분리하는 detector가 아님

### 03 Eyes Closed

- 입력: 최신 raw EEG 1,024 samples, 약 2초
- 전처리: 평균 제거, Hann window, 1,024-point FFT
- hop: 128 samples, 약 0.25초
- Theta: 4-8 Hz
- Alpha: 8-13 Hz
- Beta: 13-30 Hz
- 공식: `100 * Alpha / (Theta + Alpha + Beta)`
- 출력: 0-100 연속값
- 시각화: 값에 비례하는 원의 면적과 opacity
- 해석 제한: 눈을 감을 때 상대 alpha가 증가할 수 있지만 binary eye-state
  classifier 또는 eye-movement detector가 아님

### 04 Raw EEG

- 입력: signed raw-wave samples
- 전처리: 없음
- 메모리 history: 최신 1,024 samples
- 표시 window: 최신 512 samples, 약 1초
- 표시 범위: -2,048부터 2,048까지 고정
- 범위 밖 값은 화면에서만 clip하며 저장된 raw 값은 변경하지 않음
- 시각화: 고정 grid 위의 선형 waveform과 최신 raw 정수

### 05 TGAM Band Power

- 입력: 최신 ASIC EEG Power 패킷의 8개 band
- 표시 변환: `L[i] = log10(1 + Power[i])`
- 높이: `L[i] / max(L[0] ... L[7])`
- smoothing: 없음
- 시각화: `D`, `T`, `LA`, `HA`, `LB`, `HB`, `LG`, `MG` 8개 막대
- 해석 제한: 각 패킷 내부의 상대 모양을 보여주므로 서로 다른 시점의 같은
  높이가 같은 절대 power를 의미하지 않음

### 06 TGAM Attention / Meditation

- 입력: TGAM native eSense Attention, Meditation
- 입력 및 표시 범위: 0-100
- 파생 계산 또는 smoothing: 없음
- 시각화: `A`, `M` 두 개의 세로 막대와 native 숫자
- 현재 serial session에서 첫 패킷을 받기 전에는 `--` 표시

## 필터링 정책

- raw EEG 전체에 적용하는 global filter는 없음
- 카드 02는 4-45 Hz만 공식에 사용
- 카드 03은 4-30 Hz만 공식에 사용
- 60 Hz 전기 간섭은 카드 02와 03의 계산 범위 밖에 있음
- 현재 60 Hz notch filter는 적용하지 않음

## UI 규격

- 카드 제목과 설명은 워크숍 화면에서 숨김
- 번호 `01`-`06`으로 카드와 checkbox를 대응
- checkbox가 checked일 때만 해당 카드 표시
- 보이는 카드만 기존 순서를 유지하며 grid에 재배치
- 980 px 이상: 최대 3열
- 620-979 px: 최대 2열
- 619 px 이하: 1열 및 세로 스크롤
- 연결 전 또는 사용할 수 없는 값은 `--`와 빈 visual로 표시
- serial 연결 버튼과 상태, raw sample rate, checksum failure는 항상 header에 표시
- header 우측 아래에 native Poor Signal을 `TGAM Q q/200`으로 표시
- live 연결에서 첫 Poor Signal packet을 받기 전에는 `TGAM Q --/200` 표시
- 상단 `Signals`와 `Record` tab으로 view 전환
- `#signals`, `#record` hash URL로 각 view 직접 접근
- serial connect button은 두 view에서 같은 source를 제어
- Record view는 Signals의 시각 언어를 이어받는 4-card grid다.
- 첫 행에는 Signal Contact와 Raw EEG만 이어서 표시한다.
- 둘째 행에는 같은 card 크기의 camera와 compact recorder를 표시한다.
- 620 px 이상에서는 최대 944 px 너비의 가운데 정렬 2 x 2 grid를 사용한다.
- 619 px 이하에서는 Signal Contact, Raw EEG, camera, recorder 순서로 1열 배치한다.
- Record view에서는 Movement, Eyes Closed, Band Power, Attention/Meditation을 표시하지 않는다.
- recorder card는 folder, 30초/1분 시작, Stop, 남은 시간, frame/raw count를 표시한다.
- camera preview는 최대 190 px 너비로 제한하고 recorder status는 1행 4열로 표시해
  300 px 높이 card와 짧고 넓은 browser viewport에서도 내부 요소가 넘치지 않게 한다.

## 파일별 책임

| 파일 | 책임 |
|---|---|
| `public/index.html` | Signals/Record tab, 6개 checkbox, recorder DOM |
| `public/serial-source.js` | Web Serial 연결/해제, packet/frame dispatch |
| `public/tgam-parser.js` | ThinkGear framing, checksum, payload 및 physical frame 출력 |
| `public/derived-signals.js` | 카드 01-03 계산과 FFT |
| `public/sketch.js` | live data buffer, 반응형 layout, 카드 01-06 p5 rendering |
| `public/tabs.js` | hash 기반 in-app view 전환 |
| `public/recorder-core.js` | 녹화 상수, file name, frame/raw serialization |
| `public/recorder.js` | 폴더, camera, TGAM frame, file writer, stop/finalize lifecycle |
| `public/style.css` | Signals 및 Record view style |
| `server.js` | dependency-free localhost static server |
| `PROCESSING.md` | 계산과 시각 매핑의 상세 변경 기록 |
| `tests/` | parser, mock Web Serial, page structure 검증 |

## 현재 상태

### 완료

- [x] standalone 저장소 분리 및 GitHub `main` 배포
- [x] direct Web Serial source 구현
- [x] 공유 ThinkGear parser와 checksum diagnostics 구현
- [x] 카드 01-03 파생 신호 구현
- [x] 카드 04 raw waveform 구현
- [x] 카드 05 native band-power graph 구현
- [x] 카드 06 native Attention/Meditation 구현
- [x] 6개 카드 개별 표시/숨김 및 반응형 grid 구현
- [x] 카드 제목/설명 숨김
- [x] native TGAM Poor Signal 0-200 header 표시
- [x] checksum-valid physical TGAM frame callback 및 exact frame hex 구현
- [x] Signals/Record tab과 hash URL 구현
- [x] TGAM frame NDJSON 및 raw EEG TXT streaming writer 구현
- [x] 134 x 100, 8 FPS, 50 kbps 요청, audio 없는 WebM recorder 구현
- [x] 일반적인 640 x 480 camera 입력 요청, preview frame 대기, permission 오류 표시
- [x] 30초/1분 시작 옵션, 남은 시간 표시, 자동 stop/finalize 구현
- [x] Record view를 Signal Contact, Raw EEG, camera, recorder의 compact 4-card 연속형 grid로 구성
- [x] 1,266 x 666 short-wide viewport에서 camera/control card overflow 수정
- [x] session JSON manifest와 자동 stop/finalize 구현
- [x] parser, mock serial, recorder lifecycle, page structure 자동 테스트 통과
- [x] 1,440 x 900 desktop 및 500 px narrow browser render 확인
- [x] 1,440 x 900 및 500 x 900 Record tab browser render 확인

### 실제 장비로 확인 필요

- [ ] 워크숍 MacBook의 Chrome port chooser에 TGAM 포트가 표시되는지 확인
- [ ] 실시간 raw rate가 약 512 samples/second인지 확인
- [ ] 안정된 연결에서 checksum failure가 계속 증가하지 않는지 확인
- [ ] 실제 장비가 `0x83` ASIC band packet을 보내 카드 05가 갱신되는지 확인
- [ ] 실제 장비가 Attention/Meditation packet을 보내 카드 06이 갱신되는지 확인
- [ ] 접촉 불량과 재접촉 시 카드 01-03 상태가 올바르게 바뀌는지 확인
- [ ] Bluetooth loss, 수동 disconnect/reconnect, sleep/wake 후 복구 확인
- [ ] 실제 신호에서 raw EEG ±2,048 표시 범위가 워크숍에 적절한지 확인
- [ ] Chrome에서 recording folder permission과 지속적인 file write 확인
- [ ] 실제 webcam permission, 134 x 100 WebM 재생, file size 확인
- [ ] 실제 TGAM과 webcam 동시 30초/1분 recording의 자동 종료와 timestamp/count 확인
- [ ] serial 또는 camera 중단 시 세 파일과 manifest가 정상 finalize되는지 확인

## MVP 완료 기준

다음 조건을 모두 만족하면 실제 장비 기준 MVP 완료로 간주한다.

1. Chrome에서 사용자 gesture 후 TGAM 포트를 선택하고 연결할 수 있다.
2. 5분 연속 실행에서 raw sample rate가 기대 범위에 있고 패킷 처리가 중단되지 않는다.
3. 정상 접촉에서 카드 02와 03이 2초 이내에 값을 표시한다.
4. 카드 04 waveform이 끊기지 않고 갱신된다.
5. 카드 05와 06이 실제 TGAM packet 주기에 따라 갱신된다.
6. 모든 visibility checkbox가 대응 카드만 표시하거나 숨긴다.
7. disconnect 후 stale live 값이 현재 값처럼 표시되지 않는다.
8. Record tab에서 30초/1분 선택 후 네 출력 파일을 만들고 자동 종료 후 다시 열 수 있다.
9. 1분 동시 녹화에서 browser memory가 지속적으로 증가하지 않는다.
10. `npm test`가 통과한다.

## 알려진 제약 및 위험

- Web Serial 지원 브라우저와 secure context가 필요하다.
- p5.js를 CDN에서 불러오므로 최초 실행 시 인터넷 연결이 필요하다.
- 다른 앱이 TGAM serial port를 점유하면 브라우저가 열 수 없다.
- 카드 02와 03은 워크숍용 상대 지표이며 개인별 calibration이 없다.
- 카드 05는 패킷별 정규화이므로 시간 간 절대 power 비교에 적합하지 않다.
- TGAM eSense 값은 vendor algorithm 출력이며 현재 앱이 계산한 EEG 지표가 아니다.
- 실제 장비 없는 mock test는 browser lifecycle과 parsing을 검증하지만 Bluetooth 및
  하드웨어 timing을 검증하지 못한다.
- File System Access API와 camera permission 때문에 Record 기능도 desktop Chromium
  secure context가 필요하다.
- writable stream이 close되기 전 browser/OS가 비정상 종료되면 현재 session file이
  불완전할 수 있다.
- MediaRecorder의 실제 codec/bitrate는 browser가 요청과 다르게 선택할 수 있다.

## 실행 및 검증

```bash
npm start
npm test
```

- 기본 URL: `http://localhost:3000`
- 다른 port 예시: `PORT=8091 npm start`
- 현재 자동 테스트: parser packet/split/checksum/physical frame, mock Web Serial,
  recorder format, mock folder/camera/MediaRecorder session lifecycle, page structure

## 문서 유지 규칙

다음 변경이 발생하면 같은 commit에서 이 파일을 반드시 갱신한다.

- TGAM packet field 또는 serial 규격 변경
- frequency band, FFT window, hop, 공식, filtering 변경
- MVP 포함/제외 범위 변경
- 카드 수, 순서, visibility, layout 변경
- 녹화 파일, camera, timestamp, writer/finalize 동작 변경
- 테스트 완료 또는 실제 장비 검증 상태 변경
- 알려진 제약, 위험, 운영 방법 변경

큰 개정 전에는 현재 파일을 `backup/project-YYYY-MM-DD-vN.md` 형식으로 복사한 뒤
루트의 `project.md`만 최신 단일 기준 문서로 유지한다.
