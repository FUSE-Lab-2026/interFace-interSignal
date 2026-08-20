const TGAMPlayback = (() => {
  const {
    BAND_DEFINITIONS,
    MAX_RECORDINGS,
    RAW_DISPLAY_LIMIT,
    calculateBandSeries,
    formatTime,
    getBandPoint,
    getPlaybackWindow,
    getSampleRange,
    normalizeBandSeries,
    pairRecordingFiles,
    parseRawEegText,
  } = TGAMPlaybackCore;

  const elements = {
    add: document.querySelector("#add-playback"),
    clear: document.querySelector("#clear-playback"),
    comparison: document.querySelector("#playback-comparison"),
    comparisonCanvas: document.querySelector("#comparison-canvas"),
    comparisonLeft: document.querySelector("#comparison-left"),
    comparisonRight: document.querySelector("#comparison-right"),
    count: document.querySelector("#playback-count"),
    empty: document.querySelector("#playback-empty"),
    fileInput: document.querySelector("#playback-files"),
    list: document.querySelector("#playback-list"),
    message: document.querySelector("#playback-message"),
    pause: document.querySelector("#pause-playback"),
    play: document.querySelector("#play-all"),
    restart: document.querySelector("#restart-playback"),
    modeButtons: Array.from(document.querySelectorAll("[data-playback-mode]")),
  };

  const BAND_LABELS = ["D", "T", "A", "B", "G"];
  const BAND_POWER_MIN = 0.1;
  const BAND_POWER_MAX = 10000;
  const recordings = [];
  let animationFrame = null;
  let currentMode = "bands";

  const setMessage = (message, isError = false) => {
    elements.message.textContent = message;
    elements.message.classList.toggle("is-error", isError);
  };

  const updateModeControls = () => {
    const canCompare = recordings.length >= 2;
    if (!canCompare && currentMode === "between") currentMode = "bands";
    for (const button of elements.modeButtons) {
      const mode = button.dataset.playbackMode;
      const active = mode === currentMode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
      if (mode === "between") button.disabled = !canCompare;
    }
    elements.comparison.hidden = currentMode !== "between" || !canCompare;
    for (const recording of recordings) {
      recording.label.textContent = currentMode === "raw" ? "RAW EEG" : "ABSOLUTE BANDS";
    }
  };

  const updateControls = () => {
    const hasRecordings = recordings.length > 0;
    elements.add.disabled = recordings.length >= MAX_RECORDINGS;
    elements.play.disabled = !hasRecordings;
    elements.pause.disabled = !hasRecordings;
    elements.restart.disabled = !hasRecordings;
    elements.clear.disabled = !hasRecordings;
    elements.count.textContent = `${recordings.length} / ${MAX_RECORDINGS}`;
    elements.empty.hidden = hasRecordings;
    updateModeControls();
  };

  const resizeCanvas = (canvas, context) => {
    const width = Math.max(1, Math.round(canvas.clientWidth));
    const height = Math.max(1, Math.round(canvas.clientHeight));
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(width * scale);
    const pixelHeight = Math.round(height * scale);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    context.setTransform(scale, 0, 0, scale, 0, 0);
    return { width, height };
  };

  const drawWaveform = (recording) => {
    const { canvas, context, samples, video, time } = recording;
    const { width, height } = resizeCanvas(canvas, context);
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#e6e6e1";
    context.fillRect(0, 0, width, height);

    const inset = 18;
    const graph = {
      x: inset,
      y: inset,
      width: Math.max(1, width - inset * 2),
      height: Math.max(1, height - inset * 2),
    };
    context.strokeStyle = "#cecec8";
    context.lineWidth = 1;
    for (let index = 0; index <= 4; index += 1) {
      const y = graph.y + graph.height * index / 4;
      context.beginPath();
      context.moveTo(graph.x, y);
      context.lineTo(graph.x + graph.width, y);
      context.stroke();
    }

    const rawDurationMs = samples.length ? samples[samples.length - 1].timelineMs : 0;
    const currentMs = Math.max(0, video.currentTime * 1000);
    const totalMs = Math.max(rawDurationMs, Number.isFinite(video.duration) ? video.duration * 1000 : 0);
    const playbackWindow = getPlaybackWindow(currentMs, totalMs);
    const range = getSampleRange(samples, playbackWindow.startMs, playbackWindow.endMs);
    const durationMs = playbackWindow.endMs - playbackWindow.startMs;

    if (range.endIndex - range.startIndex > 1) {
      context.strokeStyle = "#17191a";
      context.lineWidth = 1.25;
      context.beginPath();
      for (let index = range.startIndex; index < range.endIndex; index += 1) {
        const sample = samples[index];
        const x = graph.x + (sample.timelineMs - playbackWindow.startMs) / durationMs * graph.width;
        const limited = Math.max(-RAW_DISPLAY_LIMIT, Math.min(RAW_DISPLAY_LIMIT, sample.raw));
        const y = graph.y + (RAW_DISPLAY_LIMIT - limited) / (RAW_DISPLAY_LIMIT * 2) * graph.height;
        if (index === range.startIndex) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.stroke();
    }

    const cursorX = graph.x + Math.max(
      0,
      Math.min(1, (currentMs - playbackWindow.startMs) / durationMs)
    ) * graph.width;
    context.strokeStyle = "#d34a3a";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(cursorX, graph.y);
    context.lineTo(cursorX, graph.y + graph.height);
    context.stroke();

    const totalSeconds = Number.isFinite(video.duration) ? video.duration : rawDurationMs / 1000;
    time.textContent = `${formatTime(video.currentTime)} / ${formatTime(totalSeconds)}`;
  };

  const drawBandProfile = (recording) => {
    const { canvas, context, bandSeries, samples, video, time } = recording;
    const { width, height } = resizeCanvas(canvas, context);
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#e6e6e1";
    context.fillRect(0, 0, width, height);

    const point = getBandPoint(bandSeries, video.currentTime * 1000);
    const left = 38;
    const top = 20;
    const bottom = 24;
    const graphWidth = Math.max(1, width - left - 18);
    const graphHeight = Math.max(1, height - top - bottom);
    const logMinimum = Math.log10(BAND_POWER_MIN);
    const logRange = Math.log10(BAND_POWER_MAX) - logMinimum;

    context.font = "9px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    context.textBaseline = "middle";
    for (const guide of [0.1, 1, 10, 100, 1000, 10000]) {
      const normalized = (Math.log10(guide) - logMinimum) / logRange;
      const y = top + graphHeight * (1 - normalized);
      context.strokeStyle = "#cecec8";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(left, y);
      context.lineTo(left + graphWidth, y);
      context.stroke();
      context.fillStyle = "#858885";
      context.textAlign = "right";
      context.fillText(guide >= 1000 ? `${guide / 1000}k` : String(guide), left - 5, y);
    }

    const gap = Math.max(6, Math.min(16, graphWidth * 0.03));
    const barWidth = (graphWidth - gap * (BAND_DEFINITIONS.length - 1)) / BAND_DEFINITIONS.length;
    BAND_DEFINITIONS.forEach(([name], index) => {
      const x = left + index * (barWidth + gap);
      context.fillStyle = "#d8d8d2";
      context.fillRect(x, top, barWidth, graphHeight);
      if (point) {
        const value = Math.max(BAND_POWER_MIN, point.powers[name]);
        const normalized = Math.max(0, Math.min(1, (Math.log10(value) - logMinimum) / logRange));
        const fillHeight = graphHeight * normalized;
        context.fillStyle = `rgba(23, 25, 26, ${0.18 + normalized * 0.82})`;
        context.fillRect(x, top + graphHeight - fillHeight, barWidth, fillHeight);
      }
      context.fillStyle = "#696c69";
      context.textAlign = "center";
      context.textBaseline = "bottom";
      context.fillText(BAND_LABELS[index], x + barWidth / 2, height - 4);
    });

    context.fillStyle = "#777a78";
    context.textAlign = "left";
    context.textBaseline = "top";
    context.fillText("uV^2", 6, 6);
    const rawDurationMs = samples.length ? samples[samples.length - 1].timelineMs : 0;
    const totalSeconds = Number.isFinite(video.duration) ? video.duration : rawDurationMs / 1000;
    time.textContent = `${formatTime(video.currentTime)} / ${formatTime(totalSeconds)}`;
  };

  const drawBetween = () => {
    if (currentMode !== "between" || recordings.length < 2) return;
    const leftRecording = recordings[0];
    const rightRecording = recordings[1];
    const canvas = elements.comparisonCanvas;
    const context = canvas.getContext("2d");
    const { width, height } = resizeCanvas(canvas, context);
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#e6e6e1";
    context.fillRect(0, 0, width, height);

    elements.comparisonLeft.textContent = leftRecording.key;
    elements.comparisonRight.textContent = rightRecording.key;
    const leftPoint = getBandPoint(
      leftRecording.normalizedBandSeries,
      leftRecording.video.currentTime * 1000
    );
    const rightPoint = getBandPoint(
      rightRecording.normalizedBandSeries,
      rightRecording.video.currentTime * 1000
    );

    const centerX = width / 2;
    const sidePadding = 34;
    const centerGap = 34;
    const halfWidth = Math.max(1, centerX - sidePadding - centerGap);
    const top = 24;
    const rowHeight = Math.max(28, (height - top * 2) / BAND_DEFINITIONS.length);
    context.font = "10px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    context.textBaseline = "middle";

    BAND_DEFINITIONS.forEach(([name], index) => {
      const y = top + rowHeight * index + rowHeight / 2;
      const leftValue = leftPoint?.normalized[name] ?? 0;
      const rightValue = rightPoint?.normalized[name] ?? 0;
      const shared = Math.min(leftValue, rightValue);
      const resemblance = 1 - Math.abs(leftValue - rightValue);

      context.fillStyle = "#d3d3cd";
      context.fillRect(sidePadding, y - 7, halfWidth, 14);
      context.fillRect(centerX + centerGap, y - 7, halfWidth, 14);
      context.fillStyle = `rgba(23, 25, 26, ${0.2 + leftValue * 0.8})`;
      context.fillRect(centerX - centerGap - halfWidth * leftValue, y - 7, halfWidth * leftValue, 14);
      context.fillStyle = `rgba(23, 25, 26, ${0.2 + rightValue * 0.8})`;
      context.fillRect(centerX + centerGap, y - 7, halfWidth * rightValue, 14);

      context.strokeStyle = `rgba(211, 74, 58, ${0.12 + shared * resemblance * 0.88})`;
      context.lineWidth = 2 + shared * 6;
      context.beginPath();
      context.moveTo(centerX - centerGap, y);
      context.lineTo(centerX + centerGap, y);
      context.stroke();

      context.fillStyle = "#656865";
      context.textAlign = "center";
      context.fillText(BAND_LABELS[index], centerX, y);
    });

    context.fillStyle = "#858885";
    context.font = "9px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    context.textBaseline = "top";
    context.textAlign = "left";
    context.fillText("WITHIN-SESSION RESPONSE", sidePadding, 7);
    context.textAlign = "right";
    const sharedTime = Math.min(leftRecording.video.currentTime, rightRecording.video.currentTime);
    context.fillText(formatTime(sharedTime), width - sidePadding, 7);
  };

  const renderFrame = () => {
    for (const recording of recordings) {
      if (currentMode === "raw") drawWaveform(recording);
      else drawBandProfile(recording);
    }
    drawBetween();
    animationFrame = window.requestAnimationFrame(renderFrame);
  };

  const startRendering = () => {
    if (animationFrame === null) animationFrame = window.requestAnimationFrame(renderFrame);
  };

  const stopRendering = () => {
    if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
    animationFrame = null;
  };

  const removeRecording = (recording) => {
    recording.video.pause();
    URL.revokeObjectURL(recording.videoUrl);
    recording.element.remove();
    const index = recordings.indexOf(recording);
    if (index !== -1) recordings.splice(index, 1);
    setMessage(recordings.length ? "Playback set updated." : "No recordings loaded.");
    updateControls();
  };

  const createRecordingElement = (pair, parsed, videoUrl) => {
    const element = document.createElement("article");
    element.className = "playback-session";

    const header = document.createElement("header");
    header.className = "playback-session-header";
    const name = document.createElement("span");
    name.className = "playback-session-name";
    name.textContent = pair.key;
    const remove = document.createElement("button");
    remove.className = "playback-remove";
    remove.type = "button";
    remove.textContent = "X";
    remove.title = `Remove ${pair.key}`;
    remove.setAttribute("aria-label", `Remove ${pair.key}`);
    header.append(name, remove);

    const pairLayout = document.createElement("div");
    pairLayout.className = "playback-pair";
    const cameraPane = document.createElement("div");
    cameraPane.className = "playback-camera";
    const cameraLabel = document.createElement("span");
    cameraLabel.className = "playback-label";
    cameraLabel.textContent = "CAMERA";
    const video = document.createElement("video");
    video.controls = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.src = videoUrl;
    cameraPane.append(cameraLabel, video);

    const eegPane = document.createElement("div");
    eegPane.className = "playback-eeg";
    const eegHeader = document.createElement("div");
    eegHeader.className = "playback-eeg-header";
    const eegLabel = document.createElement("span");
    eegLabel.className = "playback-label";
    eegLabel.textContent = "RAW EEG";
    const time = document.createElement("output");
    time.textContent = "00:00 / 00:00";
    eegHeader.append(eegLabel, time);
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-label", `Raw EEG waveform for ${pair.key}`);
    eegPane.append(eegHeader, canvas);
    pairLayout.append(cameraPane, eegPane);
    element.append(header, pairLayout);

    const bandSeries = calculateBandSeries(
      parsed.samples,
      parsed.expectedSampleRateHz || 512
    );
    const recording = {
      bandSeries,
      canvas,
      context: canvas.getContext("2d"),
      element,
      key: pair.key,
      label: eegLabel,
      normalizedBandSeries: normalizeBandSeries(bandSeries),
      samples: parsed.samples,
      time,
      video,
      videoUrl,
    };
    remove.addEventListener("click", () => removeRecording(recording));
    video.addEventListener("error", () => {
      setMessage(`Could not play ${pair.video.name}.`, true);
    });
    return recording;
  };

  const addFiles = async (fileList) => {
    const availableSlots = MAX_RECORDINGS - recordings.length;
    if (availableSlots <= 0) {
      setMessage(`A maximum of ${MAX_RECORDINGS} recordings can be loaded.`, true);
      return;
    }
    const paired = pairRecordingFiles(fileList);
    const existingKeys = new Set(recordings.map((recording) => recording.key));
    const candidates = paired.complete.filter((pair) => !existingKeys.has(pair.key));
    if (!candidates.length) {
      setMessage("Select matching camera WebM and raw EEG TXT files.", true);
      return;
    }

    let added = 0;
    for (const pair of candidates.slice(0, availableSlots)) {
      try {
        const parsed = parseRawEegText(await pair.raw.text());
        if (parsed.samples.length < 2) throw new Error(`${pair.raw.name} has no usable raw EEG samples.`);
        const videoUrl = URL.createObjectURL(pair.video);
        const recording = createRecordingElement(pair, parsed, videoUrl);
        recordings.push(recording);
        elements.list.append(recording.element);
        added += 1;
      } catch (error) {
        setMessage(error.message || String(error), true);
      }
    }
    if (added) {
      const omitted = candidates.length - added;
      setMessage(omitted > 0 ? `Loaded ${added}; ${omitted} exceeded the three-recording limit.` : `Loaded ${added} recording${added === 1 ? "" : "s"}.`);
      if (recordings.length >= 2) currentMode = "between";
    }
    updateControls();
  };

  const playAll = async () => {
    const sharedTime = recordings[0]?.video.currentTime || 0;
    recordings.forEach((recording) => {
      recording.video.currentTime = sharedTime;
    });
    const results = await Promise.allSettled(recordings.map((recording) => {
      if (recording.video.ended) recording.video.currentTime = 0;
      return recording.video.play();
    }));
    if (results.some((result) => result.status === "rejected")) {
      setMessage("One or more videos could not start.", true);
    } else {
      setMessage("Playing all loaded recordings.");
    }
  };

  const pauseAll = () => {
    recordings.forEach((recording) => recording.video.pause());
    setMessage("Playback paused.");
  };

  const restartAll = () => {
    recordings.forEach((recording) => {
      recording.video.pause();
      recording.video.currentTime = 0;
      if (currentMode === "raw") drawWaveform(recording);
      else drawBandProfile(recording);
    });
    drawBetween();
    setMessage("Playback returned to the start.");
  };

  const clearAll = () => {
    for (const recording of [...recordings]) removeRecording(recording);
    setMessage("No recordings loaded.");
  };

  const setMode = (mode) => {
    if (!["raw", "bands", "between"].includes(mode)) return;
    if (mode === "between" && recordings.length < 2) return;
    currentMode = mode;
    updateModeControls();
    if (mode === "between") {
      setMessage("Comparing the first two recordings on their shared 15-second timeline.");
    }
  };

  elements.add.addEventListener("click", () => elements.fileInput.click());
  elements.fileInput.addEventListener("change", async () => {
    await addFiles(elements.fileInput.files);
    elements.fileInput.value = "";
  });
  elements.play.addEventListener("click", playAll);
  elements.pause.addEventListener("click", pauseAll);
  elements.restart.addEventListener("click", restartAll);
  elements.clear.addEventListener("click", clearAll);
  elements.modeButtons.forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.playbackMode));
  });
  document.addEventListener("appviewchange", (event) => {
    if (event.detail.view === "playback") startRendering();
    else stopRendering();
  });

  if (document.body.dataset.view === "playback") startRendering();
  updateControls();

  return {
    getCount: () => recordings.length,
  };
})();
