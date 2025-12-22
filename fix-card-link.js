const fs = require('fs');
const path = require('path');

function fixTestCase(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const testCase = JSON.parse(content);

  let modified = false;

  for (let i = 0; i < testCase.actions.length; i++) {
    const action = testCase.actions[i];

    // Find actions with "新しいカードを使う" and role: "button"
    if (action.name === '新しいカードを使う' && action.role === 'button') {
      testCase.actions[i].role = 'link';
      modified = true;
    }
  }

  if (modified) {
    fs.writeFileSync(filePath, JSON.stringify(testCase, null, 2) + '\n');
    console.log(`✓ Fixed: ${path.basename(filePath)}`);
    return true;
  }

  return false;
}

// Main execution
const testDir = path.join(__dirname, 'test-cases', 'calendar');
const files = fs.readdirSync(testDir)
  .filter(f => f.startsWith('test_') && f.endsWith('.json'))
  .map(f => path.join(testDir, f));

console.log(`Found ${files.length} credit card test files\n`);

let fixedCount = 0;
files.forEach(file => {
  if (fixTestCase(file)) {
    fixedCount++;
  }
});

console.log(`\n✓ Fixed ${fixedCount} test files!`);
