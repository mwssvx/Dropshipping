import { z } from "zod";

// Zod 4 words a missing value as "Invalid input: expected string, received undefined". Messages
// from validation are shown to merchants, so keep the plain "Required" they saw before.
z.config({ customError: (issue) => (issue.code === "invalid_type" && issue.input === undefined ? "Required" : undefined) });

/** An error whose message is safe and useful to show to the person using the app. */
export class UserError extends Error {
  constructor(
    message: string,
    readonly code: string = "invalid",
  ) {
    super(message);
    this.name = "UserError";
  }
}

export class NotFoundError extends UserError {
  constructor(what: string) {
    super(`${what} not found.`, "not_found");
  }
}

export class ForbiddenError extends UserError {
  constructor() {
    super("You don't have access to this store.", "forbidden");
  }
}
