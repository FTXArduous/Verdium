import React from 'react';
import { createLogEvent } from './logger';
import { isDriverEmail, verifyHashSerial } from './security';
import { MockWifiConnection } from './mockNetwork';
import { theme } from './theme';

const connection = new MockWifiConnection();

const driverInbox = [
  { id: 'D-1001', customer: 'Pending customer', receivedAt: '08:12', status: 'queued' },
  { id: 'D-1002', customer: 'Pending customer', receivedAt: '08:18', status: 'queued' },
  { id: 'D-1003', customer: 'Pending customer', receivedAt: '08:31', status: 'queued' },
];

export function DriverShell() {
  const wifi = connection.getStatus();
  const driverEmail = 'driver@verdium.example';
  const accessGranted = isDriverEmail(driverEmail);
  const invoiceVerified = verifyHashSerial('A'.repeat(48));

  const logAction = (action: string) => {
    const event = createLogEvent('driver', action);
    console.log(JSON.stringify(event));
  };

  return (
    <div style={layout}>
      <header style={header}>
        <h1 style={title}>Verdium Driver</h1>
        <p style={subtitle}>{theme.subtitle}</p>
      </header>
      <main style={grid}>
        <section style={card}>
          <h2 style={sectionTitle}>Driver Security</h2>
          <p style={body}>Driver access is email-gated and separated from customer accounts. Taxes, mileage, payouts, vehicle data, and insurance stay here.</p>
          <p style={status}>{accessGranted ? 'Approved driver account' : 'Access blocked'}</p>
          <p style={status}>Mock internet: {wifi}</p>
        </section>
        <section style={card}>
          <h2 style={sectionTitle}>Delivery Queue</h2>
          <ul style={list}>
            {driverInbox.map((job) => (
              <li key={job.id} style={listItem}>
                <strong>{job.id}</strong>
                <span>{job.customer}</span>
                <span>{job.receivedAt}</span>
                <span>{job.status}</span>
              </li>
            ))}
          </ul>
        </section>
        <section style={card}>
          <h2 style={sectionTitle}>Admin-Gated Forms</h2>
          <p style={body}>Car identification and insurance forms are routed to Verdium Admin first. The driver app cannot complete handoff until admin verification succeeds.</p>
          <p style={status}>Hash verifier: {invoiceVerified ? 'passed' : 'failed'}</p>
          <div style={footerButtons}>
            <button style={button} onClick={() => logAction('sent')}>Sent</button>
            <button style={button} onClick={() => logAction('delivered')}>Delivered</button>
            <button style={button} onClick={() => logAction('send-vehicle-id')}>Send Vehicle ID</button>
            <button style={button} onClick={() => logAction('send-insurance')}>Send Insurance</button>
            <button style={button} onClick={() => logAction('payout-setup')}>Payout Setup</button>
            <button style={button} onClick={() => logAction('tax-records')}>Tax Records</button>
          </div>
        </section>
        <section style={card}>
          <h2 style={sectionTitle}>Banking</h2>
          <p style={body}>Driver bank or bank card information stays on the driver side only.</p>
          <button style={button} onClick={() => logAction('add-bank-details')}>Add Bank Details</button>
        </section>
      </main>
    </div>
  );
}

const layout = { minHeight: '100vh', background: theme.colors.background, color: theme.colors.text, padding: 24, fontFamily: 'system-ui, sans-serif' } as const;
const header = { marginBottom: 24 } as const;
const title = { margin: 0, fontSize: 40, letterSpacing: 1 } as const;
const subtitle = { margin: '8px 0 0', color: theme.colors.muted, textTransform: 'uppercase', letterSpacing: 3, fontSize: 12 } as const;
const grid = { display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' } as const;
const card = { background: theme.colors.surface, border: `1px solid ${theme.colors.accentSoft}`, borderRadius: 20, padding: 24 } as const;
const sectionTitle = { marginTop: 0 } as const;
const body = { lineHeight: 1.6, color: theme.colors.text } as const;
const status = { marginTop: 12, color: theme.colors.muted } as const;
const list = { listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 } as const;
const listItem = { display: 'grid', gap: 4, background: theme.colors.panel, padding: 12, borderRadius: 14 } as const;
const footerButtons = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginTop: 16 } as const;
const button = { background: theme.colors.accent, color: '#06110f', border: 'none', borderRadius: 14, padding: '14px 16px', fontWeight: 700 } as const;
