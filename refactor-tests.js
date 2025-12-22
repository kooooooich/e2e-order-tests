const fs = require('fs');
const path = require('path');

// Text selector patterns to role-based selector mapping
const selectorMappings = [
  // Button selectors
  { pattern: 'text=ましかくサイズ', role: 'button', name: 'ましかくサイズ' },
  { pattern: 'text=次へ', role: 'button', name: '次へ' },
  { pattern: /text=ストライプA\d+/, role: 'button', name: null, useOriginalName: true },
  { pattern: 'text=自動配置', role: 'button', name: '自動配置' },
  { pattern: 'text=はい', role: 'button', name: 'はい' },
  { pattern: 'text=配送先を選ぶ', role: 'button', name: '配送先を選ぶ' },
  { pattern: 'text=お支払いへ進む', role: 'button', name: 'お支払いへ進む' },
  { pattern: 'text=新しいカードを使う', role: 'button', name: '新しいカードを使う' },
  { pattern: 'text=このカードを使う', role: 'button', name: 'このカードを使う' },
  { pattern: 'text=ご注文内容を確認する', role: 'button', name: 'ご注文内容を確認する' },
  { pattern: 'text=注文を確定する', role: 'button', name: '注文を確定する' },
];

function extractNameFromSelector(selector, pattern) {
  if (typeof pattern === 'string') {
    return null;
  }
  // For regex patterns like ストライプA001, extract the actual text
  const match = selector.match(/text=(.+)/);
  return match ? match[1] : null;
}

function refactorAction(action) {
  const newAction = { ...action };

  // Skip if already has role
  if (newAction.role) {
    return newAction;
  }

  // Only process click and waitForSelector actions with text selectors
  if (!['click', 'waitForSelector'].includes(newAction.type)) {
    return newAction;
  }

  if (!newAction.selector || !newAction.selector.startsWith('text=')) {
    return newAction;
  }

  // Check mappings
  for (const mapping of selectorMappings) {
    let matched = false;
    let extractedName = null;

    if (typeof mapping.pattern === 'string') {
      matched = newAction.selector === mapping.pattern;
    } else {
      matched = mapping.pattern.test(newAction.selector);
      if (matched && mapping.useOriginalName) {
        extractedName = extractNameFromSelector(newAction.selector, mapping.pattern);
      }
    }

    if (matched) {
      delete newAction.selector;
      newAction.role = mapping.role;
      newAction.name = extractedName || mapping.name;

      // Add exact: false for partial matches
      if (newAction.name && (newAction.name.includes('注文') || newAction.name.includes('マイページ'))) {
        newAction.exact = false;
      }

      break;
    }
  }

  return newAction;
}

function refactorUploadActions(actions) {
  const newActions = [];

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];

    // Convert uploadFile to uploadFileWithApiWait
    if (action.type === 'uploadFile') {
      const uploadAction = {
        type: 'uploadFileWithApiWait',
        selector: action.selector,
        filePath: action.filePath,
        urlPattern: 'upload',
        timeout: action.timeout || 60000,
        comment: '画像アップロードとAPI完了を待機',
      };
      newActions.push(uploadAction);

      // Remove the next waitForSelector for "text=自動配置" if it exists
      // as it will be handled by API wait
      if (i + 1 < actions.length &&
          actions[i + 1].type === 'waitForSelector' &&
          actions[i + 1].selector === 'text=自動配置') {
        i++; // Skip the next action
      }
      continue;
    }

    // Convert evaluate actions for dialogs to proper role-based clicks
    if (action.type === 'evaluate' && action.value) {
      // OK button dialog
      if (action.value.includes("'OK'") || action.value.includes('"OK"')) {
        newActions.push({
          type: 'click',
          role: 'button',
          name: 'OK',
          timeout: 5000,
          comment: 'ダイアログのOKボタンをクリック(存在する場合)',
        });
        continue;
      }

      // 閉じる button
      if (action.value.includes('閉じる')) {
        newActions.push({
          type: 'click',
          role: 'button',
          name: '閉じる',
          timeout: 5000,
          comment: 'モーダルの閉じるボタン(存在する場合)',
        });
        continue;
      }

      // マイページ button/link
      if (action.value.includes('マイページ')) {
        newActions.push({
          type: 'click',
          role: 'link',
          name: 'マイページ',
          exact: false,
          timeout: 5000,
          comment: 'マイページへのリンク(存在する場合)',
        });
        continue;
      }

      // 注文する button
      if (action.value.includes('注文') && !action.value.includes('注文を確定する')) {
        newActions.push({
          type: 'click',
          role: 'button',
          name: '注文する',
          exact: false,
        });
        continue;
      }

      // Complex completion check evaluate - convert to waitForResponse
      if (action.value.includes('complete') && action.value.includes('maxWait')) {
        newActions.push({
          type: 'waitForResponse',
          urlPattern: 'complete',
          timeout: 30000,
          comment: '注文完了APIのレスポンスを待機',
        });
        continue;
      }
    }

    newActions.push(refactorAction(action));
  }

  return newActions;
}

function refactorTestCase(testCase) {
  return {
    ...testCase,
    actions: refactorUploadActions(testCase.actions),
  };
}

function processFile(filePath) {
  console.log(`Processing: ${filePath}`);

  const content = fs.readFileSync(filePath, 'utf-8');
  const testCase = JSON.parse(content);

  const refactoredTestCase = refactorTestCase(testCase);

  fs.writeFileSync(filePath, JSON.stringify(refactoredTestCase, null, 2) + '\n');
  console.log(`  ✓ Updated`);
}

// Main execution
const testDir = path.join(__dirname, 'test-cases', 'calendar');
const files = fs.readdirSync(testDir)
  .filter(f => f.startsWith('test_') && f.endsWith('.json'))
  .map(f => path.join(testDir, f));

console.log(`Found ${files.length} test files to process\n`);

files.forEach(processFile);

console.log(`\n✓ All ${files.length} test files have been refactored!`);
