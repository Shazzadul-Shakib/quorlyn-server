import { Role } from '@prisma/client';

export const MAILER = Symbol('MAILER');

export interface SendInviteEmailParams {
  to: string;
  inviteToken: string;
  organizationName: string;
  role: Role;
  isOrgOwner: boolean;
}

export interface MailerService {
  sendInviteEmail(params: SendInviteEmailParams): Promise<void>;
}
