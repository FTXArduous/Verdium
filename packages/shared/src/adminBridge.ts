import { allowedDriverEmails, verifyHashSerial } from './security';

export class AdminBridge {
  boot() {
    this.registerForms();
    this.registerVerifier();
    this.registerSecureHandoff();
  }

  registerForms() {
    return ['vehicle-id', 'insurance', 'invoice', 'tax-summary', 'payment-review'];
  }

  registerVerifier() {
    return {
      allowedDriverEmails,
      verifyHashSerial,
    };
  }

  registerSecureHandoff() {
    return 'driver data must pass through Verdium Admin before delivery release';
  }
}
