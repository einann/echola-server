import { Injectable, UnauthorizedException, ConflictException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import * as bcrypt from 'bcrypt';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { User, Prisma } from 'generated/prisma/client';
import { EnvironmentVariables } from 'src/config/env.validation';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

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

    // Step 1: verify JWT signature & expiry. Decoding the payload here also
    // gives us a trusted userId/deviceId to use for reuse-detection cleanup,
    // even when the token is no longer in the DB.
    let payload: { sub: string; deviceId: string };
    try {
      payload = await this.jwtService.verifyAsync<{ sub: string; deviceId: string }>(
        refreshToken,
        { secret: this.configService.get('JWT_REFRESH_SECRET', { infer: true }) },
      );
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (payload.deviceId !== deviceId) {
      throw new UnauthorizedException('Device mismatch');
    }

    // Step 2: rotate inside a transaction so concurrent refreshes can't both
    // succeed with the same token.
    try {
      return await this.prisma.$transaction(async (tx) => {
        const storedToken = await tx.refreshToken.findUnique({
          where: { token: refreshToken },
          include: { device: true },
        });

        // Reuse detection: JWT is valid but token is no longer in the DB,
        // meaning it was already rotated. Treat as a replay attack and revoke
        // the entire device family so both the attacker and the legit user
        // are forced to re-authenticate.
        if (!storedToken) {
          this.logger.warn(
            `Refresh token reuse detected for user=${payload.sub} device=${payload.deviceId}; revoking all device tokens`,
          );
          await tx.refreshToken.deleteMany({
            where: { userId: payload.sub, device: { deviceId: payload.deviceId } },
          });
          throw new UnauthorizedException('Refresh token reuse detected');
        }

        if (storedToken.expiresAt < new Date()) {
          await tx.refreshToken.delete({ where: { id: storedToken.id } });
          throw new UnauthorizedException('Refresh token expired');
        }

        if (storedToken.device.deviceId !== deviceId || storedToken.userId !== payload.sub) {
          throw new UnauthorizedException('Device mismatch');
        }

        await tx.refreshToken.delete({ where: { id: storedToken.id } });

        return this.generateTokens(storedToken.userId, deviceId, tx);
      });
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Invalid refresh token');
    }
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

  private async generateTokens(
    userId: string,
    deviceId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const payload = { sub: userId, deviceId };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get('JWT_ACCESS_SECRET', { infer: true }),
      expiresIn: this.configService.get('JWT_ACCESS_EXPIRATION', { infer: true }),
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get('JWT_REFRESH_SECRET', { infer: true }),
      expiresIn: this.configService.get('JWT_REFRESH_EXPIRATION', { infer: true }),
    });

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30 days

    const device = await client.device.findUnique({ where: { deviceId } });
    if (!device) {
      throw new UnauthorizedException('Device not found');
    }

    await client.refreshToken.create({
      data: {
        userId,
        deviceId: device.id,
        token: refreshToken,
        expiresAt,
      },
    });

    await this.redisService.set(`session:${userId}:${deviceId}`, 'active', 15 * 60);

    return {
      accessToken,
      refreshToken,
      expiresIn: this.configService.get('JWT_ACCESS_EXPIRATION', { infer: true }),
    };
  }

  private sanitizeUser(user: User): Omit<User, 'password'> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, ...sanitized } = user;
    return sanitized;
  }
}
