import 'dotenv/config';
import { App, LogLevel } from '@slack/bolt';
import { WebClient } from '@slack/web-api';
import { loadConfig } from './config';
import { RateLimitedQueue } from './queue';
import { TtlCache } from './cache';

const config = loadConfig();

const botToken = requireEnv('SLACK_BOT_TOKEN');
const appToken = requireEnv('SLACK_APP_TOKEN');
// User token gives visibility into every channel the installing user is in,
// which is how we get `member_joined_channel` for channels the bot itself
// is not a member of (workspace apps don't have channels:read.public).
const userToken = requireEnv('SLACK_USER_TOKEN');

const app = new App({
  token: botToken,
  appToken,
  socketMode: true,
  logLevel: LogLevel.INFO,
});

// Read-side client uses the user token: `users.info` and `conversations.info`
// resolve for any channel the installing user can see.
const userClient = new WebClient(userToken);

const queue = new RateLimitedQueue(config.rateLimitDelayMs);

interface UserDisplay {
  displayName: string;
  iconUrl: string | undefined;
  isBot: boolean;
}

interface ChannelDisplay {
  name: string;
}

const userCache = new TtlCache<UserDisplay>(config.userInfoCacheTtlMs);
const channelCache = new TtlCache<ChannelDisplay>(config.channelInfoCacheTtlMs);

app.event('member_joined_channel', async ({ event, client }) => {
  if (config.ignoreChannelIds.includes(event.channel)) return;

  // Skip notifications for the bot user itself joining a channel.
  // (We don't want a self-announcement when the bot is invited somewhere.)
  const authedUserId = await getBotUserId(client);
  if (authedUserId && event.user === authedUserId) return;

  queue.enqueue(async () => {
    try {
      const user = await fetchUserDisplay(userClient, event.user);
      if (!user) return;
      if (config.ignoreBots && user.isBot) return;

      const channel = await fetchChannelDisplay(userClient, event.channel);
      if (!channel) return;

      const text =
        `:tada: *${escapeForSlack(user.displayName)}* ` +
        `joined <#${event.channel}|${channel.name}>`;
      // `:tada: \`${event.user}\`: *${escapeForSlack(user.displayName)}* ` +
      // `joined <#${event.channel}|${channel.name}>`;

      await client.chat.postMessage({
        channel: config.notifyChannelId,
        text,
        username: user.displayName,
        icon_url: user.iconUrl,
        unfurl_links: false,
        unfurl_media: false,
      });
    } catch (err) {
      console.error('[member_joined_channel] failed:', err);
    }
  });
});

let cachedBotUserId: string | undefined;
async function getBotUserId(client: WebClient): Promise<string | undefined> {
  if (cachedBotUserId) return cachedBotUserId;
  try {
    const res = await client.auth.test();
    cachedBotUserId = res.user_id;
    return cachedBotUserId;
  } catch (err) {
    console.error('[auth.test] failed:', err);
    return undefined;
  }
}

async function fetchUserDisplay(
  client: WebClient,
  userId: string,
): Promise<UserDisplay | undefined> {
  const cached = userCache.get(userId);
  if (cached) return cached;

  const res = await client.users.info({ user: userId });
  const user = res.user;
  if (!user) return undefined;

  const profile = user.profile;
  const displayName =
    (profile?.display_name && profile.display_name.trim().length > 0
      ? profile.display_name
      : profile?.real_name) ??
    user.real_name ??
    user.name ??
    userId;

  const iconUrl =
    profile?.image_192 ??
    profile?.image_72 ??
    profile?.image_48 ??
    profile?.image_32 ??
    undefined;

  const value: UserDisplay = {
    displayName,
    iconUrl,
    isBot: !!user.is_bot,
  };
  userCache.set(userId, value);
  return value;
}

async function fetchChannelDisplay(
  client: WebClient,
  channelId: string,
): Promise<ChannelDisplay | undefined> {
  const cached = channelCache.get(channelId);
  if (cached) return cached;

  const res = await client.conversations.info({ channel: channelId });
  const channel = res.channel as { name?: string } | undefined;
  if (!channel?.name) return undefined;

  const value: ChannelDisplay = { name: channel.name };
  channelCache.set(channelId, value);
  return value;
}

function escapeForSlack(text: string): string {
  // Per https://api.slack.com/reference/surfaces/formatting#escaping
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Environment variable ${name} is required.`);
  return value;
}

(async () => {
  await app.start();
  console.log(
    `⚡️ slack-join-watcher started (Socket Mode). Notifying channel ${config.notifyChannelId}.`,
  );
})().catch((err) => {
  console.error('Failed to start app:', err);
  process.exit(1);
});
