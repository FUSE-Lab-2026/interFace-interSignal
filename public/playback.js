const TGAMPlayback = (() => {
  const {
    BAND_DEFINITIONS,
    MAX_RECORDINGS,
    RAW_DISPLAY_LIMIT,
    calculateFeatureSeries,
    formatTime,
    getPlaybackWindow,
    getSampleRange,
    getSeriesPoint,
    pairRecordingFiles,
    parsePacketNdjson,
    parseRawEegText,
  } = TGAMPlaybackCore;

  const elements = {
    add: document.querySelector("#add-playback"),
    cardButtons: Array.from(document.querySelectorAll("[data-playback-card]")),
    clear: document.querySelector("#clear-playback"),
    count: document.querySelector("#playback-count"),
    empty: document.querySelector("#playback-empty"),
    fileInput: document.querySelector("#playback-files"),
    list: document.querySelector("#playback-list"),
    message: document.querySelector("#playback-message"),
    pause: document.querySelector("#pause-playback"),
    play: document.querySelector("#play-all"),
    restart: document.querySelector("#restart-playback"),
  };

  const recordings = [];
  const loadingKeys = new Set();
  let animationFrame = null;
  let selectedCard = "bands";

  const setMessage = (message, isError = false) => {
    elements.message.textContent = message;
    elements.message.classList.toggle("is-error", isError);
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

  const drawUnavailable = (context, width, height, message = "--") => {
    context.fillStyle = "#8a8c89";
    context.font = "10px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(message, width / 2, height / 2);
  };

  const prepareFeatureCanvas = (recording) => {
    const { featureCanvas, featureContext } = recording;
    const { width, height } = resizeCanvas(featureCanvas, featureContext);
    featureContext.clearRect(0, 0, width, height);
    featureContext.fillStyle = "#f4f4f0";
    featureContext.fillRect(0, 0, width, height);
    return { context: featureContext, width, height };
  };

  const drawScore = (context, width, value) => {
    context.fillStyle = "#202221";
    context.font = "28px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    context.textAlign = "right";
    context.textBaseline = "top";
    context.fillText(Number.isFinite(value) ? String(Math.round(value)) : "--", width - 16, 14);
  };

  const drawBands = (recording, point) => {
    const { context, width, height } = prepareFeatureCanvas(recording);
    if (!point) {
      drawUnavailable(context, width, height, "2 S WARM-UP");
      return;
    }
    const insetX = 14;
    const top = 28;
    const bottom = 28;
    const graphHeight = height - top - bottom;
    const gap = 5;
    const barWidth = Math.max(8, (width - insetX * 2 - gap * 4) / 5);
    const logMinimum = Math.log10(0.1);
    const logRange = Math.log10(10000) - logMinimum;

    BAND_DEFINITIONS.forEach(([name], index) => {
      const value = Math.max(0, Number(point.powers[name]) || 0);
      const normalized = value <= 0.1
        ? 0
        : Math.max(0, Math.min(1, (Math.log10(value) - logMinimum) / logRange));
      const x = insetX + index * (barWidth + gap);
      context.fillStyle = "#deded8";
      context.fillRect(x, top, barWidth, graphHeight);
      context.fillStyle = `rgba(25, 27, 26, ${0.18 + normalized * 0.82})`;
      context.fillRect(x, top + graphHeight * (1 - normalized), barWidth, graphHeight * normalized);
      context.fillStyle = "#707371";
      context.font = "9px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
      context.textAlign = "center";
      context.textBaseline = "bottom";
      context.fillText(name[0].toUpperCase(), x + barWidth / 2, height - 8);
    });
  };

  const drawESense = (recording, point) => {
    const { context, width, height } = prepareFeatureCanvas(recording);
    if (!point || (!Number.isFinite(point.attention) && !Number.isFinite(point.meditation))) {
      drawUnavailable(context, width, height, recording.packetSeries.length ? "NO A / M DATA" : "NDJSON REQUIRED");
      return;
    }
    const values = [point.attention, point.meditation];
    const labels = ["A", "M"];
    const trackWidth = Math.min(52, width * 0.2);
    const gap = Math.min(42, width * 0.16);
    const totalWidth = trackWidth * 2 + gap;
    const startX = (width - totalWidth) / 2;
    const top = 42;
    const trackHeight = Math.max(40, height - 76);
    values.forEach((value, index) => {
      const available = Number.isFinite(value);
      const normalized = available ? Math.max(0, Math.min(1, value / 100)) : 0;
      const x = startX + index * (trackWidth + gap);
      context.fillStyle = "#202221";
      context.font = "18px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
      context.textAlign = "center";
      context.textBaseline = "top";
      context.fillText(available ? String(Math.round(value)) : "--", x + trackWidth / 2, 12);
      context.fillStyle = "#deded8";
      context.fillRect(x, top, trackWidth, trackHeight);
      context.fillStyle = `rgba(25, 27, 26, ${0.18 + normalized * 0.82})`;
      context.fillRect(x, top + trackHeight * (1 - normalized), trackWidth, trackHeight * normalized);
      context.fillStyle = "#707371";
      context.font = "10px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
      context.textBaseline = "bottom";
      context.fillText(labels[index], x + trackWidth / 2, height - 8);
    });
  };

  const drawMovement = (recording, value) => {
    const { context, width, height } = prepareFeatureCanvas(recording);
    if (!Number.isFinite(value)) {
      drawUnavailable(context, width, height);
      return;
    }
    drawScore(context, width, value);
    const normalized = Math.max(0, Math.min(1, value / 100));
    const layerCount = 8;
    const stackWidth = Math.min(150, width * 0.58);
    const layerHeight = Math.max(5, Math.min(14, (height - 76) / layerCount));
    const totalHeight = layerHeight * layerCount;
    const centerX = width / 2;
    const top = (height - totalHeight) / 2 + 18;
    const time = performance.now() / 1000;
    context.fillStyle = `rgba(25, 27, 26, ${0.18 + normalized * 0.82})`;
    for (let index = 0; index < layerCount; index += 1) {
      const shake = Math.sin(index * 2.1 + time * 8.3) + 0.4 * Math.sin(index * 4.7 - time * 13);
      const offset = shake / 1.4 * Math.min(38, width * 0.15) * normalized;
      context.fillRect(centerX - stackWidth / 2 + offset, top + index * layerHeight, stackWidth, layerHeight - 2);
    }
  };

  const drawEyes = (recording, value) => {
    const { context, width, height } = prepareFeatureCanvas(recording);
    if (!Number.isFinite(value)) {
      drawUnavailable(context, width, height);
      return;
    }
    drawScore(context, width, value);
    const normalized = Math.max(0, Math.min(1, value / 100));
    const maximumDiameter = Math.min(width * 0.58, height * 0.62);
    const diameter = maximumDiameter * Math.sqrt(normalized);
    context.fillStyle = "#deded8";
    context.beginPath();
    context.arc(width / 2, height / 2 + 12, maximumDiameter / 2, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = `rgba(25, 27, 26, ${0.18 + normalized * 0.82})`;
    context.beginPath();
    context.arc(width / 2, height / 2 + 12, diameter / 2, 0, Math.PI * 2);
    context.fill();
  };

  const drawFeature = (recording) => {
    const currentMs = Math.max(0, recording.video.currentTime * 1000);
    const featurePoint = getSeriesPoint(recording.featureSeries, currentMs);
    const packetPoint = getSeriesPoint(recording.packetSeries, currentMs);
    const reliable = !packetPoint || !Number.isFinite(packetPoint.signal) || packetPoint.signal === 0;
    recording.featureLabel.textContent = ({ bands: "03", esense: "04", movement: "05", eyes: "06" })[selectedCard];
    if (selectedCard === "esense") drawESense(recording, packetPoint);
    else if (selectedCard === "bands" && !reliable) {
      const { context, width, height } = prepareFeatureCanvas(recording);
      drawUnavailable(context, width, height);
    } else if (selectedCard === "bands") drawBands(recording, featurePoint);
    else if (selectedCard === "movement") drawMovement(recording, reliable ? featurePoint?.movement : null);
    else drawEyes(recording, reliable ? featurePoint?.eyesClosed : null);
  };

  const renderFrame = () => {
    for (const recording of recordings) {
      drawWaveform(recording);
      drawFeature(recording);
    }
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

  const createRecordingElement = (pair, parsed, packetSeries, videoUrl) => {
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

    const featurePane = document.createElement("div");
    featurePane.className = "playback-feature";
    const featureHeader = document.createElement("div");
    featureHeader.className = "playback-feature-header";
    const featureLabel = document.createElement("span");
    featureLabel.className = "playback-label";
    featureLabel.textContent = "03";
    featureHeader.append(featureLabel);
    const featureCanvas = document.createElement("canvas");
    featureCanvas.setAttribute("aria-label", `Selected signal card for ${pair.key}`);
    featurePane.append(featureHeader, featureCanvas);
    pairLayout.append(cameraPane, eegPane, featurePane);
    element.append(header, pairLayout);

    const recording = {
      canvas,
      context: canvas.getContext("2d"),
      element,
      featureCanvas,
      featureContext: featureCanvas.getContext("2d"),
      featureLabel,
      featureSeries: calculateFeatureSeries(parsed.samples, parsed.expectedSampleRateHz || 512),
      key: pair.key,
      packetSeries,
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
    const candidates = paired.complete.filter((pair) => {
      return !existingKeys.has(pair.key) && !loadingKeys.has(pair.key);
    });
    if (!candidates.length) {
      setMessage(
        paired.complete.length ? "That recording is already loaded or loading." : "Select matching camera WebM and raw EEG TXT files.",
        !paired.complete.length
      );
      return;
    }

    let added = 0;
    for (const pair of candidates.slice(0, availableSlots)) {
      loadingKeys.add(pair.key);
      try {
        const parsed = parseRawEegText(await pair.raw.text());
        if (parsed.samples.length < 2) throw new Error(`${pair.raw.name} has no usable raw EEG samples.`);
        const packetSeries = pair.packets ? parsePacketNdjson(await pair.packets.text()) : [];
        const videoUrl = URL.createObjectURL(pair.video);
        const recording = createRecordingElement(pair, parsed, packetSeries, videoUrl);
        recordings.push(recording);
        elements.list.append(recording.element);
        added += 1;
      } catch (error) {
        setMessage(error.message || String(error), true);
      } finally {
        loadingKeys.delete(pair.key);
      }
    }
    if (added) {
      const omitted = candidates.length - added;
      setMessage(omitted > 0 ? `Loaded ${added}; ${omitted} exceeded the three-recording limit.` : `Loaded ${added} recording${added === 1 ? "" : "s"}.`);
    }
    updateControls();
  };

  const playAll = async () => {
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
      drawWaveform(recording);
      drawFeature(recording);
    });
    setMessage("Playback returned to the start.");
  };

  const clearAll = () => {
    for (const recording of [...recordings]) removeRecording(recording);
    setMessage("No recordings loaded.");
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
  elements.cardButtons.forEach((button) => {
    button.addEventListener("click", () => {
      selectedCard = button.dataset.playbackCard;
      elements.cardButtons.forEach((item) => {
        const active = item === button;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      recordings.forEach(drawFeature);
    });
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
