import * as fs from 'fs';
import * as path from 'path';

interface TestInfo {
  id: string;
  option: string;
  shipping: string;
  payment: string;
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

function generateHTML(results: TestResult[]): string {
  const successCount = results.filter(r => r.success).length;
  const failCount = results.length - successCount;
  
  // オプション・配送・決済ごとにグループ化
  const options = [...new Set(results.map(r => r.testInfo.option))];
  const shippings = [...new Set(results.map(r => r.testInfo.shipping))];
  const payments = [...new Set(results.map(r => r.testInfo.payment))];

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>E2E Test Results</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      margin: 0;
      padding: 20px;
      background: #f5f5f5;
    }
    .container { max-width: 1400px; margin: 0 auto; }
    h1 { color: #333; margin-bottom: 10px; }
    .summary {
      display: flex;
      gap: 20px;
      margin-bottom: 30px;
    }
    .summary-card {
      background: white;
      padding: 20px 30px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .summary-card.success { border-left: 4px solid #22c55e; }
    .summary-card.fail { border-left: 4px solid #ef4444; }
    .summary-card .number { font-size: 36px; font-weight: bold; }
    .summary-card .label { color: #666; }
    
    .section { margin-bottom: 30px; }
    .section h2 { color: #333; margin-bottom: 15px; }
    
    table {
      width: 100%;
      border-collapse: collapse;
      background: white;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    th, td {
      padding: 12px 15px;
      text-align: left;
      border-bottom: 1px solid #eee;
    }
    th { background: #f8f9fa; font-weight: 600; color: #333; }
    tr:hover { background: #f8f9fa; }
    
    .status {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
    }
    .status.success { background: #dcfce7; color: #166534; }
    .status.fail { background: #fee2e2; color: #991b1b; }
    
    .price { font-weight: 600; color: #2563eb; }
    .error { color: #dc2626; font-size: 12px; }
    
    .matrix-table th { text-align: center; }
    .matrix-table td { text-align: center; }
    .matrix-table .price-cell { font-weight: 600; }
    .matrix-table .price-cell.success { background: #f0fdf4; }
    .matrix-table .price-cell.fail { background: #fef2f2; }
    
    .screenshots {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .screenshot-thumb {
      width: 100px;
      height: 60px;
      object-fit: cover;
      border-radius: 4px;
      cursor: pointer;
      border: 1px solid #ddd;
    }
    .screenshot-thumb:hover { border-color: #2563eb; }
    
    .timestamp { color: #888; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🧪 E2E Test Results</h1>
    <p class="timestamp">Generated: ${new Date().toLocaleString('ja-JP')}</p>
    
    <div class="summary">
      <div class="summary-card success">
        <div class="number">${successCount}</div>
        <div class="label">Passed</div>
      </div>
      <div class="summary-card fail">
        <div class="number">${failCount}</div>
        <div class="label">Failed</div>
      </div>
      <div class="summary-card">
        <div class="number">${results.length}</div>
        <div class="label">Total</div>
      </div>
    </div>

    <div class="section">
      <h2>💰 Price Matrix</h2>
      <p>オプション × 配送方法 × 決済方法 の価格一覧</p>
      
      ${options.map(opt => `
        <h3>${opt}</h3>
        <table class="matrix-table">
          <thead>
            <tr>
              <th>配送 \\ 決済</th>
              ${payments.map(p => `<th>${p}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${shippings.map(ship => `
              <tr>
                <th>${ship}</th>
                ${payments.map(pay => {
                  const result = results.find(r => 
                    r.testInfo.option === opt && 
                    r.testInfo.shipping === ship && 
                    r.testInfo.payment === pay
                  );
                  if (!result) return '<td>-</td>';
                  const statusClass = result.success ? 'success' : 'fail';
                  const content = result.success 
                    ? (result.price || '価格取得失敗')
                    : '❌';
                  return `<td class="price-cell ${statusClass}">${content}</td>`;
                }).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      `).join('')}
    </div>

    <div class="section">
      <h2>📋 Detailed Results</h2>
      <table>
        <thead>
          <tr>
            <th>Test ID</th>
            <th>Option</th>
            <th>Shipping</th>
            <th>Payment</th>
            <th>Status</th>
            <th>Price</th>
            <th>Duration</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          ${results.map(r => `
            <tr>
              <td>${r.testId}</td>
              <td>${r.testInfo.option}</td>
              <td>${r.testInfo.shipping}</td>
              <td>${r.testInfo.payment}</td>
              <td><span class="status ${r.success ? 'success' : 'fail'}">${r.success ? '✓ Pass' : '✗ Fail'}</span></td>
              <td class="price">${r.price || '-'}</td>
              <td>${(r.duration / 1000).toFixed(1)}s</td>
              <td class="error">${r.error || '-'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  </div>
</body>
</html>`;
}

async function main() {
  const resultsDir = process.env.RESULTS_DIR || './results';
  
  // 最新の結果ファイルを取得
  const resultFiles = fs.readdirSync(resultsDir)
    .filter(f => f.startsWith('results_') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (resultFiles.length === 0) {
    console.error('No result files found');
    process.exit(1);
  }

  const latestFile = path.join(resultsDir, resultFiles[0]);
  console.log(`Loading: ${latestFile}`);

  const results: TestResult[] = JSON.parse(fs.readFileSync(latestFile, 'utf-8'));
  const html = generateHTML(results);

  const outputPath = path.join(resultsDir, 'report.html');
  fs.writeFileSync(outputPath, html);
  console.log(`Report generated: ${outputPath}`);
}

main().catch(console.error);
