import { INestApplication } from '@nestjs/common';
import { json, urlencoded } from 'express';

/** Largest JSON body of an import commit (5000 rows of listing fields) */
export const IMPORT_COMMIT_BODY_LIMIT = '8mb';
export const DEFAULT_BODY_LIMIT = '100kb';

// Request body parsers with per-route size limits. The app must be created
// with { bodyParser: false }; production (main.ts) and the e2e tests both call
// this, so they enforce the same limits.
export function applyBodyLimits(app: INestApplication, prefix = '/api'): void {
  app.use(`${prefix}/listings/import/commit`, json({ limit: IMPORT_COMMIT_BODY_LIMIT }));
  app.use(json({ limit: DEFAULT_BODY_LIMIT }));
  app.use(urlencoded({ extended: true, limit: DEFAULT_BODY_LIMIT }));
}
