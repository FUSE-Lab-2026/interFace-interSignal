const signalGuessingSketch = (p) => {
  const PAGE_PADDING = 16;
  const HEADER_HEIGHT = 56;
  const PANEL_GAP = 8;
  const BUTTON_WIDTH = 132;
  let connectButton = null;

  const clamp = (value, minimum = 0, maximum = 100) => {
    return Math.max(minimum, Math.min(maximum, value));
  };

  p.setup = () => {
    const canvas = p.createCanvas(p.windowWidth, p.windowHeight);
    canvas.parent("signal-guessing");
    p.pixelDensity(Math.min(window.devicePixelRatio || 1, 2));
    p.textFont("monospace");

    connectButton = p.createButton("Connect TGAM");
    connectButton.parent("signal-guessing");
    connectButton.addClass("serial-button");
    connectButton.mousePressed(toggleSerial);
    positionConnectButton();

    TGAMSerialSource.onPacket((packet) => {
      if (packet.signal !== undefined) {
        DerivedSignals.setSignalQuality(packet.signal);
      }
      if (packet.raw !== undefined) DerivedSignals.pushRaw(packet.raw);
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
      return;
    }
    DerivedSignals.reset();
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
    p.fill(215);
    p.textAlign(p.LEFT, p.CENTER);
    p.textSize(12);
    p.text("SIGNAL GUESSING", PAGE_PADDING, HEADER_HEIGHT / 2);

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
    p.text(sourceLabel, p.width - PAGE_PADDING - BUTTON_WIDTH - 12, HEADER_HEIGHT / 2);
  };

  const getPanelBounds = () => {
    const contentY = HEADER_HEIGHT;
    const contentHeight = p.height - contentY - PAGE_PADDING;
    const contentWidth = p.width - PAGE_PADDING * 2;
    if (p.width >= 760) {
      const width = (contentWidth - PANEL_GAP * 2) / 3;
      return Array.from({ length: 3 }, (_, index) => ({
        x: PAGE_PADDING + index * (width + PANEL_GAP),
        y: contentY,
        width,
        height: contentHeight,
      }));
    }
    const height = (contentHeight - PANEL_GAP * 2) / 3;
    return Array.from({ length: 3 }, (_, index) => ({
      x: PAGE_PADDING,
      y: contentY + index * (height + PANEL_GAP),
      width: contentWidth,
      height,
    }));
  };

  const drawPanel = (value, bounds, drawVisual) => {
    const { x, y, width, height } = bounds;
    const inset = Math.max(16, Math.min(28, width * 0.06));
    const normalized = value === null ? 0 : clamp(value) / 100;

    p.noStroke();
    p.fill(244, 244, 240);
    p.rect(x, y, width, height, 4);

    p.fill(24);
    p.textAlign(p.RIGHT, p.TOP);
    p.textSize(Math.max(28, Math.min(46, width * 0.13)));
    p.text(value === null ? "--" : Math.round(value), x + width - inset, y + inset - 4);

    const visualBounds = {
      x: x + inset,
      y: y + Math.max(72, height * 0.12),
      width: width - inset * 2,
      height: height - Math.max(72, height * 0.12) - inset,
    };
    drawVisual(normalized, value !== null, visualBounds);
  };

  const drawContact = (normalized, available, bounds) => {
    const trackWidth = Math.max(44, Math.min(92, bounds.width * 0.34));
    const trackHeight = Math.max(60, bounds.height * 0.9);
    const x = bounds.x + (bounds.width - trackWidth) / 2;
    const y = bounds.y + (bounds.height - trackHeight) / 2;

    p.noStroke();
    p.fill(224, 224, 218);
    p.rect(x, y, trackWidth, trackHeight, 2);

    if (available && normalized > 0) {
      p.fill(18, 18, 18, 28 + normalized * 227);
      const fillHeight = trackHeight * normalized;
      p.rect(x, y + trackHeight - fillHeight, trackWidth, fillHeight, 2);
    }
  };

  const drawMovement = (normalized, available, bounds) => {
    const layerCount = 9;
    const stackWidth = Math.min(190, bounds.width * 0.62);
    const stackHeight = Math.min(300, bounds.height * 0.52);
    const layerHeight = stackHeight / layerCount;
    const centerX = bounds.x + bounds.width / 2;
    const top = bounds.y + (bounds.height - stackHeight) / 2;
    const time = p.millis() / 1000;
    const amount = available ? normalized : 0;
    const maximumOffset = Math.min(70, bounds.width * 0.22) * amount;

    p.noStroke();
    p.fill(18, 18, 18, 28 + amount * 227);
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

  const drawAlphaRatio = (normalized, available, bounds) => {
    const maximumDiameter = Math.max(50, Math.min(bounds.width, bounds.height) * 0.72);
    const diameter = available ? maximumDiameter * Math.sqrt(normalized) : 0;
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;

    p.noStroke();
    p.fill(224, 224, 218);
    p.circle(centerX, centerY, maximumDiameter);
    if (diameter > 0) {
      p.fill(18, 18, 18, 28 + normalized * 227);
      p.circle(centerX, centerY, diameter);
    }
  };

  p.draw = () => {
    p.background(17);
    updateConnectButton();

    drawHeader();
    const panelBounds = getPanelBounds();
    const snapshot = DerivedSignals.getSnapshot();
    const panels = [
      [snapshot.contact, drawContact],
      [snapshot.highFrequencyActivity, drawMovement],
      [snapshot.alphaRatio, drawAlphaRatio],
    ];

    panels.forEach(([value, drawVisual], index) => {
      drawPanel(value, panelBounds[index], drawVisual);
    });
  };

  p.windowResized = () => {
    p.resizeCanvas(p.windowWidth, p.windowHeight);
    positionConnectButton();
  };
};

new p5(signalGuessingSketch);
