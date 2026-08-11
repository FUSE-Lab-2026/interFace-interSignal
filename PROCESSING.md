# Signal and Visualization Log

Update this file whenever packet handling, preprocessing, formulas, or visual
mappings change.

## Acquisition

- Source: TGAM serial packets read directly by desktop Chromium Web Serial
- Serial configuration: 57,600 baud, 8 data bits, 1 stop bit, no parity, no flow
  control
- Browser read buffer request: 65,536 bytes
- Raw sample-rate assumption: 512 Hz
- Browser read chunks are not treated as packets. Every byte passes through TGAM
  sync, payload-length, payload, and checksum states.
- Only checksum-valid packets reach the score calculations.
- Every decoded raw sample is processed from the serial read callback. The p5
  frame rate does not determine sample ingestion.
- No recording, WebSocket transport, interpolation, or resampling is used.

## Signal Contact

- Source: TGAM `POOR_SIGNAL`, called `q` below
- Native range: 0 is good contact; 200 means no contact
- Formula: `Contact = 100 * (1 - clamp(q, 0, 200) / 200)`
- No smoothing or calibration is applied.
- The two frequency-derived scores are hidden whenever `q` is nonzero.
- Visual: a vertical fill whose height is `Contact / 100`; opacity also increases
  with the score.
- Header: the native value is also shown without conversion as `TGAM Q q/200`.
  It remains `--` until a quality packet arrives in the current live connection.

## Movement

- Source: raw TGAM EEG
- FFT input: latest 512 samples, representing 1 second
- Update hop: 128 samples, or 0.25 seconds
- Preprocessing: remove the window mean, apply a Hann window, then run a 512-point
  FFT
- Bin power: `P[k] = Re(X[k])^2 + Im(X[k])^2`
- Numerator: summed power where `30 <= frequency < 45 Hz`
- Denominator: summed power where `4 <= frequency < 45 Hz`
- Formula: `Movement = 100 * Power(30-45 Hz) / Power(4-45 Hz)`
- No logarithm, smoothing, adaptive baseline, percentile scaling, or inversion is
  applied.
- Visual: nine layers whose horizontal displacement and opacity increase with the
  score.

This score responds to broad high-frequency activity commonly produced by jaw,
forehead, eyelid, and blink muscle activity. Cable and electrode motion can also
raise it. It is not a dedicated facial-movement or eye-movement detector.

## Eyes Closed

- Source: raw TGAM EEG
- FFT input: latest 1,024 samples, representing 2 seconds
- Update hop: 128 samples, or 0.25 seconds
- Preprocessing: remove the window mean, apply a Hann window, then run a
  1,024-point FFT
- Theta: summed power where `4 <= frequency < 8 Hz`
- Alpha: summed power where `8 <= frequency < 13 Hz`
- Beta: summed power where `13 <= frequency < 30 Hz`
- Formula: `EyesClosed = 100 * Alpha / (Theta + Alpha + Beta)`
- No smoothing, adaptive baseline, percentile scaling, or inversion is applied.
- The first frequency-derived values appear after the 1,024-sample buffer fills,
  approximately 2 seconds after raw data begins.
- Visual: circle area is proportional to the score, so its diameter is
  `maximumDiameter * sqrt(score / 100)`; opacity also increases with the score.

Closing the eyes often increases relative alpha, but this score is not a binary
eye-state classifier and does not directly measure eye movement.

## Frequency rejection

- The raw signal is not globally filtered.
- Movement uses only 4-45 Hz.
- Eyes Closed uses only 4-30 Hz.
- Therefore 60 Hz electrical interference is excluded from both score formulas.
- A notch filter is not currently applied.

## Raw EEG

- Source: decoded signed TGAM raw-wave packets
- No filtering, smoothing, interpolation, or resampling is applied.
- History retained in memory: latest 1,024 samples
- Samples displayed: latest 512 samples, representing approximately 1 second
- Horizontal axis: packet/sample order
- Vertical display range: fixed at -2,048 to 2,048
- Values outside that range are visually clipped at the card boundary; the stored
  raw values are not modified.
- The latest raw integer is shown in the card corner.

## TGAM band power

- Source: the eight native ASIC EEG power values in TGAM code `0x83` packets
- Order: delta, theta, low alpha, high alpha, low beta, high beta, low gamma,
  mid gamma
- Labels: `D`, `T`, `LA`, `HA`, `LB`, `HB`, `LG`, `MG`
- Each packet value is transformed for display with `L[i] = log10(1 + Power[i])`.
- Bar height is normalized within the latest packet:
  `Height[i] = L[i] / max(L[0] ... L[7])`.
- Bar opacity uses the same normalized value.
- No smoothing or calibration is applied.

The graph emphasizes the relative shape across bands in one TGAM update. Bar
height is not an absolute scale, so the same height can represent different raw
power values in different packets.

## TGAM Attention and Meditation

- Source: native TGAM eSense Attention code `0x04` and Meditation code `0x05`
- Native range: 0-100
- The card uses separate `A` and `M` vertical meters.
- Filled height and opacity are directly proportional to each native score.
- No smoothing, interpolation, inversion, or derived calculation is applied.
- Values remain unavailable until their first packets arrive in the current
  serial session.

## Guessing display

- Panel names and formula descriptions are intentionally hidden.
- Cards are identified only as `01` through `06`. Numbered checkboxes independently
  show or hide each card without revealing its title.
- Fixed order: Signal Contact, Movement, Eyes Closed, Raw EEG, TGAM band power,
  TGAM Attention/Meditation.
- Visible cards reflow to three columns on wide screens, two columns on medium
  screens, and one scrollable column on narrow screens.
- Missing/contact-gated values display `--`.
- Numeric scores remain visible to support comparison and experimentation.
- These are relative workshop signals, not probabilities or clinical measurements.

## Synchronized recording

### Shared source

- `Signals` and `Record` are views within one page and share one
  `TGAMSerialSource` instance.
- A second browser page does not independently open the same serial port.
- The parser emits a frame callback for every checksum-valid physical TGAM frame.
- Each frame callback contains payload length, checksum, payload bytes, complete
  frame bytes, and the decoded packet object.

### TGAM frame NDJSON

- Filename: `YYYY-MM-DD_HHmmss_SSS-tgam-packets.ndjson`
- One JSON object per line
- `tgam_frame` fields: frame index, Unix milliseconds, elapsed milliseconds,
  payload length, checksum, complete lowercase hexadecimal frame, and decoded
  TGAM values
- `transport_stats` is appended once per second with parser and raw-rate counters.
- `recording_start` and `recording_stop` delimit the session.
- Checksum-invalid frames are excluded from `tgam_frame` records; their count is
  retained in `transport_stats` and the manifest.
- Text is buffered and written to the selected folder in approximately 64 KiB or
  one-second batches.

### Raw EEG text

- Filename: `YYYY-MM-DD_HHmmss_SSS-raw-eeg.txt`
- Source: decoded raw-wave values from the same valid frame callbacks
- Preprocessing: none
- Columns: `sample_index`, `elapsed_ms`, `unix_ms`, `raw`
- Delimiter: tab
- Comment header records format version, session ID, start time, expected 512 Hz
  sample rate, and preprocessing state.

### Camera video

- Filename: `YYYY-MM-DD_HHmmss_SSS-camera-240p.webm`
- Audio: disabled at capture and absent from the recording stream
- Camera request: ideal 320 x 240, ideal 12 FPS, maximum 15 FPS
- Output guarantee: each camera frame is redrawn to an exact 320 x 240 canvas
- Canvas capture: 12 FPS
- MediaRecorder requested bitrate: 180,000 bits/second
- Preferred codec order: WebM VP8, WebM VP9, browser WebM fallback
- MediaRecorder may report an actual bitrate different from the request.
- Video chunks are written directly to the selected folder as they arrive rather
  than retained as one in-memory Blob.

### Session manifest

- Filename: `YYYY-MM-DD_HHmmss_SSS-session.json`
- Records serial/video targets, actual camera settings, selected codec and bitrate,
  filenames, timestamps, stop reason, frame/raw totals, video bytes, and parser
  statistics at start and stop.
- The manifest is written after all three stream files close successfully.

### Stop behavior

- Manual Stop finalizes every stream and then writes the manifest.
- Serial disconnect, camera end, video error, or file-write error initiates stop.
- Closing or reloading the page while recording triggers a browser warning.
- A browser/OS crash before writable streams close can leave the current session
  incomplete.
