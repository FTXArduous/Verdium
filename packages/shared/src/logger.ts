export type LogEvent = {
  scope: 'customer' | 'driver' | 'admin';
  action: string;
  detail?: string;
  createdAt: string;
};

export function createLogEvent(scope: LogEvent['scope'], action: string, detail = ''): LogEvent {
  return {
    scope,
    action,
    detail,
    createdAt: new Date().toISOString(),
  };
}
