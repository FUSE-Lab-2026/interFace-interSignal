const TGAMSessionRecorder = (() => {
  const { SERIAL, VIDEO } = TGAMRecorderCore;
  const FLUSH_THRESHOLD = 65536;

  const elements = {
    cameraPreview: document.querySelector("#camera-preview"),
    cameraPlaceholder: document.querySelector("#camera-placeholder"),
    captureCanvas: document.querySelector("#camera-capture"),
    chooseFolder: document.querySelector("#choose-folder"),
    enableCamera: document.querySelector("#enable-camera"),
    start: document.querySelector("#start-recording"),
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
  };

  let directoryHandle = null;
  let cameraStream = null;
  let captureStream = null;
  let cameraDrawTimer = null;
  let mediaRecorder = null;
  let mediaStopPromise = null;
  let frameUnsubscribe = null;
  let flushTimer = null;
  let statsTimer = null;
  let state = "idle";
  let session = null;
  let queues = null;
  let packetBuffer = "";
  let rawBuffer = "";
  let stopPromise = null;
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

  const setState = (nextState) => {
    state = nextState;
    elements.state.textContent = nextState.toUpperCase();
    updateControls();
  };

  const cameraReady = () => {
    return Boolean(cameraStream?.getVideoTracks().some((track) => track.readyState === "live"));
  };

  const updateControls = () => {
    const busy = state === "preparing" || state === "recording" || state === "stopping";
    const ready = directoryHandle && cameraReady() && TGAMSerialSource.isConnected();
    elements.chooseFolder.disabled = busy || !("showDirectoryPicker" in window);
    elements.enableCamera.disabled = busy || !navigator.mediaDevices?.getUserMedia;
    elements.enableCamera.textContent = cameraReady() ? "Disable Camera" : "Enable Camera";
    elements.start.disabled = busy || !ready || typeof MediaRecorder === "undefined";
    elements.stop.disabled = state !== "recording";
  };

  const formatElapsed = (milliseconds) => {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  };

  const updateStatus = () => {
    updateControls();
    if (state === "recording" && session) {
      elements.elapsed.textContent = formatElapsed(performance.now() - session.startedPerformanceMs);
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
      setMessage("Recording folder selected.");
    } catch (error) {
      if (error.name !== "AbortError") setMessage(error.message || String(error), true);
    }
    updateControls();
  };

  const stopCamera = () => {
    if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
    elements.cameraPreview.srcObject = null;
    elements.cameraPlaceholder.hidden = false;
    updateControls();
  };

  const enableCamera = async () => {
    if (cameraReady()) {
      stopCamera();
      setMessage("Camera disabled.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessage("Camera capture is unavailable in this browser.", true);
      return;
    }

    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: { ideal: VIDEO.width },
          height: { ideal: VIDEO.height },
          frameRate: { ideal: VIDEO.framesPerSecond, max: 15 },
          aspectRatio: { ideal: VIDEO.width / VIDEO.height },
          facingMode: "user",
        },
      });
      const [track] = cameraStream.getVideoTracks();
      track.addEventListener("ended", () => {
        cameraStream = null;
        elements.cameraPreview.srcObject = null;
        elements.cameraPlaceholder.hidden = false;
        if (state === "recording") {
          setMessage("Camera stopped. Finalizing the current files.", true);
          stopRecording("camera_ended");
        }
        updateControls();
      }, { once: true });
      elements.cameraPreview.srcObject = cameraStream;
      await elements.cameraPreview.play();
      elements.cameraPlaceholder.hidden = true;
      setMessage("Camera ready at low-resolution recording settings.");
    } catch (error) {
      stopCamera();
      setMessage(error.message || String(error), true);
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

  const startRecording = async () => {
    if (state === "recording" || state === "stopping") return;
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
    elements.elapsed.textContent = "00:00";

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
        files,
        serial: SERIAL,
        video: VIDEO,
      });
      flushTextBuffers();
      frameUnsubscribe = TGAMSerialSource.onFrame(recordFrame);
      mediaRecorder.start(1000);
      setState("recording");
      setMessage("Recording TGAM frames, raw EEG, and 240p camera video.");
      flushTimer = window.setInterval(flushTextBuffers, 1000);
      statsTimer = window.setInterval(() => {
        if (state !== "recording" || !session) return;
        appendNdjson({
          event: "transport_stats",
          unix_ms: Date.now(),
          elapsed_ms: Math.round(performance.now() - session.startedPerformanceMs),
          ...TGAMSerialSource.getStats(),
        });
      }, 1000);
    } catch (error) {
      if (frameUnsubscribe) frameUnsubscribe();
      frameUnsubscribe = null;
      if (mediaRecorder?.state === "recording") mediaRecorder.stop();
      cleanupCaptureStream();
      await abortQueues();
      session = null;
      setState("error");
      setMessage(error.message || String(error), true);
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
    if (frameUnsubscribe) frameUnsubscribe();
    frameUnsubscribe = null;
    if (flushTimer) window.clearInterval(flushTimer);
    if (statsTimer) window.clearInterval(statsTimer);
    flushTimer = null;
    statsTimer = null;

    const stoppedUnixMs = Date.now();
    const durationMs = Math.max(0, Math.round(performance.now() - session.startedPerformanceMs));
    appendNdjson({
      event: "recording_stop",
      reason,
      unix_ms: stoppedUnixMs,
      elapsed_ms: durationMs,
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
      stopReason: reason,
      serialSessionId: session.serialSessionId,
      serial: SERIAL,
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
    elements.elapsed.textContent = formatElapsed(durationMs);
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
  elements.enableCamera.addEventListener("click", enableCamera);
  elements.start.addEventListener("click", startRecording);
  elements.stop.addEventListener("click", () => stopRecording("user"));

  window.addEventListener("beforeunload", (event) => {
    if (state !== "recording" && state !== "stopping") return;
    event.preventDefault();
    event.returnValue = "";
  });

  window.setInterval(updateStatus, 250);
  updateControls();

  return {
    getState: () => state,
    isRecording: () => state === "recording",
    stop: stopRecording,
  };
})();
