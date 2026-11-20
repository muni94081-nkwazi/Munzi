import { logger } from '../utils/logger.js';
import { Worker, Queue } from 'bullmq';
import { Redis as IORedis } from 'ioredis';
import { PrismaClient } from '../generated/prisma/index.js';
import { sweepExpiredReservations } from '../services/reservation.service.js';

const prisma = new PrismaClient();

const connection = new IORedis(
  process.env.BULLMQ_REDIS_URL ?? 'redis://localhost:6379',
  { maxRetriesPerRequest: null },
);

const EXPIRY_QUEUE = 'inventory-expiry';

const BATCH_SIZE = Math.max(1, Number(process.env.EXPIRY_SWEEP_BATCH_SIZE ?? 200));

let queueRef:  Queue  | null = null;
let workerRef: Worker | null = null;

export async function startExpiryWorker() {
  const queue = new Queue(EXPIRY_QUEUE, { connection });
  await queue.add(
    'sweep-expired-reservations',
    {},
    { repeat: { pattern: '*/5 * * * *' }, jobId: 'expiry-sweep' },
  );

  const worker = new Worker(
    EXPIRY_QUEUE,
    async () => {
      const now = new Date();
      const { swept, errors } = await sweepExpiredReservations(prisma, now, BATCH_SIZE);

      if (swept > 0) {
        logger.info(`Expired reservation sweep complete: swept ${swept} reservation(s), ${errors} error(s)`);
      }

      return { released: swept, errors };
    },
    { connection },
  );

  worker.on('completed', (job, result) => {
    if ((result as { released: number }).released > 0) {
      logger.info(`Sweep complete — expired ${(result as { released: number }).released} reservation(s)`);
    }
  });
  worker.on('failed', (_job, err) => logger.error('Expiry sweep failed', { detail: err.message }));

  queueRef  = queue;
  workerRef = worker;
  return worker;
}

export async function stopExpiryWorker(): Promise<void> {
  await Promise.allSettled([workerRef?.close(), queueRef?.close()]);
  workerRef = null;
  queueRef  = null;
  await connection.quit().catch(() => {});
}
