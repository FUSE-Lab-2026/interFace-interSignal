const TGAMSessionRecorder = (() => {
  const { CAMERA_REQUEST, SERIAL, VIDEO } = TGAMRecorderCore;
  const FLUSH_THRESHOLD = 65536;
  const CAMERA_START_TIMEOUT_MS = 8000;

  const elements = {
    cameraPreview: document.querySelector("#camera-preview"),
    cameraPlaceholder: document.querySelector("#camera-placeholder"),
    captureCanvas: document.querySelector("#camera-capture"),
    chooseFolder: document.querySelector("#choose-folder"),
    enableCamera: document.querySelector("#enable-camera"),
    start30: document.querySelector("#start-recording-30"),
    start60: document.querySelector("#start-recording-60"),
    stop: document.querySelector("#stop-recording"),
    state: document.querySelector("#record-state"),
    elapsed: document.querySelector("#record-elapsed"),
    packets: document.querySelector("#record-packets"),
    raw: document.querySelector("#record-raw"),
    folder: document.querySelector("#record-folder"),
    message: document.querySelector("#record-message"),
    archiveFile: document.querySelector("#archive-file"),
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
        if (closed) return Promise.reject(new Error("파일 저장이 이미 종료되었습니다."));
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
      NotAllowedError: "카메라 권한이 거부되었습니다. 브라우저 설정에서 이 사이트의 카메라 사용을 허용한 뒤 다시 시도해 주세요.",
      NotFoundError: "연결된 카메라를 찾을 수 없습니다.",
      NotReadableError: "카메라를 사용할 수 없습니다. 다른 앱에서 카메라를 사용 중인지 확인해 주세요.",
      OverconstrainedError: "이 카메라에서 지원하지 않는 영상 설정입니다.",
      SecurityError: "브라우저 보안 정책으로 카메라 사용이 차단되었습니다.",
      AbortError: "카메라를 시작하지 못했습니다. 다시 시도해 주세요.",
    };
    return messages[error?.name] || error?.message || String(error);
  };

  const setState = (nextState) => {
    const labels = {
      idle: "대기",
      preparing: "준비 중",
      recording: "녹화 중",
      stopping: "저장 중",
      saved: "저장 완료",
      error: "오류",
    };
    state = nextState;
    elements.state.textContent = labels[nextState] || nextState;
    updateControls();
  };

  const cameraReady = () => {
    return Boolean(cameraStream?.getVideoTracks().some((track) => track.readyState === "live"));
  };

  const updateControls = () => {
    const busy = state === "preparing" || state === "recording" || state === "stopping";
    const ready = directoryHandle && TGAMSerialSource.isConnected();
    elements.chooseFolder.disabled = busy || !("showDirectoryPicker" in window);
    elements.enableCamera.disabled = busy || cameraStarting || !navigator.mediaDevices?.getUserMedia;
    elements.enableCamera.textContent = cameraStarting
      ? "카메라 연결 중..."
      : cameraReady() ? "카메라 끄기" : "카메라 켜기";
    const videoUnavailable = cameraReady()
      && (typeof MediaRecorder === "undefined" || !elements.captureCanvas.captureStream);
    const startDisabled = busy || cameraStarting || !ready || videoUnavailable;
    elements.start30.disabled = startDisabled;
    elements.start60.disabled = startDisabled;
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
        setMessage("TGAM 연결이 끊어졌습니다. 현재 파일을 저장하고 있습니다.", true);
        stopRecording("serial_disconnected");
      }
    }
  };

  const chooseFolder = async () => {
    if (!("showDirectoryPicker" in window)) {
      setMessage("폴더 저장 기능은 데스크톱 Chrome 또는 Chromium에서 사용할 수 있습니다.", true);
      return;
    }
    try {
      directoryHandle = await window.showDirectoryPicker({
        id: "interface-intersignal-recordings",
        mode: "readwrite",
      });
      elements.folder.textContent = directoryHandle.name;
      elements.chooseFolder.textContent = "폴더 선택 완료";
      elements.chooseFolder.title = directoryHandle.name;
      setMessage("녹화 파일을 저장할 폴더를 선택했습니다.");
    } catch (error) {
      if (error.name !== "AbortError") setMessage(error.message || String(error), true);
    }
    updateControls();
  };

  const stopCamera = () => {
    if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
    elements.cameraPreview.srcObject = null;
    setCameraStatus("카메라 꺼짐");
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
        const error = new Error("카메라는 연결되었지만 영상이 표시되지 않습니다.");
        error.name = "AbortError";
        finish(reject, error);
      }, CAMERA_START_TIMEOUT_MS);
      elements.cameraPreview.addEventListener("loadeddata", () => finish(resolve), { once: true });
      elements.cameraPreview.addEventListener("error", () => {
        finish(reject, new Error("카메라 미리보기를 표시할 수 없습니다."));
      }, { once: true });
    });
  };

  const enableCamera = async () => {
    if (cameraStarting) return;
    if (cameraReady()) {
      stopCamera();
      setMessage("카메라를 껐습니다.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessage("이 브라우저에서는 카메라를 사용할 수 없습니다.", true);
      setCameraStatus("카메라 사용 불가");
      return;
    }
    if (window.isSecureContext === false) {
      setMessage("카메라를 사용하려면 localhost 또는 HTTPS로 접속해야 합니다.", true);
      setCameraStatus("HTTPS 필요");
      return;
    }

    try {
      cameraStarting = true;
      updateControls();
      setCameraStatus("카메라 권한 요청 중");
      setMessage("브라우저의 카메라 권한을 확인해 주세요.");
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
        setCameraStatus("카메라 중지됨");
        if (state === "recording") {
          setMessage("카메라가 중지되었습니다. 현재 파일을 저장하고 있습니다.", true);
          stopRecording("camera_ended");
        }
        updateControls();
      }, { once: true });
      elements.cameraPreview.srcObject = cameraStream;
      await elements.cameraPreview.play();
      await waitForCameraFrame();
      setCameraStatus("카메라 준비 완료", true);
      setMessage("카메라가 준비되었습니다. 영상은 134 x 100 크기로 저장됩니다.");
    } catch (error) {
      stopCamera();
      const message = describeCameraError(error);
      const status = error?.name === "NotAllowedError" ? "카메라 권한 차단됨" : "카메라 오류";
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
      setMessage(`파일을 저장하지 못했습니다: ${error.message || error}`, true);
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
      const error = event.error || new Error("영상 녹화 중 오류가 발생했습니다.");
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

  const startRecording = async (plannedDurationMs) => {
    if (state === "recording" || state === "stopping") return;
    if (!TGAMSerialSource.isConnected()) {
      setMessage("녹화를 시작하기 전에 TGAM을 연결해 주세요.", true);
      return;
    }
    if (!directoryHandle) {
      setMessage("먼저 녹화 파일을 저장할 폴더를 선택해 주세요.", true);
      return;
    }
    const cameraEnabled = cameraReady();
    if (cameraEnabled && (typeof MediaRecorder === "undefined" || !elements.captureCanvas.captureStream)) {
      setMessage("이 브라우저에서는 영상을 녹화할 수 없습니다.", true);
      return;
    }
    if (plannedDurationMs !== 30000 && plannedDurationMs !== 60000) {
      setMessage("30초 또는 1분 녹화를 선택해 주세요.", true);
      return;
    }

    setState("preparing");
    setMessage(cameraEnabled ? "EEG와 카메라를 함께 녹화할 준비를 하고 있습니다..." : "EEG를 녹화할 준비를 하고 있습니다...");
    packetBuffer = "";
    rawBuffer = "";
    writeFailure = null;
    elements.packets.textContent = "0";
    elements.raw.textContent = "0";
    elements.elapsed.textContent = formatRemaining(plannedDurationMs);

    const startedAt = new Date();
    const baseName = TGAMRecorderCore.createBaseName(startedAt);
    const files = TGAMRecorderCore.createFileNames(baseName, "webm", cameraEnabled);
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
      cameraEnabled,
      plannedDurationMs,
      initialStats: null,
      cameraInput: cameraEnabled ? cameraInputSettings() : null,
    };

    elements.archiveFile.textContent = files.archive;

    try {
      queues = {
        packets: await openQueue(files.packets),
        raw: await openQueue(files.raw),
      };
      if (cameraEnabled) {
        queues.video = await openQueue(files.video);
        createMediaRecorder();
        if (!cameraReady()) throw new Error("파일을 준비하는 동안 카메라가 중지되었습니다.");
      }
      if (!TGAMSerialSource.isConnected()) throw new Error("파일을 준비하는 동안 TGAM 연결이 끊어졌습니다.");
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
        video: cameraEnabled ? VIDEO : null,
        planned_duration_ms: plannedDurationMs,
      });
      flushTextBuffers();
      frameUnsubscribe = TGAMSerialSource.onFrame(recordFrame);
      if (mediaRecorder) mediaRecorder.start(1000);
      setState("recording");
      setMessage(
        cameraEnabled
          ? `${plannedDurationMs / 1000}초 동안 TGAM 패킷, Raw EEG, 저해상도 영상을 녹화합니다.`
          : `${plannedDurationMs / 1000}초 동안 TGAM 패킷과 Raw EEG를 녹화합니다.`
      );
      const stopDelayMs = Math.max(
        0,
        plannedDurationMs - (performance.now() - session.startedPerformanceMs)
      );
      autoStopTimer = window.setTimeout(() => stopRecording("duration_complete"), stopDelayMs);
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
      if (autoStopTimer) window.clearTimeout(autoStopTimer);
      autoStopTimer = null;
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

  const createSessionArchive = async (files) => {
    const componentNames = [files.packets, files.raw, files.video, files.manifest].filter(Boolean);
    const entries = [];
    for (const name of componentNames) {
      const handle = await directoryHandle.getFileHandle(name);
      entries.push({ name, data: await handle.getFile() });
    }

    const archive = await TGAMSessionZip.createArchive(entries);
    const archiveHandle = await directoryHandle.getFileHandle(files.archive, { create: true });
    const writable = await archiveHandle.createWritable();
    try {
      await writable.write(archive);
      await writable.close();
    } catch (error) {
      try {
        await writable.abort();
      } catch (_) {
        // The writable may already be closed after a failed write.
      }
      throw error;
    }

    const savedArchive = await archiveHandle.getFile();
    const extracted = await TGAMSessionZip.extractArchive(savedArchive);
    const extractedNames = new Set(extracted.map((entry) => entry.name));
    if (componentNames.some((name) => !extractedNames.has(name))) {
      throw new Error("ZIP 파일에 필요한 녹화 파일이 모두 들어 있지 않습니다.");
    }
    if (typeof directoryHandle.removeEntry !== "function") {
      throw new Error("이 브라우저에서는 임시 녹화 파일을 정리할 수 없습니다.");
    }
    for (const name of componentNames) await directoryHandle.removeEntry(name);
    return savedArchive.size;
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

    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
      await mediaStopPromise;
    }
    const recorderDetails = session.cameraEnabled ? {
      mimeType: session.videoMimeType,
      requestedBitsPerSecond: VIDEO.bitsPerSecond,
      actualBitsPerSecond: session.actualVideoBitsPerSecond,
      bytes: session.videoBytes,
    } : null;
    cleanupCaptureStream();

    const closingResults = await Promise.allSettled(Object.values(queues).map((queue) => queue.close()));
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
      video: {
        enabled: session.cameraEnabled,
        target: session.cameraEnabled ? VIDEO : null,
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
    setMessage("녹화 파일을 하나의 ZIP 파일로 묶고 있습니다...");
    const archiveBytes = await createSessionArchive(session.files);
    elements.elapsed.textContent = formatRemaining(session.plannedDurationMs - durationMs);
    setState("saved");
    setMessage(
      `TGAM 패킷 ${session.frameCount}개와 Raw EEG 샘플 ${session.rawSampleCount}개를 `
      + `${session.files.archive} 파일 하나로 저장했습니다`
      + `${session.cameraEnabled ? "" : " (EEG 전용)"} (${Math.ceil(archiveBytes / 1024)} KB).`
    );
  };

  const stopRecording = (reason = "user") => {
    if (stopPromise) return stopPromise;
    if (state !== "recording" || !session) return Promise.resolve();
    stopPromise = performStop(reason)
      .catch(async (error) => {
        cleanupCaptureStream();
        if (queues) await abortQueues();
        setState("error");
        setMessage(`녹화 파일 저장을 완료하지 못했습니다: ${error.message || error}`, true);
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
  elements.start30.addEventListener("click", () => startRecording(30000));
  elements.start60.addEventListener("click", () => startRecording(60000));
  elements.stop.addEventListener("click", () => stopRecording("user"));

  window.addEventListener("beforeunload", (event) => {
    if (state !== "recording" && state !== "stopping") return;
    event.preventDefault();
    event.returnValue = "";
  });

  window.setInterval(updateStatus, 250);
  if (!navigator.mediaDevices?.getUserMedia) {
    setCameraStatus(window.isSecureContext === false ? "HTTPS 필요" : "카메라 사용 불가");
    setMessage(
      window.isSecureContext === false
        ? "카메라는 사용할 수 없지만 EEG만 녹화할 수 있습니다."
        : "이 브라우저에서는 카메라를 사용할 수 없습니다. EEG만 녹화할 수 있습니다."
    );
  }
  updateControls();

  return {
    getState: () => state,
    isRecording: () => state === "recording",
    stop: stopRecording,
  };
})();
