const {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
  ActionRowBuilder, StringSelectMenuBuilder,
} = require('discord.js');

// ── Config ───────────────────────────────────────────────────────────────────
const TOKEN     = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const TOTAL_TURNS = 10;
const BOT_ID      = 'BOT'; // sentinel value to mark a bot-controlled slot

// ── Type data ─────────────────────────────────────────────────────────────────
// Each array is [HR, 3B, 2B, 1B, BB, FO, K, PO, RGO, LGO]
const OUTCOMES = ['HR', '3B', '2B', '1B', 'BB', 'FO', 'K', 'PO', 'RGO', 'LGO'];

const PITCHER_TYPES = {
  'Basic Balanced':       [13,  1, 14, 35, 19, 57, 45, 13, 28, 26],
  'Basic Strikeout':      [11,  2, 16, 34, 19, 57, 62,  8, 20, 22],
  'Basic Finesse':        [13,  1, 14, 38, 18, 46, 34, 16, 34, 37],
  'No Homers':            [ 1,  9, 24, 33, 21, 53, 41, 26, 21, 22],
  'Flyball Pitcher':      [20,  4, 18, 13, 13, 89, 21, 21, 26, 26],
  'Three True Outcomes':  [23,  1,  9, 13, 30, 23,121,  8, 11, 12],
  'Trust Your Defense':   [ 5, 11, 23, 27, 15, 59, 19, 15, 39, 38],
  'Extreme Groundballer': [ 8,  4, 29, 32, 16, 25, 11,  8, 59, 59],
  '1B/BB':                [ 7,  1, 12, 40, 38, 50, 28, 22, 25, 28],
  'Extremely Neutral':    [14, 14, 14, 14, 14, 36, 36, 36, 36, 37],
  'Weak Contact':         [ 9,  2, 25, 29, 13, 26, 11,111, 13, 12],
  'Nothing To Hit':       [11,  2, 13, 24, 42, 45, 31,  9, 37, 37],
  'Single Focus':         [ 6,  1,  8, 69, 10, 25, 11, 69, 25, 27],
  'Position*':            [18,  1, 22, 47, 31, 55, 11, 27, 20, 19],
};

const BATTER_TYPES = {
  'Basic Neutral':        [11,  3, 20, 37, 20, 51, 49, 10, 24, 25],
  'Basic Power':          [21,  1, 14, 20, 20, 60, 60,  6, 24, 24],
  'Basic Contact':        [ 8,  3, 16, 52, 20, 45, 31, 10, 32, 33],
  'Max Homers':           [34,  1, 10,  8, 12, 15,  5,  5, 80, 80],
  'Speedy':               [ 6, 16, 21, 20, 14, 62, 34, 58, 10,  9],
  'Extra Base Focus':     [15,  8, 27, 10, 14, 16, 55, 55, 25, 25],
  '1B/BB':                [ 8,  2, 14, 41, 40, 35, 20, 11, 35, 44],
  'Extremely Neutral':    [15, 15, 15, 15, 15, 35, 35, 35, 35, 35],
  'Work The Count':       [12,  4, 14, 16, 56, 45, 40, 23, 20, 20],
  'HR/K':                 [27,  1, 12, 21, 10, 20, 90, 10, 30, 29],
  'Three True Outcomes':  [25,  1,  7,  7, 45, 20,120,  5, 10, 10],
  'Sacrifice Master':     [10,  2, 15, 34, 30, 99, 10, 10, 30, 10],
  'Single Focused':       [ 7,  1, 10, 70, 10, 20, 10, 75, 24, 23],
  'Pitcher*':             [ 8,  2,  8, 16, 21, 20, 85, 20, 35, 35],
};

// Hand bonuses — applied when pitcher and batter share the same handedness
// [HR, 3B, 2B, 1B, BB, FO, K, PO, RGO, LGO]
const HAND_BONUSES = {
  'Anti-Homer':  [-4, -1, -3, -2, -1,  1,  6,  0,  2,  2],
  'Anti-Single': [-2, -1, -3, -7, -1,  2,  8,  2,  1,  1],
  'Balanced':    [-3, -1, -3, -4, -1,  2,  5,  1,  2,  2],
};

const OUTCOME_POINTS = { HR: 5, '3B': 4, '2B': 3, '1B': 2, BB: 1 };
const OUTCOME_EMOJI  = {
  HR: '🏠', '3B': '🔺', '2B': '✌️', '1B': '1️⃣', BB: '🚶',
  FO: '🌀', K: '❌', PO: '🧤', RGO: '➡️', LGO: '⬅️',
};

// Good outcomes (batter wants these), bad outcomes (pitcher wants these)
const GOOD_OUTCOMES = new Set(['HR', '3B', '2B', '1B', 'BB']);
const BAD_OUTCOMES  = new Set(['FO', 'K', 'PO', 'RGO', 'LGO']);

// ── Build diff ranges ─────────────────────────────────────────────────────────
function buildRanges(pitcherType, batterType, handBonus, sameHand) {
  const ranges = [];
  let cumulative = 0;
  for (let i = 0; i < OUTCOMES.length; i++) {
    let total = PITCHER_TYPES[pitcherType][i] + BATTER_TYPES[batterType][i];
    if (sameHand && handBonus) {
      total = Math.max(0, total + HAND_BONUSES[handBonus][i]);
    }
    cumulative += total;
    ranges.push({ label: OUTCOMES[i], max: cumulative - 1 });
  }
  return ranges;
}

// ── Get result from diff using dynamic ranges ─────────────────────────────────
function getResult(diff, ranges) {
  for (const range of ranges) {
    if (diff <= range.max) {
      const label = range.label;
      return { label, emoji: OUTCOME_EMOJI[label], points: OUTCOME_POINTS[label] || 0 };
    }
  }
  const label = ranges[ranges.length - 1].label;
  return { label, emoji: OUTCOME_EMOJI[label], points: OUTCOME_POINTS[label] || 0 };
}

// ── Bot AI strategy ───────────────────────────────────────────────────────────
// Returns the range boundaries for each outcome as [min, max] pairs
function getRangeBounds(ranges) {
  const bounds = {};
  let prev = 0;
  for (const r of ranges) {
    bounds[r.label] = [prev, r.max];
    prev = r.max + 1;
  }
  return bounds;
}

// Bot pitcher: picks a number to maximise the batter landing in a bad outcome.
// Finds the center of the largest bad-outcome diff range, then offsets from 500
// so the batter can't easily escape by going the other way around.
// 20% of the time it randomises slightly to be unpredictable.
function botPitch(ranges) {
  const bounds = getRangeBounds(ranges);

  // Find the bad outcome range with the most width
  let bestLabel = null;
  let bestWidth = -1;
  for (const label of BAD_OUTCOMES) {
    if (!bounds[label]) continue;
    const width = bounds[label][1] - bounds[label][0];
    if (width > bestWidth) { bestWidth = width; bestLabel = label; }
  }

  // Center of that bad range
  const [lo, hi] = bounds[bestLabel];
  const targetDiff = Math.round((lo + hi) / 2);

  // Pick a base pitch that places the swing target at the center of the bad zone
  // We choose a base of 500 and offset so the batter has symmetric risk both ways
  let base = 500 - targetDiff;
  if (base < 1)    base = 1;
  if (base > 1000) base = 1000;

  // 20% chance: add a random jitter of up to ±50 to stay unpredictable
  if (Math.random() < 0.2) {
    const jitter = Math.floor(Math.random() * 101) - 50;
    base = Math.max(1, Math.min(1000, base + jitter));
  }

  return base;
}

// Bot batter: picks a number to maximise landing in a good outcome.
// Finds the center of the best (highest-points) good outcome range, then picks
// a swing that would land on that diff if the pitch were 500 (a reasonable blind guess).
// 20% of the time it randomises.
function botSwing(ranges) {
  const bounds = getRangeBounds(ranges);

  // Find the good outcome with the highest points and largest range
  let bestLabel = null;
  let bestScore = -1;
  for (const label of GOOD_OUTCOMES) {
    if (!bounds[label]) continue;
    const pts   = OUTCOME_POINTS[label] || 0;
    const width = bounds[label][1] - bounds[label][0];
    const score = pts * 100 + width; // weight by points first, then size
    if (score > bestScore) { bestScore = score; bestLabel = label; }
  }

  const [lo, hi] = bounds[bestLabel];
  const targetDiff = Math.round((lo + hi) / 2);

  // Blind guess: assume pitch is somewhere around 500, aim for targetDiff away
  let base = 500 - targetDiff;
  if (base < 1)    base = 1;
  if (base > 1000) base = 1000;

  // 20% chance: add random jitter
  if (Math.random() < 0.2) {
    const jitter = Math.floor(Math.random() * 101) - 50;
    base = Math.max(1, Math.min(1000, base + jitter));
  }

  return base;
}

// ── Scoreboard string ─────────────────────────────────────────────────────────
function scoreboard(g) {
  if (g.history.length === 0) return '';
  const rows = g.history.map((h, i) => {
    const r   = getResult(h.diff, g.ranges);
    const pts = r.points > 0 ? ` · **+${r.points} pts**` : '';
    return `Turn ${i + 1}: pitch **${h.pitch}** · swing **${h.swing}** · diff **${h.diff}** · ${r.emoji} ${r.label}${pts}`;
  });
  const avg      = (g.history.reduce((sum, h) => sum + h.diff, 0) / g.history.length).toFixed(1);
  const totalPts = g.history.reduce((sum, h) => sum + getResult(h.diff, g.ranges).points, 0);
  return (
    `\n\n📋 **Scoreboard**\n` +
    rows.join('\n') +
    `\n\nAverage diff: **${avg}** · Total points: **${totalPts}**`
  );
}

// ── Menu builders ─────────────────────────────────────────────────────────────
function pitcherTypeMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('select_pitcher_type')
      .setPlaceholder('Select pitcher type…')
      .addOptions(Object.keys(PITCHER_TYPES).map(n => ({ label: n, value: n })))
  );
}
function batterTypeMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('select_batter_type')
      .setPlaceholder('Select batter type…')
      .addOptions(Object.keys(BATTER_TYPES).map(n => ({ label: n, value: n })))
  );
}
function handBonusMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('select_hand_bonus')
      .setPlaceholder('Select hand bonus…')
      .addOptions(Object.keys(HAND_BONUSES).map(n => ({ label: n, value: n })))
  );
}
function handednessMenu(customId, placeholder) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(placeholder)
      .addOptions([
        { label: 'Right Handed', value: 'R' },
        { label: 'Left Handed',  value: 'L' },
      ])
  );
}

// ── Check if all setup selections are done ────────────────────────────────────
function setupComplete(g) {
  return g.pitcherType && g.handBonus && g.pitcherHand && g.batterType && g.batterHand;
}

// ── Display name helper ───────────────────────────────────────────────────────
function displayName(id) {
  return id === BOT_ID ? '🤖 **Bot**' : `<@${id}>`;
}

// ── Game state ────────────────────────────────────────────────────────────────
const games = new Map();

// ── Register commands ─────────────────────────────────────────────────────────
async function registerCommands() {
  const startgame = new SlashCommandBuilder()
    .setName('startgame')
    .setDescription('Start a 10-turn game. Use @Bot as pitcher or batter to play against the AI.')
    .addUserOption(opt =>
      opt.setName('pitcher').setDescription('The pitcher — use @Bot to use the AI').setRequired(true)
    )
    .addUserOption(opt =>
      opt.setName('batter').setDescription('The batter — use @Bot to use the AI').setRequired(true)
    );

  const endgame = new SlashCommandBuilder()
    .setName('endgame').setDescription('End the current game session early');

  const pitch = new SlashCommandBuilder()
    .setName('pitch').setDescription('Throw your number for this turn (Pitcher only)')
    .addIntegerOption(opt =>
      opt.setName('value').setDescription('Your pitch (1–1000)').setRequired(true).setMinValue(1).setMaxValue(1000)
    );

  const swing = new SlashCommandBuilder()
    .setName('swing').setDescription('Swing at the pitch (Batter only)')
    .addIntegerOption(opt =>
      opt.setName('value').setDescription('Your swing (1–1000)').setRequired(true).setMinValue(1).setMaxValue(1000)
    );

  const status = new SlashCommandBuilder()
    .setName('status').setDescription('Show the current game status and scoreboard');

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), {
    body: [startgame, endgame, pitch, swing, status].map(c => c.toJSON()),
  });
  console.log('✅ Commands registered globally');
}

// ── Bot ───────────────────────────────────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.once('ready', () => console.log(`🤖 Logged in as ${client.user.tag}`));

client.on('interactionCreate', async interaction => {
  const guildId = interaction.guildId;
  const userId  = interaction.user.id;
  const game    = games.get(guildId);

  // ── Select menu interactions ───────────────────────────────────────────────
  if (interaction.isStringSelectMenu()) {
    if (!game) return;
    const val = interaction.values[0];

    // Only the human player whose turn it is to choose can interact
    const isPitcherMenu = ['select_pitcher_type', 'select_hand_bonus', 'select_pitcher_hand'].includes(interaction.customId);
    const isBatterMenu  = ['select_batter_type', 'select_batter_hand'].includes(interaction.customId);
    const expectedUser  = isPitcherMenu ? game.pitcherId : game.batterId;
    if (userId !== expectedUser) {
      await interaction.reply({ content: `⚠️ This menu is not for you.`, ephemeral: true });
      return;
    }

    if (interaction.customId === 'select_pitcher_type') {
      game.pitcherType = val;
      await interaction.update({
        content: `🟡 Pitcher type set to **${val}**. Now select a hand bonus:`,
        components: [handBonusMenu()],
      });
      return;
    }

    if (interaction.customId === 'select_hand_bonus') {
      game.handBonus = val;
      await interaction.update({
        content: `🟡 Hand bonus set to **${val}**. Now select your handedness:`,
        components: [handednessMenu('select_pitcher_hand', 'Select your throwing hand…')],
      });
      return;
    }

    if (interaction.customId === 'select_pitcher_hand') {
      game.pitcherHand = val;
      const handLabel = val === 'R' ? 'Right Handed' : 'Left Handed';
      await interaction.update({
        content: `🟡 Pitcher is **${handLabel}**. Pitcher setup complete!`,
        components: [],
      });
      if (setupComplete(game)) await startGame(interaction, guildId);
      return;
    }

    if (interaction.customId === 'select_batter_type') {
      game.batterType = val;
      await interaction.update({
        content: `🔵 Batter type set to **${val}**. Now select your handedness:`,
        components: [handednessMenu('select_batter_hand', 'Select your batting hand…')],
      });
      return;
    }

    if (interaction.customId === 'select_batter_hand') {
      game.batterHand = val;
      const handLabel = val === 'R' ? 'Right Handed' : 'Left Handed';
      await interaction.update({
        content: `🔵 Batter is **${handLabel}**. Batter setup complete!`,
        components: [],
      });
      if (setupComplete(game)) await startGame(interaction, guildId);
      return;
    }
  }

  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;

  // ── /startgame ──────────────────────────────────────────────────────────────
  if (commandName === 'startgame') {
    if (game) {
      await interaction.reply({
        content: `⚠️ A game is already in progress (turn ${game.turn}/${TOTAL_TURNS}). Use \`/endgame\` to cancel it first.`,
        ephemeral: true,
      });
      return;
    }

    const pitcherUser = interaction.options.getUser('pitcher');
    const batterUser  = interaction.options.getUser('batter');

    const pitcherIsBot = pitcherUser.id === client.user.id;
    const batterIsBot  = batterUser.id  === client.user.id;

    if (pitcherUser.id === batterUser.id && !pitcherIsBot) {
      await interaction.reply({ content: `⚠️ The Pitcher and Batter must be different users.`, ephemeral: true });
      return;
    }

    const pitcherId = pitcherIsBot ? BOT_ID : pitcherUser.id;
    const batterId  = batterIsBot  ? BOT_ID : batterUser.id;

    // Randomly assign bot selections up front
    const pitcherTypeKeys = Object.keys(PITCHER_TYPES);
    const batterTypeKeys  = Object.keys(BATTER_TYPES);
    const handBonusKeys   = Object.keys(HAND_BONUSES);
    const hands           = ['R', 'L'];
    const randItem        = arr => arr[Math.floor(Math.random() * arr.length)];

    const newGame = {
      pitcherId,
      batterId,
      pitcherIsBot,
      batterIsBot,
      pitcherType: pitcherIsBot ? randItem(pitcherTypeKeys) : null,
      handBonus:   pitcherIsBot ? randItem(handBonusKeys)   : null,
      pitcherHand: pitcherIsBot ? randItem(hands)           : null,
      batterType:  batterIsBot  ? randItem(batterTypeKeys)  : null,
      batterHand:  batterIsBot  ? randItem(hands)           : null,
      turn:        1,
      pending:     null,
      history:     [],
      ranges:      null,
      started:     false,
    };
    games.set(guildId, newGame);

    let setupMsg =
      `⚾ **Game setup started!**\n\n` +
      `🟡 **Pitcher:** ${pitcherIsBot ? '🤖 Bot' : `<@${pitcherId}>`}\n` +
      `🔵 **Batter:** ${batterIsBot ? '🤖 Bot' : `<@${batterId}>`}\n\n`;

    // If both are bots (unlikely but possible), just start immediately
    if (pitcherIsBot && batterIsBot) {
      await interaction.reply({ content: setupMsg + `Both roles are bots — starting game!`, components: [] });
      await startGame(interaction, guildId);
      return;
    }

    // Send pitcher setup menu to pitcher (if human), or note bot's random choice
    if (pitcherIsBot) {
      setupMsg += `🤖 Bot pitcher randomly selected: **${newGame.pitcherType}** · Bonus: **${newGame.handBonus}** · **${newGame.pitcherHand === 'R' ? 'Right' : 'Left'} Handed**\n\n`;
      setupMsg += `<@${batterId}> — select your batter type:`;
      await interaction.reply({ content: setupMsg, components: [batterTypeMenu()] });
    } else if (batterIsBot) {
      setupMsg += `🤖 Bot batter randomly selected: **${newGame.batterType}** · **${newGame.batterHand === 'R' ? 'Right' : 'Left'} Handed**\n\n`;
      setupMsg += `<@${pitcherId}> — select your pitcher type:`;
      await interaction.reply({ content: setupMsg, components: [pitcherTypeMenu()] });
    } else {
      // Human vs human — pitcher goes first, batter gets their menu after
      setupMsg += `<@${pitcherId}> — select your pitcher type:`;
      await interaction.reply({ content: setupMsg, components: [pitcherTypeMenu()] });
      // Send batter menu as a separate follow-up so both can choose simultaneously
      await interaction.followUp({
        content: `🔵 <@${batterId}> — select your batter type while the pitcher sets up:`,
        components: [batterTypeMenu()],
      });
    }
    return;
  }

  // ── /endgame ────────────────────────────────────────────────────────────────
  if (commandName === 'endgame') {
    if (!game) {
      await interaction.reply({ content: `⚠️ No game is currently running.`, ephemeral: true });
      return;
    }
    const board = game.started ? scoreboard(game) : '';
    games.delete(guildId);
    await interaction.reply({ content: `🛑 Game ended early by <@${userId}>.` + board });
    return;
  }

  // ── /status ─────────────────────────────────────────────────────────────────
  if (commandName === 'status') {
    if (!game) {
      await interaction.reply({ content: `No game is currently running. Use \`/startgame\` to begin.`, ephemeral: true });
      return;
    }
    if (!game.started) {
      await interaction.reply({ content: `⏳ Game is still in setup — waiting for selections to be completed.`, ephemeral: true });
      return;
    }
    const sameHand   = game.pitcherHand === game.batterHand;
    const handNote   = sameHand ? `🤝 Same hand — **${game.handBonus}** bonus active` : `↔️ Different hands — no bonus`;
    const waitingFor = game.pending
      ? `Waiting for **Batter** ${displayName(game.batterId)} to \`/swing\`.`
      : `Waiting for **Pitcher** ${displayName(game.pitcherId)} to \`/pitch\`.`;
    await interaction.reply({
      content:
        `⚾ **Game in progress — Turn ${game.turn}/${TOTAL_TURNS}**\n` +
        `🟡 Pitcher: ${displayName(game.pitcherId)} (${game.pitcherType}, ${game.pitcherHand}) · 🔵 Batter: ${displayName(game.batterId)} (${game.batterType}, ${game.batterHand})\n` +
        `${handNote}\n${waitingFor}` +
        scoreboard(game),
      ephemeral: true,
    });
    return;
  }

  // ── /pitch ──────────────────────────────────────────────────────────────────
  if (commandName === 'pitch') {
    if (!game || !game.started) {
      await interaction.reply({ content: `⚠️ No game is running yet.`, ephemeral: true });
      return;
    }
    if (game.pitcherIsBot) {
      await interaction.reply({ content: `⚠️ The bot is pitching this game — it pitches automatically.`, ephemeral: true });
      return;
    }
    if (userId !== game.pitcherId) {
      await interaction.reply({ content: `⚠️ Only the assigned Pitcher (<@${game.pitcherId}>) can use \`/pitch\`.`, ephemeral: true });
      return;
    }
    if (game.pending) {
      await interaction.reply({ content: `⚠️ You already pitched this turn. Waiting for the Batter to \`/swing\`.`, ephemeral: true });
      return;
    }

    const value = interaction.options.getInteger('value');
    game.pending = { number: value };

    await interaction.reply({ content: `✅ Pitch of **${value}** locked in — only you can see this!`, ephemeral: true });
    await interaction.followUp({
      content:
        `⚾ **Turn ${game.turn}/${TOTAL_TURNS}** — 🟡 Pitcher has thrown a pitch!\n` +
        `${displayName(game.batterId)} — swing with \`/swing\`!`,
    });
    return;
  }

  // ── /swing ──────────────────────────────────────────────────────────────────
  if (commandName === 'swing') {
    if (!game || !game.started) {
      await interaction.reply({ content: `⚠️ No game is running yet.`, ephemeral: true });
      return;
    }
    if (game.batterIsBot) {
      await interaction.reply({ content: `⚠️ The bot is batting this game — it swings automatically.`, ephemeral: true });
      return;
    }
    if (userId !== game.batterId) {
      await interaction.reply({ content: `⚠️ Only the assigned Batter (<@${game.batterId}>) can use \`/swing\`.`, ephemeral: true });
      return;
    }
    if (!game.pending) {
      await interaction.reply({ content: `⚠️ No pitch has been thrown yet.`, ephemeral: true });
      return;
    }

    const swingValue = interaction.options.getInteger('value');
    await interaction.reply({ content: `🔵 Swing of **${swingValue}** recorded!`, ephemeral: true });
    await resolveTurn(interaction, guildId, swingValue);
    return;
  }
});

// ── Resolve a turn given a swing value ───────────────────────────────────────
async function resolveTurn(interaction, guildId, swingValue) {
  const game       = games.get(guildId);
  const pitchValue = game.pending.number;
  const rawDiff    = Math.abs(pitchValue - swingValue);
  const wrapDiff   = 1000 - rawDiff;
  const diff       = Math.min(rawDiff, wrapDiff);
  const result     = getResult(diff, game.ranges);

  game.history.push({ pitch: pitchValue, swing: swingValue, diff });
  game.pending = null;

  const currentTurn = game.turn;
  const isLastTurn  = currentTurn === TOTAL_TURNS;
  const pointsLine  = result.points > 0 ? ` · **+${result.points} pts**` : '';

  let msg =
    `⚾ **Turn ${currentTurn}/${TOTAL_TURNS} Result**\n\n` +
    `🟡 Pitch: **${pitchValue}** · 🔵 Swing: **${swingValue}**\n` +
    `Diff: **${diff}** · ${result.emoji} **${result.label}**${pointsLine}`;

  if (isLastTurn) {
    msg += `\n\n🏁 **Game over!** All ${TOTAL_TURNS} turns complete.` + scoreboard(game);
    games.delete(guildId);
    await interaction.followUp({ content: msg });
  } else {
    game.turn += 1;

    // If bot is pitching next, do it automatically
    if (game.pitcherIsBot) {
      const botPitchValue = botPitch(game.ranges);
      game.pending = { number: botPitchValue };
      msg +=
        `\n\n🤖 **Bot has thrown turn ${game.turn} pitch!**\n` +
        `${displayName(game.batterId)} — swing with \`/swing\`!`;
      await interaction.followUp({ content: msg });
    } else {
      msg += `\n\n${displayName(game.pitcherId)} — throw turn ${game.turn} with \`/pitch\`!`;
      await interaction.followUp({ content: msg });
    }
  }
}

// ── Start the game once all selections are complete ───────────────────────────
async function startGame(interaction, guildId) {
  const game     = games.get(guildId);
  const sameHand = game.pitcherHand === game.batterHand;
  game.ranges    = buildRanges(game.pitcherType, game.batterType, game.handBonus, sameHand);
  game.started   = true;

  const pitcherHandLabel = game.pitcherHand === 'R' ? 'Right' : 'Left';
  const batterHandLabel  = game.batterHand  === 'R' ? 'Right' : 'Left';
  const handNote = sameHand
    ? `🤝 Same handedness — **${game.handBonus}** bonus applied!`
    : `↔️ Different handedness — no hand bonus applied.`;

  let cumulative = 0;
  const rangeLines = game.ranges.map(r => {
    const low = cumulative;
    cumulative = r.max + 1;
    return `${OUTCOME_EMOJI[r.label]} **${r.label}**: ${low}–${r.max}`;
  });

  let setupMsg =
    `✅ **Setup complete! Game is starting.**\n\n` +
    `🟡 Pitcher: ${displayName(game.pitcherId)} — **${game.pitcherType}** · Bonus: **${game.handBonus}** · **${pitcherHandLabel} Handed**\n` +
    `🔵 Batter: ${displayName(game.batterId)} — **${game.batterType}** · **${batterHandLabel} Handed**\n` +
    `${handNote}\n\n` +
    `📊 **Outcome ranges:**\n` +
    rangeLines.join('\n');

  // If bot is pitching, throw first pitch automatically
  if (game.pitcherIsBot) {
    const botPitchValue = botPitch(game.ranges);
    game.pending = { number: botPitchValue };
    setupMsg +=
      `\n\n🤖 **Bot has thrown the first pitch!**\n` +
      `${displayName(game.batterId)} — swing with \`/swing\`!`;
  } else {
    setupMsg += `\n\n${displayName(game.pitcherId)} — throw the first pitch with \`/pitch\`!`;
  }

  await interaction.followUp({ content: setupMsg });
}

// ── Start ─────────────────────────────────────────────────────────────────────
(async () => {
  await registerCommands();
  await client.login(TOKEN);
})();
