'use strict';

const { Client, GatewayIntentBits, Events } = require('discord.js');
const { loadConfig, assertSetup } = require('./config');
const { registerCommand } = require('./discord');

async function main() {
  const config = loadConfig();

  try {
    assertSetup(config, { requireDiscord: true });
  } catch (error) {
    console.error('[register] Setup is incomplete:\n');
    console.error(error.message);
    process.exit(1);
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once(Events.ClientReady, async (readyClient) => {
    const command = await registerCommand(readyClient);
    if (!command) {
      process.exitCode = 1;
    } else {
      console.log('\n[register] Done. You can close this window.');
      console.log('[register] If the command does not appear in Discord, wait a few minutes and restart Discord.');
    }
    await client.destroy();
    process.exit(process.exitCode || 0);
  });

  client.login(config.discordToken).catch((error) => {
    console.error('[register] Login failed:', error.message);
    console.error('[register] Check DISCORD_TOKEN in .env.');
    process.exit(1);
  });
}

main();
