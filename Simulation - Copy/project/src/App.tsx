import { useCallback, useEffect, useRef, useState } from 'react';
import { ShorelineScene, type SceneState } from './scene/ShorelineScene';
import { Hud, type LogEntry } from './components/Hud';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<ShorelineScene | null>(null);
  const [state, setState] = useState<SceneState>('IDLE');
  const [speed, setSpeed] = useState(0);
  const [victim, setVictim] = useState<{ x: number; z: number } | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logId = useRef(0);

  const addLog = useCallback((msg: string, type: 'new' | 'warn' = 'new') => {
    setLogs((prev) => [...prev, { id: logId.current++, msg, type }].slice(-12));
  }, []);

  useEffect(() => {
    if (!canvasRef.current) return;
    const scene = new ShorelineScene(canvasRef.current, {
      onArrive: () => {
        addLog('Victim reached. Recovery in progress.', 'warn');
      },
      onReturn: () => {
        addLog('Rescue complete. Unit returned to station.');
        setState('IDLE');
      },
      onIdle: () => setState('IDLE'),
      onLog: (msg, type) => addLog(msg, type),
      onTelemetry: (t) => {
        setSpeed(t.speed);
        setState(t.state);
      },
      onRadarVictim: (pos) => setVictim(pos),
    });
    sceneRef.current = scene;
    scene.start();
    addLog('Station online. Awaiting dispatch.');
    return () => scene.dispose();
  }, [addLog]);

  const launch = useCallback((payload?: any) => {
    const s = sceneRef.current;
    if (!s) return;
    const srcMsg = payload && payload.source ? ` (${payload.source})` : '';
    addLog(`Distress call received${srcMsg}. Launching rescue unit!`, 'warn');
    setState('RESCUE');
    s.triggerRescue();
  }, [addLog]);

  useEffect(() => {
    (window as any).triggerRescueExternal = (payload?: any) => {
      launch(payload);
    };

    let channel: BroadcastChannel | null = null;
    if ('BroadcastChannel' in window) {
      channel = new BroadcastChannel('amsrs_rescue_channel');
      channel.onmessage = (e) => {
        if (e.data && e.data.type === 'AMSRS_RESCUE') {
          launch(e.data.payload);
        } else if (e.data && e.data.type === 'AMSRS_PING') {
          channel?.postMessage({ type: 'GUARDIAN_READY' });
        }
      };
      // Announce ready over BroadcastChannel on mount
      channel.postMessage({ type: 'GUARDIAN_READY' });
    }

    const handleMessage = (e: MessageEvent) => {
      if (e.data && e.data.type === 'AMSRS_PING') {
        if (e.source && 'postMessage' in e.source) {
          (e.source as Window).postMessage({ type: 'GUARDIAN_READY' }, '*');
        }
      } else if (e.data && e.data.type === 'AMSRS_RESCUE') {
        launch(e.data.payload);
      }
    };

    window.addEventListener('message', handleMessage);

    if (window.opener) {
      try {
        window.opener.postMessage({ type: 'GUARDIAN_READY' }, '*');
      } catch (_) {}
    }

    return () => {
      delete (window as any).triggerRescueExternal;
      window.removeEventListener('message', handleMessage);
      if (channel) channel.close();
    };
  }, [launch]);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-950 font-sans">
      <canvas ref={canvasRef} className="block w-full h-full" />
      <Hud
        state={state}
        speed={speed}
        logs={logs}
        victim={victim}
        onLaunch={() => launch()}
      />
    </div>
  );
}

