import nodemailer from "nodemailer";
import { assert } from "./domain.ts";
import { z } from "zod";
export function mailConfigured() {
  return !!process.env.SMTP_HOST && !!process.env.SMTP_FROM;
}
export async function deliverMail(
  to: string,
  subject: string,
  text: string,
  attachments: { filename: string; content: Buffer }[] = [],
  messageId?: string,
) {
  assert(
    mailConfigured(),
    503,
    "Configure SMTP_HOST and SMTP_FROM to send email",
  );
  const from = z.email().parse(process.env.SMTP_FROM);
  z.email().parse(to);
  const local = ["localhost", "127.0.0.1", "::1"].includes(
    process.env.SMTP_HOST!,
  );
  const secure = process.env.SMTP_SECURE === "1";
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || (secure ? 465 : 587)),
    secure,
    requireTLS: !secure && !local,
    ignoreTLS: local && !secure,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  try {
    const result = await transport.sendMail({
      from,
      to,
      subject,
      text,
      attachments,
      messageId,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    assert(
      result.accepted.length === 1,
      502,
      "SMTP did not accept the recipient",
    );
    return { messageId: result.messageId };
  } finally {
    transport.close();
  }
}
