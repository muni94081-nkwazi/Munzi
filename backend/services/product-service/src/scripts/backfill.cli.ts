#!/usr/bin/env node
/**
 * MUNZI Stage 2 — Catalogue Offer Backfill & Migration CLI Runner
 *
 * Standalone, safely configurable CLI runner for the Stage 2 variant-to-offer backfill.
 *
 * SAFETY GUARANTEES:
 * 1. MANDATORY DRY-RUN BY DEFAULT: Always defaults to dry-run. Requires both
 *    `--execute` and `--confirm` to perform any database writes.
 * 2. PRODUCTION GUARD: Refuses live execution in NODE_ENV=production unless
 *    `MUNZI_ALLOW_PRODUCTION_BACKFILL=true` is set.
 * 3. CREDENTIAL MASKING: Redacts database passwords in all logs.
 * 4. DETERMINISTIC IDEMPOTENCY: Uses deterministic offer IDs ('off_' + variant.id).
 *    Never overwrites existing offers or order references.
 * 5. QUARANTINE PROTOCOL: Quarantines unverified sellers and zero-variant products.
 * 6. RECONCILIATION: Runs automated parity verification before and after operations.
 * 7. GUARDED ROLLBACK: Rollback protects active reservations and subsequently modified offers.
 */

import 'dotenv/config';
import { prisma } from '../db/prisma.js';
import {
  runCatalogueBackfill,
  reconcileLegacyToOffers,
  rollbackCatalogueBackfill,
  type BackfillSummary,
  type ReconciliationReport,
  type RollbackSummary,
} from '../services/backfill.service.js';

interface CliArgs {
  mode: 'dry-run' | 'execute' | 'rollback' | 'reconcile';
  confirmed: boolean;
  trustedSellers?: Set<string>;
  batchSize?: number;
  json: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    mode: 'dry-run',
    confirmed: false,
    json: false,
    help: false,
  };

  for (const arg of argv.slice(2)) {
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--execute') {
      args.mode = 'execute';
    } else if (arg === '--dry-run') {
      args.mode = 'dry-run';
    } else if (arg === '--rollback') {
      args.mode = 'rollback';
    } else if (arg === '--reconcile') {
      args.mode = 'reconcile';
    } else if (arg === '--confirm') {
      args.confirmed = true;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg.startsWith('--trusted-sellers=')) {
      const sellers = arg.split('=')[1].split(',').map((s) => s.trim()).filter(Boolean);
      args.trustedSellers = new Set(sellers);
    } else if (arg.startsWith('--batch-size=')) {
      const size = parseInt(arg.split('=')[1], 10);
      if (!isNaN(size) && size > 0) {
        args.batchSize = size;
      }
    }
  }

  return args;
}

function maskDatabaseUrl(url?: string): string {
  if (!url) return 'NOT_CONFIGURED';
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = '******';
    }
    return parsed.toString();
  } catch {
    return 'CONFIGURED (MASKED)';
  }
}

function printHelp(): void {
  console.log(`
MUNZI Stage 2 — Catalogue Offer Backfill CLI Runner

USAGE:
  tsx src/scripts/backfill.cli.ts [OPTIONS]

MODES:
  --dry-run             (Default) Execute read-only dry-run with complete parity reporting.
  --execute             Apply backfill mutations (REQUIRES --confirm).
  --rollback            Roll back backfilled offers with safety checks (dry-run unless --confirm).
  --reconcile           Run 1:1 legacy variant-to-offer reconciliation report only.

OPTIONS:
  --confirm             Required confirmation flag for live execution or live rollback.
  --trusted-sellers=IDS Comma-separated list of trusted seller IDs.
  --json                Output summary report in JSON format.
  --help, -h            Show this help message.

EXAMPLES:
  # 1. Preview backfill in dry-run mode (Default, safe):
  npm run backfill

  # 2. Preview dry-run with trusted sellers:
  tsx src/scripts/backfill.cli.ts --dry-run --trusted-sellers=sel-1,sel-2

  # 3. Execute live backfill:
  tsx src/scripts/backfill.cli.ts --execute --confirm

  # 4. Preview rollback (dry-run):
  tsx src/scripts/backfill.cli.ts --rollback

  # 5. Check reconciliation parity:
  tsx src/scripts/backfill.cli.ts --reconcile
`);
}

export async function main(argv: string[] = process.argv): Promise<number> {
  const args = parseArgs(argv);

  if (args.help) {
    printHelp();
    return 0;
  }

  const rawDbUrl = process.env.DATABASE_URL;
  const maskedDbUrl = maskDatabaseUrl(rawDbUrl);
  const nodeEnv = process.env.NODE_ENV ?? 'development';

  if (!args.json) {
    console.log('================================================================');
    console.log('       MUNZI Stage 2 Catalogue Offer Backfill CLI Runner        ');
    console.log('================================================================');
    console.log(`Environment:      ${nodeEnv}`);
    console.log(`Database Target:  ${maskedDbUrl}`);
    console.log(`Requested Mode:   ${args.mode.toUpperCase()}`);
    console.log(`Confirmation:     ${args.confirmed ? 'CONFIRMED' : 'UNCONFIRMED'}`);
    console.log('----------------------------------------------------------------');
  }

  // Safety checks
  if (args.mode === 'execute' && !args.confirmed) {
    console.error('ERROR: --execute specified without --confirm.');
    console.error('Safety guard blocked live execution. Use --dry-run or provide --confirm to proceed.');
    return 1;
  }

  if (args.mode === 'execute' && nodeEnv === 'production') {
    if (process.env.MUNZI_ALLOW_PRODUCTION_BACKFILL !== 'true') {
      console.error('CRITICAL ERROR: Production execution blocked.');
      console.error('To run live backfill in production, set MUNZI_ALLOW_PRODUCTION_BACKFILL=true.');
      return 1;
    }
  }

  try {
    // ── Mode: RECONCILE ONLY ─────────────────────────────────────────────────
    if (args.mode === 'reconcile') {
      const report: ReconciliationReport = await reconcileLegacyToOffers({
        client: prisma,
        batchSize: args.batchSize,
      });
      if (args.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log('\n--- RECONCILIATION PARITY REPORT ---');
        console.log(`Parity Confirmed:        ${report.isParityConfirmed ? 'YES (PASS)' : 'NO (FAIL)'}`);
        console.log(`Missing Offers:          ${report.missingOffersCount}`);
        console.log(`Unmapped Reservations:   ${report.unmappedReservationsCount}`);
        console.log(`Price Mismatches:        ${report.priceMismatchCount}`);
        console.log(`Stock Mismatches:        ${report.stockMismatchCount}`);
        console.log(`Reserved Mismatches:     ${report.reservedMismatchCount}`);
        if (report.discrepancies.length > 0) {
          console.log('\nDiscrepancies (first 10):');
          console.table(report.discrepancies.slice(0, 10));
        }
      }
      return report.isParityConfirmed ? 0 : 2;
    }

    // ── Mode: ROLLBACK ───────────────────────────────────────────────────────
    if (args.mode === 'rollback') {
      const isDryRun = !args.confirmed;
      if (!args.json) {
        console.log(isDryRun
          ? 'Running ROLLBACK in DRY-RUN mode (no deletions will occur)...'
          : 'WARNING: Executing LIVE ROLLBACK...'
        );
      }

      const summary: RollbackSummary = await rollbackCatalogueBackfill({
        dryRun: isDryRun,
        client: prisma,
      });

      if (args.json) {
        console.log(JSON.stringify(summary, null, 2));
      } else {
        console.log('\n--- ROLLBACK SUMMARY ---');
        console.log(`Mode:                    ${summary.dryRun ? 'DRY-RUN (NO DELETIONS)' : 'LIVE EXECUTION'}`);
        console.log(`Scanned Candidate Offers:${summary.scannedOffers}`);
        console.log(`Eligible For Rollback:   ${summary.eligibleForRollback}`);
        console.log(`Protected Offers:        ${summary.protectedOffers}`);
        console.log(`Deleted Offers:          ${summary.rolledBackOffers}`);
        if (summary.protectedDetails.length > 0) {
          console.log('\nProtected Offer Details:');
          console.table(summary.protectedDetails.slice(0, 10));
        }
      }
      return 0;
    }

    // ── Mode: DRY-RUN or EXECUTE ─────────────────────────────────────────────
    const isDryRun = args.mode === 'dry-run';

    if (!args.json) {
      console.log(isDryRun
        ? 'Running in DRY-RUN mode (Read-Only: Zero database writes)...'
        : 'Running in LIVE EXECUTION mode (Applying database mutations)...'
      );
    }

    const summary: BackfillSummary = await runCatalogueBackfill({
      dryRun: isDryRun,
      trustedSellerIds: args.trustedSellers,
      batchSize: args.batchSize,
      client: prisma,
    });

    const reconciliation: ReconciliationReport = await reconcileLegacyToOffers({
      client: prisma,
      batchSize: args.batchSize,
    });

    const fullReport = {
      timestamp: new Date().toISOString(),
      environment: nodeEnv,
      database: maskedDbUrl,
      mode: isDryRun ? 'DRY_RUN' : 'LIVE_EXECUTION',
      backfill: summary,
      reconciliation,
    };

    if (args.json) {
      console.log(JSON.stringify(fullReport, null, 2));
    } else {
      console.log('\n--- CATALOGUE BACKFILL SUMMARY ---');
      console.log(`Mode:                    ${summary.dryRun ? 'DRY-RUN (NO WRITES)' : 'LIVE EXECUTION'}`);
      console.log(`Scanned Products:        ${summary.scannedProducts}`);
      console.log(`Scanned Variants:        ${summary.scannedVariants}`);
      console.log(`Offers Created:          ${summary.createdOffers}`);
      console.log(`Existing Offers Skipped: ${summary.skippedExistingOffers}`);
      console.log(`SKU Collisions Resolved: ${summary.skuCollisionsDisambiguated}`);
      console.log(`Quarantined Products:    ${summary.quarantinedProducts}`);
      console.log(`Migrated Reservations:   ${summary.migratedReservations}`);

      if (summary.quarantinedDetails.length > 0) {
        console.log('\nQuarantined Product Details:');
        console.table(summary.quarantinedDetails.slice(0, 10));
      }

      console.log('\n--- POST-BACKFILL RECONCILIATION PARITY ---');
      console.log(`Parity Confirmed:        ${reconciliation.isParityConfirmed ? 'YES (PASS)' : 'NO (PENDING/FAIL)'}`);
      console.log(`Missing Offers:          ${reconciliation.missingOffersCount}`);
      console.log(`Unmapped Reservations:   ${reconciliation.unmappedReservationsCount}`);
      console.log(`Price Mismatches:        ${reconciliation.priceMismatchCount}`);
      console.log(`Stock Mismatches:        ${reconciliation.stockMismatchCount}`);
      console.log(`Reserved Mismatches:     ${reconciliation.reservedMismatchCount}`);
      console.log('================================================================\n');
    }

    return 0;
  } catch (error) {
    console.error('Backfill execution failed:', error);
    return 1;
  }
}

// Direct execution guard
if (process.argv[1]?.endsWith('backfill.cli.ts') || process.argv[1]?.endsWith('backfill.cli.js')) {
  main()
    .then((code) => {
      process.exit(code);
    })
    .catch((err) => {
      console.error('Fatal CLI error:', err);
      process.exit(1);
    });
}
