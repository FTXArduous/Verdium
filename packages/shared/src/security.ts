export const allowedDriverEmails = ['driver@verdium.example', 'fleet@verdium.example'];

export function isDriverEmail(email: string) {
  return allowedDriverEmails.includes(email.trim().toLowerCase());
}

export function verifyHashSerial(serial: string) {
  const clean = serial.replace(/\s+/g, '').toUpperCase();
  return /^[A-Z0-9]{48}$/.test(clean);
}
