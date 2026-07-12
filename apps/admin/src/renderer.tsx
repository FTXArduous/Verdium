import React, { useEffect, useMemo, useState } from 'react';
import { theme } from '../../../packages/shared/src/theme';
import { AdminBridge } from '../../../packages/shared/src/adminBridge';

const bridge = new AdminBridge();
const forms = bridge.registerForms();

export function AdminRenderer() {
  const verifier = bridge.registerVerifier();
  const [startupHealth, setStartupHealth] = useState<any>(null);
  const [wifiSimulationEnabled, setWifiSimulationEnabled] = useState(false);

  useEffect(() => {
    const adminApi = (window as any)?.verdiumAdmin;
    if (!adminApi?.getStartupHealth) {
      return;
    }
    adminApi.getStartupHealth().then(setStartupHealth).catch(() => {
      setStartupHealth({
        apiConfigured: false,
        apiReachable: false,
        apiReason: 'Startup health check unavailable.',
        ffmpegExists: true,
      });
    });
  }, []);

  const startupMessage = useMemo(() => {
    if (!startupHealth) {
      return 'Checking startup health...';
    }

    const notes = [];
    if (startupHealth.wifiSimulationMode) {
      notes.push('Wi-Fi simulation is active. Server functions are disabled.');
      if (startupHealth.simulatedProfile?.email) {
        notes.push(`Local sign-in: ${startupHealth.simulatedProfile.email}.`);
      }
    } else if (!startupHealth.apiConfigured) {
      notes.push('API is not configured. App loaded in local mode.');
    } else if (!startupHealth.apiReachable) {
      notes.push('API did not respond at startup. App loaded in local mode.');
    } else {
      notes.push('API reachable.');
    }

    if (!startupHealth.ffmpegExists) {
      notes.push('ffmpeg.dll is missing; media features may be limited.');
      if (startupHealth.ffmpegRepairSource) {
        notes.push(`Repair attempted from: ${startupHealth.ffmpegRepairSource}.`);
      }
      if (startupHealth.ffmpegRepairError) {
        notes.push(`Repair error: ${startupHealth.ffmpegRepairError}.`);
      }
    } else if (startupHealth.ffmpegRepaired) {
      notes.push('ffmpeg.dll was repaired automatically at startup.');
    }

    return notes.join(' ');
  }, [startupHealth]);

  const toggleWifiSimulation = async () => {
    const enabled = !wifiSimulationEnabled;
    const adminApi = (window as any)?.verdiumAdmin;
    if (!adminApi?.setWifiSimulation) {
      return;
    }
    const result = await adminApi.setWifiSimulation(enabled);
    setWifiSimulationEnabled(result.enabled);
    setStartupHealth(await adminApi.getStartupHealth());
  };

  return (
    <div style={layout}>
      <header style={header}>
        <div>
          <h1 style={title}>Verdium Admin</h1>
          <p style={subtitle}>Atrium Copia</p>
        </div>
        <label style={simulationToggle}>
          <span>Wi-Fi Sim</span>
          <input type="checkbox" checked={wifiSimulationEnabled} onChange={toggleWifiSimulation} />
        </label>
      </header>
      <main style={card}>
        <div style={startupBanner}>
          <strong>Startup Status</strong>
          <p style={startupText}>{startupMessage}</p>
        </div>
        <h2 style={sectionTitle}>Form Gateway</h2>
        <p style={body}>All driver-side vehicle, insurance, invoice, and tax submissions must pass through this desktop executable before release.</p>
        <div style={grid}>
          {forms.map((form) => (
            <button key={form} style={button}>{form}</button>
          ))}
        </div>
        <div style={panel}>
          <strong>Verifier</strong>
          <pre style={pre}>{JSON.stringify(verifier, null, 2)}</pre>
        </div>
      </main>
    </div>
  );
}

const layout = { minHeight: '100vh', background: theme.colors.background, color: theme.colors.text, padding: 24, fontFamily: 'system-ui, sans-serif' } as const;
const header = { marginBottom: 24, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 } as const;
const title = { margin: 0, fontSize: 40, letterSpacing: 1 } as const;
const subtitle = { margin: '8px 0 0', color: theme.colors.muted, textTransform: 'uppercase', letterSpacing: 3, fontSize: 12 } as const;
const card = { background: theme.colors.surface, border: `1px solid ${theme.colors.accentSoft}`, borderRadius: 20, padding: 24, maxWidth: 900 } as const;
const sectionTitle = { marginTop: 0 } as const;
const body = { lineHeight: 1.6, color: theme.colors.text } as const;
const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginTop: 18 } as const;
const button = { background: theme.colors.accent, color: '#06110f', border: 'none', borderRadius: 14, padding: '14px 16px', fontWeight: 700 } as const;
const startupBanner = { marginBottom: 16, background: theme.colors.panel, borderRadius: 14, border: `1px solid ${theme.colors.accentSoft}`, padding: 12 } as const;
const startupText = { margin: '8px 0 0', color: theme.colors.muted, lineHeight: 1.45 } as const;
const simulationToggle = { display: 'flex', alignItems: 'center', gap: 8, color: theme.colors.muted, fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' } as const;
const panel = { marginTop: 18, background: theme.colors.panel, borderRadius: 16, padding: 16 } as const;
const pre = { margin: 0, whiteSpace: 'pre-wrap', color: theme.colors.muted } as const;
