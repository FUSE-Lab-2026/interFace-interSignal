const TGAMPlayback = (() => {
  const {
    MAX_RECORDINGS,
    RAW_DISPLAY_LIMIT,
    formatTime,
    getPlaybackWindow,
    getSampleRange,
    pairRecordingFiles,
    parseRawEegText,
  } = TGAMPlaybackCore;

  const elements = {
    add: document.querySelector("#add-playback"),
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
  let animationFrame = null;

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

  const renderFrame = () => {
    for (const recording of recordings) drawWaveform(recording);
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

    const recording = {
      canvas,
      context: canvas.getContext("2d"),
      element,
      key: pair.key,
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
