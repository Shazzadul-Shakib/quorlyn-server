import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export const DEVICE_ID_HEADER = 'x-device-id';

/**
 * A client-generated, stable identifier for the browser or app instance
 * (ADR-0017). Not a security control — a stable one, so a legitimate
 * re-login on the same machine is not treated as a device change.
 */
export const DeviceId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | null => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const header = request.headers[DEVICE_ID_HEADER];
    const value = Array.isArray(header) ? header[0] : header;
    return value && value.trim().length > 0 ? value.trim().slice(0, 200) : null;
  },
);
