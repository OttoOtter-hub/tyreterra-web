import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

// credentials: the refresh cookie crosses origins in local development
// (web on :3000, API on :3001). Behind nginx both share one domain.
export function corsOptions(): CorsOptions {
  return { origin: process.env.CORS_ORIGIN || 'http://localhost:3000', credentials: true };
}
