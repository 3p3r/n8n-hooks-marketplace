import { cleanupOrphanE2eProcesses } from './cleanup';

await cleanupOrphanE2eProcesses();
console.log('E2E orphan processes cleaned up.');
