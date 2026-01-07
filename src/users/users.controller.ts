import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAccessGuard } from 'src/auth/guards/jwt-access.guard';
import { UsersService } from './users.service';
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
} from './dto';

@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  // ========================================
  // Profile Management
  // ========================================

  @Get('me')
  @UseGuards(JwtAccessGuard)
  async getMyProfile(@Request() req) {
    return this.usersService.getUserProfile(req.user.userId);
  }

  @Put('me')
  @UseGuards(JwtAccessGuard)
  async updateMyProfile(@Request() req, @Body() updateDto: UpdateProfileDto) {
    return this.usersService.updateUserProfile(req.user.userId, updateDto);
  }

  @Post('me/change-password')
  @UseGuards(JwtAccessGuard)
  @HttpCode(HttpStatus.OK)
  async changePassword(@Request() req, @Body() dto: ChangePasswordDto) {
    return this.usersService.changePassword(req.user.userId, dto);
  }

  // ========================================
  // Avatar Upload
  // ========================================

  @Post('me/avatar/request-upload')
  @UseGuards(JwtAccessGuard)
  async requestAvatarUpload(@Request() req, @Body() dto: RequestAvatarUploadDto) {
    return this.usersService.requestAvatarUpload(req.user.userId, dto);
  }

  @Post('me/avatar/confirm-upload')
  @UseGuards(JwtAccessGuard)
  async confirmAvatarUpload(@Request() req, @Body() dto: ConfirmAvatarUploadDto) {
    return this.usersService.confirmAvatarUpload(req.user.userId, dto);
  }

  // ========================================
  // User Search
  // ========================================

  @Get('search')
  @UseGuards(JwtAccessGuard)
  async searchUsers(@Query() searchDto: SearchUsersDto) {
    return this.usersService.searchUsers(searchDto);
  }

  // ========================================
  // Email Verification (Public + Authenticated)
  // ========================================

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.usersService.verifyEmail(dto);
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  async resendVerification(@Body() dto: ResendVerificationDto) {
    return this.usersService.resendVerificationEmail(dto);
  }

  @Post('me/send-verification')
  @UseGuards(JwtAccessGuard)
  @HttpCode(HttpStatus.OK)
  async sendVerification(@Request() req) {
    return this.usersService.sendVerificationEmail(req.user.userId);
  }

  // ========================================
  // Block/Unblock Users
  // ========================================

  @Post('block/:targetUserId')
  @UseGuards(JwtAccessGuard)
  @HttpCode(HttpStatus.OK)
  async blockUser(@Request() req, @Param('targetUserId') targetUserId: string) {
    return this.usersService.blockUser(req.user.userId, targetUserId);
  }

  @Delete('block/:targetUserId')
  @UseGuards(JwtAccessGuard)
  @HttpCode(HttpStatus.OK)
  async unblockUser(@Request() req, @Param('targetUserId') targetUserId: string) {
    return this.usersService.unblockUser(req.user.userId, targetUserId);
  }

  @Get('blocked')
  @UseGuards(JwtAccessGuard)
  async getBlockedUsers(@Request() req) {
    return this.usersService.getBlockedUsers(req.user.userId);
  }

  // ========================================
  // Password Reset (Public)
  // ========================================

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.usersService.forgotPassword(dto);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.usersService.resetPassword(dto);
  }
}
