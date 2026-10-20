/** Fixed public errors only. Provider responses, object keys and credentials never become messages. */
export class CloudContentError extends Error {
  constructor(code, message, status = 503, fields) {
    super(message);
    this.code = code;
    this.status = status;
    if (fields) this.fields = fields;
  }
}
