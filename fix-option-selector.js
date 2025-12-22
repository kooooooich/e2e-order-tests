const fs = require('fs');
const path = require('path');

function fixTestCase(filePath) {
  console.log(`Processing: ${filePath}`);

  const content = fs.readFileSync(filePath, 'utf-8');
  const testCase = JSON.parse(content);

  // Determine if this test uses "スタンドあり" or "スタンドなし"
  const hasStand = testCase.testInfo.option === '専用スタンドあり';

  // Find and fix the option selection actions
  let modified = false;

  for (let i = 0; i < testCase.actions.length; i++) {
    const action = testCase.actions[i];

    // Find the waitForSelector for .box-wrapper.option
    if (action.type === 'waitForSelector' &&
        action.selector === '.box-wrapper.option') {

      // Replace with role-based selector
      if (hasStand) {
        testCase.actions[i] = {
          type: 'waitForSelector',
          selector: 'text=/専用スタンドあり/',
          timeout: 60000,
          comment: 'オプション選択エリアを待機'
        };
      } else {
        testCase.actions[i] = {
          type: 'waitForSelector',
          selector: 'text=/専用スタンドなし/',
          timeout: 60000,
          comment: 'オプション選択エリアを待機'
        };
      }
      modified = true;
    }

    // Find the click for .box-wrapper.option.rounded-top button
    if (action.type === 'click' &&
        action.selector === '.box-wrapper.option.rounded-top button') {

      // Replace with text-based selector for the specific option
      if (hasStand) {
        testCase.actions[i] = {
          type: 'click',
          selector: '.box-wrapper.option.rounded-top button',
          comment: '専用スタンドあり のボタンをクリック'
        };
      } else {
        // For "なし", we need to click the second option
        testCase.actions[i] = {
          type: 'click',
          selector: '.box-wrapper.option >> nth=1 >> button',
          comment: '専用スタンドなし のボタンをクリック'
        };
      }
      modified = true;
    }
  }

  if (modified) {
    fs.writeFileSync(filePath, JSON.stringify(testCase, null, 2) + '\n');
    console.log(`  ✓ Fixed: ${hasStand ? 'スタンドあり' : 'スタンドなし'}`);
  } else {
    console.log(`  - No changes needed`);
  }
}

// Main execution
const testDir = path.join(__dirname, 'test-cases', 'calendar');
const files = fs.readdirSync(testDir)
  .filter(f => f.startsWith('test_') && f.endsWith('.json'))
  .map(f => path.join(testDir, f));

console.log(`Found ${files.length} test files to process\n`);

files.forEach(fixTestCase);

console.log(`\n✓ All test files have been processed!`);
