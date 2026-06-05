// Build-time safety check.
//
// The whole point: a production deploy must NEVER ship without a database
// connection again. On a Vercel *production* build, missing DB env vars fail
// the build (blocking the deploy). On CI / preview / local builds (which don't
// have production secrets) we only warn, so those builds still pass.

const REQUIRED = ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN'];
const missing = REQUIRED.filter((key) => !process.env[key]);
const isVercelProduction = process.env.VERCEL_ENV === 'production';

if (missing.length === 0) {
  console.log('[check-env] Database env vars present.');
  process.exit(0);
}

const message = `[check-env] Missing required env var(s): ${missing.join(', ')}`;

if (isVercelProduction) {
  console.error(
    `\n${message}\n` +
      'Refusing to build a PRODUCTION deploy without a database connection.\n' +
      'Set them in Vercel → Settings → Environment Variables (Production scope), then redeploy.\n',
  );
  process.exit(1);
}

console.warn(`${message} — warning only (not a Vercel production build).`);
process.exit(0);
