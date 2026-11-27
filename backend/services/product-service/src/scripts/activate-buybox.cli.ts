#!/usr/bin/env node
/**
 * MUNZI Gate 3G.3 — Buy Box Activation & Product Offer Projection Refresh CLI
 *
 * Defaults to --dry-run. Requires --execute --confirm to write changes.
 */

import 'dotenv/config';
import { prisma } from '../db/prisma.js';
import { activateBuyBoxAndRefreshProjections } from '../services/buybox-activation.service.js';

function maskDatabaseUrl(url?: string): string {
  if (!url) return 'NOT_CONFIGURED';
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '******';
    return parsed.toString();
  } catch {
    return 'CONFIGURED (MASKED)';
  }
}

export async function main(argv: string[] = process.argv): Promise<number> {
  const flags = new Set(argv.slice(2));
  const execute = flags.has('--execute');
  const confirmed = flags.has('--confirm');
  const json = flags.has('--json');

  if (execute && !confirmed) {
    console.error('ERROR: --execute specified without --confirm.');
    return 1;
  }

  const nodeEnv = process.env.NODE_ENV ?? 'development';
  if (execute && nodeEnv === 'production' && process.env.MUNZI_ALLOW_PRODUCTION_BUYBOX_ACTIVATION !== 'true') {
    console.error('CRITICAL ERROR: Production execution blocked.');
    return 1;
  }

  const dryRun = !execute;
  if (!json) {
    console.log('================================================================');
    console.log('   MUNZI Gate 3G.3 Buy Box Activation & Projection Refresh      ');
    console.log('================================================================');
    console.log(`Environment:     ${nodeEnv}`);
    console.log(`Database Target: ${maskDatabaseUrl(process.env.DATABASE_URL)}`);
    console.log(`Mode:            ${dryRun ? 'DRY-RUN (NO WRITES)' : 'LIVE EXECUTION'}`);
    console.log('----------------------------------------------------------------');
  }

  try {
    const summary = await activateBuyBoxAndRefreshProjections({ dryRun, client: prisma });
    if (json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(`Scanned Variants:              ${summary.scannedVariants}`);
      console.log(`Buy Box Winners Assigned:      ${summary.winnersAssigned}`);
      console.log(`Variants Without Winner:       ${summary.variantsWithoutWinner}`);
      console.log(`Scanned Products:              ${summary.scannedProducts}`);
      console.log(`Products With Active Offers:   ${summary.productsWithActiveOffers}`);
      console.log(`Products Without Active Offers:${summary.productsWithoutActiveOffers}`);
      console.log('================================================================');
    }
    return 0;
  } catch (err) {
    console.error('Buy Box activation failed:', err);
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

const isMainModule =
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop() || '');

if (isMainModule) {
  main().then((code) => process.exit(code));
}
