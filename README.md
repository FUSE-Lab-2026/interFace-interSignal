# interFace / interSignal

A standalone p5.js workshop visualization that reads NeuroSky TGAM packets
directly in the browser. It presents three unlabeled signals so participants can
experiment, observe, and guess what each display responds to.

This is an exploratory visualization, not a medical or diagnostic tool.

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
misaligned serial data.

## What is displayed

The three panels are intentionally unlabeled during the guessing activity. Their
fixed order is:

1. Signal Contact
2. Movement
3. Eyes Closed

The numeric values are continuous workshop scores from 0 to 100. Movement and
Eyes Closed remain unavailable while TGAM reports poor electrode contact.

Exact formulas, FFT windows, frequency ranges, and limitations are documented in
[PROCESSING.md](PROCESSING.md).

## Architecture

```text
TGAM serial bytes
  -> browser Web Serial
  -> ThinkGear framing and checksum parser
  -> raw EEG and signal-quality packet callbacks
  -> browser FFT-derived signals
  -> p5.js visualization
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
public/index.html          page entry
public/serial-source.js    Web Serial lifecycle and packet dispatch
public/tgam-parser.js      ThinkGear packet framing and checksum parser
public/derived-signals.js  contact and spectral score calculations
public/sketch.js           p5 layout and anonymous visual mappings
public/style.css           page and serial-button styling
server.js                  dependency-free localhost static server
tests/                     parser and mocked Web Serial tests
```
