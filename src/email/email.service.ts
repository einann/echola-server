import { Injectable } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from 'src/config/env.validation';
import { Logger } from 'nestjs-pino';

@Injectable()
export class EmailService {
  constructor(
    private mailerService: MailerService,
    private configService: ConfigService<EnvironmentVariables>,
    private readonly logger: Logger,
  ) {}

  async sendEmailVerification(email: string, displayName: string, token: string): Promise<void> {
    const frontendUrl = this.configService.get('FRONTEND_URL', { infer: true });
    const verificationUrl = `${frontendUrl}/verify-email?token=${token}`;

    try {
      await this.mailerService.sendMail({
        to: email,
        subject: 'Verify Your Email - Echola',
        template: './email-verification',
        context: {
          displayName,
          verificationUrl,
          year: new Date().getFullYear(),
        },
      });
      this.logger.log(`Verification email sent to ${email}`);
    } catch (error) {
      this.logger.error(`Failed to send verification email to ${email}`, error);
      throw error;
    }
  }

  async sendPasswordReset(email: string, displayName: string, token: string): Promise<void> {
    const frontendUrl = this.configService.get('FRONTEND_URL', { infer: true });
    const resetUrl = `${frontendUrl}/reset-password?token=${token}`;

    try {
      await this.mailerService.sendMail({
        to: email,
        subject: 'Reset Your Password - Echola',
        template: './password-reset',
        context: {
          displayName,
          resetUrl,
          expirationHours: 1,
          year: new Date().getFullYear(),
        },
      });
      this.logger.log(`Password reset email sent to ${email}`);
    } catch (error) {
      this.logger.error(`Failed to send password reset email to ${email}`, error);
      throw error;
    }
  }

  async sendPasswordChanged(email: string, displayName: string): Promise<void> {
    try {
      await this.mailerService.sendMail({
        to: email,
        subject: 'Password Changed Successfully - Echola',
        template: './password-changed',
        context: {
          displayName,
          year: new Date().getFullYear(),
        },
      });
      this.logger.log(`Password changed notification sent to ${email}`);
    } catch (error) {
      this.logger.error(`Failed to send password changed email to ${email}`, error);
      // Don't throw - this is a notification email
    }
  }
}
