# E2E Order Tests

JSONベースのE2Eテスト実行環境。Playwrightを使用して注文フローをテストします。

## 🏗️ アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│ ローカル（テストケース作成）                                   │
│                                                             │
│   Claude + MCP Playwright ──▶ JSONテストケース生成           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼ git push
┌─────────────────────────────────────────────────────────────┐
│ GitHub Actions（テスト実行）                                  │
│                                                             │
│   JSONロード ──▶ Playwright実行 ──▶ レポート生成             │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ GitHub Pages（結果閲覧）                                      │
│                                                             │
│   価格マトリックス / スクリーンショット / 詳細結果             │
└─────────────────────────────────────────────────────────────┘
```

## 📁 ディレクトリ構成

```
e2e-order-tests/
├── test-cases/
│   └── calendar/              # カレンダー商品のテストケース
│       ├── _matrix.json       # テストマトリックス定義
│       ├── test_001_xxx.json
│       └── ...
├── src/
│   ├── runner.ts              # テスト実行スクリプト
│   └── report-generator.ts    # HTMLレポート生成
├── results/                   # テスト結果（gitignore）
├── .github/workflows/
│   └── e2e-test.yml          # GitHub Actions
└── package.json
```

## 🚀 セットアップ

### 1. リポジトリをクローン

```bash
git clone https://github.com/YOUR_ORG/e2e-order-tests.git
cd e2e-order-tests
npm install
```

### 2. GitHub Secretsを設定

リポジトリの Settings > Secrets and variables > Actions で以下を設定：

| Secret | 説明 |
|--------|------|
| `DEV_LOGIN_USER` | 開発環境ログインユーザー |
| `DEV_LOGIN_PASS` | 開発環境ログインパスワード |
| `DEV_BASIC_USER` | 開発環境Basic認証ユーザー |
| `DEV_BASIC_PASS` | 開発環境Basic認証パスワード |
| `STAGING_LOGIN_USER` | ステージング環境ログインユーザー |
| `STAGING_LOGIN_PASS` | ステージング環境ログインパスワード |
| `SLACK_WEBHOOK_URL` | Slack通知用（オプション） |

### 3. GitHub Pages を有効化

Settings > Pages > Source: `gh-pages` branch

## 📝 テストケースの作成

### MCPを使った作成（推奨）

Claude + MCP Playwright を使って対話的にテストケースを作成：

```
User: カレンダー商品の注文テストを作成して。
      オプション：スタンドあり/なし
      配送：ゆうメール/ゆうパケット/ゆうパック
      決済：クレカ/代引き/PayPay...

Claude: [MCP Playwrightで実際に操作しながらJSONを生成]
```

### JSONフォーマット

```json
{
  "testInfo": {
    "id": "test_001",
    "option": "専用スタンドあり",
    "shipping": "ゆうメール",
    "payment": "クレジットカード"
  },
  "url": "https://example.com/edit/",
  "credentialKey": "dev",
  "device": "pc",
  "headless": true,
  "actions": [
    { "type": "waitForSelector", "selector": "body", "timeout": 10000 },
    { "type": "click", "selector": "text=次へ" },
    { "type": "fill", "selector": "#email", "value": "{{LOGIN_USER}}" },
    { "type": "screenshot" }
  ]
}
```

### 利用可能なアクション

| アクション | 説明 | 例 |
|-----------|------|-----|
| `click` | 要素をクリック | `{ "type": "click", "selector": "#btn" }` |
| `fill` | テキスト入力 | `{ "type": "fill", "selector": "#input", "value": "text" }` |
| `select` | セレクトボックス | `{ "type": "select", "selector": "select", "value": "opt1" }` |
| `waitForSelector` | 要素を待機 | `{ "type": "waitForSelector", "selector": ".loaded" }` |
| `wait` | 待機（ms） | `{ "type": "wait", "x": 2000 }` |
| `screenshot` | スクリーンショット | `{ "type": "screenshot" }` |
| `screenshotFullPage` | フルページスクショ | `{ "type": "screenshotFullPage" }` |
| `evaluate` | JS実行 | `{ "type": "evaluate", "value": "document.title" }` |
| `uploadFile` | ファイルアップロード | `{ "type": "uploadFile", "selector": "input[type=file]", "filePath": "/path/to/file" }` |
| `getText` | テキスト取得 | `{ "type": "getText", "selector": "h1" }` |
| `getCurrentUrl` | URL取得 | `{ "type": "getCurrentUrl" }` |

### プレースホルダー

| プレースホルダー | 説明 |
|-----------------|------|
| `{{LOGIN_USER}}` | ログインユーザー名（環境変数から） |
| `{{LOGIN_PASS}}` | ログインパスワード（環境変数から） |

## 🏃 テスト実行

### ローカル実行

```bash
# 環境変数設定
export DEV_LOGIN_USER="your_user"
export DEV_LOGIN_PASS="your_pass"

# 全テスト実行
npm run test

# 特定ディレクトリ
npm run test -- --dir=./test-cases/calendar

# 単一ファイル
npm run test -- --file=./test-cases/calendar/test_001.json

# レポート生成
npm run report
```

### GitHub Actions 実行

1. **手動実行**: Actions > E2E Order Tests > Run workflow
2. **自動実行**: 毎日午前9時（JST）
3. **PR時**: test-cases/ の変更時

## 📊 結果の確認

### GitHub Pages

```
https://YOUR_ORG.github.io/e2e-order-tests/reports/RUN_NUMBER/report.html
```

### Artifacts

Actions > 該当のRun > Artifacts からダウンロード

## 🔧 カスタマイズ

### 新しい商品のテストを追加

```bash
mkdir test-cases/new-product
# JSONファイルを追加
```

### 環境を追加

1. `.github/workflows/e2e-test.yml` に環境変数を追加
2. GitHub Secrets に認証情報を追加
3. テストケースの `credentialKey` を更新

## 🐛 トラブルシューティング

### よくあるエラー

| エラー | 原因 | 対処 |
|-------|------|------|
| `Timeout` | ページロードが遅い | `timeout` を増やす / `wait` を追加 |
| `Element not found` | セレクタが変わった | 実際のページでセレクタを確認 |
| `Authentication failed` | 認証情報が間違い | Secretsを確認 |

### デバッグ

```bash
# ヘッドありモード（ブラウザ表示）
npm run test -- --headless=false
```

## 📄 ライセンス

MIT
