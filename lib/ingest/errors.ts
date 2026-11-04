// Typed ingestion errors. Callers map `code` to a copy key; no display text here.

export class IngestError extends Error {
  constructor(
    readonly code: "invalid_phone" | "unknown_line" | "missing_actor" | "invalid_actor" | "invalid_time",
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** The phone can't be read as an Indonesian number. */
export class InvalidPhoneError extends IngestError {
  constructor(input: string) {
    super("invalid_phone", `Not an Indonesian phone number: ${input}`);
  }
}

/** waLineId doesn't name an active WhatsApp line. */
export class UnknownLineError extends IngestError {
  constructor(lineId: string) {
    super("unknown_line", `No active WhatsApp line ${lineId}`);
  }
}

/** A quick-add lead needs the rep who logged it. */
export class MissingActorError extends IngestError {
  constructor() {
    super("missing_actor", "manual_quick_add needs opts.actorId");
  }
}

/** The logging user isn't an active rep, sales lead, CEO or admin. */
export class InvalidActorError extends IngestError {
  constructor(actorId: string) {
    super("invalid_actor", `User ${actorId} can't log leads`);
  }
}

/** receivedAt isn't a readable time, or is in the future. */
export class InvalidTimeError extends IngestError {
  constructor(input: string) {
    super("invalid_time", `Not a usable received time: ${input}`);
  }
}
