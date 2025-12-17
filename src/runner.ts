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
  workerId?: number;
  attempt?: number;
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
const PARALLEL_COUNT = parseInt(process.env.PARALLEL_COUNT || '1', 10);

// リトライ設定
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '2', 10);
const RETRY_DELAY_MS = parseInt(process.env.RETRY_DELAY_MS || '5000', 10);

// ワーカー起動間隔（ミリ秒）
const WORKER_START_DELAY_MS = parseInt(process.env.WORKER_START_DELAY_MS || '3000', 10);

// ============================================
// ユーティリティ関数
// ============================================

/**
 * ワーカーIDに応じた認証情報を取得
 * 環境変数の優先順位:
 * 1. DEV_LOGIN_USER_W1, DEV_LOGIN_PASS_W1 (ワーカー固有)
 * 2. DEV_LOGIN_USER, DEV_LOGIN_PASS (フォールバック)
 */
function getCredentials(credentialKey?: string, workerId?: number): Credentials {
  const key = (credentialKey || 'dev').toUpperCase();
  
  // ワーカー固有の認証情報を探す
  let loginUser = '';
  let loginPass = '';
  
  if (workerId) {
    // ワーカー固有の認証情報を優先
    const workerUser = process.env[`${key}_LOGIN_USER_W${workerId}`];
    const workerPass = process.env[`${key}_LOGIN_PASS_W${workerId}`];
    
    if (workerUser && workerPass) {
      loginUser = workerUser;
      loginPass = workerPass;
      console.log(`  📋 Using worker-specific credentials for W${workerId}`);
    }
  }
  
  // フォールバック: 共通の認証情報
  if (!loginUser || !loginPass) {
    loginUser = process.env[`${key}_LOGIN_USER`] || '';
    loginPass = process.env[`${key}_LOGIN_PASS`] || '';
    if (workerId) {
      console.log(`  ⚠️  Worker ${workerId} using shared credentials (no W${workerId} specific credentials found)`);
    }
  }
  
  return {
    loginUser,
    loginPass,
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

async function runTest(testCase: TestCase, workerId: number, attempt: number = 1): Promise<TestResult> {
  const startTime = Date.now();
  const screenshots: string[] = [];
  
  // ワーカーIDに応じた認証情報を取得
  const creds = getCredentials(testCase.credentialKey, workerId);
  const prefix = `[W${workerId}][${testCase.testInfo.id}]${attempt > 1 ? `[retry ${attempt}]` : ''}`;
  
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    browser = await chromium.launch({
      headless: testCase.headless,
    });

    const contextOptions: any = {
      viewport: testCase.device === 'mobile' 
        ? { width: 375, height: 667 }
        : { width: 1280, height: 720 },
      // 各ワーカーで完全に独立したストレージ状態
      storageState: undefined,
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
    let price: string | undefined;

    for (let i = 0; i < testCase.actions.length; i++) {
      const action = testCase.actions[i];
      const actionDesc = action.selector || action.value || '';
      console.log(`  ${prefix} [${i + 1}/${testCase.actions.length}] ${action.type} ${actionDesc.substring(0, 50)}`);
      
      const result = await executeAction(page, action, creds, testCase.testInfo.id, screenshotIndex);
      
      if (result.screenshot) {
        screenshots.push(result.screenshot);
      }

      if (action.type === 'screenshotFullPage') {
        const currentUrl = page.url();
        if (currentUrl.includes('/confirm')) {
          price = await extractPrice(page);
          if (price) {
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
      workerId,
      attempt,
    };

  } catch (error) {
    if (page) {
      try {
        ensureDir(SCREENSHOT_DIR);
        const errorScreenshot = path.join(SCREENSHOT_DIR, `${testCase.testInfo.id}_error_attempt${attempt}.png`);
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
      workerId,
      attempt,
    };

  } finally {
    if (context) await context.close();
    if (browser) await browser.close();
  }
}

// ============================================
// リトライ付きテスト実行
// ============================================

async function runTestWithRetry(
  testCase: TestCase,
  workerId: number,
  maxRetries: number = MAX_RETRIES
): Promise<TestResult> {
  let lastResult: TestResult;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    lastResult = await runTest(testCase, workerId, attempt);
    
    if (lastResult.success) {
      return lastResult;
    }
    
    if (attempt < maxRetries) {
      const delayMs = RETRY_DELAY_MS * attempt; // 指数バックオフ
      console.log(`  ⚠️ [W${workerId}] Test ${testCase.testInfo.id} failed, retrying in ${delayMs / 1000}s... (${attempt}/${maxRetries - 1})`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  return lastResult!;
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

  // 利用可能なアカウント数をチェック
  console.log('\n📋 Checking available credentials per worker:');
  for (let i = 1; i <= parallelCount; i++) {
    const creds = getCredentials('dev', i);
    const hasWorkerCreds = !!process.env[`DEV_LOGIN_USER_W${i}`];
    console.log(`  W${i}: ${hasWorkerCreds ? '✅ Worker-specific' : '⚠️  Shared'} (${creds.loginUser ? creds.loginUser.substring(0, 20) + '...' : 'NOT SET'})`);
  }
  console.log('');

  const workers: Promise<void>[] = [];

  for (let workerId = 1; workerId <= parallelCount; workerId++) {
    const currentWorkerId = workerId; // クロージャ用
    
    const worker = async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) break;

        const { testCase } = item;
        console.log(`\n🚀 [W${currentWorkerId}] Start: ${testCase.testInfo.id} (${testCase.testInfo.shipping} / ${testCase.testInfo.payment})`);

        // リトライ付きでテスト実行
        const result = await runTestWithRetry(testCase, currentWorkerId);
        results.push(result);
        completedCount++;

        const status = result.success ? '✅' : '❌';
        const priceInfo = result.price ? ` - ${result.price}` : '';
        const retryInfo = result.attempt && result.attempt > 1 ? ` (after ${result.attempt - 1} retries)` : '';
        console.log(`\n${status} [W${currentWorkerId}] Done: ${testCase.testInfo.id} (${(result.duration / 1000).toFixed(1)}s)${priceInfo}${retryInfo} [${completedCount}/${totalCount}]`);
      }
    };

    workers.push(worker());
    
    // ワーカー起動を十分にずらす（セッション競合を防ぐ）
    if (workerId < parallelCount) {
      console.log(`  ⏳ Waiting ${WORKER_START_DELAY_MS / 1000}s before starting W${workerId + 1}...`);
      await new Promise(resolve => setTimeout(resolve, WORKER_START_DELAY_MS));
    }
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
  console.log(`   Max retries: ${MAX_RETRIES}, Retry delay: ${RETRY_DELAY_MS}ms`);
  console.log(`   Worker start delay: ${WORKER_START_DELAY_MS}ms`);
  console.log(`${'═'.repeat(80)}`);

  const startTime = Date.now();
  
  const results = await runTestsInParallel(testCases, parallelCount);

  const totalDuration = Date.now() - startTime;

  results.sort((a, b) => a.testId.localeCompare(b.testId));

  const resultsFile = path.join(RESULTS_DIR, `results_${Date.now()}.json`);
  fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
  console.log(`\n📊 Results saved to: ${resultsFile}`);

  const successCount = results.filter(r => r.success).length;
  const retriedCount = results.filter(r => r.attempt && r.attempt > 1).length;
  
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`📈 Summary: ${successCount}/${results.length} passed`);
  if (retriedCount > 0) {
    console.log(`   ${retriedCount} test(s) succeeded after retry`);
  }
  console.log(`⏱️  Total time: ${(totalDuration / 1000).toFixed(1)}s (${parallelCount} workers)`);
  console.log(`${'═'.repeat(80)}\n`);

  console.log('💰 Price Matrix:');
  console.log('─'.repeat(80));
  console.log(`| ${'Option'.padEnd(14)} | ${'Shipping'.padEnd(12)} | ${'Payment'.padEnd(14)} | ${'Price'.padEnd(10)} |`);
  console.log('─'.repeat(80));
  for (const r of results) {
    if (r.success) {
      console.log(`| ${r.testInfo.option.padEnd(14)} | ${r.testInfo.shipping.padEnd(12)} | ${r.testInfo.payment.padEnd(14)} | ${(r.price || 'N/A').padEnd(10)} |`);
    }
  }
  console.log('─'.repeat(80));

  const failedTests = results.filter(r => !r.success);
  if (failedTests.length > 0) {
    console.log('\n❌ Failed Tests:');
    console.log('─'.repeat(80));
    for (const r of failedTests) {
      console.log(`  ${r.testId} (W${r.workerId}, attempt ${r.attempt}): ${r.error?.substring(0, 60)}...`);
    }
    console.log('─'.repeat(80));
  }

  process.exit(successCount === results.length ? 0 : 1);
}

main().catch(console.error);
