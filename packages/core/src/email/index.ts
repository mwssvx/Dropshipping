export type OutgoingEmail = { to: string; subject: string; text: string; replyTo?: string; headers?: Record<string, string> };

export interface Mailer {
  readonly name: "log" | "resend";
  send(email: OutgoingEmail): Promise<{ id: string }>;
}

/** Development mailer: keeps sent mail in memory and prints a one-line summary. */
export class LogMailer implements Mailer {
  readonly name = "log" as const;
  readonly sent: OutgoingEmail[] = [];
  constructor(private readonly quiet = false) {}
  async send(email: OutgoingEmail) {
    this.sent.push(email);
    if (!this.quiet) console.info(`[mail] to=${email.to} subject=${JSON.stringify(email.subject)}`);
    return { id: `log_${this.sent.length}` };
  }
}

export class ResendMailer implements Mailer {
  readonly name = "resend" as const;
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}
  async send(email: OutgoingEmail) {
    const res = await this.fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: this.from, to: [email.to], subject: email.subject, text: email.text, reply_to: email.replyTo, headers: email.headers }),
    });
    const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok || !json.id) throw new Error(`Resend: ${json.message ?? res.status}`);
    return { id: json.id };
  }
}

export function mailerFromEnv(env: Record<string, string | undefined>): Mailer {
  if (env.RESEND_API_KEY) {
    if (!env.EMAIL_FROM) throw new Error("RESEND_API_KEY needs EMAIL_FROM, for example \"Store <orders@yourdomain.com>\"");
    return new ResendMailer(env.RESEND_API_KEY, env.EMAIL_FROM);
  }
  return new LogMailer(env.NODE_ENV === "test");
}
