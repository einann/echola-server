import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

// Extend Express Request to include our custom properties

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // Generate or use existing request ID from client
    const requestId = (req.headers['x-request-id'] as string) || uuidv4();

    // Attach request ID to request object
    req.requestId = requestId;

    // Attach start time for performance tracking
    req.startTime = Date.now();

    // Set request ID in response header for client-side tracing
    res.setHeader('x-request-id', requestId);

    // If user is authenticated (added by JWT strategy), attach to request
    // This will be populated by JwtAccessGuard after this middleware runs

    next();
  }
}
