# interFace / interSignal

A standalone p5.js workshop visualization that reads NeuroSky TGAM packets
directly in the browser. It presents six unlabeled signals so participants can
experiment, observe, and guess what each display responds to.

This is an exploratory visualization, not a medical or diagnostic tool.

## Hosted version

The static browser app is published at:

<https://fuse-lab-2026.github.io/interFace-interSignal/>

GitHub Pages serves the files in `public/` through the Pages workflow. The
hosted HTTPS version can use Web Serial, camera permission, local recording, and
local playback in supported desktop Chromium browsers. `server.js` is used only
for local development and is not part of the hosted runtime.

For repositories configured as `Deploy from a branch: main / root`, the root
`index.html` preserves the URL hash and redirects to the same app under
`public/` instead of allowing Jekyll to render this README.

## Run

Requirements:

- Node.js 18 or newer
- Desktop Chrome or another Chromium browser with Web Serial
- A TGAM serial device configured for 57,600 baud
- Internet access on first load for the p5.js CDN

```bash
npm start
```

Open `http://localhost:3000`, press **TGAM 연결**, and select the TGAM serial
port. Keep other TGAM/serial applications closed because one process should own
the port at a time.

The header should show approximately `512 raw/s` while raw packets are arriving.
`bad 0` is the checksum-failure counter; a rising value indicates corrupt or
misaligned serial data. `TGAM Q n/200` shows the native contact-quality packet:
`0` is best and `200` means no contact.

## Cards and visibility

The six numbered checkboxes in the header independently show or hide each card.
Visible cards automatically reflow into three, two, or one column depending on
the viewport. The panels remain intentionally untitled during the guessing
activity. Their fixed order is:

1. Signal Contact
2. Raw EEG
3. Absolute band power
4. TGAM Attention and Meditation
5. Movement
6. Eyes Closed

Only Signal Contact is selected and shown on first load. Signal Contact,
Movement, and Eyes Closed are continuous workshop scores from 0 to 100. Movement,
Eyes Closed, and Absolute Band Power remain unavailable while TGAM reports poor
electrode contact. Raw EEG displays the incoming stream, Absolute Band Power is
calculated from that stream in `uV^2`, and Attention/Meditation displays native
TGAM values.

## 녹화 tab

The `녹화` tab uses the same browser-owned TGAM connection as the signal cards,
so the serial port is opened only once. Recording requires desktop Chrome or
Chromium.

The Record controls, camera states, recording status, and error guidance are
shown in Korean for workshop operation.

1. Press **TGAM 연결** and select the serial port.
2. Open `녹화` or visit `http://localhost:3000/#record`.
3. Press **저장 폴더 선택** and grant write access.
4. Optionally press **카메라 켜기** and grant camera access. Leave it off for
   an EEG-only session.
5. Press **30초 녹화** or **1분 녹화**. The session stops and finalizes
   automatically; **녹화 중지** remains available for an early finish.

The Record view is a compact continuation of the signal grid. It carries over
only Signal Contact and Raw EEG, then adds one camera card and one recording
control card. The four cards form a centered 2 x 2 grid on larger screens and
stack in the same order on narrow screens.

Each completed session leaves one file in the selected folder:

- `*.eegsession.zip`: one standard, uncompressed ZIP containing packet NDJSON,
  raw EEG TXT, and a session JSON manifest. Camera-enabled sessions also contain
  a silent 100p WebM.

The component files stream directly to disk while recording. After all streams
close, the app creates and CRC-validates the ZIP, then removes the temporary
components. If ZIP finalization fails, the component files remain for recovery.

Camera is optional and does not affect the EEG recorder start controls. When it
is enabled, the app requests a broadly supported 640 x 480 input and waits for a
real preview frame. The recorded stream is independently downsampled through a
134 x 100 canvas. Permission denial, insecure context, missing camera, and a
camera busy in another app are shown as distinct errors, but the user may still
record EEG only. The browser may choose a slightly different actual video
bitrate than requested.

## 재생 tab

`재생` or `#playback` compares the recorded camera and raw EEG in the
browser. Press **녹화 파일 불러오기** and select an `.eegsession.zip` produced
by the Record tab. The ZIP is extracted locally in browser memory; it is not
uploaded to a server. Up to three ZIP files can be selected together.

Playback also accepts manually created standard ZIP files using Store or
Deflate compression. The component files may be at the ZIP root or inside one
folder; Finder `__MACOSX` metadata is ignored. Encrypted and Zip64 archives are
not supported.

- Up to three sessions can be loaded at once.
- Each session displays camera, raw EEG, and one selected signal card. EEG-only
  sessions show `카메라 없음` in the camera pane.
- The `03`-`06` control applies one Signals-page card to every loaded session:
  absolute five-band power, native Attention/Meditation, Movement, or Eyes Closed.
- On desktop, Raw EEG is two-thirds of its previous width and the selected card
  uses the remaining third. Narrow screens stack all three panes.
- With video, the raw waveform follows that session video's `currentTime`,
  including native video seeking. EEG-only sessions use the reconstructed raw
  EEG duration and an on-screen timeline slider as their playback clock.
- Waveform x positions use `sample_index` and the TXT header sample rate
  (normally 512 Hz). The recorded `elapsed_ms` remains available as browser
  receipt timing, but serial chunk bursts do not collapse samples onto one x
  coordinate.
- The graph shows a moving four-second window: three seconds before the current
  time and up to one second ahead.
- **재생**, **일시정지**, and **처음부터** control every loaded session; each
  native video control can still be used independently.
- Playback applies no filtering, interpolation, or resampling to the TXT values;
  sample-clock reconstruction changes only their display positions.

Current `camera-100p.webm` and earlier `camera-240p.webm` filenames are both
accepted through the legacy loose-file input. Cards 03, 05, and 06 are
reconstructed from raw EEG. Card 04 requires packet NDJSON; older WebM/TXT-only
recordings show it as unavailable. Files stay local and are loaded through
browser object URLs.

Exact formulas, FFT windows, frequency ranges, and limitations are documented in
[PROCESSING.md](PROCESSING.md).

현재 데이터 규격, MVP 범위, 구현 및 검증 상태는 한국어
[project.md](project.md)를 기준으로 관리합니다. 큰 개정 전의 프로젝트 문서는
`backup/`에 보관합니다.

## Architecture

```text
TGAM serial bytes
  -> browser Web Serial
  -> ThinkGear framing and checksum parser
  -> valid physical-frame callbacks
     -> browser FFT-derived signals -> p5.js visualization
     -> frame NDJSON + raw EEG text recorder

Optional web camera -> preview -> 134 x 100 canvas -> MediaRecorder -> WebM file

NDJSON + TXT + manifest (+ optional WebM) -> verified eegsession ZIP

eegsession ZIP -> browser extraction -> video clock or EEG-only clock -> waveform/cards
```

Node only serves static files on localhost. It does not access the serial port,
parse packets, preprocess EEG, use WebSockets, or replay a recording.

## Commands

```bash
npm test
PORT=8090 npm start
```

Web Serial requires a secure context. Use the localhost URL printed by the server;
opening the page from another device over a plain LAN IP will not provide direct
access to the Mac's serial port.

## Project structure

```text
public/index.html          Signals/Record/Playback tabs and page entry
public/serial-source.js    Web Serial lifecycle and packet dispatch
public/tgam-parser.js      ThinkGear packet framing and checksum parser
public/derived-signals.js  contact and spectral score calculations
public/sketch.js           responsive p5 cards, visibility, and visual mappings
public/style.css           page and serial-button styling
public/recorder-core.js    recording constants and pure file formatting
public/recorder.js         folder, camera, TGAM, and session recording lifecycle
public/session-zip.js      dependency-free ZIP creation, CRC check, and extraction
public/playback-core.js    playback file pairing, TXT parsing, and time windows
public/playback.js         multi-session video and raw EEG playback
public/tabs.js             hash-addressable in-app view switching
server.js                  dependency-free localhost static server
tests/                     parser and mocked Web Serial tests
```
