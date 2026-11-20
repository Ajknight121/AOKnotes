import { createPcDaemonServer, getLocalLanAddresses } from './server.js';

const port = Number(process.env.AOK_PC_PORT || 4545);
const vaultDir = process.env.AOK_VAULT_DIR;
const pairingToken = process.env.AOK_PAIRING_TOKEN;

const { server, vaultDir: resolvedVault } = createPcDaemonServer({
  port,
  vaultDir,
  pairingToken,
});

server.listen(port, '0.0.0.0', () => {
  const ips = getLocalLanAddresses();
  console.log('==========================================================');
  console.log('  AOKnotes — Personal PC Local Sync & Backup Daemon');
  console.log('==========================================================');
  console.log(`  Local Vault Directory : ${resolvedVault}`);
  console.log(`  Listening Port        : ${port}`);
  console.log(`  LAN Endpoints         :`);
  for (const ip of ips) {
    console.log(`    -> http://${ip}:${port}`);
  }
  console.log('  Auto-syncs with Phone & Web apps while PC is running.');
  console.log('==========================================================');
});
