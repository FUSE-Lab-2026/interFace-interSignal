const TGAMSessionRecorder = (() => {
  const { CAMERA_REQUEST, SERIAL, VIDEO } = TGAMRecorderCore;
  const FLUSH_THRESHOLD = 65536;
  const CAMERA_START_TIMEOUT_MS = 8000;
  const RECORDING_DURATION_MS = 15000;
  const COUNTDOWN_SECONDS = 3;

  const elements = {
    cameraPreview: document.querySelector("#camera-preview"),
    cameraPlaceholder: document.querySelector("#camera-placeholder"),
    captureCanvas: document.querySelector("#camera-capture"),
    chooseFolder: document.querySelector("#choose-folder"),
    chooseStimulus: document.querySelector("#choose-stimulus"),
    enableCamera: document.querySelector("#enable-camera"),
    start15: document.querySelector("#start-recording-15"),
    stop: document.querySelector("#stop-recording"),
    state: document.querySelector("#record-state"),
    elapsed: document.querySelector("#record-elapsed"),
    packets: document.querySelector("#record-packets"),
    raw: document.querySelector("#record-raw"),
    folder: document.querySelector("#record-folder"),
    message: document.querySelector("#record-message"),
    packetsFile: document.querySelector("#packets-file"),
    rawFile: document.querySelector("#raw-file"),
    videoFile: document.querySelector("#video-file"),
    manifestFile: document.querySelector("#manifest-file"),
    stimulusCountdown: document.querySelector("#record-countdown"),
    stimulusFile: document.querySelector("#stimulus-file"),
    stimulusMeta: document.querySelector("#stimulus-meta"),
    stimulusPanel: document.querySelector("#stimulus-panel"),
    stimulusPlaceholder: document.querySelector("#stimulus-placeholder"),
    stimulusVideo: document.querySelector("#imitation-video"),
  };

  let directoryHandle = null;
  let cameraStream = null;
  let cameraStarting = false;
  let captureStream = null;
  let cameraDrawTimer = null;
  let mediaRecorder = null;
  let mediaStopPromise = null;
  let frameUnsubscribe = null;
  let flushTimer = null;
  let statsTimer = null;
  let autoStopTimer = null;
  let countdownTimer = null;
  let state = "idle";
  let session = null;
  let queues = null;
  let packetBuffer = "";
  let rawBuffer = "";
  let stopPromise = null;
  let stimulusSelection = null;
  let writeFailure = null;

  const createWriteQueue = (writable) => {
    let chain = Promise.resolve();
    let closed = false;
    return {
      write(data) {
        if (closed) return Promise.reject(new Error("File writer is closed"));
        chain = chain.then(() => writable.write(data));
        return chain;
      },
      async close() {
        if (closed) return;
        closed = true;
        try {
          await chain;
        } finally {
          await writable.close();
        }
      },
      async abort() {
        if (closed) return;
        closed = true;
        try {
          await writable.abort();
        } catch (_) {
          // The browser may already have closed a failed writer.
        }
      },
    };
  };

  const setMessage = (message, isError = false) => {
    elements.message.textContent = message;
    elements.message.classList.toggle("is-error", isError);
  };

  const setCameraStatus = (message, hidden = false) => {
    elements.cameraPlaceholder.textContent = message;
    elements.cameraPlaceholder.hidden = hidden;
  };

  const describeCameraError = (error) => {
    const messages = {
      NotAllowedError: "Camera permission was denied. Allow this site in Chrome and enable Chrome in macOS Privacy & Security > Camera, then retry.",
      NotFoundError: "No webcam was found.",
      NotReadableError: "The webcam is unavailable. Close other camera apps and check macOS Camera privacy settings.",
      OverconstrainedError: "The webcam could not provide a compatible video mode.",
      SecurityError: "Camera access is blocked by the browser security policy.",
      AbortError: "The webcam did not finish starting. Retry Camera.",
    };
    return messages[error?.name] || error?.message || String(error);
  };

  const setState = (nextState) => {
    state = nextState;
    elements.state.textContent = nextState.toUpperCase();
    updateControls();
  };

  const cameraReady = () => {
    return Boolean(cameraStream?.getVideoTracks().some((track) => track.readyState === "live"));
  };

  const stimulusReady = () => {
    return Boolean(
      stimulusSelection &&
      Number.isFinite(elements.stimulusVideo.duration) &&
      elements.stimulusVideo.duration >= RECORDING_DURATION_MS / 1000
    );
  };

  const updateControls = () => {
    const busy = state === "preparing" || state === "countdown" || state === "recording" || state === "stopping";
    const ready = directoryHandle && cameraReady() && stimulusReady() && TGAMSerialSource.isConnected();
    elements.chooseFolder.disabled = busy || !("showDirectoryPicker" in window);
    elements.chooseStimulus.disabled = busy;
    elements.enableCamera.disabled = busy || cameraStarting || !navigator.mediaDevices?.getUserMedia;
    elements.enableCamera.textContent = cameraStarting
      ? "Starting Camera..."
      : cameraReady() ? "Disable Camera" : "Enable Camera";
    const startDisabled = busy || !ready || typeof MediaRecorder === "undefined";
    elements.start15.disabled = startDisabled;
    elements.stop.disabled = state !== "recording";
  };

  const formatRemaining = (milliseconds) => {
    const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  };

  const updateStatus = () => {
    updateControls();
    if (state === "recording" && session) {
      const elapsedMs = performance.now() - session.startedPerformanceMs;
      elements.elapsed.textContent = formatRemaining(session.plannedDurationMs - elapsedMs);
      if (!TGAMSerialSource.isConnected() && !stopPromise) {
        setMessage("TGAM disconnected. Finalizing the current files.", true);
        stopRecording("serial_disconnected");
      }
    }
  };

  const chooseFolder = async () => {
    if (!("showDirectoryPicker" in window)) {
      setMessage("Folder recording requires desktop Chrome/Chromium.", true);
      return;
    }
    try {
      directoryHandle = await window.showDirectoryPicker({
        id: "interface-intersignal-recordings",
        mode: "readwrite",
      });
      elements.folder.textContent = directoryHandle.name;
      elements.chooseFolder.textContent = "Folder Selected";
      elements.chooseFolder.title = directoryHandle.name;
      setMessage("Recording folder selected.");
    } catch (error) {
      if (error.name !== "AbortError") setMessage(error.message || String(error), true);
    }
    updateControls();
  };

  const revokeStimulusUrl = () => {
    if (
      !stimulusSelection?.url ||
      typeof URL === "undefined" ||
      typeof URL.revokeObjectURL !== "function"
    ) return;
    URL.revokeObjectURL(stimulusSelection.url);
  };

  const resetStimulus = () => {
    elements.stimulusVideo.pause();
    revokeStimulusUrl();
    stimulusSelection = null;
    elements.stimulusVideo.removeAttribute("src");
    elements.stimulusVideo.load();
    elements.stimulusPlaceholder.hidden = false;
    elements.stimulusMeta.textContent = "NO VIDEO";
  };

  const waitForStimulusMetadata = () => {
    if (Number.isFinite(elements.stimulusVideo.duration)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const handleLoaded = () => resolve();
      const handleError = () => reject(new Error("The selected imitation video could not be loaded."));
      elements.stimulusVideo.addEventListener("loadedmetadata", handleLoaded, { once: true });
      elements.stimulusVideo.addEventListener("error", handleError, { once: true });
    });
  };

  const selectStimulus = async (file) => {
    if (!file) return;
    resetStimulus();
    try {
      const url = URL.createObjectURL(file);
      stimulusSelection = {
        file,
        url,
        durationSeconds: null,
      };
      elements.stimulusVideo.src = url;
      elements.stimulusVideo.load();
      await waitForStimulusMetadata();
      const durationSeconds = elements.stimulusVideo.duration;
      if (!Number.isFinite(durationSeconds) || durationSeconds < RECORDING_DURATION_MS / 1000) {
        throw new Error("Choose a video that is at least 15 seconds long.");
      }
      stimulusSelection.durationSeconds = durationSeconds;
      elements.stimulusVideo.currentTime = 0;
      elements.stimulusPlaceholder.hidden = true;
      elements.stimulusMeta.textContent = `${file.name} | ${durationSeconds.toFixed(1)} s`;
      setMessage("Imitation video ready.");
    } catch (error) {
      resetStimulus();
      setMessage(error.message || String(error), true);
    }
    updateControls();
  };

  const stopCamera = () => {
    if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
    elements.cameraPreview.srcObject = null;
    setCameraStatus("CAMERA OFF");
    updateControls();
  };

  const waitForCameraFrame = () => {
    if (elements.cameraPreview.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        callback(value);
      };
      const timeout = window.setTimeout(() => {
        const error = new Error("The webcam connected but did not provide a video frame.");
        error.name = "AbortError";
        finish(reject, error);
      }, CAMERA_START_TIMEOUT_MS);
      elements.cameraPreview.addEventListener("loadeddata", () => finish(resolve), { once: true });
      elements.cameraPreview.addEventListener("error", () => {
        finish(reject, new Error("The webcam preview could not be displayed."));
      }, { once: true });
    });
  };

  const enableCamera = async () => {
    if (cameraStarting) return;
    if (cameraReady()) {
      stopCamera();
      setMessage("Camera disabled.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessage("Camera capture is unavailable in this browser.", true);
      setCameraStatus("CAMERA UNAVAILABLE");
      return;
    }
    if (window.isSecureContext === false) {
      setMessage("Camera access requires localhost or HTTPS.", true);
      setCameraStatus("HTTPS REQUIRED");
      return;
    }

    try {
      cameraStarting = true;
      updateControls();
      setCameraStatus("REQUESTING CAMERA");
      setMessage("Waiting for browser and macOS camera permission...");
      cameraStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: { ideal: CAMERA_REQUEST.width },
          height: { ideal: CAMERA_REQUEST.height },
          frameRate: {
            ideal: CAMERA_REQUEST.framesPerSecond,
            max: CAMERA_REQUEST.maximumFramesPerSecond,
          },
          facingMode: { ideal: "user" },
        },
      });
      const [track] = cameraStream.getVideoTracks();
      track.addEventListener("ended", () => {
        cameraStream = null;
        elements.cameraPreview.srcObject = null;
        setCameraStatus("CAMERA STOPPED");
        if (state === "recording") {
          setMessage("Camera stopped. Finalizing the current files.", true);
          stopRecording("camera_ended");
        }
        updateControls();
      }, { once: true });
      elements.cameraPreview.srcObject = cameraStream;
      await elements.cameraPreview.play();
      await waitForCameraFrame();
      setCameraStatus("CAMERA READY", true);
      setMessage("Camera ready. Video will be downsampled to 134 x 100.");
    } catch (error) {
      stopCamera();
      const message = describeCameraError(error);
      const status = error?.name === "NotAllowedError" ? "CAMERA BLOCKED" : "CAMERA ERROR";
      setCameraStatus(status);
      setMessage(message, true);
    } finally {
      cameraStarting = false;
    }
    updateControls();
  };

  const openQueue = async (fileName) => {
    const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    return createWriteQueue(writable);
  };

  const queueData = (name, data) => {
    if (!queues?.[name] || !data) return;
    queues[name].write(data).catch((error) => {
      if (writeFailure) return;
      writeFailure = error;
      setMessage(`File write failed: ${error.message || error}`, true);
      if (state === "recording") stopRecording("write_error");
    });
  };

  const flushTextBuffers = () => {
    if (packetBuffer) {
      const content = packetBuffer;
      packetBuffer = "";
      queueData("packets", content);
    }
    if (rawBuffer) {
      const content = rawBuffer;
      rawBuffer = "";
      queueData("raw", content);
    }
  };

  const appendNdjson = (record) => {
    packetBuffer += `${JSON.stringify(record)}\n`;
    if (packetBuffer.length >= FLUSH_THRESHOLD) flushTextBuffers();
  };

  const recordFrame = (frame) => {
    if (state !== "recording" || !session || !TGAMSerialSource.isConnected()) return;
    const performanceMs = performance.now();
    const unixMs = Date.now();
    const record = TGAMRecorderCore.createFrameRecord(frame, {
      frameIndex: session.frameCount,
      unixMs,
      performanceMs,
      startedPerformanceMs: session.startedPerformanceMs,
    });
    appendNdjson(record);
    session.frameCount += 1;
    elements.packets.textContent = String(session.frameCount);

    if (Number.isFinite(frame.packet.raw)) {
      const elapsedMs = performanceMs - session.startedPerformanceMs;
      rawBuffer += TGAMRecorderCore.createRawRow(
        session.rawSampleCount,
        elapsedMs,
        unixMs,
        frame.packet.raw
      );
      session.rawSampleCount += 1;
      elements.raw.textContent = String(session.rawSampleCount);
      if (rawBuffer.length >= FLUSH_THRESHOLD) flushTextBuffers();
    }
  };

  const drawCameraFrame = () => {
    if (!cameraReady() || elements.cameraPreview.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    const context = elements.captureCanvas.getContext("2d", { alpha: false });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "low";
    context.drawImage(elements.cameraPreview, 0, 0, VIDEO.width, VIDEO.height);
  };

  const createMediaRecorder = () => {
    drawCameraFrame();
    cameraDrawTimer = window.setInterval(drawCameraFrame, 1000 / VIDEO.framesPerSecond);
    captureStream = elements.captureCanvas.captureStream(VIDEO.framesPerSecond);
    const mimeType = TGAMRecorderCore.selectVideoMimeType((type) => MediaRecorder.isTypeSupported(type));
    const options = { videoBitsPerSecond: VIDEO.bitsPerSecond };
    if (mimeType) options.mimeType = mimeType;
    mediaRecorder = new MediaRecorder(captureStream, options);
    session.videoMimeType = mediaRecorder.mimeType || mimeType || "video/webm";
    session.actualVideoBitsPerSecond = mediaRecorder.videoBitsPerSecond;

    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (!event.data?.size) return;
      session.videoBytes += event.data.size;
      queueData("video", event.data);
    });
    mediaRecorder.addEventListener("error", (event) => {
      const error = event.error || new Error("MediaRecorder failed");
      setMessage(error.message || String(error), true);
      if (state === "recording") stopRecording("video_error");
    });
    mediaStopPromise = new Promise((resolve) => {
      mediaRecorder.addEventListener("stop", resolve, { once: true });
    });
  };

  const abortQueues = async () => {
    if (!queues) return;
    await Promise.allSettled(Object.values(queues).map((queue) => queue.abort()));
    queues = null;
  };

  const cleanupCaptureStream = () => {
    if (cameraDrawTimer) window.clearInterval(cameraDrawTimer);
    cameraDrawTimer = null;
    if (captureStream) captureStream.getTracks().forEach((track) => track.stop());
    captureStream = null;
    mediaRecorder = null;
    mediaStopPromise = null;
  };

  const stimulusMetadata = () => ({
    name: stimulusSelection.file.name,
    sizeBytes: stimulusSelection.file.size ?? null,
    lastModifiedUnixMs: stimulusSelection.file.lastModified ?? null,
    sourceDurationMs: Math.round(stimulusSelection.durationSeconds * 1000),
    playbackStartMs: 0,
    playbackDurationMs: RECORDING_DURATION_MS,
    muted: true,
  });

  const failPreparedRecording = async (error) => {
    if (countdownTimer) window.clearTimeout(countdownTimer);
    countdownTimer = null;
    elements.stimulusCountdown.hidden = true;
    elements.stimulusVideo.pause();
    if (frameUnsubscribe) frameUnsubscribe();
    frameUnsubscribe = null;
    if (mediaRecorder?.state === "recording") mediaRecorder.stop();
    if (autoStopTimer) window.clearTimeout(autoStopTimer);
    autoStopTimer = null;
    cleanupCaptureStream();
    await abortQueues();
    session = null;
    setState("error");
    setMessage(error.message || String(error), true);
  };

  const beginSynchronizedCapture = async () => {
    countdownTimer = null;
    elements.stimulusCountdown.hidden = true;
    try {
      if (!cameraReady()) throw new Error("Camera stopped during the countdown");
      if (!TGAMSerialSource.isConnected()) throw new Error("TGAM disconnected during the countdown");
      if (!stimulusReady()) throw new Error("Imitation video became unavailable");

      elements.stimulusVideo.currentTime = 0;
      session.startedUnixMs = Date.now();
      session.startedPerformanceMs = performance.now();
      session.initialStats = TGAMSerialSource.getStats();
      queueData("raw", TGAMRecorderCore.createRawHeader(session));
      appendNdjson({
        event: "recording_start",
        format_version: 1,
        session_id: session.sessionId,
        serial_session_id: session.serialSessionId,
        unix_ms: session.startedUnixMs,
        elapsed_ms: 0,
        files: session.files,
        serial: SERIAL,
        video: VIDEO,
        stimulus: session.stimulus,
        countdown_ms: COUNTDOWN_SECONDS * 1000,
        planned_duration_ms: session.plannedDurationMs,
      });
      flushTextBuffers();
      frameUnsubscribe = TGAMSerialSource.onFrame(recordFrame);
      mediaRecorder.start(1000);
      const playbackPromise = elements.stimulusVideo.play();
      setState("recording");
      setMessage("Recording 15-second imitation response.");
      autoStopTimer = window.setTimeout(
        () => stopRecording("duration_complete"),
        session.plannedDurationMs
      );
      flushTimer = window.setInterval(flushTextBuffers, 1000);
      statsTimer = window.setInterval(() => {
        if (state !== "recording" || !session) return;
        appendNdjson({
          event: "transport_stats",
          unix_ms: Date.now(),
          elapsed_ms: Math.round(performance.now() - session.startedPerformanceMs),
          stimulus_time_ms: Math.round(elements.stimulusVideo.currentTime * 1000),
          ...TGAMSerialSource.getStats(),
        });
      }, 1000);
      await playbackPromise;
    } catch (error) {
      await failPreparedRecording(error);
    }
  };

  const startCountdown = () => {
    let remaining = COUNTDOWN_SECONDS;
    elements.stimulusPanel.scrollIntoView({ block: "center" });
    elements.stimulusVideo.pause();
    elements.stimulusVideo.currentTime = 0;
    elements.stimulusCountdown.hidden = false;
    elements.stimulusCountdown.textContent = String(remaining);
    setState("countdown");
    setMessage("Recording begins after the countdown.");

    const advance = () => {
      remaining -= 1;
      if (remaining <= 0) {
        beginSynchronizedCapture();
        return;
      }
      elements.stimulusCountdown.textContent = String(remaining);
      countdownTimer = window.setTimeout(advance, 1000);
    };
    countdownTimer = window.setTimeout(advance, 1000);
  };

  const startRecording = async () => {
    if (["preparing", "countdown", "recording", "stopping"].includes(state)) return;
    if (!TGAMSerialSource.isConnected()) {
      setMessage("Connect TGAM before recording.", true);
      return;
    }
    if (!directoryHandle) {
      setMessage("Choose a recording folder first.", true);
      return;
    }
    if (!cameraReady()) {
      setMessage("Enable the camera before recording.", true);
      return;
    }
    if (!stimulusReady()) {
      setMessage("Choose an imitation video that is at least 15 seconds long.", true);
      return;
    }
    if (typeof MediaRecorder === "undefined" || !elements.captureCanvas.captureStream) {
      setMessage("Video recording is unavailable in this browser.", true);
      return;
    }
    setState("preparing");
    setMessage("Preparing synchronized output files...");
    packetBuffer = "";
    rawBuffer = "";
    writeFailure = null;
    elements.packets.textContent = "0";
    elements.raw.textContent = "0";
    elements.elapsed.textContent = formatRemaining(RECORDING_DURATION_MS);

    const startedAt = new Date();
    const baseName = TGAMRecorderCore.createBaseName(startedAt);
    const files = TGAMRecorderCore.createFileNames(baseName);
    session = {
      sessionId: `${baseName}-${crypto.randomUUID().slice(0, 8)}`,
      files,
      startedUnixMs: null,
      startedPerformanceMs: null,
      serialSessionId: TGAMSerialSource.getSessionId(),
      frameCount: 0,
      rawSampleCount: 0,
      videoBytes: 0,
      videoMimeType: "",
      actualVideoBitsPerSecond: 0,
      plannedDurationMs: RECORDING_DURATION_MS,
      stimulus: stimulusMetadata(),
      initialStats: null,
      cameraInput: cameraInputSettings(),
    };

    elements.packetsFile.textContent = files.packets;
    elements.rawFile.textContent = files.raw;
    elements.videoFile.textContent = files.video;
    elements.manifestFile.textContent = files.manifest;

    try {
      queues = {
        packets: await openQueue(files.packets),
        raw: await openQueue(files.raw),
        video: await openQueue(files.video),
      };
      createMediaRecorder();
      if (!cameraReady()) throw new Error("Camera stopped while preparing files");
      if (!TGAMSerialSource.isConnected()) throw new Error("TGAM disconnected while preparing files");
      startCountdown();
    } catch (error) {
      await failPreparedRecording(error);
    }
  };

  const cameraInputSettings = () => {
    const settings = cameraStream?.getVideoTracks()[0]?.getSettings() || {};
    return {
      width: settings.width ?? null,
      height: settings.height ?? null,
      frameRate: settings.frameRate ?? null,
      aspectRatio: settings.aspectRatio ?? null,
      facingMode: settings.facingMode ?? null,
    };
  };

  const writeManifest = async (manifest) => {
    const fileHandle = await directoryHandle.getFileHandle(manifest.files.manifest, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(`${JSON.stringify(manifest, null, 2)}\n`);
    await writable.close();
  };

  const performStop = async (reason) => {
    setState("stopping");
    if (autoStopTimer) window.clearTimeout(autoStopTimer);
    autoStopTimer = null;
    if (frameUnsubscribe) frameUnsubscribe();
    frameUnsubscribe = null;
    if (flushTimer) window.clearInterval(flushTimer);
    if (statsTimer) window.clearInterval(statsTimer);
    flushTimer = null;
    statsTimer = null;
    elements.stimulusVideo.pause();

    const stoppedUnixMs = Date.now();
    const durationMs = Math.max(0, Math.round(performance.now() - session.startedPerformanceMs));
    appendNdjson({
      event: "recording_stop",
      reason,
      unix_ms: stoppedUnixMs,
      elapsed_ms: durationMs,
      stimulus_time_ms: Math.round(elements.stimulusVideo.currentTime * 1000),
      frame_count: session.frameCount,
      raw_sample_count: session.rawSampleCount,
    });
    flushTextBuffers();

    if (mediaRecorder?.state !== "inactive") {
      mediaRecorder.stop();
      await mediaStopPromise;
    }
    const recorderDetails = {
      mimeType: session.videoMimeType,
      requestedBitsPerSecond: VIDEO.bitsPerSecond,
      actualBitsPerSecond: session.actualVideoBitsPerSecond,
      bytes: session.videoBytes,
    };
    cleanupCaptureStream();

    const closingResults = await Promise.allSettled([
      queues.packets.close(),
      queues.raw.close(),
      queues.video.close(),
    ]);
    const closeFailure = closingResults.find((result) => result.status === "rejected");
    queues = null;
    if (closeFailure || writeFailure) throw closeFailure?.reason || writeFailure;

    const manifest = {
      formatVersion: 1,
      sessionId: session.sessionId,
      source: "browser_web_serial",
      startedUnixMs: session.startedUnixMs,
      stoppedUnixMs,
      durationMs,
      plannedDurationMs: session.plannedDurationMs,
      stopReason: reason,
      serialSessionId: session.serialSessionId,
      serial: SERIAL,
      stimulus: session.stimulus,
      video: {
        target: VIDEO,
        input: session.cameraInput,
        recorder: recorderDetails,
      },
      files: session.files,
      totals: {
        frames: session.frameCount,
        rawSamples: session.rawSampleCount,
      },
      parserStatsAtStart: session.initialStats,
      parserStatsAtStop: TGAMSerialSource.getStats(),
      packetFormat: {
        container: "ndjson",
        frameEncoding: "lowercase hexadecimal",
        decodedPacketsOnly: false,
        checksumValidFramesOnly: true,
      },
      rawFormat: {
        container: "tab-separated text",
        columns: ["sample_index", "elapsed_ms", "unix_ms", "raw"],
        preprocessing: "none",
      },
    };
    await writeManifest(manifest);
    elements.elapsed.textContent = formatRemaining(session.plannedDurationMs - durationMs);
    setState("saved");
    setMessage(`Saved ${session.frameCount} TGAM frames and ${session.rawSampleCount} raw samples.`);
  };

  const stopRecording = (reason = "user") => {
    if (stopPromise) return stopPromise;
    if (state !== "recording" || !session) return Promise.resolve();
    stopPromise = performStop(reason)
      .catch(async (error) => {
        cleanupCaptureStream();
        if (queues) await abortQueues();
        setState("error");
        setMessage(`Could not finalize recording: ${error.message || error}`, true);
      })
      .finally(() => {
        stopPromise = null;
        session = null;
        updateControls();
      });
    return stopPromise;
  };

  elements.chooseFolder.addEventListener("click", chooseFolder);
  elements.chooseStimulus.addEventListener("click", () => elements.stimulusFile.click());
  elements.stimulusFile.addEventListener("change", async () => {
    await selectStimulus(elements.stimulusFile.files?.[0]);
    elements.stimulusFile.value = "";
  });
  elements.enableCamera.addEventListener("click", enableCamera);
  elements.start15.addEventListener("click", startRecording);
  elements.stop.addEventListener("click", () => stopRecording("user"));

  window.addEventListener("beforeunload", (event) => {
    if (!["preparing", "countdown", "recording", "stopping"].includes(state)) return;
    event.preventDefault();
    event.returnValue = "";
  });

  window.setInterval(updateStatus, 250);
  if (!navigator.mediaDevices?.getUserMedia) {
    setCameraStatus(window.isSecureContext === false ? "HTTPS REQUIRED" : "CAMERA UNAVAILABLE");
    setMessage(
      window.isSecureContext === false
        ? "Camera access requires localhost or HTTPS."
        : "Camera capture is unavailable in this browser.",
      true
    );
  }
  updateControls();

  return {
    getState: () => state,
    isRecording: () => state === "recording",
    stop: stopRecording,
  };
})();
