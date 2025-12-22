# E2E テストリファクタリングガイド

このドキュメントでは、Playwright E2Eテストのリファクタリング内容と新しいセレクタの使い方について説明します。

## アーキテクチャ設計

### 抽象化の原則

このプロジェクトでは、**処理ロジック**と**テストフロー**を明確に分離しています:

- **runner.ts**: 抽象化された汎用的な処理ロジック
  - アクションタイプの実装 (click, fill, waitForSelector など)
  - セレクタの解決 (role, selector)
  - エラーハンドリング、リトライ処理

- **テストケースJSON**: 宣言的なテストフロー定義
  - どの要素を操作するか (セレクタ)
  - どのアクションを実行するか (type)
  - テスト固有のパラメータ (timeout, exact など)

### 利点

1. **保守性**: テスト固有のスクリプト不要、JSONの編集のみ
2. **再利用性**: runner.tsの機能は全テストで共有
3. **可読性**: テストフローがJSONで明示的に記述される

## リファクタリングの目的

1. **安定性の向上**: テキストベースのセレクタ (`text=ボタン名`) からアクセシビリティベースのセレクタ (`role + name`) への移行
2. **API監視**: 画像アップロード処理でAPIレスポンスを待機して、処理完了を確実に検知
3. **保守性の向上**: より明示的でセマンティックなセレクタの使用

## 主な変更点

### 1. アクセシビリティベースのセレクタ

#### 従来の方法 (不安定)
```json
{
  "type": "click",
  "selector": "text=次へ"
}
```

#### 新しい方法 (安定)
```json
{
  "type": "click",
  "role": "button",
  "name": "次へ"
}
```

#### サポートされているロール

- `button`: ボタン要素
- `link`: リンク要素
- その他のPlaywrightでサポートされているすべてのARIAロール

#### オプション

- `exact`: 完全一致するかどうか (デフォルト: `false`)
  ```json
  {
    "type": "click",
    "role": "button",
    "name": "注文する",
    "exact": false  // "注文する" を含むボタンにマッチ
  }
  ```

### 2. 画像アップロード処理の改善

#### 従来の方法
```json
{
  "type": "uploadFile",
  "selector": "input[type=file]",
  "filePath": "./assets/images/sample.jpg"
},
{
  "type": "waitForSelector",
  "selector": "text=自動配置",
  "timeout": 30000
}
```

#### 新しい方法
```json
{
  "type": "uploadFileWithApiWait",
  "selector": "input[type=file]",
  "filePath": "./assets/images/sample.jpg",
  "urlPattern": "upload",
  "timeout": 60000,
  "comment": "画像アップロードとAPI完了を待機"
}
```

**メリット:**
- APIレスポンスを待機するため、アップロード処理の完了を確実に検知
- タイムアウトエラーの削減
- より信頼性の高いテスト実行

### 3. API完了待機

注文完了など、複雑なAPI処理の完了を待つ新しいアクションタイプ:

```json
{
  "type": "waitForResponse",
  "urlPattern": "complete",
  "timeout": 30000,
  "comment": "注文完了APIのレスポンスを待機"
}
```

### 4. オプション要素のクリック

存在しない可能性のある要素(モーダルの閉じるボタンなど)は、タイムアウトを短く設定:

```json
{
  "type": "click",
  "role": "button",
  "name": "閉じる",
  "timeout": 5000,
  "comment": "モーダルの閉じるボタン(存在する場合)"
}
```

**動作:**
- タイムアウトが10秒未満の場合、要素が見つからなくてもエラーにならずスキップ
- ログに「Optional element not found (skipping)」と表示

## テストアクションの型定義

```typescript
interface TestAction {
  type: string;

  // 従来のセレクタ (後方互換性のため残す)
  selector?: string;

  // 新しいアクセシビリティセレクタ
  role?: string;        // 'button', 'link', など
  name?: string;        // ボタンやリンクのテキスト
  exact?: boolean;      // 完全一致するか

  // その他のフィールド
  value?: string;
  timeout?: number;
  filePath?: string;

  // API監視用
  urlPattern?: string;      // 待機するAPIのURLパターン
  responseField?: string;   // レスポンスから取得するフィールド

  comment?: string;     // コメント(ドキュメント用)
}
```

## サポートされているアクションタイプ

### 既存のアクション (アクセシビリティセレクタ対応済み)
- `click`: 要素をクリック
- `fill`: 入力フィールドに値を入力
- `waitForSelector`: 要素が表示されるまで待機
- `check` / `uncheck`: チェックボックス操作
- `hover`: マウスホバー
- その他、すべての既存アクションで `role` + `name` を使用可能

### 新しいアクション
- `uploadFileWithApiWait`: ファイルアップロード + APIレスポンス待機
- `waitForResponse`: 特定のAPIレスポンスを待機

## セレクタの選択ガイドライン

### アクセシビリティセレクタを使う場合
✅ ボタン、リンク、明確なラベルがある要素
```json
{ "role": "button", "name": "次へ" }
{ "role": "link", "name": "新しいカードを使う" }
```

### 従来のセレクタを使う場合

#### 1. ID、クラス、属性セレクタ
```json
{ "selector": "#input-username" }
{ "selector": "input[type=file]" }
```

#### 2. Playwrightの高度なセレクタ
```json
{ "selector": ".box-wrapper.option:has-text(\"専用スタンドあり\") button" }
{ "selector": "text=/ゆうパケット/" }
```

**ポイント**: `:has-text()`, `:has()`, `>>` などのPlaywrightセレクタがそのまま使用可能

## セレクタ実装例

### 例1: 複数要素の曖昧性を解消

**問題**: `.box-wrapper.option` が2つの要素にマッチ

**解決策**: `:has-text()` で絞り込み
```json
{
  "type": "click",
  "selector": ".box-wrapper.option:has-text(\"専用スタンドあり\") button"
}
```

### 例2: 要素タイプの誤認識

**問題**: ボタンだと思ったらリンクだった

**解決策**: ブラウザの開発者ツールで確認してroleを修正
```json
// ❌ 間違い
{ "role": "button", "name": "新しいカードを使う" }

// ✅ 正しい
{ "role": "link", "name": "新しいカードを使う" }
```

## テストケース作成・修正のワークフロー

1. **ブラウザで手動確認**
   - 開発者ツールで要素を調査
   - role属性、クラス、IDを確認

2. **JSONに宣言的に記述**
   - roleセレクタを優先的に使用
   - 必要に応じてPlaywrightセレクタを使用

3. **runner.tsは修正不要**
   - 既存の抽象化で対応可能
   - 新しいアクションタイプが必要な場合のみ追加

## トラブルシューティング

### 要素が見つからないエラー
```
Click attempt 1/3 failed for role=button name=次へ
```

**解決策:**
1. ブラウザの開発者ツールで要素のrole属性を確認
2. `exact: false` を追加して部分一致を許可
3. 従来の `selector` に戻す

### タイムアウトエラー
```
Timeout waiting for role=button name=自動配置
```

**解決策:**
1. `timeout` を増やす (デフォルト: 30000ms)
2. `uploadFileWithApiWait` を使用してAPI完了を待機
3. `waitForResponse` でAPI完了を確認

## パフォーマンス最適化

- **並列実行**: `--parallel=N` オプションで並列実行数を調整
  ```bash
  npm run test -- --dir=./test-cases/calendar --parallel=5
  ```

- **オプション要素**: 存在しない可能性がある要素はタイムアウトを短く設定
  ```json
  { "timeout": 5000 }  // 10秒未満でスキップ可能
  ```

## まとめ

### アーキテクチャの利点

このリファクタリングにより:
- ✅ **抽象化**: runner.tsで汎用的な処理を実装
- ✅ **宣言的**: テストフローはJSONで明示的に記述
- ✅ **保守性**: テスト固有のスクリプト不要
- ✅ **拡張性**: 新しいアクションタイプを簡単に追加可能

### 技術的改善

- ✅ テストの安定性が向上 (アクセシビリティセレクタ)
- ✅ セレクタの保守性が向上 (セマンティックな記述)
- ✅ API処理の完了を確実に検知 (uploadFileWithApiWait, waitForResponse)
- ✅ オプション要素の扱いが簡単に (timeout < 10000でスキップ)
- ✅ より明示的なテストコード (role + name)

### 後方互換性

従来のセレクタとの後方互換性を維持:
- `selector` と `role` の両方をサポート
- 既存のテストケースをそのまま実行可能
- 段階的な移行が可能
