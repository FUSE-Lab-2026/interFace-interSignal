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

## Run

Requirements:

- Node.js 18 or newer
- Desktop Chrome or another Chromium browser with Web Serial
- A TGAM serial device configured for 57,600 baud
- Internet access on first load for the p5.js CDN

```bash
npm start
```

Open `http://localhost:3000`, press **Connect TGAM**, and select the TGAM serial
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

## Record tab

The `Record` tab uses the same browser-owned TGAM connection as the signal cards,
so the serial port is opened only once. Recording requires desktop Chrome or
Chromium.

1. Press **Connect TGAM** and select the serial port.
2. Open `Record` or visit `http://localhost:3000/#record`.
3. Press **Choose Folder** and grant write access.
4. Press **Enable Camera** and grant camera access.
5. Press **30 s** or **1 min**. The session stops and finalizes automatically;
   **Stop** remains available for an early finish.

The Record view is a compact continuation of the signal grid. It carries over
only Signal Contact and Raw EEG, then adds one camera card and one recording
control card. The four cards form a centered 2 x 2 grid on larger screens and
stack in the same order on narrow screens.

Each session writes directly to the selected folder:

- `*-tgam-packets.ndjson`: checksum-valid physical TGAM frames, frame hex,
  timestamps, decoded fields, and transport-stat events
- `*-raw-eeg.txt`: unfiltered raw values with sample index and two timestamps
- `*-camera-100p.webm`: silent 134 x 100, 8 FPS video at a requested 50 kbps
- `*-session.json`: recording settings, filenames, counts, duration, and final
  parser statistics

The app requests a broadly supported 640 x 480 camera input and waits for a real
preview frame. The recorded stream is independently downsampled through a
134 x 100 canvas. Permission denial, insecure context, missing camera, and a
camera busy in another app are shown as distinct errors. The browser may choose
a slightly different actual video bitrate than requested.

## Playback tab

`Playback` or `#playback` compares the recorded camera and raw EEG in the
browser. Press **Add recordings** and select each matching camera WebM and raw
EEG TXT pair together. The filename before `-camera-*p.webm` and
`-raw-eeg.txt` identifies the session.

- Up to three sessions can be loaded at once.
- Each session displays camera and raw EEG side by side.
- The raw waveform follows that session video's `currentTime`, including native
  video seeking.
- Waveform x positions use `sample_index` and the TXT header sample rate
  (normally 512 Hz). The recorded `elapsed_ms` remains available as browser
  receipt timing, but serial chunk bursts do not collapse samples onto one x
  coordinate.
- The graph shows a moving four-second window: three seconds before the current
  time and up to one second ahead.
- **Play all**, **Pause**, and **Restart** control every loaded session; each
  native video control can still be used independently.
- Playback applies no filtering, interpolation, or resampling to the TXT values;
  sample-clock reconstruction changes only their display positions.

Current `camera-100p.webm` and earlier `camera-240p.webm` filenames are both
accepted. Files stay local and are loaded through browser object URLs.

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

Web camera -> preview -> 134 x 100 canvas -> MediaRecorder -> WebM file

local camera WebM + raw EEG TXT -> browser playback -> synchronized video/waveform
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
public/playback-core.js    playback file pairing, TXT parsing, and time windows
public/playback.js         multi-session video and raw EEG playback
public/tabs.js             hash-addressable in-app view switching
server.js                  dependency-free localhost static server
tests/                     parser and mocked Web Serial tests
```
