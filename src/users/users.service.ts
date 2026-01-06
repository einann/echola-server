import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { StorageService } from 'src/storage/storage.service';
import { EmailService } from 'src/email/email.service';
import { StorageBucket } from 'src/storage/enums';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import {
  UpdateProfileDto,
  ChangePasswordDto,
  SearchUsersDto,
  RequestAvatarUploadDto,
  ConfirmAvatarUploadDto,
  VerifyEmailDto,
  ResendVerificationDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  UserProfileResponseDto,
  SearchUsersResponseDto,
} from './dto';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private storageService: StorageService,
    private emailService: EmailService,
  ) {}

  // ========================================
  // Profile Management
  // ========================================

  async getUserProfile(userId: string): Promise<UserProfileResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        username: true,
        bio: true,
        avatarUrl: true,
        statusMessage: true,
        isOnline: true,
        lastSeenAt: true,
        emailVerified: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async updateUserProfile(
    userId: string,
    updateData: UpdateProfileDto,
  ): Promise<UserProfileResponseDto> {
    // Check if username is taken (if provided)
    if (updateData.username) {
      const existingUser = await this.prisma.user.findFirst({
        where: {
          username: updateData.username,
          NOT: { id: userId },
        },
      });

      if (existingUser) {
        throw new ConflictException('Username already taken');
      }
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        email: true,
        displayName: true,
        username: true,
        bio: true,
        avatarUrl: true,
        statusMessage: true,
        isOnline: true,
        lastSeenAt: true,
        emailVerified: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return user;
  }

  async changePassword(
    userId: string,
    changePasswordDto: ChangePasswordDto,
  ): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Verify current password
    const isPasswordValid = await bcrypt.compare(
      changePasswordDto.currentPassword,
      user.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(changePasswordDto.newPassword, 10);

    // Update password
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    // Send notification email
    await this.emailService.sendPasswordChanged(
      user.email,
      user.displayName || 'User',
    );

    // Optionally: Invalidate all refresh tokens except current device
    // This would require deviceId parameter

    return { message: 'Password changed successfully' };
  }

  // ========================================
  // Avatar Upload
  // ========================================

  async requestAvatarUpload(
    userId: string,
    dto: RequestAvatarUploadDto,
  ): Promise<{ uploadUrl: string; fileKey: string; expiresAt: Date }> {
    // Validate mime type
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedMimeTypes.includes(dto.mimeType)) {
      throw new BadRequestException(
        'Invalid file type. Only JPEG, PNG, and WebP are allowed',
      );
    }

    const fileKey = `avatars/${userId}/${randomBytes(16).toString('hex')}.${this.getExtension(dto.mimeType)}`;

    const result = await this.storageService.generatePresignedUploadUrl(
      StorageBucket.MEDIA,
      fileKey,
      dto.mimeType,
      3600, // 1 hour
    );

    return result;
  }

  async confirmAvatarUpload(
    userId: string,
    dto: ConfirmAvatarUploadDto,
  ): Promise<UserProfileResponseDto> {
    // Get old avatar URL to delete if exists
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarUrl: true },
    });

    // Generate permanent download URL
    const avatarUrl = await this.storageService.generatePresignedDownloadUrl(
      StorageBucket.MEDIA,
      dto.fileKey,
      7 * 24 * 60 * 60, // 7 days
    );

    // Update user with new avatar
    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl },
      select: {
        id: true,
        email: true,
        displayName: true,
        username: true,
        bio: true,
        avatarUrl: true,
        statusMessage: true,
        isOnline: true,
        lastSeenAt: true,
        emailVerified: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Delete old avatar from storage if exists
    if (user?.avatarUrl) {
      try {
        // Extract fileKey from old URL (implementation depends on URL structure)
        // await this.storageService.delete(StorageBucket.MEDIA, oldFileKey);
      } catch (error) {
        // Log but don't throw - avatar update was successful
      }
    }

    return updatedUser;
  }

  // ========================================
  // User Search
  // ========================================

  async searchUsers(
    searchDto: SearchUsersDto,
  ): Promise<SearchUsersResponseDto> {
    const { query, limit = 20, offset = 0 } = searchDto;

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          AND: [
            { isActive: true },
            {
              OR: [
                { username: { contains: query, mode: 'insensitive' } },
                { displayName: { contains: query, mode: 'insensitive' } },
                { email: { contains: query, mode: 'insensitive' } },
              ],
            },
          ],
        },
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarUrl: true,
          bio: true,
        },
        take: limit,
        skip: offset,
        orderBy: [{ username: 'asc' }, { displayName: 'asc' }],
      }),
      this.prisma.user.count({
        where: {
          AND: [
            { isActive: true },
            {
              OR: [
                { username: { contains: query, mode: 'insensitive' } },
                { displayName: { contains: query, mode: 'insensitive' } },
                { email: { contains: query, mode: 'insensitive' } },
              ],
            },
          ],
        },
      }),
    ]);

    return {
      users,
      total,
      limit,
      offset,
    };
  }

  // ========================================
  // Email Verification
  // ========================================

  async sendVerificationEmail(userId: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.emailVerified) {
      throw new BadRequestException('Email already verified');
    }

    // Delete any existing verification tokens
    await this.prisma.emailVerificationToken.deleteMany({
      where: { userId },
    });

    // Generate new token
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24); // 24 hours

    await this.prisma.emailVerificationToken.create({
      data: {
        userId,
        token,
        expiresAt,
      },
    });

    // Send email
    await this.emailService.sendEmailVerification(
      user.email,
      user.displayName || 'User',
      token,
    );

    return { message: 'Verification email sent' };
  }

  async verifyEmail(dto: VerifyEmailDto): Promise<{ message: string }> {
    const tokenRecord = await this.prisma.emailVerificationToken.findUnique({
      where: { token: dto.token },
      include: { user: true },
    });

    if (!tokenRecord) {
      throw new BadRequestException('Invalid verification token');
    }

    if (tokenRecord.expiresAt < new Date()) {
      throw new BadRequestException('Verification token has expired');
    }

    // Mark email as verified
    await this.prisma.user.update({
      where: { id: tokenRecord.userId },
      data: { emailVerified: true },
    });

    // Delete used token
    await this.prisma.emailVerificationToken.delete({
      where: { id: tokenRecord.id },
    });

    return { message: 'Email verified successfully' };
  }

  async resendVerificationEmail(
    dto: ResendVerificationDto,
  ): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      // Don't reveal if email exists
      return { message: 'If the email exists, a verification email was sent' };
    }

    if (user.emailVerified) {
      throw new BadRequestException('Email already verified');
    }

    return this.sendVerificationEmail(user.id);
  }

  // ========================================
  // Password Reset
  // ========================================

  async forgotPassword(dto: ForgotPasswordDto): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    // Don't reveal if user exists
    if (!user) {
      return {
        message: 'If the email exists, a password reset link was sent',
      };
    }

    // Delete any existing reset tokens
    await this.prisma.passwordResetToken.deleteMany({
      where: { userId: user.id },
    });

    // Generate new token
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1); // 1 hour

    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        token,
        expiresAt,
      },
    });

    // Send email
    await this.emailService.sendPasswordReset(
      user.email,
      user.displayName || 'User',
      token,
    );

    return { message: 'If the email exists, a password reset link was sent' };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    const tokenRecord = await this.prisma.passwordResetToken.findUnique({
      where: { token: dto.token },
      include: { user: true },
    });

    if (!tokenRecord) {
      throw new BadRequestException('Invalid reset token');
    }

    if (tokenRecord.expiresAt < new Date()) {
      throw new BadRequestException('Reset token has expired');
    }

    if (tokenRecord.used) {
      throw new BadRequestException('Reset token already used');
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(dto.newPassword, 10);

    // Update password and mark token as used
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: tokenRecord.userId },
        data: { password: hashedPassword },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: tokenRecord.id },
        data: { used: true },
      }),
      // Invalidate all refresh tokens
      this.prisma.refreshToken.deleteMany({
        where: { userId: tokenRecord.userId },
      }),
    ]);

    // Send confirmation email
    await this.emailService.sendPasswordChanged(
      tokenRecord.user.email,
      tokenRecord.user.displayName || 'User',
    );

    return { message: 'Password reset successfully' };
  }

  // ========================================
  // Helper Methods
  // ========================================

  private getExtension(mimeType: string): string {
    const map: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
    };
    return map[mimeType] || 'bin';
  }
}
