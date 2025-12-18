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
const PARALLEL_COUNT = parseInt(process.env.PARALLEL_COUNT || '3', 10);

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
// クリック（リトライ付き）
// ============================================

async function clickWithRetry(
  page: Page,
  selector: string,
  timeout: number = 30000,
  maxRetries: number = 3
): Promise<void> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // 要素が表示されるまで待つ
      await page.waitForSelector(selector, { state: 'visible', timeout: timeout / maxRetries });
      
      // クリック実行（force: trueでオーバーレイを無視）
      await page.click(selector, { timeout: timeout / maxRetries, force: attempt > 1 });
      return;
      
    } catch (error) {
      lastError = error as Error;
      console.log(`    Click attempt ${attempt}/${maxRetries} failed for ${selector}`);
      
      if (attempt < maxRetries) {
        // エラーダイアログがあれば閉じる
        try {
          const errorDialog = await page.$('text=再度お試しください');
          if (errorDialog) {
            console.log(`    Closing error dialog...`);
            await page.click('text=OK', { timeout: 3000, force: true }).catch(() => {});
            await page.waitForTimeout(500);
          }
        } catch {}
        
        // 少し待ってリトライ
        await page.waitForTimeout(1000);
      }
    }
  }
  
  throw lastError;
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
      await page.goto(action.value!, { timeout, waitUntil: 'networkidle' });
      break;

    case 'click':
      await clickWithRetry(page, action.selector!, timeout);
      break;

    case 'fill':
      const fillValue = replaceCredentialPlaceholders(action.value || '', creds);
      await page.waitForSelector(action.selector!, { state: 'visible', timeout });
      await page.fill(action.selector!, fillValue, { timeout });
      break;

    case 'select':
      await page.waitForSelector(action.selector!, { state: 'visible', timeout });
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
      await page.waitForSelector(action.selector!, { state: 'visible', timeout });
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
    const price = await page.evaluate(() => {
      const totalRow = document.querySelector('tr.total');
      if (totalRow) {
        const text = totalRow.textContent || '';
        const match = text.match(/([0-9,]+円)/);
        if (match) {
          return match[1];
        }
      }

      const bodyText = document.body.innerText;
      const priceMatch = bodyText.match(/合計\s*([0-9,]+円)/);
      if (priceMatch) {
        return priceMatch[1];
      }

      return null;
    });

    return price || undefined;
  } catch (error) {
    console.warn('Price extraction failed:', error);
    return undefined;
  }
}

// ============================================
// 単一テスト実行
// ============================================

async function runTest(testCase: TestCase, workerId: number): Promise<TestResult> {
  const startTime = Date.now();
  const screenshots: string[] = [];
  const creds = getCredentials(testCase.credentialKey);
  const prefix = `[W${workerId}][${testCase.testInfo.id}]`;
  
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  let price: string | undefined;  // tryブロックの外で宣言

  try {
    browser = await chromium.launch({
      headless: testCase.headless,
    });

    const contextOptions: any = {
      viewport: testCase.device === 'mobile' 
        ? { width: 375, height: 667 }
        : { width: 1280, height: 720 },
    };

    if (creds.basicUser && creds.basicPass) {
      contextOptions.httpCredentials = {
        username: creds.basicUser,
        password: creds.basicPass,
      };
    }

    context = await browser.newContext(contextOptions);
    page = await context.newPage();

    // 初期ページ読み込み
    await page.goto(testCase.url, { timeout: 60000, waitUntil: 'domcontentloaded' });

    const screenshotIndex = { value: 1 };

    for (let i = 0; i < testCase.actions.length; i++) {
      const action = testCase.actions[i];
      const actionDesc = action.selector || action.value || '';
      console.log(`  ${prefix} [${i + 1}/${testCase.actions.length}] ${action.type} ${actionDesc.substring(0, 50)}`);
      
      const result = await executeAction(page, action, creds, testCase.testInfo.id, screenshotIndex);
      
      if (result.screenshot) {
        screenshots.push(result.screenshot);
      }

      // 価格取得（確認画面または完了画面）
      if (action.type === 'screenshotFullPage' || action.type === 'screenshot') {
        const currentUrl = page.url();
        if (currentUrl.includes('/confirm') || currentUrl.includes('complete')) {
          const extractedPrice = await extractPrice(page);
          if (extractedPrice) {
            price = extractedPrice;
            console.log(`  ${prefix} Price: ${price}`);
          }
        }
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
    // エラー時も価格を取得試行
    if (page && !price) {
      try {
        const extractedPrice = await extractPrice(page);
        if (extractedPrice) {
          price = extractedPrice;
          console.log(`  ${prefix} Price (on error): ${price}`);
        }
      } catch {}
    }
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
      price,  // エラー時も価格を保持
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
// 並列実行ワーカー
// ============================================

async function runTestsInParallel(
  testCases: { file: string; testCase: TestCase }[],
  parallelCount: number
): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const queue = [...testCases];
  let completedCount = 0;
  const totalCount = testCases.length;

  const workers: Promise<void>[] = [];

  for (let workerId = 1; workerId <= parallelCount; workerId++) {
    const worker = async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) break;

        const { testCase } = item;
        console.log(`\n🚀 [W${workerId}] Start: ${testCase.testInfo.id} (${testCase.testInfo.shipping} / ${testCase.testInfo.payment})`);

        const result = await runTest(testCase, workerId);
        results.push(result);
        completedCount++;

        const status = result.success ? '✅' : '❌';
        const priceInfo = result.price ? ` - ${result.price}` : '';
        console.log(`\n${status} [W${workerId}] Done: ${testCase.testInfo.id} (${(result.duration / 1000).toFixed(1)}s)${priceInfo} [${completedCount}/${totalCount}]`);
      }
    };

    workers.push(worker());
    
    // ワーカー起動を少しずらす
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  await Promise.all(workers);
  return results;
}

// ============================================
// メイン
// ============================================

async function main() {
  const args = process.argv.slice(2);
  const testCasesDir = args.find(a => a.startsWith('--dir='))?.split('=')[1] || './test-cases/calendar';
  const singleFile = args.find(a => a.startsWith('--file='))?.split('=')[1];
  const parallelArg = args.find(a => a.startsWith('--parallel='));
  const parallelCount = parallelArg ? parseInt(parallelArg.split('=')[1], 10) : PARALLEL_COUNT;

  ensureDir(RESULTS_DIR);

  let testFiles: string[];

  if (singleFile) {
    testFiles = [singleFile];
  } else {
    testFiles = fs.readdirSync(testCasesDir)
      .filter(f => f.endsWith('.json') && !f.startsWith('_'))
      .map(f => path.join(testCasesDir, f));
  }

  const testCases = testFiles.map(file => ({
    file,
    testCase: JSON.parse(fs.readFileSync(file, 'utf-8')) as TestCase,
  }));

  console.log(`\n${'═'.repeat(80)}`);
  console.log(`🧪 Running ${testCases.length} tests with ${parallelCount} parallel workers`);
  console.log(`${'═'.repeat(80)}`);

  const startTime = Date.now();
  
  const results = await runTestsInParallel(testCases, parallelCount);

  const totalDuration = Date.now() - startTime;

  results.sort((a, b) => a.testId.localeCompare(b.testId));

  const resultsFile = path.join(RESULTS_DIR, `results_${Date.now()}.json`);
  fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
  console.log(`\n📊 Results saved to: ${resultsFile}`);

  const successCount = results.filter(r => r.success).length;
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`📈 Summary: ${successCount}/${results.length} passed`);
  console.log(`⏱️  Total time: ${(totalDuration / 1000).toFixed(1)}s (${parallelCount} workers)`);
  console.log(`${'═'.repeat(80)}\n`);

  console.log('💰 Price Matrix:');
  console.log('─'.repeat(80));
  console.log(`| ${'Option'.padEnd(14)} | ${'Shipping'.padEnd(12)} | ${'Payment'.padEnd(14)} | ${'Price'.padEnd(10)} | ${'Status'.padEnd(6)} |`);
  console.log('─'.repeat(80));
  for (const r of results) {
    const status = r.success ? '✓' : (r.price ? '⚠' : '✗');
    const priceDisplay = r.price || (r.success ? 'N/A' : '-');
    console.log(`| ${r.testInfo.option.padEnd(14)} | ${r.testInfo.shipping.padEnd(12)} | ${r.testInfo.payment.padEnd(14)} | ${priceDisplay.padEnd(10)} | ${status.padEnd(6)} |`);
  }
  console.log('─'.repeat(80));
  console.log('Legend: ✓=Pass, ⚠=Failed but price captured, ✗=Failed');

  const failedTests = results.filter(r => !r.success);
  if (failedTests.length > 0) {
    console.log('\n❌ Failed Tests:');
    console.log('─'.repeat(80));
    for (const r of failedTests) {
      const priceInfo = r.price ? ` [Price: ${r.price}]` : '';
      console.log(`  ${r.testId}${priceInfo}: ${r.error?.substring(0, 70)}...`);
    }
    console.log('─'.repeat(80));
  }

  process.exit(successCount === results.length ? 0 : 1);
}

main().catch(console.error);
