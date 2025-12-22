# E2E テストリファクタリングガイド

このドキュメントでは、Playwright E2Eテストのリファクタリング内容と新しいセレクタの使い方について説明します。

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
{ "role": "link", "name": "マイページ" }
```

### 従来のセレクタを使う場合
✅ ID、クラス、属性で一意に特定できる要素
```json
{ "selector": "#input-username" }
{ "selector": "input[type=file]" }
{ "selector": ".box-wrapper.option" }
```

✅ ラジオボタンやチェックボックスのラベル
```json
{ "selector": "text=/ゆうパケット/" }
{ "selector": "text=/クレジットカード/" }
```

## マイグレーション手順

既存のテストケースを新しい形式に移行する場合:

1. `refactor-tests.js` スクリプトを使用
   ```bash
   node refactor-tests.js
   ```

2. 手動で調整が必要な箇所を確認
   - フォーム入力フィールド (ID/クラスセレクタをそのまま使用)
   - ラジオボタン/チェックボックス (textセレクタを維持)

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

このリファクタリングにより:
- ✅ テストの安定性が向上
- ✅ セレクタの保守性が向上
- ✅ API処理の完了を確実に検知
- ✅ オプション要素の扱いが簡単に
- ✅ より明示的なテストコード

従来のセレクタとの後方互換性を維持しているため、段階的な移行が可能です。
