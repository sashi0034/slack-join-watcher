# slack-join-watcher

Slack ワークスペース内で **メンバーがチャンネルに参加した際**、指定の通知用チャンネルに

```
:tada: `U01ABCDEFG`: *Alice* joined #general
```

の形式でアナウンスする Slack ボットです。`@slack/bolt` (TypeScript, Socket Mode) で実装。

主な特徴:

- ユーザーの **ディスプレイネーム** を投稿に使用（`users.info` から取得）
- 投稿時の **アイコンと表示名をユーザー本人のもの** に差し替え (`chat:write.customize`)
- 大量の参加イベントが一度に来てもレートリミットに引っかからないよう、
  **遅延付き直列キュー** で `chat.postMessage` を順次処理
- ユーザー / チャンネル情報は **TTL キャッシュ** で再リクエストを抑制
- Socket Mode で動作（公開 URL / 署名検証不要）

---

## 必要な Slack 権限 (Scopes / Events)

> **重要**: ボットトークンだけでは「ボットが入っているチャンネル」の `member_joined_channel`
> しか受け取れません（Enterprise Grid 限定の `channels:read.public` を除く）。
> このボットでは **インストール者のユーザートークン** で `member_joined_channel` を購読し、
> ユーザーが入っている全チャンネルを監視します。

> **手っ取り早く作るなら**: <https://api.slack.com/apps> → **Create New App** → **From an app manifest**
> を選び、[manifest.example.yml](manifest.example.yml) の中身を貼り付ければ scope / event 設定が一括で入ります。
> その後 **Install to Workspace** すると **Bot Token (`xoxb-...`) と User Token (`xoxp-...`)** が両方発行されます。
> 加えて **Basic Information** → **App-Level Tokens** で `connections:write` 付きの App-Level Token (`xapp-...`) を発行してください。

手動で設定する場合は、Slack App 管理画面で以下を設定してください。

### Bot Token Scopes

ボットは「投稿する人」だけ。各チャンネルに招待されている必要はありません
（ただし通知投稿先である `notifyChannelId` のチャンネルには招待してください）。

| Scope | 用途 |
| --- | --- |
| `chat:write` | 通知チャンネルへの投稿 |
| `chat:write.customize` | 投稿時にユーザーの表示名・アイコンを使う |

### User Token Scopes

ユーザートークンが「監視の目」。インストール者が入っている全チャンネルを見られます。

| Scope | 用途 |
| --- | --- |
| `channels:read` | パブリックチャンネルの情報取得 + `member_joined_channel` 受信 |
| `groups:read` | プライベートチャンネルの情報取得 + `member_joined_channel` 受信 |
| `users:read` | ユーザーの表示名・プロフィール画像の取得 |

### Event Subscriptions

`Subscribe to events on behalf of users` (= `user_events`) に以下を追加:

- `member_joined_channel`

> **`bot_events` 側に追加しないこと**: 両方に入れるとイベントが二重発火します。

### Socket Mode

- **Socket Mode を ON** にする
- **Basic Information** → **App-Level Tokens** で `connections:write` 付きの App-Level Token (`xapp-...`) を発行
- 発行したトークンを `.env` の `SLACK_APP_TOKEN` に設定

### 何が見えて何が見えないか

- 監視対象は **インストール者がメンバーであるチャンネルすべて**（パブリック / プライベート問わず）
- ワークスペース管理者でインストールすればワークスペース全体に近い可視範囲になる
- ユーザーが入っていないプライベートチャンネルの参加イベントは取れない
- DM / Group DM では `member_joined_channel` は発火しない

---

## セットアップ

### 1. 依存をインストール

```bash
npm install
```

### 2. `.env` を作る

```bash
cp .env.example .env
# SLACK_BOT_TOKEN, SLACK_APP_TOKEN, SLACK_USER_TOKEN を設定
```

### 3. `config.json` を作る

```bash
cp config.example.json config.json
```

`config.json`:

```jsonc
{
  // 通知を投稿するチャンネルの ID (C... or G...)。Slack でチャンネル名を右クリック → "View channel details" で確認可
  "notifyChannelId": "C0123456789",

  // 連続投稿の間隔 (ms)。Slack の chat.postMessage は Tier 4 (1 msg/sec/channel) なので 1.5s 以上推奨
  "rateLimitDelayMs": 1500,

  // 通知から除外したいチャンネル ID のリスト
  "ignoreChannelIds": [],

  // ボット (is_bot=true) のチャンネル参加を無視するか
  "ignoreBots": true,

  // ユーザー / チャンネル情報のキャッシュ TTL (ms)
  "userInfoCacheTtlMs": 600000,
  "channelInfoCacheTtlMs": 600000
}
```

### 4. 起動

開発:

```bash
npm run dev
```

本番:

```bash
npm run build
npm start
```

`⚡️ slack-join-watcher started (Socket Mode). Notifying channel C...` と表示されれば OK。

---

## 動作の流れ

1. `member_joined_channel` イベント受信
2. 通知対象外 (`ignoreChannelIds`) や Bot 自身の参加はスキップ
3. レートリミットキューにタスクを enqueue
4. キューが順番に
   - `users.info` でディスプレイネーム / アイコン URL を取得 (キャッシュ参照)
   - `conversations.info` でチャンネル名を取得 (キャッシュ参照)
   - `chat.postMessage` で `notifyChannelId` に投稿
   - `username` と `icon_url` を該当ユーザーのものにオーバーライド
5. 次のタスクは `rateLimitDelayMs` 経過後に処理

これにより、1 ユーザーが一度に大量のチャンネルに招待された場合でも、
`chat.postMessage` の投稿は `rateLimitDelayMs` 間隔で直列に流れ、
Slack の rate limit (HTTP 429) を踏みにくくなります。

---

## 注意点

- **プライベートチャンネル**: `member_joined_channel` をプライベートチャンネルで受け取るには、
  ボットがそのチャンネルに **メンバーとして参加している必要** があります（Slack の仕様）。
- **DM / Group DM**: これらでは `member_joined_channel` は発火しません。
- **アイコンが反映されない**: `chat:write.customize` を付与しているか確認してください。
- **ディスプレイネームが空**: 設定されていないユーザーは `real_name` → `name` → user ID の順で
  フォールバックします。
- **ボット自身の参加通知を抑制**: `auth.test` で取得した bot user id と一致するイベントは
  スキップします。

