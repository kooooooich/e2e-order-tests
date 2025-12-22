const fs = require('fs');
const path = require('path');

function fixTestCase(filePath) {
  console.log(`Processing: ${filePath}`);

  const content = fs.readFileSync(filePath, 'utf-8');
  const testCase = JSON.parse(content);

  // Determine if this test uses "スタンドあり" or "スタンドなし"
  const hasStand = testCase.testInfo.option === '専用スタンドあり';

  let modified = false;

  for (let i = 0; i < testCase.actions.length; i++) {
    const action = testCase.actions[i];

    // Find the click action for option selection
    if (action.type === 'click' &&
        action.comment &&
        action.comment.includes('専用スタンド')) {

      if (hasStand) {
        // For スタンドあり, use :has-text selector combined with class
        testCase.actions[i] = {
          type: 'click',
          selector: '.box-wrapper.option:has-text("専用スタンドあり") button',
          comment: '専用スタンドあり のボタンをクリック'
        };
      } else {
        // For スタンドなし, use :has-text selector
        testCase.actions[i] = {
          type: 'click',
          selector: '.box-wrapper.option:has-text("専用スタンドなし") button',
          comment: '専用スタンドなし のボタンをクリック'
        };
      }
      modified = true;
      console.log(`  ✓ Fixed click: ${hasStand ? 'スタンドあり' : 'スタンドなし'}`);
    }
  }

  if (modified) {
    fs.writeFileSync(filePath, JSON.stringify(testCase, null, 2) + '\n');
    console.log(`  ✓ Saved`);
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
