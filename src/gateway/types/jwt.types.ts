export interface JwtPayload {
  sub: string;
  deviceId: string;
  iat?: number;
  exp?: number;
}
