import React from 'react';
import { theme } from '../../../packages/shared/src/theme';
import { AdminBridge } from '../../../packages/shared/src/adminBridge';

const bridge = new AdminBridge();
const forms = bridge.registerForms();

export function AdminRenderer() {
  const verifier = bridge.registerVerifier();

  return (
    <div style={layout}>
      <header style={header}>
        <h1 style={title}>Verdium Admin</h1>
        <p style={subtitle}>Atrium Copia</p>
      </header>
      <main style={card}>
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
const header = { marginBottom: 24 } as const;
const title = { margin: 0, fontSize: 40, letterSpacing: 1 } as const;
const subtitle = { margin: '8px 0 0', color: theme.colors.muted, textTransform: 'uppercase', letterSpacing: 3, fontSize: 12 } as const;
const card = { background: theme.colors.surface, border: `1px solid ${theme.colors.accentSoft}`, borderRadius: 20, padding: 24, maxWidth: 900 } as const;
const sectionTitle = { marginTop: 0 } as const;
const body = { lineHeight: 1.6, color: theme.colors.text } as const;
const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginTop: 18 } as const;
const button = { background: theme.colors.accent, color: '#06110f', border: 'none', borderRadius: 14, padding: '14px 16px', fontWeight: 700 } as const;
const panel = { marginTop: 18, background: theme.colors.panel, borderRadius: 16, padding: 16 } as const;
const pre = { margin: 0, whiteSpace: 'pre-wrap', color: theme.colors.muted } as const;
