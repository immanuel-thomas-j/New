# AMSRS Guard — Coastal Rescue & Sea Watch (PWA)

A Progressive Web App (PWA) tailored specifically for lifeguards, first responders, and coastal patrol units.

---

### 🌊 Key Capabilities

1. **🚨 Instant Critical Alerting**
   * High-contrast pulsing emergency banner.
   * **Web Audio Siren**: Built-in dual-tone alarm synthesizer (no external audio files required).
   * **Haptic Vibration**: Rhythmic phone vibration pulses for pocket alerts.
   * **Screen Wake Lock**: Prevents screen sleep during active distress incidents.

2. **📊 Real-Time Sea & Environmental Telemetry**
   * **Water Wave Displacement Gauge**: Real-time height deviation from calibrated baseline.
   * **Target IR Temperature & Hypothermia Exposure Index**: Automatic triage indicator (Normal / Moderate Exposure Risk / Severe Hypothermia).
   * **Ambient Shore Temperature & Sea State Index**: Real-time coastal conditions.
   * **Beach Flag System**: 🟢 Green (Normal), 🟡 Yellow (Caution/En Route), 🔴 Red (Distress Active).

3. **📍 Offshore Sector Radar & Direction Compass**
   * Dynamic sweeping radar tracking victim coordinates in real time.
   * Target bearing (e.g., `048° NE`), distance estimation, and station zone (`Alpha-3`).

4. **⚡ Tactical First Responder Actions**
   * **"Acknowledge & En Route"**: Silences siren and broadcasts responder status back to base command.
   * **"Deploy Rescue Vessel"**: Remotely launches the autonomous rescue boat in the 3D simulation.
   * **"Stand Down / Reset"**: Clears false alarms and resets to safe state.
   * **"VHF Channel 16"**: Standardized international maritime Mayday broadcast dialer.

5. **📱 Complete Offline & PWA Support**
   * Installable to Home Screen on iOS, Android, and Desktop Chrome/Edge.
   * Service Worker caching (`sw.js`) for instant offline launch.
   * Inter-tab and cross-device communication via standard `BroadcastChannel('amsrs_rescue_channel')` and `window.postMessage` (zero cloud/Supabase dependencies needed).

---

### 🚀 How to Run & Test

1. **Directly open in browser:**
   Open `D:\AD2RS\Website - Copy\Guard-PWA\index.html` in your browser, or click **"Open Guard App"** directly from `amsrs-console-v2.html`.

2. **Live Sync with AMSRS Console & 3D Guardian:**
   * Open `amsrs-console-v2.html` (Ground Station).
   * Click **"Open Guardian"** (launches 3D simulation).
   * Click **"Open Guard App"** (launches Mobile Guard PWA).
   * Any hardware trigger, displacement spike, or manual dispatch will immediately sound the siren and alert the Guard PWA in real time!
