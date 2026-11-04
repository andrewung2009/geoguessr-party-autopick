'use strict';

const {
  Client,
  GatewayIntentBits,
  Events,
  ApplicationCommandType,
  ApplicationIntegrationType,
  InteractionContextType,
  MessageFlags
} = require('discord.js');
const { loadConfig, assertSetup } = require('./config');
const { startBridge } = require('./bridge');

const COMMAND_NAME = 'Apply to GeoGuessr';

function formatResult(result) {
  if (!result || !result.ok) {
    return `Could not apply: ${result?.message || 'Unknown error.'}`;
  }

  const mapPart = result.mapName ? `Map: ${result.mapName}` : 'Map: unchanged';
  const modePart = result.modeLabel ? `Mode: ${result.modeLabel}` : 'Mode: unchanged';

  return [
    'Applied.',
    mapPart,
    modePart,
    'Other party settings were left unchanged.'
  ].join('\n');
}

async function registerCommand(client) {
  if (!client.application) return null;

  try {
    const command = await client.application.commands.create({
      name: COMMAND_NAME,
      type: ApplicationCommandType.Message,
      integration_types: [ApplicationIntegrationType.UserInstall],
      contexts: [InteractionContextType.PrivateChannel]
    });

    console.log(`[discord] Registered "${COMMAND_NAME}" (${command.id}).`);
    console.log(
      `[discord] Install link: https://discord.com/oauth2/authorize?client_id=${client.application.id}&integration_type=1&scope=applications.commands`
    );
    return command;
  } catch (error) {
    console.error('[discord] Could not register the context-menu command.');
    console.error('[discord] Make sure User Install is enabled in the Developer Portal -> Installation.');
    console.error(`[discord] ${error.message}`);
    return null;
  }
}

function isAllowedUser(interaction, config) {
  const allowed = config.allowedUserIds;
  if (allowed.length === 0) return true;

  if (allowed.includes(interaction.user.id)) return true;

  const names = [interaction.user.username, interaction.user.globalName]
    .filter(Boolean)
    .map((name) => String(name).toLowerCase());

  return allowed.some(
    (entry) => !/^\d+$/.test(entry) && names.includes(entry.toLowerCase())
  );
}

function startDiscord(bridge, config) {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once(Events.ClientReady, async (readyClient) => {
    console.log(`[discord] Logged in as ${readyClient.user.tag}.`);
    const usernames = config.allowedUserIds.filter((entry) => !/^\d+$/.test(entry));
    if (usernames.length > 0) {
      console.warn(
        `[discord] Username allowlist entries detected: ${usernames.join(', ')}. ` +
          'They work, but a numeric Discord user ID is safer.'
      );
    }
    await registerCommand(readyClient);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isContextMenuCommand()) return;
    if (interaction.commandType !== ApplicationCommandType.Message) return;
    if (interaction.commandName !== COMMAND_NAME) return;

    if (!isAllowedUser(interaction, config)) {
      await interaction
        .reply({
          content: 'You are not allowed to use this command.',
          flags: MessageFlags.Ephemeral
        })
        .catch(() => {});
      return;
    }

    const text = String(interaction.targetMessage?.content || '').trim();
    if (!text) {
      await interaction
        .reply({
          content: 'That message has no text. Right-click a message like "comp NM".',
          flags: MessageFlags.Ephemeral
        })
        .catch(() => {});
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

    let result;
    try {
      result = await bridge.runCommand(text, {
        deliver: true,
        wait: true,
        timeoutMs: 15000
      });
    } catch (error) {
      result = { ok: false, message: error.message };
    }

    await interaction.editReply({ content: formatResult(result) }).catch((error) => {
      console.error('[discord] Could not edit reply:', error.message);
    });
  });

  client.on(Events.Error, (error) => {
    console.error('[discord] Client error:', error.message);
  });

  client.login(config.discordToken).catch((error) => {
    console.error('[discord] Login failed:', error.message);
    console.error('[discord] Check DISCORD_TOKEN in .env.');
  });

  return client;
}

function main() {
  const config = loadConfig();

  try {
    assertSetup(config, { requireDiscord: false });
  } catch (error) {
    console.error('[startup] Setup is incomplete:\n');
    console.error(error.message);
    process.exit(1);
  }

  const bridge = startBridge({ config });

  if (!config.discordToken || config.discordToken.includes('paste_')) {
    console.log('\n[discord] Discord token is not configured. Running bridge-only mode.');
    console.log('[discord] The Tampermonkey overlay will still work. Run "npm run setup" when ready.\n');
    return;
  }

  if (config.allowedUserIds.length === 0) {
    console.warn('[discord] ALLOWED_DISCORD_USER_IDS is empty; every interaction will be rejected.');
  }

  const client = startDiscord(bridge, config);

  const shutdown = async () => {
    console.log('\n[shutdown] Closing...');
    await client.destroy().catch(() => {});
    bridge.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  main();
}

module.exports = { COMMAND_NAME, registerCommand, formatResult };
