import * as fs from 'fs';
import * as path from 'path';

export interface Config {
  notifyChannelId: string;
  rateLimitDelayMs: number;
  ignoreChannelIds: string[];
  ignoreBots: boolean;
  userInfoCacheTtlMs: number;
  channelInfoCacheTtlMs: number;
}

const DEFAULTS = {
  rateLimitDelayMs: 1500,
  ignoreChannelIds: [] as string[],
  ignoreBots: true,
  userInfoCacheTtlMs: 10 * 60 * 1000,
  channelInfoCacheTtlMs: 10 * 60 * 1000,
};

export function loadConfig(): Config {
  const configPath = process.env.CONFIG_PATH
    ? path.resolve(process.env.CONFIG_PATH)
    : path.resolve(process.cwd(), 'config.json');

  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Config file not found at ${configPath}. Copy config.example.json to config.json and edit it.`,
    );
  }

  const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Partial<Config>;

  if (!raw.notifyChannelId || typeof raw.notifyChannelId !== 'string') {
    throw new Error('config.notifyChannelId is required and must be a Slack channel ID (e.g. "C0123...").');
  }

  return {
    notifyChannelId: raw.notifyChannelId,
    rateLimitDelayMs: raw.rateLimitDelayMs ?? DEFAULTS.rateLimitDelayMs,
    ignoreChannelIds: raw.ignoreChannelIds ?? DEFAULTS.ignoreChannelIds,
    ignoreBots: raw.ignoreBots ?? DEFAULTS.ignoreBots,
    userInfoCacheTtlMs: raw.userInfoCacheTtlMs ?? DEFAULTS.userInfoCacheTtlMs,
    channelInfoCacheTtlMs: raw.channelInfoCacheTtlMs ?? DEFAULTS.channelInfoCacheTtlMs,
  };
}
