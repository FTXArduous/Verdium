export const allowedDriverEmails = ['driver@verdium.example', 'fleet@verdium.example'];

export function isDriverEmail(email: string) {
  return allowedDriverEmails.includes(email.trim().toLowerCase());
}

export function verifyHashSerial(serial: string) {
  const clean = serial.replace(/\s+/g, '').toUpperCase();
  return /^[A-Z0-9]{48}$/.test(clean);
}

export function generateTestHash() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const seed = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`.toUpperCase();
  let value = '';

  for (let i = 0; i < 48; i += 1) {
    const code = seed.charCodeAt(i % seed.length) || (i * 17);
    value += alphabet[code % alphabet.length];
  }

  return value;
}
