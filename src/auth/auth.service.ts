import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import * as bcrypt from 'bcrypt';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { User } from 'generated/prisma/client';
import { EnvironmentVariables } from 'src/config/env.validation';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService<EnvironmentVariables>,
    private redisService: RedisService,
  ) {}

  async register(registerDto: RegisterDto) {
    const { email, password, displayName, username, deviceId, deviceName, deviceType } =
      registerDto;

    // Check if user already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    // Check username uniqueness if provided
    if (username) {
      const existingUsername = await this.prisma.user.findUnique({
        where: { username },
      });

      if (existingUsername) {
        throw new ConflictException('Username already taken');
      }
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user and device in a transaction
    const user = await this.prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        displayName: displayName || email.split('@')[0],
        username,
        devices: {
          create: {
            deviceId,
            deviceName,
            deviceType,
          },
        },
      },
      include: {
        devices: true,
      },
    });

    // Generate tokens for the new device
    const tokens = await this.generateTokens(user.id, deviceId);

    return {
      user: this.sanitizeUser(user),
      ...tokens,
    };
  }

  async login(loginDto: LoginDto) {
    const { email, password, deviceId, deviceName, deviceType, fcmToken } = loginDto;

    // Find user
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { devices: true },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check if account is active
    if (!user.isActive) {
      throw new UnauthorizedException('Account has been deactivated');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check if device exists, create or update
    let device = user.devices.find((d) => d.deviceId === deviceId);

    if (!device) {
      device = await this.prisma.device.create({
        data: {
          userId: user.id,
          deviceId,
          deviceName,
          deviceType,
          fcmToken,
        },
      });
    } else {
      // Update device info
      device = await this.prisma.device.update({
        where: { id: device.id },
        data: {
          deviceName,
          fcmToken,
          lastActiveAt: new Date(),
        },
      });
    }

    // Generate tokens
    const tokens = await this.generateTokens(user.id, deviceId);

    return {
      user: this.sanitizeUser(user),
      ...tokens,
    };
  }

  async refreshTokens(refreshTokenDto: RefreshTokenDto) {
    const { refreshToken, deviceId } = refreshTokenDto;

    // Verify refresh token exists in database
    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true, device: true },
    });

    if (!storedToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Check if token expired
    if (storedToken.expiresAt < new Date()) {
      await this.prisma.refreshToken.delete({ where: { id: storedToken.id } });
      throw new UnauthorizedException('Refresh token expired');
    }

    // Verify device matches
    if (storedToken.device.deviceId !== deviceId) {
      throw new UnauthorizedException('Device mismatch');
    }

    // Delete old refresh token
    await this.prisma.refreshToken.delete({ where: { id: storedToken.id } });

    // Generate new tokens
    const tokens = await this.generateTokens(storedToken.userId, deviceId);

    return tokens;
  }

  async logout(userId: string, deviceId: string) {
    // Delete refresh tokens for this device
    await this.prisma.refreshToken.deleteMany({
      where: {
        userId,
        device: { deviceId },
      },
    });

    // Remove from Redis active sessions
    await this.redisService.del(`session:${userId}:${deviceId}`);

    return { message: 'Logged out successfully' };
  }

  async logoutAllDevices(userId: string) {
    // Get all devices
    const devices = await this.prisma.device.findMany({
      where: { userId },
    });

    // Delete all refresh tokens
    await this.prisma.refreshToken.deleteMany({
      where: { userId },
    });

    // Remove all Redis sessions
    for (const device of devices) {
      await this.redisService.del(`session:${userId}:${device.deviceId}`);
    }

    return { message: 'Logged out from all devices' };
  }

  private async generateTokens(userId: string, deviceId: string) {
    const payload = { sub: userId, deviceId };

    // Generate access token (short-lived)
    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get('JWT_ACCESS_SECRET', { infer: true }),
      expiresIn: this.configService.get('JWT_ACCESS_EXPIRATION', {
        infer: true,
      }),
    });

    // Generate refresh token (long-lived)
    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get('JWT_REFRESH_SECRET', { infer: true }),
      expiresIn: this.configService.get('JWT_REFRESH_EXPIRATION', {
        infer: true,
      }),
    });

    // Store refresh token in database
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30 days

    await this.prisma.refreshToken.create({
      data: {
        userId,
        deviceId: (await this.prisma.device.findUnique({ where: { deviceId } }))?.id ?? '',
        token: refreshToken,
        expiresAt,
      },
    });

    // Store session in Redis for quick lookup (15 min TTL matching access token)
    await this.redisService.set(`session:${userId}:${deviceId}`, 'active', 15 * 60);

    return {
      accessToken,
      refreshToken,
      expiresIn: this.configService.get('JWT_ACCESS_EXPIRATION', {
        infer: true,
      }),
    };
  }

  private sanitizeUser(user: User): Omit<User, 'password'> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, ...sanitized } = user;
    return sanitized;
  }
}
