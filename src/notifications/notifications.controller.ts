import { Controller, Post, Delete, Body, UseGuards, Request } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { RegisterFcmTokenDto } from './dto/register-token.dto';

@Controller('notifications')
@UseGuards(JwtAccessGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('fcm-token')
  async registerFcmToken(@Request() req, @Body() dto: RegisterFcmTokenDto) {
    await this.notificationsService.registerToken(req.user.userId, req.user.deviceId, dto.fcmToken);
    return { success: true };
  }

  @Delete('fcm-token')
  async unregisterFcmToken(@Request() req) {
    await this.notificationsService.unregisterToken(req.user.userId, req.user.deviceId);
    return { success: true };
  }
}
