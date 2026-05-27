import { Controller, Post, Body, UseGuards, Request, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { JwtAccessGuard } from './guards/jwt-access.guard';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @ApiOperation({ summary: 'Register a new user and create the initial device' })
  @Post('register')
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @ApiOperation({ summary: 'Email + password login; returns access and refresh tokens' })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @ApiOperation({
    summary: 'Exchange a refresh token for a new pair (rotation + reuse detection)',
  })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refreshTokens(@Body() refreshTokenDto: RefreshTokenDto) {
    return this.authService.refreshTokens(refreshTokenDto);
  }

  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Sign out the current device (revokes its refresh token)' })
  @Post('logout')
  @UseGuards(JwtAccessGuard)
  @HttpCode(HttpStatus.OK)
  async logout(@Request() req) {
    const { userId, deviceId } = req.user;
    return this.authService.logout(userId, deviceId);
  }

  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Sign out from every device' })
  @Post('logout-all')
  @UseGuards(JwtAccessGuard)
  @HttpCode(HttpStatus.OK)
  async logoutAll(@Request() req) {
    const { userId } = req.user;
    return this.authService.logoutAllDevices(userId);
  }
}
