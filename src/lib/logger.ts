interface LogFields {
  [key: string]: unknown;
}

function write(level: 'info' | 'error' | 'debug', message: string, fields: LogFields = {}): void {
  const payload = { level, message, ...fields };
  console.log(JSON.stringify(payload));
}

export function logInfo(message: string, fields?: LogFields): void {
  write('info', message, fields);
}

export function logError(message: string, fields?: LogFields): void {
  write('error', message, fields);
}

export function logDebug(message: string, fields?: LogFields): void {
  write('debug', message, fields);
}
