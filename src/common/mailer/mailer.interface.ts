import { OrgRole } from '@prisma/client';

export const MAILER = Symbol('MAILER');

export interface SendInviteEmailParams {
  to: string;
  inviteToken: string;
  organizationName: string;
  role: OrgRole;
  isOrgOwner: boolean;
}

export interface SendDeviceChangeCodeParams {
  to: string;
  code: string;
  expiresInMinutes: number;
  newDeviceLabel?: string;
}

export interface MailerService {
  sendInviteEmail(params: SendInviteEmailParams): Promise<void>;

  /**
   * Unlike invite mail, this one is load-bearing: a code that never arrives
   * is a locked-out student (ADR-0017). Failures must propagate.
   */
  sendDeviceChangeCode(params: SendDeviceChangeCodeParams): Promise<void>;
}
