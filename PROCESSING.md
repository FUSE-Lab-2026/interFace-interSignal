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
- All three frequency-derived outputs are hidden whenever `q` is nonzero.
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
- The latest raw integer is shown in the card corner. It is a signed ADC count,
  not a normalized score: its sign indicates instantaneous voltage direction
  relative to the TGAM reference and its magnitude indicates deflection.
- Nominal voltage conversion is approximately `raw * 0.2197265625 uV`, so a
  displayed count of `1000` is approximately `220 uV`. It is not a calibrated
  clinical voltage measurement.

## Absolute band power

- Source: the latest 1,024 raw TGAM samples, representing 2 seconds at 512 Hz
- Raw conversion:
  `x_uV[n] = raw[n] * ((1.8 / 4096) / 2000) * 1,000,000`
- Conversion factor: approximately `0.2197265625 uV` per raw count
- Preprocessing: mean removal and a 1,024-point Hann window
- FFT size: 1,024; frequency-bin width: 0.5 Hz
- Update hop: 128 samples, approximately 0.25 seconds
- One-sided periodogram:
  `PSD[k] = 2 * |FFT((x_uV - mean) * Hann)[k]|^2 / (Fs * sum(Hann^2))`
  in `uV^2/Hz`; DC is excluded and the Nyquist bin is not doubled.
- Band power: `Power_band = sum(PSD[k] * 0.5 Hz)` for bins inside the band
- Bands: Delta 0.5-4 Hz, Theta 4-8 Hz, Alpha 8-13 Hz, Beta 13-30 Hz,
  Gamma 30-50 Hz
- Labels: `D`, `T`, `A`, `B`, `G`
- The card does not use or display the TGAM `0x83` low/high band subdivisions.
  Those native packet values remain available to the parser and recorder.
- Display axis: fixed logarithmic range from `0.1` to `10,000 uV^2`
- Bar height:
  `clamp((log10(Power_band) - log10(0.1)) / 5, 0, 1)`
- Values are not normalized against the strongest band or total power. The same
  bar height therefore represents the same calculated power at different times.
- No temporal smoothing, software notch filter, or band-pass filter is applied.
- Card output is hidden unless TGAM Poor Signal is exactly `0`.

The voltage conversion follows NeuroSky's TGAT/TGAM nominal 2,000x gain. The
manufacturer notes that actual hardware gain can vary by approximately +/-5%,
so these are nominal estimates rather than clinical measurements. Conversion
reference: <https://support.neurosky.com/kb/science/how-to-convert-raw-values-to-voltage>.

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
- Fixed order: Signal Contact, Raw EEG, absolute band power, TGAM
  Attention/Meditation, Movement, Eyes Closed.
- On first load, only card `01` Signal Contact is checked and visible.
- Visible cards reflow to three columns on wide screens, two columns on medium
  screens, and one scrollable column on narrow screens.
- Missing/contact-gated values display `--`.
- Numeric scores remain visible to support comparison and experimentation.
- These are relative workshop signals, not probabilities or clinical measurements.

## Synchronized recording

### Shared source

- `신호` and `녹화` are views within one page and share one
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

- Filename: `YYYY-MM-DD_HHmmss_SSS-camera-100p.webm`
- Audio: disabled at capture and absent from the recording stream
- Camera input request: ideal 640 x 480, ideal 15 FPS, maximum 30 FPS
- Output guarantee: each camera frame is redrawn to an exact 134 x 100 canvas
- Canvas capture: 8 FPS
- MediaRecorder requested bitrate: 50,000 bits/second
- Preferred codec order: WebM VP8, WebM VP9, browser WebM fallback
- MediaRecorder may report an actual bitrate different from the request.
- Video chunks are written directly to the selected folder as they arrive rather
  than retained as one in-memory Blob.
- The preview waits up to eight seconds for a decoded frame. Camera permission,
  secure-context, missing-device, and busy-device failures are reported in the
  Record card.

### Fixed recording duration

- The only start choices are 30,000 ms and 60,000 ms.
- `planned_duration_ms` is written to `recording_start` and
  `plannedDurationMs` is written to the session manifest.
- A browser timer calls the same finalization path as manual Stop when the chosen
  duration is reached, using `duration_complete` as the stop reason.

### Session manifest

- Filename: `YYYY-MM-DD_HHmmss_SSS-session.json`
- Records serial/video targets, actual camera settings, selected codec and bitrate,
  filenames, timestamps, stop reason, frame/raw totals, video bytes, and parser
  statistics at start and stop.
- The manifest is written after all three stream files close successfully.

### Stop behavior

- Reaching 30 seconds or 1 minute finalizes every stream and writes the manifest.
- `녹화 중지` can finalize a session before its planned duration.
- Serial disconnect, camera end, video error, or file-write error initiates stop.
- Closing or reloading the page while recording triggers a browser warning.
- A browser/OS crash before writable streams close can leave the current session
  incomplete.

## Recording playback

### Input pairing

- Playback accepts up to three complete camera/raw file pairs with optional packet NDJSON.
- Raw EEG filename: `<session>-raw-eeg.txt`
- Camera filename: `<session>-camera-100p.webm`; the earlier
  `<session>-camera-240p.webm` form is also accepted.
- Packet filename: `<session>-tgam-packets.ndjson`
- The common `<session>` filename stem groups the files. NDJSON is optional for
  cards 03, 05, and 06 but required for native card 04 Attention/Meditation.
- Files are read locally with `File.text()` and browser object URLs. They are not
  uploaded or sent to `server.js`.

### Raw EEG timeline

- The TXT parser ignores comment lines and the column-header row.
- Used columns: `sample_index`, `elapsed_ms`, `unix_ms`, `raw`.
- `elapsed_ms` and `unix_ms` are retained as browser receipt times. Web Serial
  can deliver several packets in one read, so consecutive samples can share the
  same rounded `elapsed_ms` value.
- Samples are ordered by `sample_index`. With a valid TXT header sample rate,
  each display timestamp is reconstructed as
  `first_elapsed_ms + (sample_index - first_sample_index) * 1000 / expected_sample_rate_hz`.
  At 512 Hz, adjacent samples are 1.953125 ms apart.
- If the header has no valid sample rate, playback falls back to `elapsed_ms`.
- Timeline reconstruction changes only x positions. Raw values are not filtered,
  smoothed, interpolated, or resampled, and no samples are inserted or removed.
- Each waveform uses its own video's `currentTime * 1000` as the current EEG
  timestamp.
- The visible window is 4,000 ms. Normally it starts 3,000 ms before the current
  timestamp, leaving up to 1,000 ms ahead of the cursor. At either file boundary,
  the window shifts to remain within the available duration.
- Display clipping remains fixed at raw values `-2048` to `+2048`; clipping only
  affects drawing and does not modify loaded samples.
- Native video seeking immediately changes the waveform window.

### Multi-session behavior

- `재생`, `일시정지`, and `처음부터` operate on every loaded video.
- Camera and EEG synchronization is maintained within each recording because the
  EEG cursor reads that recording's video clock.
- Up to three recordings are rendered as vertically stacked comparison rows.
- Removing or clearing a recording pauses the video and revokes its object URL.

### Selectable signal card

- Each desktop row uses Camera / Raw EEG / selected card proportions of
  `0.36 / 0.4267 / 0.2133`. At 1,400 px this is 504 / 597 / 299 px, making Raw
  EEG exactly two-thirds of its former 896 px width.
- One global `03`-`06` selector changes the third pane for every loaded session.
- Card 03 uses 1,024 raw samples, mean removal, Hann window, one-sided PSD, and
  absolute Delta/Theta/Alpha/Beta/Gamma power in `uV^2`.
- Card 05 uses a 512-sample window and
  `100 * Power(30-45 Hz) / Power(4-45 Hz)`.
- Card 06 uses a 1,024-sample window and
  `100 * Power(8-13 Hz) / Power(4-30 Hz)`.
- Raw-derived features advance every 128 samples, approximately 0.25 seconds.
- Card 04 reads native Attention and Meditation from checksum-valid
  `tgam_frame.decoded` NDJSON records and holds the latest values by `elapsed_ms`.
- If packet NDJSON reports Poor Signal above 0, cards 03, 05, and 06 are hidden
  for that interval. TXT-only recordings cannot apply this contact-quality gate.
