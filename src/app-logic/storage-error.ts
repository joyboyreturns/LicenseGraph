/** A durable write failed; callers must stop before making any external payment request. */
export class StorageError extends Error {
  constructor(options?: ErrorOptions) {
    super("Could not durably save this run. No further payment operation can start until storage recovers.", options);
    this.name = "StorageError";
  }
}
