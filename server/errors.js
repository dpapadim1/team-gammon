export class ProtocolError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'ProtocolError';
    this.code = code;
  }
}

export function fail(code, message) {
  throw new ProtocolError(code, message);
}
