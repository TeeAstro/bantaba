import { Body, Controller, Get, Post, UseGuards, HttpCode } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { RegisterOrganizerDto } from './dto/register-organizer.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { AuthSessionDto, CurrentUserDto, SuccessDto, TokenPairDto } from './dto/auth-responses.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiCreatedResponse({ type: AuthSessionDto })
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('register-organizer')
  registerOrganizer(@Body() dto: RegisterOrganizerDto) {
    return this.authService.registerOrganizer(dto);
  }

  @ApiOkResponse({ type: AuthSessionDto })
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @ApiOkResponse({ type: TokenPairDto, description: 'Rotates the refresh token. Reusing an old one revokes every session for the user.' })
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @ApiOkResponse({ type: SuccessDto })
  @Post('logout')
  @HttpCode(200)
  logout(@Body() dto: RefreshDto) {
    return this.authService.logout(dto.refreshToken);
  }

  @Post('forgot-password')
  @HttpCode(200)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Post('reset-password')
  @HttpCode(200)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.newPassword);
  }

  // Any authenticated user, any role — proves JwtAuthGuard alone works
  // (no @Roles() means "just be logged in").
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({ type: CurrentUserDto })
  @Get('me')
  me(@CurrentUser() user: { id: string; email: string; role: string }) {
    return user;
  }
}
