export type MockConnectionState = 'offline' | 'wifi';

export class MockWifiConnection {
  private state: MockConnectionState = 'wifi';

  getStatus() {
    return this.state;
  }

  connect() {
    this.state = 'wifi';
    return this.state;
  }

  disconnect() {
    this.state = 'offline';
    return this.state;
  }
}
