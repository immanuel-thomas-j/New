// ─────────────────────────────────────────────────────────────────────────────
// AMSRS GUARD — TACTICAL FIELD PWA ENGINE v2.3
// ─────────────────────────────────────────────────────────────────────────────

class SoundSynth {
  constructor() {
    this.ctx = null;
    this.osc = null;
    this.gain = null;
    this.isPlaying = false;
    this.sirenInterval = null;
    this.muted = false;

    // Mobile Audio Unlock on first touch/tap
    const unlockAudio = () => {
      this._init();
      window.removeEventListener('touchstart', unlockAudio);
      window.removeEventListener('click', unlockAudio);
    };
    window.addEventListener('touchstart', unlockAudio, { passive: true });
    window.addEventListener('click', unlockAudio, { passive: true });
  }

  _init() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.ctx = new AudioContext();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  startSiren() {
    if (this.muted) return;
    this._init();
    if (!this.ctx || this.isPlaying) return;

    try {
      this.isPlaying = true;
      this.osc = this.ctx.createOscillator();
      this.gain = this.ctx.createGain();

      this.osc.type = 'sawtooth';
      this.gain.gain.setValueAtTime(0.25, this.ctx.currentTime);

      this.osc.connect(this.gain);
      this.gain.connect(this.ctx.destination);

      let toggle = false;
      this.osc.frequency.setValueAtTime(750, this.ctx.currentTime);
      this.osc.start();

      this.sirenInterval = setInterval(() => {
        if (!this.osc || !this.ctx) return;
        const now = this.ctx.currentTime;
        const targetFreq = toggle ? 880 : 587; // High-Low alarm tone
        this.osc.frequency.exponentialRampToValueAtTime(targetFreq, now + 0.35);
        toggle = !toggle;
      }, 400);
    } catch (e) {
      console.warn('Audio Siren Error:', e);
    }
  }

  stopSiren() {
    if (this.sirenInterval) {
      clearInterval(this.sirenInterval);
      this.sirenInterval = null;
    }
    if (this.osc) {
      try {
        this.osc.stop();
        this.osc.disconnect();
      } catch (_) {}
      this.osc = null;
    }
    this.isPlaying = false;
  }

  playBeep(freq = 600, duration = 0.15) {
    if (this.muted) return;
    this._init();
    if (!this.ctx) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch (_) {}
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.muted && this.isPlaying) {
      this.stopSiren();
    }
    return this.muted;
  }
}

class RadarVisualizer {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.angle = 0;
    this.target = null;
    this.blips = [];
    this.raf = null;
    this.start();
  }

  start() {
    const draw = () => {
      this.draw();
      this.raf = requestAnimationFrame(draw);
    };
    draw();
  }

  setTarget(x, y) {
    this.target = { x, y };
  }

  clearTarget() {
    this.target = null;
  }

  draw() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const r = w / 2 - 4;

    ctx.fillStyle = '#061122';
    ctx.fillRect(0, 0, w, h);

    // Range Rings
    ctx.strokeStyle = 'rgba(2, 132, 199, 0.2)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, (r * i) / 3, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Crosshairs
    ctx.beginPath();
    ctx.moveTo(cx, 4);
    ctx.lineTo(cx, h - 4);
    ctx.moveTo(4, cy);
    ctx.lineTo(w - 4, cy);
    ctx.strokeStyle = 'rgba(2, 132, 199, 0.15)';
    ctx.stroke();

    // Sweep Line and Gradient Trail
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.angle);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(r, 0);
    ctx.strokeStyle = 'rgba(2, 132, 199, 0.9)';
    ctx.lineWidth = 2;
    ctx.stroke();

    for (let a = 0; a < Math.PI * 0.5; a += 0.05) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(r * Math.cos(-a), r * Math.sin(-a));
      ctx.strokeStyle = `rgba(2, 132, 199, ${0.1 * (1 - a / (Math.PI * 0.5))})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();

    // Draw Target Blip
    if (this.target) {
      const tx = cx + this.target.x * (r - 12);
      const ty = cy - this.target.y * (r - 12);
      ctx.beginPath();
      ctx.arc(tx, ty, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#dc2626';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(tx, ty, 10 + Math.sin(Date.now() / 150) * 3, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(220, 38, 38, 0.7)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Ambient random blips
    if (Math.random() < 0.02) {
      const a = Math.random() * Math.PI * 2;
      const d = 15 + Math.random() * (r - 20);
      this.blips.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, life: 1.0 });
    }

    this.blips = this.blips.filter((b) => b.life > 0);
    this.blips.forEach((b) => {
      b.life -= 0.008;
      ctx.beginPath();
      ctx.arc(b.x, b.y, 2, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(2, 132, 199, ${b.life * 0.6})`;
      ctx.fill();
    });

    this.angle = (this.angle + 0.035) % (Math.PI * 2);
  }
}

class GuardPWA {
  constructor() {
    this.sound = new SoundSynth();
    this.radar = new RadarVisualizer('guardRadar');
    this.wakeLock = null;
    this.activeAlert = false;
    this.baselineDepth = null;
    this.lastData = { depth: 12.4, initial: 12.0, ambient: 26.8, object: 33.5, status: 'NORMAL' };
    this.guardStatus = 'ON_DUTY';
    this.deferredPrompt = null;
    this.pollTimer = null;

    this.initNetworkSync();
    this.initDOM();
    this.initTheme();
    this.initPWA();
    this.log('AMSRS Guard Field PWA ready. Real-time telemetry monitoring.', 'success');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // THEME MANAGEMENT
  // ───────────────────────────────────────────────────────────────────────────
  initTheme() {
    this.currentTheme = localStorage.getItem('guard_theme') || 'light';
    this.applyTheme(this.currentTheme);

    const themeBtn = document.getElementById('btnTheme');
    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        this.currentTheme = this.currentTheme === 'light' ? 'dark' : 'light';
        localStorage.setItem('guard_theme', this.currentTheme);
        this.applyTheme(this.currentTheme);
        this.sound.playBeep(950, 0.05);
      });
    }
  }

  applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const themeIcon = document.getElementById('themeIcon');
    if (themeIcon) {
      themeIcon.innerHTML = theme === 'light'
        ? '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'
        : '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
    }
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', theme === 'light' ? '#f1f5f9' : '#060911');
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // MULTI-CHANNEL NETWORK SYNC (WebSocket + SSE + Polling + BroadcastChannel)
  // ───────────────────────────────────────────────────────────────────────────
  initNetworkSync() {
    this.initWebSocket();
    this.initSSE();
    this.initBroadcastChannel();
    this.startTelemetryPolling();
  }

  initWebSocket() {
    let wsUrl = '';
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      wsUrl = `${wsProto}//${location.host}`;
    } else {
      wsUrl = 'ws://10.197.28.147:8080';
    }

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.setLinkStatus(true, 'LIVE SYNCED (WS)');
        this.log('Connected to AMSRS Live WebSocket Relay.', 'success');
      };

      this.ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          this.handleIncomingEvent(data);
        } catch (_) {}
      };

      this.ws.onclose = () => {
        this.setLinkStatus(false, 'RECONNECTING...');
        setTimeout(() => this.initWebSocket(), 3000);
      };

      this.ws.onerror = () => {
        try { this.ws.close(); } catch (_) {}
      };
    } catch (err) {
      setTimeout(() => this.initWebSocket(), 3000);
    }
  }

  initSSE() {
    if (typeof EventSource !== 'undefined' && (location.protocol === 'http:' || location.protocol === 'https:')) {
      try {
        const sse = new EventSource('/api/events');
        sse.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            if (data.type === 'INIT') {
              if (data.telemetry) this.updateTelemetry(data.telemetry);
              if (data.distress) this.triggerDistressAlert(data.distress);
            } else {
              this.handleIncomingEvent(data);
            }
          } catch (_) {}
        };
      } catch (_) {}
    }
  }

  startTelemetryPolling() {
    const fetchSnapshot = () => {
      if (location.protocol === 'http:' || location.protocol === 'https:') {
        fetch('/api/telemetry', { cache: 'no-store' })
          .then((r) => r.json())
          .then((data) => {
            if (data.telemetry) {
              this.updateTelemetry(data.telemetry);
              this.setLinkStatus(true, 'LIVE SYNCED (HTTP)');
            }
            if (data.distress && !this.activeAlert && this.guardStatus !== 'RESPONDING') {
              this.triggerDistressAlert(data.distress);
            } else if (!data.distress && this.activeAlert && this.guardStatus === 'ON_DUTY') {
              this.dismissAlert(false);
            }
          })
          .catch(() => {});
      }
    };

    fetchSnapshot();
    this.pollTimer = setInterval(fetchSnapshot, 2000);
  }

  initBroadcastChannel() {
    if ('BroadcastChannel' in window) {
      this.channel = new BroadcastChannel('amsrs_rescue_channel');
      this.channel.onmessage = (e) => {
        const data = e.data;
        if (!data) return;
        this.handleIncomingEvent(data);
      };
      this.channel.postMessage({ type: 'AMSRS_PING' });
    }

    window.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'AMSRS_RESCUE') {
        this.triggerDistressAlert(e.data.payload || {});
      }
    });
  }

  handleIncomingEvent(data) {
    if (data.type === 'AMSRS_TELEMETRY') {
      this.updateTelemetry(data.payload || {});
    } else if (data.type === 'AMSRS_RESCUE') {
      this.triggerDistressAlert(data.payload || {});
    } else if (data.type === 'GUARD_STANDDOWN') {
      this.dismissAlert(false);
    } else if (data.type === 'GUARD_ACK') {
      this.log(`Guard ${data.payload?.guardId || 'Patrol'} acknowledged alert.`, 'data');
    }
  }

  sendNetworkMessage(type, payload = {}) {
    const msgObj = { type, payload, timestamp: Date.now() };

    // 1. WebSocket
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try { this.ws.send(JSON.stringify(msgObj)); } catch (_) {}
    }

    // 2. BroadcastChannel
    if (this.channel) {
      try { this.channel.postMessage(msgObj); } catch (_) {}
    }

    // 3. HTTP Endpoint fallback
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      const endpoint = type === 'AMSRS_RESCUE' ? '/api/rescue'
                     : type === 'GUARD_ACK' ? '/api/guard_ack'
                     : type === 'GUARD_STANDDOWN' ? '/api/standdown'
                     : null;
      if (endpoint) {
        fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).catch(() => {});
      }
    }
  }

  setLinkStatus(linked, customText) {
    const dot = document.getElementById('linkDot');
    const text = document.getElementById('linkText');
    if (dot && text) {
      dot.style.backgroundColor = linked ? '#059669' : '#dc2626';
      text.textContent = customText || (linked ? 'AMSRS SYNCED' : 'STANDALONE');
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // DOM & PWA
  // ───────────────────────────────────────────────────────────────────────────
  initDOM() {
    document.getElementById('btnMute').addEventListener('click', () => {
      const isMuted = this.sound.toggleMute();
      document.getElementById('btnMute').classList.toggle('active', !isMuted);
      const icon = document.getElementById('muteIcon');
      if (icon) {
        icon.innerHTML = isMuted
          ? '<path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>'
          : '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>';
      }
    });

    document.getElementById('btnRespond').addEventListener('click', () => this.acknowledgeAlert());
    document.getElementById('btnDismiss').addEventListener('click', () => this.dismissAlert(true));
    document.getElementById('btnQuickDeploy').addEventListener('click', () => this.deployVessel());
    document.getElementById('btnTestAlert').addEventListener('click', () => this.triggerDrill());
    document.getElementById('btnVhfRadio').addEventListener('click', () => this.openVhfModal());
    document.getElementById('btnCloseVhf').addEventListener('click', () => this.closeVhfModal());
    document.getElementById('btnBroadcastVhf').addEventListener('click', () => this.broadcastVhf());

    const missionDeploy = document.getElementById('btnMissionDeploy');
    if (missionDeploy) missionDeploy.addEventListener('click', () => this.deployVessel());

    const missionStanddown = document.getElementById('btnMissionStanddown');
    if (missionStanddown) missionStanddown.addEventListener('click', () => this.dismissAlert(true));

    document.querySelectorAll('.nav-item').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.sound.playBeep(800, 0.08);
      });
    });
  }

  initPWA() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker
          .register('./sw.js')
          .then((reg) => reg.update())
          .catch((err) => console.warn('SW registration:', err));
      });
    }

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredPrompt = e;
      const banner = document.getElementById('installBanner');
      if (banner) banner.classList.add('active');
    });

    const installBtn = document.getElementById('btnInstallApp');
    if (installBtn) {
      installBtn.addEventListener('click', async () => {
        if (!this.deferredPrompt) return;
        this.deferredPrompt.prompt();
        const { outcome } = await this.deferredPrompt.userChoice;
        console.log('User install outcome:', outcome);
        this.deferredPrompt = null;
        document.getElementById('installBanner').classList.remove('active');
      });
    }
  }

  async acquireWakeLock() {
    if ('wakeLock' in navigator) {
      try {
        this.wakeLock = await navigator.wakeLock.request('screen');
      } catch (_) {}
    }
  }

  releaseWakeLock() {
    if (this.wakeLock) {
      this.wakeLock.release();
      this.wakeLock = null;
    }
  }

  vibrate(pattern = [500, 200, 500, 200, 1000]) {
    if ('vibrate' in navigator) {
      try { navigator.vibrate(pattern); } catch (_) {}
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TELEMETRY & CONDITIONS LOGIC
  // ───────────────────────────────────────────────────────────────────────────
  updateTelemetry(data) {
    if (!data) return;
    this.lastData = Object.assign(this.lastData, data);

    // 1. Baseline Calibration
    if (data.initial !== undefined && data.initial !== null) {
      this.baselineDepth = parseFloat(data.initial);
    } else if (this.baselineDepth === null && data.depth !== undefined && data.depth !== null) {
      this.baselineDepth = parseFloat(data.depth);
    }

    const baseline = this.baselineDepth !== null ? this.baselineDepth : 12.0;

    // 2. Displacement Wave Height
    let depthVal = null;
    if (data.depth !== undefined && data.depth !== null) {
      depthVal = parseFloat(data.depth);
    } else if (data.distance !== undefined && data.distance !== null) {
      depthVal = parseFloat(data.distance);
    }

    let delta = 0;
    if (depthVal !== null && !isNaN(depthVal)) {
      document.getElementById('valDisplacement').textContent = depthVal.toFixed(1);
      delta = depthVal - baseline;
      document.getElementById('subDisplacement').textContent = `Δ: ${delta >= 0 ? '+' : ''}${delta.toFixed(1)} cm (Baseline: ${baseline}cm)`;

      const barFill = document.getElementById('displacementFill');
      if (barFill) {
        const pct = Math.min(100, Math.max(10, (depthVal / 40) * 100));
        barFill.style.width = `${pct}%`;
        barFill.classList.toggle('danger', delta > 8);
      }
    }

    // 3. Ambient Shore Temperature
    const amb = data.ambient ?? data.ambientTemp ?? data.temp;
    if (amb !== undefined && amb !== null) {
      const ambVal = parseFloat(amb);
      if (!isNaN(ambVal)) document.getElementById('valAmbient').textContent = ambVal.toFixed(1);
    }

    // 4. Target IR Body Temperature
    const obj = data.object ?? data.objectTemp ?? data.targetTemp ?? data.irTemp;
    let objVal = null;
    if (obj !== undefined && obj !== null) {
      objVal = parseFloat(obj);
      if (!isNaN(objVal)) {
        document.getElementById('valObject').textContent = objVal.toFixed(1);

        const hypoEl = document.getElementById('hypoRisk');
        if (hypoEl) {
          if (objVal >= 38.0) {
            hypoEl.textContent = 'High Body IR Thermal Spike';
            hypoEl.style.color = '#dc2626';
          } else if (objVal >= 35.0) {
            hypoEl.textContent = 'Normal Human Thermal Range';
            hypoEl.style.color = '#059669';
          } else if (objVal >= 28.0) {
            hypoEl.textContent = 'Moderate Exposure Risk';
            hypoEl.style.color = '#d97706';
          } else {
            hypoEl.textContent = 'Severe Hypothermia Risk';
            hypoEl.style.color = '#dc2626';
          }
        }
      }
    }

    // 5. Beach Safety Flag Status
    if (!this.activeAlert && this.guardStatus === 'ON_DUTY') {
      const statusStr = (data.status || '').toLowerCase();
      const flagPill = document.getElementById('flagStatus');

      const isDanger = statusStr.includes('red') || statusStr.includes('danger') || statusStr.includes('high') ||
                       delta > 8 || (objVal !== null && objVal >= 38.0);
      const isWarn = statusStr.includes('warn') || statusStr.includes('yellow') || statusStr.includes('orange') ||
                     delta > 4 || (objVal !== null && objVal < 32.0);

      if (flagPill) {
        if (isDanger) {
          flagPill.className = 'flag-pill danger';
          flagPill.innerHTML = '<span class="dot-indicator"></span> RED FLAG · CRITICAL WAVE / THERMAL SPIKE';
        } else if (isWarn) {
          flagPill.className = 'flag-pill warn';
          flagPill.innerHTML = '<span class="dot-indicator"></span> YELLOW FLAG · MODERATE SURGE / CAUTION';
        } else {
          flagPill.className = 'flag-pill safe';
          flagPill.innerHTML = '<span class="dot-indicator"></span> GREEN FLAG · NORMAL CONDITIONS';
        }
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // EMERGENCY DISTRESS & ACTION HANDLERS
  // ───────────────────────────────────────────────────────────────────────────
  triggerDistressAlert(payload = {}) {
    this.activeAlert = true;
    this.guardStatus = 'EMERGENCY';
    this.acquireWakeLock();
    this.sound.startSiren();
    this.vibrate([600, 200, 600, 200, 1200]);

    const banner = document.getElementById('distressBanner');
    const missionBanner = document.getElementById('missionBanner');
    if (missionBanner) missionBanner.classList.remove('active');

    const dispVal = payload.depth !== undefined && payload.depth !== null ? parseFloat(payload.depth) : this.lastData.depth;
    const tempVal = payload.object !== undefined && payload.object !== null ? parseFloat(payload.object) : this.lastData.object;
    const reasonStr = payload.reason || payload.status || 'Critical threshold anomaly detected.';
    const sourceStr = payload.source || 'AMSRS BUOY ARRAY #1';
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const elDisp = document.getElementById('alertDispVal');
    const elTemp = document.getElementById('alertTempVal');
    const elReason = document.getElementById('alertReasonText');
    const elSource = document.getElementById('alertSourceText');
    const elTime = document.getElementById('alertTime');

    if (elDisp) elDisp.textContent = `${dispVal.toFixed(1)} cm`;
    if (elTemp) elTemp.textContent = `${tempVal.toFixed(1)} °C`;
    if (elReason) elReason.textContent = reasonStr;
    if (elSource) elSource.textContent = `${sourceStr} · Sector Alpha-3`;
    if (elTime) elTime.textContent = timeStr;

    if (banner) banner.classList.add('active');

    // Update telemetry cards to match distress metrics
    this.updateTelemetry({
      depth: dispVal,
      object: tempVal,
      ambient: payload.ambient ?? this.lastData.ambient,
      status: 'CRITICAL DISTRESS'
    });

    const flagPill = document.getElementById('flagStatus');
    if (flagPill) {
      flagPill.className = 'flag-pill danger';
      flagPill.innerHTML = '<span class="dot-indicator"></span> RED FLAG · DISTRESS ACTIVE';
    }

    this.radar.setTarget(0.45, 0.55);
    const radarStatus = document.getElementById('radarStatusText');
    if (radarStatus) {
      radarStatus.textContent = 'TARGET LOCKED · 048° NE';
      radarStatus.style.color = '#dc2626';
    }

    this.log(`DISTRESS ALERT: ${reasonStr} (Wave: ${dispVal}cm, IR: ${tempVal}°C)`, 'alert');
  }

  acknowledgeAlert() {
    this.sound.stopSiren();
    this.guardStatus = 'RESPONDING';

    const banner = document.getElementById('distressBanner');
    if (banner) banner.classList.remove('active');

    const missionBanner = document.getElementById('missionBanner');
    if (missionBanner) missionBanner.classList.add('active');

    const flagPill = document.getElementById('flagStatus');
    if (flagPill) {
      flagPill.className = 'flag-pill warn';
      flagPill.innerHTML = '<span class="dot-indicator"></span> RESCUE EN ROUTE · GUARD RESPONDING';
    }

    this.sendNetworkMessage('GUARD_ACK', { guardId: 'TOWER-04', timestamp: Date.now() });
    this.log('Guard ACKNOWLEDGED alert. Response protocol initiated.', 'success');
  }

  dismissAlert(broadcast = true) {
    this.sound.stopSiren();
    this.releaseWakeLock();
    this.activeAlert = false;
    this.guardStatus = 'ON_DUTY';

    const banner = document.getElementById('distressBanner');
    if (banner) banner.classList.remove('active');

    const missionBanner = document.getElementById('missionBanner');
    if (missionBanner) missionBanner.classList.remove('active');

    const flagPill = document.getElementById('flagStatus');
    if (flagPill) {
      flagPill.className = 'flag-pill safe';
      flagPill.innerHTML = '<span class="dot-indicator"></span> GREEN FLAG · NORMAL CONDITIONS';
    }

    this.radar.clearTarget();
    const radarStatus = document.getElementById('radarStatusText');
    if (radarStatus) {
      radarStatus.textContent = 'SECTOR CLEAR · SCANNING';
      radarStatus.style.color = 'var(--brand-cyan)';
    }

    if (broadcast) {
      this.sendNetworkMessage('GUARD_STANDDOWN', { timestamp: Date.now() });
    }

    this.log('Alert dismissed / Stand down confirmed.', 'data');
  }

  deployVessel() {
    this.sound.playBeep(900, 0.25);
    this.sendNetworkMessage('AMSRS_RESCUE', {
      source: 'GUARD PWA HANDHELD',
      reason: 'Manual vessel dispatch by lifeguard',
      timestamp: Date.now()
    });
    this.log('Remote vessel deployment triggered via handheld PWA.', 'alert');
    alert('Rescue Boat deployed! Signal transmitted to Coast Guard Shoreline Station.');
  }

  triggerDrill() {
    this.triggerDistressAlert({
      source: 'MOCK DRILL / TEST TRIGGER',
      reason: 'Wave Displacement Spike (+14.8cm) & Elevated IR Signature (38.2°C)',
      depth: 26.8,
      ambient: 24.5,
      object: 38.2,
      status: 'HIGH ALERT'
    });
  }

  openVhfModal() {
    document.getElementById('vhfModal').classList.add('active');
  }

  closeVhfModal() {
    document.getElementById('vhfModal').classList.remove('active');
  }

  broadcastVhf() {
    this.sound.playBeep(1200, 0.3);
    this.closeVhfModal();
    this.sendNetworkMessage('AMSRS_RESCUE', {
      source: 'VHF CH-16 MAYDAY BROADCAST',
      reason: 'Emergency Mayday radio broadcast',
      timestamp: Date.now()
    });
    this.log('VHF Channel 16 Mayday Broadcast logged to coastal network.', 'alert');
    alert('VHF Channel 16 Emergency Mayday broadcast transmitted.');
  }

  log(msg, type = 'data') {
    const time = new Date().toLocaleTimeString([], { hour12: false });
    const list = document.getElementById('logList');
    if (!list) return;

    const item = document.createElement('div');
    item.className = `log-item ${type}`;
    item.innerHTML = `<span class="time">[${time}]</span> <span>${msg}</span>`;

    list.prepend(item);
    if (list.childElementCount > 40) {
      list.removeChild(list.lastChild);
    }
  }
}

// Auto-instantiate on DOM Ready
window.addEventListener('DOMContentLoaded', () => {
  window.guardApp = new GuardPWA();
});
