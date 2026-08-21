import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createTransport,
  getTestMessageUrl,
  type Transporter,
} from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { EnvConfig } from '../config/env.validation';
import { MailerService, SendInviteEmailParams } from './mailer.interface';

const ROLE_LABEL: Record<SendInviteEmailParams['role'], string> = {
  SUPERADMIN: 'Superadmin',
  TEACHER: 'Teacher',
  STUDENT: 'Student',
};

@Injectable()
export class NodemailerMailerService implements MailerService {
  private readonly logger = new Logger(NodemailerMailerService.name);
  private readonly transporter: Transporter<SMTPTransport.SentMessageInfo>;
  private readonly from: string;
  private readonly frontendUrl: string;

  constructor(configService: ConfigService<EnvConfig, true>) {
    const port = configService.get('SMTP_PORT', { infer: true });
    this.transporter = createTransport({
      host: configService.get('SMTP_HOST', { infer: true }),
      port,
      secure: port === 465,
      auth: {
        user: configService.get('SMTP_USER', { infer: true }),
        pass: configService.get('SMTP_PASS', { infer: true }),
      },
    });
    this.from = configService.get('SMTP_FROM', { infer: true });
    this.frontendUrl = configService.get('FRONTEND_URL', { infer: true });
  }

  async sendInviteEmail(params: SendInviteEmailParams): Promise<void> {
    const acceptUrl = `${this.frontendUrl}/invites/${params.inviteToken}`;
    const roleLabel = ROLE_LABEL[params.role];
    const ownerNote = params.isOrgOwner ? ' as the organization owner' : '';

    const info = await this.transporter.sendMail({
      from: this.from,
      to: params.to,
      subject: `You're invited to join ${params.organizationName} on Quorlyn`,
      text: `You've been invited to join ${params.organizationName} on Quorlyn as a ${roleLabel}${ownerNote}.\n\nAccept your invite: ${acceptUrl}\n\nThis link expires in 7 days.`,
      html: `<p>You've been invited to join <strong>${params.organizationName}</strong> on Quorlyn as a <strong>${roleLabel}</strong>${ownerNote}.</p><p><a href="${acceptUrl}">Accept your invite</a></p><p>This link expires in 7 days.</p>`,
    });
    this.logger.log(`Invite email sent to ${params.to}`);

    // Only set for sandbox providers like Ethereal; a no-op with real transports.
    const previewUrl = getTestMessageUrl(info);
    if (previewUrl) {
      this.logger.debug(`Preview: ${previewUrl}`);
    }
  }
}
