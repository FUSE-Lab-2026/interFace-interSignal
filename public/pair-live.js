const PairLive = (() => {
  const SAMPLE_RATE = 512;
  const RAW_HISTORY_SIZE = 1024;
  const RAW_DISPLAY_SIZE = 512;
  const RAW_DISPLAY_LIMIT = 2048;
  const SIMILARITY_INTERVAL_MS = 250;
  const SIMILARITY_TRAIL_MS = 4000;
  const BAND_KEYS = TGAMPairCore.BAND_KEYS;
  const BAND_LABELS = ["D", "T", "A", "B", "G"];
  const COLORS = {
    a: "#e45c45",
    b: "#168f9b",
    ink: "#222323",
    muted: "#858886",
    grid: "#d3d3cd",
    paper: "#f4f4f0",
  };

  const elements = {
    view: document.querySelector("#pair-view"),
    connectA: document.querySelector("#pair-connect-a"),
    connectB: document.querySelector("#pair-connect-b"),
    simulate: document.querySelector("#pair-simulate"),
    message: document.querySelector("#pair-message"),
    similarity: document.querySelector("#pair-similarity"),
    betweenCanvas: document.querySelector("#pair-between-canvas"),
  };

  if (!elements.view) return null;

  const createParticipant = (key) => {
    const source = TGAMSerial.createSource();
    const engine = DerivedSignalEngine.create();
    const participant = {
      key,
      source,
      engine,
      raw: [],
      quality: null,
      simulated: false,
      elements: {
        connect: elements[`connect${key.toUpperCase()}`],
        status: document.querySelector(`#pair-status-${key}`),
        quality: document.querySelector(`#pair-quality-${key}`),
        contact: document.querySelector(`#pair-contact-${key}`),
        raw: document.querySelector(`#pair-raw-${key}`),
        bands: document.querySelector(`#pair-bands-${key}`),
      },
    };

    source.onPacket((packet) => {
      if (packet.signal !== undefined) {
        participant.quality = packet.signal;
        engine.setSignalQuality(packet.signal);
      }
      if (packet.raw !== undefined) pushRaw(participant, packet.raw);
    });
    return participant;
  };

  const participants = [createParticipant("a"), createParticipant("b")];
  let simulating = false;
  let simulationStartedAt = 0;
  let simulationSamples = 0;
  let similarity = null;
  let similarityHistory = [];
  let lastSimilarityAt = 0;

  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

  function pushRaw(participant, value) {
    if (!Number.isFinite(value)) return;
    participant.engine.pushRaw(value);
    participant.raw.push(value);
    if (participant.raw.length > RAW_HISTORY_SIZE) {
      participant.raw.splice(0, participant.raw.length - RAW_HISTORY_SIZE);
    }
  }

  const resetParticipant = (participant) => {
    participant.engine.reset();
    participant.raw = [];
    participant.quality = null;
    participant.simulated = false;
  };

  const stopSimulation = () => {
    if (!simulating) return;
    simulating = false;
    elements.simulate.setAttribute("aria-pressed", "false");
    elements.simulate.textContent = "Test Signal";
    participants.forEach(resetParticipant);
    similarity = null;
    similarityHistory = [];
  };

  const startSimulation = async () => {
    for (const participant of participants) {
      if (participant.source.isConnected()) await participant.source.disconnect();
      resetParticipant(participant);
      participant.simulated = true;
      participant.quality = 0;
      participant.engine.setSignalQuality(0);
    }
    if (TGAMSerialSource.isConnected()) await TGAMSerialSource.disconnect();
    simulating = true;
    simulationStartedAt = performance.now();
    simulationSamples = 0;
    similarity = null;
    similarityHistory = [];
    lastSimilarityAt = 0;
    elements.simulate.setAttribute("aria-pressed", "true");
    elements.simulate.textContent = "Stop Test";
  };

  const toggleSimulation = async () => {
    if (simulating) stopSimulation();
    else await startSimulation();
  };

  const toggleParticipant = async (participant) => {
    if (simulating) stopSimulation();
    const status = participant.source.getStatus();
    if (status === "connecting" || status === "disconnecting") return;
    if (participant.source.isConnected()) {
      await participant.source.disconnect();
      resetParticipant(participant);
      return;
    }
    if (TGAMSerialSource.isConnected()) {
      await TGAMSerialSource.disconnect();
      DerivedSignals.reset();
    }
    resetParticipant(participant);
    await participant.source.connect();
  };

  const updateSimulation = (now) => {
    if (!simulating) return;
    const expectedSamples = Math.floor((now - simulationStartedAt) * SAMPLE_RATE / 1000);
    const endSample = Math.min(expectedSamples, simulationSamples + 96);
    for (; simulationSamples < endSample; simulationSamples += 1) {
      const t = simulationSamples / SAMPLE_RATE;
      const convergence = (Math.sin(2 * Math.PI * t / 8 - Math.PI / 2) + 1) / 2;
      const shared = Math.sin(2 * Math.PI * 10 * t);
      const slowA = Math.sin(2 * Math.PI * 5.5 * t + 0.3);
      const slowB = Math.sin(2 * Math.PI * 7 * t + 1.1);
      const fastA = Math.sin(2 * Math.PI * 21 * t);
      const fastB = Math.sin(2 * Math.PI * 18 * t + 0.7);
      const gammaB = Math.sin(2 * Math.PI * 36 * t + 0.2);
      const noiseA = (Math.random() - 0.5) * 150;
      const noiseB = (Math.random() - 0.5) * 150;
      pushRaw(participants[0], 430 * shared + 180 * slowA + 70 * fastA + noiseA);
      pushRaw(
        participants[1],
        (60 + 380 * convergence) * shared +
        (90 + 50 * convergence) * slowB +
        (60 + 390 * (1 - convergence)) * fastB +
        240 * (1 - convergence) * gammaB +
        noiseB
      );
    }
  };

  const buildBandElements = (participant) => {
    participant.elements.bands.replaceChildren();
    BAND_LABELS.forEach((label) => {
      const band = document.createElement("div");
      band.className = "pair-band";
      const fill = document.createElement("span");
      fill.className = "pair-band-fill";
      const text = document.createElement("span");
      text.className = "pair-band-label";
      text.textContent = label;
      band.append(fill, text);
      participant.elements.bands.append(band);
    });
  };

  const updateParticipantUI = (participant) => {
    const status = participant.simulated ? "simulated" : participant.source.getStatus();
    const stats = participant.source.getStats();
    const connected = participant.simulated || participant.source.isConnected();
    const labels = {
      connecting: "CONNECTING",
      disconnecting: "CLOSING",
      error: "ERROR",
      unsupported: "UNAVAILABLE",
      disconnected: "DISCONNECTED",
      idle: "IDLE",
      simulated: "TEST / 512 raw/s",
    };
    participant.elements.status.textContent = participant.source.isConnected()
      ? `LIVE / ${Math.round(stats.rawRate)} raw/s / bad ${stats.checksumFailures}`
      : labels[status] || status.toUpperCase();
    participant.elements.connect.textContent = participant.source.isConnected()
      ? `Disconnect ${participant.key.toUpperCase()}`
      : status === "connecting" ? "Connecting..." : `Connect ${participant.key.toUpperCase()}`;
    participant.elements.connect.disabled = status === "connecting" || status === "disconnecting" || simulating;
    participant.elements.connect.classList.toggle("is-connected", participant.source.isConnected());
    participant.elements.connect.title = participant.source.getLastError();

    const quality = connected && Number.isFinite(participant.quality) ? participant.quality : null;
    const contact = quality === null ? 0 : 100 * (1 - clamp(quality, 0, 200) / 200);
    participant.elements.quality.textContent = quality === null ? "Q --" : `Q ${Math.round(quality)}`;
    participant.elements.contact.style.height = `${contact}%`;
    participant.elements.contact.style.opacity = String(0.15 + 0.85 * contact / 100);

    const profile = TGAMPairCore.relativeProfile(participant.engine.getSnapshot().bandPowers);
    const fills = participant.elements.bands.querySelectorAll(".pair-band-fill");
    fills.forEach((fill, index) => {
      const maximum = profile ? Math.max(...profile) : 1;
      const normalized = profile ? Math.sqrt(profile[index] / Math.max(maximum, 1e-12)) : 0;
      fill.style.height = `${normalized * 100}%`;
      fill.style.opacity = String(0.25 + normalized * 0.75);
    });
    return profile;
  };

  const canvasContext = (canvas) => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(rect.width * scale);
    const height = Math.round(rect.height * scale);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const context = canvas.getContext("2d");
    context.setTransform(scale, 0, 0, scale, 0, 0);
    return { context, width: rect.width, height: rect.height };
  };

  const drawRaw = (participant) => {
    const target = canvasContext(participant.elements.raw);
    if (!target) return;
    const { context, width, height } = target;
    context.clearRect(0, 0, width, height);
    context.strokeStyle = COLORS.grid;
    context.lineWidth = 1;
    for (let index = 0; index <= 4; index += 1) {
      const y = 0.5 + index * (height - 1) / 4;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }
    const values = participant.raw.slice(-RAW_DISPLAY_SIZE);
    if (values.length < 2) return;
    context.strokeStyle = COLORS[participant.key];
    context.lineWidth = 1.25;
    context.beginPath();
    values.forEach((value, index) => {
      const x = index / (values.length - 1) * width;
      const limited = clamp(value, -RAW_DISPLAY_LIMIT, RAW_DISPLAY_LIMIT);
      const y = height / 2 - limited / RAW_DISPLAY_LIMIT * height * 0.46;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
  };

  const polygonPoints = (profile, centerX, centerY, radius) => {
    if (!profile) return null;
    const maximum = Math.max(...profile);
    return profile.map((value, index) => {
      const angle = -Math.PI / 2 + index * Math.PI * 2 / profile.length;
      const scaled = Math.sqrt(value / Math.max(maximum, 1e-12));
      return {
        x: centerX + Math.cos(angle) * radius * scaled,
        y: centerY + Math.sin(angle) * radius * scaled,
      };
    });
  };

  const drawPolygon = (context, points, color) => {
    if (!points) return;
    context.beginPath();
    points.forEach((point, index) => {
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    context.closePath();
    context.globalAlpha = 0.28;
    context.fillStyle = color;
    context.fill();
    context.globalAlpha = 0.9;
    context.strokeStyle = color;
    context.lineWidth = 1.5;
    context.stroke();
    context.globalAlpha = 1;
  };

  const drawBetween = (profileA, profileB) => {
    const target = canvasContext(elements.betweenCanvas);
    if (!target) return;
    const { context, width, height } = target;
    context.clearRect(0, 0, width, height);
    const narrow = width < 700;
    const constellation = narrow
      ? { x: width / 2, y: height * 0.34, radius: Math.min(width * 0.24, height * 0.25) }
      : { x: width * 0.25, y: height * 0.5, radius: Math.min(width * 0.16, height * 0.35) };
    const trail = narrow
      ? { x: 24, y: height * 0.68, width: width - 48, height: height * 0.23 }
      : { x: width * 0.52, y: height * 0.17, width: width * 0.43, height: height * 0.66 };

    context.font = "9px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    for (let ring = 1; ring <= 4; ring += 1) {
      const radius = constellation.radius * ring / 4;
      context.strokeStyle = COLORS.grid;
      context.lineWidth = 1;
      context.beginPath();
      BAND_LABELS.forEach((_, index) => {
        const angle = -Math.PI / 2 + index * Math.PI * 2 / BAND_LABELS.length;
        const x = constellation.x + Math.cos(angle) * radius;
        const y = constellation.y + Math.sin(angle) * radius;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.closePath();
      context.stroke();
    }
    BAND_LABELS.forEach((label, index) => {
      const angle = -Math.PI / 2 + index * Math.PI * 2 / BAND_LABELS.length;
      const x = constellation.x + Math.cos(angle) * constellation.radius * 1.14;
      const y = constellation.y + Math.sin(angle) * constellation.radius * 1.14;
      context.fillStyle = COLORS.muted;
      context.fillText(label, x, y);
    });

    context.globalCompositeOperation = "multiply";
    drawPolygon(context, polygonPoints(profileA, constellation.x, constellation.y, constellation.radius), COLORS.a);
    drawPolygon(context, polygonPoints(profileB, constellation.x, constellation.y, constellation.radius), COLORS.b);
    context.globalCompositeOperation = "source-over";

    context.strokeStyle = COLORS.grid;
    context.lineWidth = 1;
    for (let guide = 0; guide <= 2; guide += 1) {
      const y = trail.y + guide * trail.height / 2;
      context.beginPath();
      context.moveTo(trail.x, y);
      context.lineTo(trail.x + trail.width, y);
      context.stroke();
      context.fillStyle = COLORS.muted;
      context.textAlign = "right";
      context.fillText(String(100 - guide * 50), trail.x - 7, y);
    }
    const now = performance.now();
    const points = similarityHistory.filter((item) => now - item.time <= SIMILARITY_TRAIL_MS);
    if (points.length > 1) {
      context.strokeStyle = COLORS.ink;
      context.lineWidth = 2;
      context.beginPath();
      points.forEach((item, index) => {
        const age = now - item.time;
        const x = trail.x + trail.width * (1 - age / SIMILARITY_TRAIL_MS);
        const y = trail.y + trail.height * (1 - item.value);
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.stroke();
    }
  };

  const updateSimilarity = (profileA, profileB, now) => {
    const next = TGAMPairCore.cosineSimilarity(profileA, profileB);
    if (next === null) {
      similarity = null;
      return;
    }
    similarity = similarity === null ? next : similarity * 0.82 + next * 0.18;
    if (now - lastSimilarityAt >= SIMILARITY_INTERVAL_MS) {
      similarityHistory.push({ time: now, value: similarity });
      similarityHistory = similarityHistory.filter((item) => now - item.time <= SIMILARITY_TRAIL_MS);
      lastSimilarityAt = now;
    }
  };

  const updateMessage = () => {
    if (simulating) {
      const ready = participants.every((participant) => participant.engine.getSnapshot().ready);
      elements.message.textContent = ready
        ? "Test streams are running. Their band shapes slowly move together and apart."
        : "Building two seconds of test EEG for the first band estimate...";
      return;
    }
    const connected = participants.filter((participant) => participant.source.isConnected()).length;
    if (connected === 2) elements.message.textContent = "Two live TGAM streams are active.";
    else if (connected === 1) elements.message.textContent = "One TGAM is connected. Select a different serial port for the other participant.";
    else elements.message.textContent = "Connect two TGAM ports or start the test signal.";
  };

  const render = (now) => {
    updateSimulation(now);
    const profiles = participants.map((participant) => {
      const profile = updateParticipantUI(participant);
      drawRaw(participant);
      return profile;
    });
    updateSimilarity(profiles[0], profiles[1], now);
    elements.similarity.textContent = similarity === null ? "--" : String(Math.round(similarity * 100));
    drawBetween(profiles[0], profiles[1]);
    updateMessage();
    requestAnimationFrame(render);
  };

  participants.forEach((participant) => {
    buildBandElements(participant);
    participant.elements.connect.addEventListener("click", () => toggleParticipant(participant));
  });
  elements.simulate.addEventListener("click", toggleSimulation);
  requestAnimationFrame(render);

  return {
    getParticipants: () => participants,
    isSimulating: () => simulating,
  };
})();
