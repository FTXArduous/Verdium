import React from 'react';
import { MockWifiConnection } from './mockNetwork';
import { createLogEvent } from './logger';
import { theme } from './theme';

const connection = new MockWifiConnection();

export function CustomerShell() {
  const wifi = connection.getStatus();

  const logAction = (action: string) => {
    const event = createLogEvent('customer', action);
    console.log(JSON.stringify(event));
  };

  return (
    <div style={layout}>
      <header style={header}>
        <h1 style={title}>Verdium</h1>
        <p style={subtitle}>{theme.subtitle}</p>
      </header>
      <main style={card}>
        <h2 style={sectionTitle}>Customer Access</h2>
        <p style={body}>Customer accounts stay separate from driver accounts. QR connect, invoice upload, and payment details live here.</p>
        <div style={footerButtons}>
          <button style={button} onClick={() => logAction('qr-connect')}>QR Connect</button>
          <button style={button} onClick={() => logAction('invoice-upload')}>Invoice Upload</button>
          <button style={button} onClick={() => logAction('credit-card')}>Credit Card</button>
        </div>
        <p style={status}>Mock internet: {wifi}</p>
      </main>
    </div>
  );
}

const layout = { minHeight: '100vh', background: theme.colors.background, color: theme.colors.text, padding: 24, fontFamily: 'system-ui, sans-serif' } as const;
const header = { marginBottom: 24 } as const;
const title = { margin: 0, fontSize: 40, letterSpacing: 1 } as const;
const subtitle = { margin: '8px 0 0', color: theme.colors.muted, textTransform: 'uppercase', letterSpacing: 3, fontSize: 12 } as const;
const card = { background: theme.colors.surface, border: `1px solid ${theme.colors.accentSoft}`, borderRadius: 20, padding: 24, maxWidth: 720 } as const;
const sectionTitle = { marginTop: 0 } as const;
const body = { lineHeight: 1.6, color: theme.colors.text } as const;
const footerButtons = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginTop: 24 } as const;
const button = { background: theme.colors.accent, color: '#06110f', border: 'none', borderRadius: 14, padding: '14px 16px', fontWeight: 700 } as const;
const status = { marginTop: 20, color: theme.colors.muted } as const;
