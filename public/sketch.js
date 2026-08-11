const signalGuessingSketch = (p) => {
  const PAGE_PADDING = 16;
  const HEADER_HEIGHT = 104;
  const PANEL_GAP = 8;
  const BUTTON_WIDTH = 132;
  const RAW_HISTORY_SIZE = 1024;
  const RAW_DISPLAY_SIZE = 512;
  const RAW_DISPLAY_LIMIT = 2048;
  const CARD_IDS = ["contact", "movement", "eyes", "raw", "bands", "esense"];
  const BAND_KEYS = [
    "delta",
    "theta",
    "lowAlpha",
    "highAlpha",
    "lowBeta",
    "highBeta",
    "lowGamma",
    "midGamma",
  ];
  const BAND_LABELS = ["D", "T", "LA", "HA", "LB", "HB", "LG", "MG"];

  let connectButton = null;
  let visibleCardIds = new Set(CARD_IDS);
  let rawHistory = [];
  let latestBands = null;
  let attention = null;
  let meditation = null;
  let signalQuality = null;

  const clamp = (value, minimum = 0, maximum = 100) => {
    return Math.max(minimum, Math.min(maximum, value));
  };

  const getColumnCount = (width) => {
    if (width >= 980) return 3;
    if (width >= 620) return 2;
    return 1;
  };

  const getCanvasHeight = (width, viewportHeight, cardCount) => {
    if (cardCount === 0) return viewportHeight;
    const columns = Math.min(getColumnCount(width), cardCount);
    const rows = Math.ceil(cardCount / columns);
    const minimumPanelHeight = width < 620 ? 220 : 300;
    const minimumContentHeight = rows * minimumPanelHeight + (rows - 1) * PANEL_GAP;
    return Math.max(viewportHeight, HEADER_HEIGHT + PAGE_PADDING + minimumContentHeight);
  };

  const resizeForLayout = () => {
    const height = getCanvasHeight(p.windowWidth, p.windowHeight, visibleCardIds.size);
    p.resizeCanvas(p.windowWidth, height);
    positionConnectButton();
  };

  const resetLiveData = () => {
    rawHistory = [];
    latestBands = null;
    attention = null;
    meditation = null;
    signalQuality = null;
  };

  p.setup = () => {
    const height = getCanvasHeight(p.windowWidth, p.windowHeight, visibleCardIds.size);
    const canvas = p.createCanvas(p.windowWidth, height);
    canvas.parent("signal-guessing");
    canvas.addClass("signal-canvas");
    p.pixelDensity(Math.min(window.devicePixelRatio || 1, 2));
    p.textFont("monospace");

    connectButton = p.createButton("Connect TGAM");
    connectButton.parent("signal-guessing");
    connectButton.addClass("serial-button");
    connectButton.mousePressed(toggleSerial);
    positionConnectButton();

    for (const input of document.querySelectorAll("[data-card-id]")) {
      input.addEventListener("change", () => {
        visibleCardIds = new Set(
          Array.from(document.querySelectorAll("[data-card-id]:checked"), (item) => item.dataset.cardId)
        );
        resizeForLayout();
      });
    }

    TGAMSerialSource.onPacket((packet) => {
      if (packet.signal !== undefined) {
        DerivedSignals.setSignalQuality(packet.signal);
        signalQuality = packet.signal;
      }
      if (packet.raw !== undefined) {
        DerivedSignals.pushRaw(packet.raw);
        rawHistory.push(packet.raw);
        if (rawHistory.length > RAW_HISTORY_SIZE) {
          rawHistory.splice(0, rawHistory.length - RAW_HISTORY_SIZE);
        }
      }
      if (packet.bands) latestBands = { ...packet.bands };
      if (packet.attention !== undefined) attention = packet.attention;
      if (packet.meditation !== undefined) meditation = packet.meditation;
    });

    document.addEventListener("appviewchange", (event) => {
      if (event.detail.view === "signals") requestAnimationFrame(resizeForLayout);
    });
  };

  const positionConnectButton = () => {
    if (!connectButton) return;
    connectButton.position(p.width - PAGE_PADDING - BUTTON_WIDTH, 12);
  };

  const toggleSerial = async () => {
    const status = TGAMSerialSource.getStatus();
    if (status === "connecting" || status === "disconnecting") return;
    if (TGAMSerialSource.isConnected()) {
      await TGAMSerialSource.disconnect();
      DerivedSignals.reset();
      resetLiveData();
      return;
    }
    DerivedSignals.reset();
    resetLiveData();
    await TGAMSerialSource.connect();
  };

  const updateConnectButton = () => {
    const status = TGAMSerialSource.getStatus();
    const states = {
      connected: ["Disconnect", false],
      connecting: ["Connecting...", true],
      disconnecting: ["Disconnecting...", true],
      unsupported: ["Serial unavailable", true],
      error: ["Retry TGAM", false],
    };
    const [label, disabled] = states[status] || ["Connect TGAM", false];
    connectButton.html(label);
    connectButton.elt.disabled = disabled;
    connectButton.elt.title = TGAMSerialSource.getLastError();
  };

  const drawHeader = () => {
    p.noStroke();
    const status = TGAMSerialSource.getStatus();
    const connected = TGAMSerialSource.isConnected();
    const stats = TGAMSerialSource.getStats();
    let sourceLabel = `SERIAL | ${status}`;
    if (connected) {
      sourceLabel = `LIVE | ${Math.round(stats.rawRate)} raw/s | bad ${stats.checksumFailures}`;
    }
    if (p.width < 620) {
      sourceLabel = connected ? `${Math.round(stats.rawRate)} /s` : status.toUpperCase();
    }
    p.fill(connected ? 210 : 135);
    p.textAlign(p.RIGHT, p.CENTER);
    p.text(sourceLabel, p.width - PAGE_PADDING - BUTTON_WIDTH - 12, 28);

    const qualityLabel = connected && Number.isFinite(signalQuality)
      ? `TGAM Q ${Math.round(signalQuality)}/200`
      : "TGAM Q --/200";
    p.fill(135);
    p.textSize(10);
    p.text(qualityLabel, p.width - PAGE_PADDING, 73);
  };

  const getPanelBounds = (cardCount) => {
    if (cardCount === 0) return [];
    const columns = Math.min(getColumnCount(p.width), cardCount);
    const rows = Math.ceil(cardCount / columns);
    const contentWidth = p.width - PAGE_PADDING * 2;
    const contentHeight = p.height - HEADER_HEIGHT - PAGE_PADDING;
    const width = (contentWidth - PANEL_GAP * (columns - 1)) / columns;
    const height = (contentHeight - PANEL_GAP * (rows - 1)) / rows;

    return Array.from({ length: cardCount }, (_, index) => ({
      x: PAGE_PADDING + index % columns * (width + PANEL_GAP),
      y: HEADER_HEIGHT + Math.floor(index / columns) * (height + PANEL_GAP),
      width,
      height,
    }));
  };

  const drawScore = (value, bounds) => {
    const inset = Math.max(16, Math.min(28, bounds.width * 0.06));
    p.noStroke();
    p.fill(24);
    p.textAlign(p.RIGHT, p.TOP);
    p.textSize(Math.max(25, Math.min(42, bounds.width * 0.11)));
    p.text(value === null ? "--" : Math.round(value), bounds.x + bounds.width - inset, bounds.y + inset - 4);
  };

  const drawPanel = (card, bounds) => {
    const inset = Math.max(16, Math.min(28, bounds.width * 0.06));
    p.noStroke();
    p.fill(244, 244, 240);
    p.rect(bounds.x, bounds.y, bounds.width, bounds.height, 4);

    p.fill(132);
    p.textAlign(p.LEFT, p.TOP);
    p.textSize(10);
    p.text(card.number, bounds.x + inset, bounds.y + inset);

    const visualTop = Math.max(58, bounds.height * 0.15);
    card.draw({
      x: bounds.x + inset,
      y: bounds.y + visualTop,
      width: bounds.width - inset * 2,
      height: bounds.height - visualTop - inset,
    }, bounds);
  };

  const drawContact = (value, visualBounds, panelBounds) => {
    drawScore(value, panelBounds);
    const normalized = value === null ? 0 : clamp(value) / 100;
    const trackWidth = Math.max(38, Math.min(78, visualBounds.width * 0.25));
    const trackHeight = Math.max(50, visualBounds.height * 0.88);
    const x = visualBounds.x + (visualBounds.width - trackWidth) / 2;
    const y = visualBounds.y + (visualBounds.height - trackHeight) / 2;

    p.noStroke();
    p.fill(224, 224, 218);
    p.rect(x, y, trackWidth, trackHeight, 2);
    if (value !== null && normalized > 0) {
      p.fill(18, 18, 18, 28 + normalized * 227);
      const fillHeight = trackHeight * normalized;
      p.rect(x, y + trackHeight - fillHeight, trackWidth, fillHeight, 2);
    }
  };

  const drawMovement = (value, visualBounds, panelBounds) => {
    drawScore(value, panelBounds);
    const normalized = value === null ? 0 : clamp(value) / 100;
    const layerCount = 9;
    const stackWidth = Math.min(180, visualBounds.width * 0.58);
    const stackHeight = Math.min(220, visualBounds.height * 0.56);
    const layerHeight = stackHeight / layerCount;
    const centerX = visualBounds.x + visualBounds.width / 2;
    const top = visualBounds.y + (visualBounds.height - stackHeight) / 2;
    const time = p.millis() / 1000;
    const maximumOffset = Math.min(62, visualBounds.width * 0.2) * normalized;

    p.noStroke();
    p.fill(18, 18, 18, 28 + normalized * 227);
    for (let index = 0; index < layerCount; index += 1) {
      const shake = (
        Math.sin(index * 2.17 + time * 8.3) +
        0.45 * Math.sin(index * 4.71 - time * 13.1)
      ) / 1.45;
      const x = centerX - stackWidth / 2 + maximumOffset * shake;
      const y = top + index * layerHeight;
      p.rect(x, y, stackWidth, Math.max(3, layerHeight - 3), 1);
    }
  };

  const drawEyes = (value, visualBounds, panelBounds) => {
    drawScore(value, panelBounds);
    const normalized = value === null ? 0 : clamp(value) / 100;
    const maximumDiameter = Math.max(46, Math.min(visualBounds.width, visualBounds.height) * 0.72);
    const diameter = value === null ? 0 : maximumDiameter * Math.sqrt(normalized);
    const centerX = visualBounds.x + visualBounds.width / 2;
    const centerY = visualBounds.y + visualBounds.height / 2;

    p.noStroke();
    p.fill(224, 224, 218);
    p.circle(centerX, centerY, maximumDiameter);
    if (diameter > 0) {
      p.fill(18, 18, 18, 28 + normalized * 227);
      p.circle(centerX, centerY, diameter);
    }
  };

  const drawRaw = (visualBounds, panelBounds, connected) => {
    const available = connected && rawHistory.length > 1;
    const latest = available ? rawHistory[rawHistory.length - 1] : null;
    drawScore(latest, panelBounds);

    const graphHeight = visualBounds.height * 0.72;
    const graphY = visualBounds.y + (visualBounds.height - graphHeight) / 2;
    p.stroke(218);
    p.strokeWeight(1);
    for (let index = 0; index <= 4; index += 1) {
      const y = graphY + graphHeight * index / 4;
      p.line(visualBounds.x, y, visualBounds.x + visualBounds.width, y);
    }
    if (!available) return;

    const values = rawHistory.slice(-RAW_DISPLAY_SIZE);
    p.noFill();
    p.stroke(18, 18, 18, 220);
    p.strokeWeight(1.25);
    p.beginShape();
    values.forEach((value, index) => {
      const x = values.length === 1
        ? visualBounds.x
        : visualBounds.x + index / (values.length - 1) * visualBounds.width;
      const limited = clamp(value, -RAW_DISPLAY_LIMIT, RAW_DISPLAY_LIMIT);
      const y = p.map(limited, -RAW_DISPLAY_LIMIT, RAW_DISPLAY_LIMIT, graphY + graphHeight, graphY);
      p.vertex(x, y);
    });
    p.endShape();
  };

  const drawBands = (visualBounds, connected) => {
    const available = connected && latestBands !== null;
    const values = BAND_KEYS.map((key) => available ? Math.max(0, Number(latestBands[key]) || 0) : 0);
    const logValues = values.map((value) => Math.log10(1 + value));
    const maximum = Math.max(1e-12, ...logValues);
    const normalized = logValues.map((value) => value / maximum);
    const labelHeight = 22;
    const trackHeight = visualBounds.height - labelHeight;
    const gap = Math.max(4, Math.min(10, visualBounds.width * 0.018));
    const barWidth = Math.max(8, (visualBounds.width - gap * 7) / 8);

    BAND_LABELS.forEach((label, index) => {
      const x = visualBounds.x + index * (barWidth + gap);
      p.noStroke();
      p.fill(224, 224, 218);
      p.rect(x, visualBounds.y, barWidth, trackHeight, 1);
      if (available && normalized[index] > 0) {
        const fillHeight = trackHeight * normalized[index];
        p.fill(18, 18, 18, 28 + normalized[index] * 227);
        p.rect(x, visualBounds.y + trackHeight - fillHeight, barWidth, fillHeight, 1);
      }
      p.fill(112);
      p.textAlign(p.CENTER, p.BOTTOM);
      p.textSize(9);
      p.text(label, x + barWidth / 2, visualBounds.y + visualBounds.height);
    });
  };

  const drawESense = (visualBounds, connected) => {
    const values = [attention, meditation];
    const labels = ["A", "M"];
    const trackWidth = Math.max(38, Math.min(72, visualBounds.width * 0.2));
    const gap = Math.max(28, Math.min(70, visualBounds.width * 0.14));
    const totalWidth = trackWidth * 2 + gap;
    const startX = visualBounds.x + (visualBounds.width - totalWidth) / 2;
    const scoreSpace = 32;
    const labelSpace = 22;
    const trackHeight = Math.max(40, visualBounds.height - scoreSpace - labelSpace);

    values.forEach((value, index) => {
      const available = connected && Number.isFinite(value);
      const normalized = available ? clamp(value) / 100 : 0;
      const x = startX + index * (trackWidth + gap);

      p.noStroke();
      p.fill(24);
      p.textAlign(p.CENTER, p.TOP);
      p.textSize(Math.max(18, Math.min(28, visualBounds.width * 0.075)));
      p.text(available ? Math.round(value) : "--", x + trackWidth / 2, visualBounds.y);

      const trackY = visualBounds.y + scoreSpace;
      p.fill(224, 224, 218);
      p.rect(x, trackY, trackWidth, trackHeight, 2);
      if (available && normalized > 0) {
        const fillHeight = trackHeight * normalized;
        p.fill(18, 18, 18, 28 + normalized * 227);
        p.rect(x, trackY + trackHeight - fillHeight, trackWidth, fillHeight, 2);
      }

      p.fill(112);
      p.textAlign(p.CENTER, p.BOTTOM);
      p.textSize(10);
      p.text(labels[index], x + trackWidth / 2, visualBounds.y + visualBounds.height);
    });
  };

  const getCards = () => {
    const snapshot = DerivedSignals.getSnapshot();
    const connected = TGAMSerialSource.isConnected();
    return [
      { id: "contact", number: "01", draw: (visual, panel) => drawContact(snapshot.contact, visual, panel) },
      { id: "movement", number: "02", draw: (visual, panel) => drawMovement(snapshot.highFrequencyActivity, visual, panel) },
      { id: "eyes", number: "03", draw: (visual, panel) => drawEyes(snapshot.alphaRatio, visual, panel) },
      { id: "raw", number: "04", draw: (visual, panel) => drawRaw(visual, panel, connected) },
      { id: "bands", number: "05", draw: (visual) => drawBands(visual, connected) },
      { id: "esense", number: "06", draw: (visual) => drawESense(visual, connected) },
    ].filter((card) => visibleCardIds.has(card.id));
  };

  p.draw = () => {
    p.background(17);
    updateConnectButton();
    drawHeader();

    const cards = getCards();
    const panelBounds = getPanelBounds(cards.length);
    cards.forEach((card, index) => drawPanel(card, panelBounds[index]));
  };

  p.windowResized = resizeForLayout;
};

new p5(signalGuessingSketch);
