import { Module } from '@nestjs/common';
import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';
import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';
import { join } from 'path';
import { EnvironmentVariables } from 'src/config/env.validation';

@Module({
  imports: [
    MailerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<EnvironmentVariables>) => ({
        transport: {
          host: configService.get('SMTP_HOST', { infer: true }),
          port: configService.get('SMTP_PORT', { infer: true }),
          secure: configService.get('SMTP_SECURE', { infer: true }), // true for 465, false for 587
          auth: {
            user: configService.get('SMTP_USER', { infer: true }),
            pass: configService.get('SMTP_PASS', { infer: true }),
          },
        },
        defaults: {
          from: `"Echola" <${configService.get('SMTP_FROM', { infer: true })}>`,
        },
        template: {
          dir: join(__dirname, 'templates'),
          adapter: new HandlebarsAdapter(),
          options: {
            strict: true,
          },
        },
      }),
    }),
  ],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
