import { chromium, Browser, Page, BrowserContext } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

// ============================================
// 型定義
// ============================================

interface TestAction {
  type: string;
  selector?: string;
  value?: string;
  timeout?: number;
  x?: number;
  y?: number;
  filePath?: string;
  filePaths?: string[];
  targetSelector?: string;
  comment?: string;
}

interface TestInfo {
  id: string;
  option: string;
  shipping: string;
  payment: string;
}

interface TestCase {
  testInfo: TestInfo;
  url: string;
  credentialKey?: string;
  device: 'pc' | 'mobile';
  headless: boolean;
  actions: TestAction[];
}

interface TestResult {
  testId: string;
  testInfo: TestInfo;
  success: boolean;
  price?: string;
  error?: string;
  screenshots: string[];
  duration: number;
  timestamp: string;
}

interface Credentials {
  loginUser: string;
  loginPass: string;
  basicUser?: string;
  basicPass?: string;
}

// ============================================
// 設定
// ============================================

const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || './results/screenshots';
const RESULTS_DIR = process.env.RESULTS_DIR || './results';

// ============================================
// ユーティリティ関数
// ============================================

function getCredentials(credentialKey?: string): Credentials {
  const key = (credentialKey || 'dev').toUpperCase();
  return {
    loginUser: process.env[`${key}_LOGIN_USER`] || '',
    loginPass: process.env[`${key}_LOGIN_PASS`] || '',
    basicUser: process.env[`${key}_BASIC_USER`],
    basicPass: process.env[`${key}_BASIC_PASS`],
  };
}

function replaceCredentialPlaceholders(value: string, creds: Credentials): string {
  return value
    .replace('{{LOGIN_USER}}', creds.loginUser)
    .replace('{{LOGIN_PASS}}', creds.loginPass);
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ============================================
// アクション実行
// ============================================

async function executeAction(
  page: Page,
  action: TestAction,
  creds: Credentials,
  testId: string,
  screenshotIndex: { value: number }
): Promise<{ screenshot?: string; result?: string }> {
  const timeout = action.timeout || 30000;
  let result: { screenshot?: string; result?: string } = {};

  switch (action.type) {
    case 'goto':
      await page.goto(action.value!, { timeout });
      break;

    case 'click':
      await page.click(action.selector!, { timeout });
      break;

    case 'fill':
      const fillValue = replaceCredentialPlaceholders(action.value || '', creds);
      await page.fill(action.selector!, fillValue, { timeout });
      break;

    case 'select':
      await page.selectOption(action.selector!, action.value!, { timeout });
      break;

    case 'check':
      await page.check(action.selector!, { timeout });
      break;

    case 'uncheck':
      await page.uncheck(action.selector!, { timeout });
      break;

    case 'getText':
      result.result = await page.textContent(action.selector!, { timeout }) || '';
      break;

    case 'getAttribute':
      result.result = await page.getAttribute(action.selector!, action.value!, { timeout }) || '';
      break;

    case 'getInputValue':
      result.result = await page.inputValue(action.selector!, { timeout });
      break;

    case 'waitForSelector':
      await page.waitForSelector(action.selector!, { timeout });
      break;

    case 'wait':
      await page.waitForTimeout(action.x || 1000);
      break;

    case 'screenshot':
    case 'screenshotFullPage':
      ensureDir(SCREENSHOT_DIR);
      const screenshotPath = path.join(
        SCREENSHOT_DIR,
        `${testId}_${String(screenshotIndex.value++).padStart(3, '0')}.png`
      );
      await page.screenshot({
        path: screenshotPath,
        fullPage: action.type === 'screenshotFullPage',
      });
      result.screenshot = screenshotPath;
      break;

    case 'press':
      await page.keyboard.press(action.value!);
      break;

    case 'hover':
      await page.hover(action.selector!, { timeout });
      break;

    case 'scrollIntoView':
      await page.locator(action.selector!).scrollIntoViewIfNeeded({ timeout });
      break;

    case 'evaluate':
      result.result = await page.evaluate(action.value!);
      break;

    case 'uploadFile':
      const absoluteFilePath = path.resolve(process.cwd(), action.filePath!);
      await page.setInputFiles(action.selector!, absoluteFilePath);
      break;

    case 'uploadFiles':
      await page.setInputFiles(action.selector!, action.filePaths!);
      break;

    case 'getCurrentUrl':
      result.result = page.url();
      break;

    case 'getTitle':
      result.result = await page.title();
      break;

    case 'dragAndDrop':
      await page.dragAndDrop(action.selector!, action.targetSelector!, { timeout });
      break;

    default:
      console.warn(`Unknown action type: ${action.type}`);
  }

  return result;
}

// ============================================
// 価格取得
// ============================================

async function extractPrice(page: Page): Promise<string | undefined> {
  try {
    // 複数のセレクタパターンを試す
    const priceSelectors = [
      '.total-price',
      '.price-total',
      '[class*="total"]',
      '[class*="price"]',
      'text=/合計.*円/',
      'text=/¥[0-9,]+/',
    ];

    for (const selector of priceSelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          const text = await element.textContent();
          if (text && /[0-9,]+円|¥[0-9,]+/.test(text)) {
            return text.trim();
          }
        }
      } catch {
        continue;
      }
    }

    // ページ全体から価格パターンを探す
    const pageContent = await page.content();
    const priceMatch = pageContent.match(/合計[：:]\s*([0-9,]+円|¥[0-9,]+)/);
    if (priceMatch) {
      return priceMatch[1];
    }

    return undefined;
  } catch (error) {
    console.warn('Price extraction failed:', error);
    return undefined;
  }
}

// ============================================
// テスト実行
// ============================================

async function runTest(testCase: TestCase): Promise<TestResult> {
  const startTime = Date.now();
  const screenshots: string[] = [];
  const creds = getCredentials(testCase.credentialKey);
  
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    // ブラウザ起動
    browser = await chromium.launch({
      headless: testCase.headless,
    });

    // コンテキスト設定
    const contextOptions: any = {
      viewport: testCase.device === 'mobile' 
        ? { width: 375, height: 667 }
        : { width: 1280, height: 720 },
    };

    // Basic認証
    if (creds.basicUser && creds.basicPass) {
      contextOptions.httpCredentials = {
        username: creds.basicUser,
        password: creds.basicPass,
      };
    }

    context = await browser.newContext(contextOptions);
    page = await context.newPage();

    // 初期URL
    await page.goto(testCase.url, { timeout: 60000 });

    // アクション実行
    const screenshotIndex = { value: 1 };
    let price: string | undefined;

    for (const action of testCase.actions) {
      console.log(`  [${testCase.testInfo.id}] Executing: ${action.type} ${action.selector || action.value || ''}`);
      
      const result = await executeAction(page, action, creds, testCase.testInfo.id, screenshotIndex);
      
      if (result.screenshot) {
        screenshots.push(result.screenshot);
      }

      // 注文確認画面で価格を取得
      if (action.type === 'screenshotFullPage') {
        price = await extractPrice(page);
      }
    }

    return {
      testId: testCase.testInfo.id,
      testInfo: testCase.testInfo,
      success: true,
      price,
      screenshots,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };

  } catch (error) {
    // エラー時のスクリーンショット
    if (page) {
      try {
        ensureDir(SCREENSHOT_DIR);
        const errorScreenshot = path.join(SCREENSHOT_DIR, `${testCase.testInfo.id}_error.png`);
        await page.screenshot({ path: errorScreenshot, fullPage: true });
        screenshots.push(errorScreenshot);
      } catch {}
    }

    return {
      testId: testCase.testInfo.id,
      testInfo: testCase.testInfo,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      screenshots,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };

  } finally {
    if (context) await context.close();
    if (browser) await browser.close();
  }
}

// ============================================
// メイン
// ============================================

async function main() {
  const args = process.argv.slice(2);
  const testCasesDir = args.find(a => a.startsWith('--dir='))?.split('=')[1] || './test-cases/calendar';
  const singleFile = args.find(a => a.startsWith('--file='))?.split('=')[1];

  ensureDir(RESULTS_DIR);

  let testFiles: string[];

  if (singleFile) {
    testFiles = [singleFile];
  } else {
    testFiles = fs.readdirSync(testCasesDir)
      .filter(f => f.endsWith('.json') && !f.startsWith('_'))
      .map(f => path.join(testCasesDir, f));
  }

  console.log(`\n🧪 Running ${testFiles.length} test(s)...\n`);

  const results: TestResult[] = [];

  for (const file of testFiles) {
    console.log(`\n📋 Loading: ${file}`);
    const testCase: TestCase = JSON.parse(fs.readFileSync(file, 'utf-8'));
    console.log(`   Option: ${testCase.testInfo.option}`);
    console.log(`   Shipping: ${testCase.testInfo.shipping}`);
    console.log(`   Payment: ${testCase.testInfo.payment}`);

    const result = await runTest(testCase);
    results.push(result);

    if (result.success) {
      console.log(`   ✅ Success (${result.duration}ms) - Price: ${result.price || 'N/A'}`);
    } else {
      console.log(`   ❌ Failed: ${result.error}`);
    }
  }

  // 結果を保存
  const resultsFile = path.join(RESULTS_DIR, `results_${Date.now()}.json`);
  fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
  console.log(`\n📊 Results saved to: ${resultsFile}`);

  // サマリー表示
  const successCount = results.filter(r => r.success).length;
  console.log(`\n============================================`);
  console.log(`📈 Summary: ${successCount}/${results.length} passed`);
  console.log(`============================================\n`);

  // 価格一覧
  console.log('💰 Price Matrix:');
  console.log('─'.repeat(80));
  console.log('| Option | Shipping | Payment | Price |');
  console.log('─'.repeat(80));
  for (const r of results) {
    if (r.success) {
      console.log(`| ${r.testInfo.option.padEnd(14)} | ${r.testInfo.shipping.padEnd(10)} | ${r.testInfo.payment.padEnd(14)} | ${(r.price || 'N/A').padEnd(10)} |`);
    }
  }
  console.log('─'.repeat(80));

  // 終了コード
  process.exit(successCount === results.length ? 0 : 1);
}

main().catch(console.error);
