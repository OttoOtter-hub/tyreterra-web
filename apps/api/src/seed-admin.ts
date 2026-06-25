/**
 * One-time script: creates an admin user in the DB.
 * Usage: npx ts-node -r tsconfig-paths/register src/seed-admin.ts
 */
import 'dotenv/config';
import { Client } from 'pg';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

const EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@tyreterra.com';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Admin1234!';

async function main() {
  const client = new Client({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT ?? 5432),
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });

  await client.connect();

  // Check if user already exists
  const existing = await client.query('SELECT id FROM users WHERE email = $1', [EMAIL]);
  if (existing.rows.length > 0) {
    console.log(`User ${EMAIL} already exists (id: ${existing.rows[0].id})`);
    await client.end();
    return;
  }

  // Need a company row first (FK constraint)
  const companyId = randomUUID();
  await client.query(
    `INSERT INTO companies (id, name, country, vat_verified, created_at, updated_at)
     VALUES ($1, 'TyreTerra Admin', 'EU', true, NOW(), NOW())`,
    [companyId],
  );

  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const userId = randomUUID();

  await client.query(
    `INSERT INTO users (id, email, password_hash, role, status, company_id, gdpr_consent, gdpr_consent_at, tos_accepted_at, created_at, updated_at)
     VALUES ($1, $2, $3, 'admin', 'active', $4, true, NOW(), NOW(), NOW(), NOW())`,
    [userId, EMAIL, passwordHash, companyId],
  );

  console.log(`Admin user created:`);
  console.log(`  Email:    ${EMAIL}`);
  console.log(`  Password: ${PASSWORD}`);
  console.log(`  ID:       ${userId}`);

  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
