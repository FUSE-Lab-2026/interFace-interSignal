# PROJECT.md

# TGAM EEG Visualizer

## Overview

A lightweight web-based EEG visualization tool built with p5.js and NeuroSky TGAM.

The project is intended as a playground for interactive media art rather than a scientific EEG analysis tool.

The primary goals are:

- receive EEG data from a NeuroSky TGAM module
- visualize EEG signals in real time
- explore simple signal processing techniques
- provide an extensible framework for interactive artworks

---

# Technology Stack

Frontend

- p5.js
- HTML5 Canvas
- WebSocket

Backend

- Node.js
- serialport
- ws

Hardware

- NeuroSky TGAM
- Bluetooth Serial or USB Serial

---

# Architecture

```
TGAM

        │
        ▼

Node.js (SerialPort)

        │

   JSON Stream

        │

 WebSocket Server

        │

        ▼

    p5.js Client
```

The backend is responsible for:

- serial communication
- packet decoding
- filtering invalid packets
- converting data into JSON

The frontend is responsible for:

- visualization
- interaction
- animation
- artwork logic

---

# Project Structure

```
project/

    backend/

        server.js

        parser.js

        package.json

    frontend/

        index.html

        sketch.js

        style.css

        websocket.js

        visualizer.js

    docs/

        PROJECT.md
```

---

# Data Model

The frontend receives one JSON object per update.

Example:

```json
{
    "signal": 0,
    "attention": 63,
    "meditation": 51,
    "raw": 241,

    "bands": {

        "delta": 0,
        "theta": 0,

        "lowAlpha": 0,
        "highAlpha": 0,

        "lowBeta": 0,
        "highBeta": 0,

        "lowGamma": 0,
        "midGamma": 0
    }
}
```

---

# Signal Processing

Only lightweight processing is performed.

Possible stages:

```
Raw

↓

Poor Signal Check

↓

EMA Filter

↓

Baseline Normalization

↓

Band Ratios

↓

State Detection
```

No medical interpretation is attempted.

---

# Visualization Modules

The project is modular.

## Raw EEG

Scrolling waveform.

---

## Band Power

Eight vertical bars.

- Delta
- Theta
- Low Alpha
- High Alpha
- Low Beta
- High Beta
- Low Gamma
- Mid Gamma

---

## eSense

Display

- Attention
- Meditation

---

## Brain State

Simple state machine.

Possible states:

- Idle
- Relax
- Focus
- Active

---

# Development Philosophy

This project prioritizes

- simplicity
- readability
- modularity
- real-time performance

Avoid unnecessary frameworks.

Keep dependencies minimal.

---

# Coding Style

Prefer

- ES6 modules
- const / let
- small functions
- pure functions where possible

Avoid

- global mutable state
- callback nesting
- large monolithic files

---

# Milestones

## Phase 1

- Read serial data
- Parse TGAM packets
- Send JSON over WebSocket

---

## Phase 2

- Display raw EEG
- Display Attention
- Display Meditation

---

## Phase 3

- Display all EEG bands
- EMA smoothing
- Baseline normalization

---

## Phase 4

- Interactive artwork mode
- Fullscreen visualization
- Audio reactive mapping

---

# Future Ideas

- Recording sessions
- Playback mode
- FFT visualization
- Spectrogram
- OSC output
- MIDI output
- Web Serial support
- Multi-user EEG visualization
- Networked installations

---

# Non-goals

This project is NOT intended to

- diagnose medical conditions
- detect emotions
- classify mental disorders
- replace scientific EEG software

It is an artistic and educational visualization toolkit.

