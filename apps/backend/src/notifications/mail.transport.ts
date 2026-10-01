import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import * as nodemailer from 'nodemailer';

// How emails leave the system (docs/notifications.md → "Sending email").
//
//   MAIL_TRANSPORT=smtp — any provider that speaks SMTP: Postmark,
//     SendGrid, Brevo, Mailgun, Amazon SES... or Mailpit locally (catches
//     everything, shows it at http://localhost:8025).
//   MAIL_TRANSPORT=log — nothing is sent; each email is written as an
//     .html file under MAIL_PREVIEW_DIR (default apps/backend/mail-previews)
//     with its images embedded, and the path is logged. The default when
//     SMTP_HOST isn't set, so development works with no email account.

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
  cid?: string; // referenced from the HTML as <img src="cid:...">
}

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: MailAttachment[];
  tag?: string; // message type, for previews and provider analytics
}

@Injectable()
export class MailTransport {
  private readonly logger = new Logger('Mail');
  readonly mode: 'smtp' | 'log';
  readonly from: string;
  private readonly smtp: nodemailer.Transporter | null = null;
  private readonly previewDir: string;

  constructor(config: ConfigService) {
    const host = config.get<string>('SMTP_HOST');
    const explicit = config.get<string>('MAIL_TRANSPORT');
    this.mode = explicit === 'smtp' || (explicit !== 'log' && !!host) ? 'smtp' : 'log';
    this.from = config.get<string>('MAIL_FROM') ?? 'Event Ticketing <tickets@localhost>';
    this.previewDir = resolve(config.get<string>('MAIL_PREVIEW_DIR') ?? join(process.cwd(), 'mail-previews'));
    if (this.mode === 'smtp') {
      if (!host) throw new Error('MAIL_TRANSPORT=smtp needs SMTP_HOST (see docs/notifications.md)');
      const port = Number(config.get<string>('SMTP_PORT') ?? 587);
      const user = config.get<string>('SMTP_USER');
      this.smtp = nodemailer.createTransport({
        host,
        port,
        secure: config.get<string>('SMTP_SECURE') === 'true' || port === 465,
        auth: user ? { user, pass: config.get<string>('SMTP_PASS') ?? '' } : undefined,
        // Fail a stuck connection instead of holding the worker forever;
        // the outbox retries it later.
        connectionTimeout: 15_000,
        greetingTimeout: 10_000,
        socketTimeout: 30_000,
      });
    }
  }

  async send(msg: MailMessage): Promise<void> {
    if (this.smtp) {
      await this.smtp.sendMail({
        from: this.from,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        attachments: msg.attachments?.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType, cid: a.cid })),
        headers: msg.tag ? { 'X-Message-Type': msg.tag } : undefined,
      });
      return;
    }
    // Preview file: inline images turned into data: URLs so the file opens
    // on its own in a browser.
    let html = msg.html;
    for (const a of msg.attachments ?? []) {
      if (a.cid) html = html.split(`cid:${a.cid}`).join(`data:${a.contentType};base64,${a.content.toString('base64')}`);
    }
    const header =
      `<div style="font:13px/1.5 monospace;background:#fffbe6;border-bottom:1px solid #e6d9a8;padding:10px 16px">` +
      `<b>Preview (MAIL_TRANSPORT=log): not sent.</b><br>To: ${escapeHtml(msg.to)}<br>Subject: ${escapeHtml(msg.subject)}</div>`;
    await mkdir(this.previewDir, { recursive: true });
    const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${msg.tag ?? 'mail'}-${Math.random().toString(36).slice(2, 7)}.html`;
    const path = join(this.previewDir, name);
    await writeFile(path, html.replace(/<body([^>]*)>/i, `<body$1>${header}`));
    this.logger.log(`Not sent (log mode): "${msg.subject}" to ${msg.to} → ${path}`);
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
