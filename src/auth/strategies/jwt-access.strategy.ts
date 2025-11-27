import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';

@Injectable()
export class JwtAccessStrategy extends PassportStrategy(
  Strategy,
  'jwt-access',
) {
  constructor(
    configService: ConfigService,
    private prisma: PrismaService,
    private redisService: RedisService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      ignoreExpiration: false,
    });
  }

  async validate(payload: { sub: string; deviceId: string }) {
    const { sub: userId, deviceId } = payload;

    // Check if session exists in Redis (quick check)
    const sessionExists = await this.redisService.exists(
      `session:${userId}:${deviceId}`,
    );

    if (!sessionExists) {
      throw new UnauthorizedException('Session expired or invalid');
    }

    // Fetch user from database
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        devices: {
          where: { deviceId },
        },
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }

    if (user.devices.length === 0) {
      throw new UnauthorizedException('Device not found');
    }

    // Update last active timestamp
    await this.prisma.device.update({
      where: { id: user.devices[0].id },
      data: { lastActiveAt: new Date() },
    });

    // Return user info to be attached to request
    return {
      userId: user.id,
      email: user.email,
      deviceId,
      device: user.devices[0],
    };
  }
}
