/**
 * 計算ロジックの自動テスト（Node.jsで実行）。
 *
 *   node tests/run.js
 *
 * GAS本体（スプレッドシート・Drive・Claude API）には触れず、
 * 明細のパース・消費税・請求番号の採番など「間違えると請求金額がズレる部分」だけを検証します。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const GAS_DIR = path.join(__dirname, '..', 'gas');

// GAS のグローバル（PropertiesService / Utilities）を最低限スタブする
const sandbox = {
  console,
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) },
  Utilities: {
    formatDate: (d, tz, fmt) => {
      const p = n => String(n).padStart(2, '0');
      return fmt
        .replace('yyyy', d.getFullYear())
        .replace('MM', p(d.getMonth() + 1))
        .replace('dd', p(d.getDate()))
        .replace('HH', p(d.getHours()))
        .replace('mm', p(d.getMinutes()))
        .replace(/\bM\b/, d.getMonth() + 1)
        .replace(/\bd\b/, d.getDate());
    }
  }
};
vm.createContext(sandbox);
['Config.gs', 'DocService.gs', 'Invoice.gs', 'Claude.gs'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(GAS_DIR, f), 'utf8'), sandbox, { filename: f });
});

let pass = 0, fail = 0;
const eq = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + '\n      期待: ' + e + '\n      実際: ' + a); }
};
const throws = (label, fn) => {
  try { fn(); fail++; console.log('  ✗ ' + label + ' (エラーが出なかった)'); }
  catch (e) { pass++; console.log('  ✓ ' + label + ' → ' + e.message); }
};

console.log('\n■ 明細のパース');
eq('品目,数量,単価',
  sandbox.parseInvoiceItems_('リール動画制作,3,30000'),
  [{ name: 'リール動画制作', qty: 3, price: 30000, amount: 90000 }]);
eq('品目,単価（数量は1）',
  sandbox.parseInvoiceItems_('撮影ディレクション,50000'),
  [{ name: '撮影ディレクション', qty: 1, price: 50000, amount: 50000 }]);
eq('複数行・全角カンマ・読点・タブ・円表記・空行',
  sandbox.parseInvoiceItems_('A，2，10000\n\nB、1、5000円\nC\t3\t1000').map(i => i.amount),
  [20000, 5000, 3000]);
eq('数量あり + ¥桁区切りの単価',
  sandbox.parseInvoiceItems_('撮影費,2,¥10,000').map(i => [i.qty, i.price, i.amount]), [[2, 10000, 20000]]);
eq('数量省略 + ¥桁区切りの単価',
  sandbox.parseInvoiceItems_('撮影費,¥10,000').map(i => [i.qty, i.price]), [[1, 10000]]);
eq('数量省略 + 円付き桁区切り',
  sandbox.parseInvoiceItems_('撮影費,10,000円').map(i => [i.qty, i.price]), [[1, 10000]]);
eq('数量と3桁単価は素直に読む',
  sandbox.parseInvoiceItems_('コピー代,5,100').map(i => [i.qty, i.price, i.amount]), [[5, 100, 500]]);
throws('単位なしの曖昧な桁区切りは推測せずエラー', () => sandbox.parseInvoiceItems_('撮影費,10,000'));
throws('品目だけの行はエラー', () => sandbox.parseInvoiceItems_('ディレクション'));
throws('品目が空ならエラー', () => sandbox.parseInvoiceItems_(',2,1000'));
throws('単価0はエラー', () => sandbox.parseInvoiceItems_('撮影費,2,0'));
throws('数量0はエラー', () => sandbox.parseInvoiceItems_('撮影費,0,5000'));
eq('空入力は空配列', sandbox.parseInvoiceItems_(''), []);

console.log('\n■ 消費税と合計');
const items = sandbox.parseInvoiceItems_('リール動画制作,3,30000\n撮影ディレクション,1,50000');
const subtotal = items.reduce((s, i) => s + i.amount, 0);
eq('小計', subtotal, 140000);
eq('消費税10%（切り捨て）', sandbox.applyRounding_(subtotal * 0.10, 'floor'), 14000);
eq('端数切り捨て 1333.3→1333', sandbox.applyRounding_(13333 * 0.10, 'floor'), 1333);
eq('端数四捨五入 1333.3→1333', sandbox.applyRounding_(13333 * 0.10, 'round'), 1333);
eq('端数切り上げ 1333.3→1334', sandbox.applyRounding_(13333 * 0.10, 'ceil'), 1334);
eq('合計', subtotal + 14000, 154000);

console.log('\n■ 表示フォーマット');
eq('金額', sandbox.formatYen_(154000), '¥154,000');
eq('金額（3桁未満）', sandbox.formatYen_(980), '¥980');
eq('金額（0）', sandbox.formatYen_(0), '¥0');
eq('日付', sandbox.formatDateJa_(new Date(2026, 8, 13)), '2026年9月13日');
eq('ファイル名の危険文字を除去', sandbox.sanitizeFileName_('株式会社A/B:C'), '株式会社A_B_C');

console.log('\n■ 支払期限（翌月末）');
eq('9/13 → 10/31', sandbox.formatDateIso_(sandbox.endOfNextMonth_(new Date(2026, 8, 13))), '2026-10-31');
eq('12/20 → 翌年1/31', sandbox.formatDateIso_(sandbox.endOfNextMonth_(new Date(2026, 11, 20))), '2027-01-31');
eq('1/31 → 2/28（うるう年でない）', sandbox.formatDateIso_(sandbox.endOfNextMonth_(new Date(2027, 0, 31))), '2027-02-28');

console.log('\n■ 請求番号の自動採番');
const mockSheet = rows => ({
  getLastRow: () => rows.length + 1,
  getRange: () => ({ getValues: () => rows.map(v => [v]) })
});
eq('初回', sandbox.nextInvoiceNumber_(mockSheet([]), new Date(2026, 8, 13)), 'INV-202609-001');
eq('続き番号', sandbox.nextInvoiceNumber_(mockSheet(['INV-202609-001', 'INV-202609-002']), new Date(2026, 8, 13)), 'INV-202609-003');
eq('月が変われば001に戻る', sandbox.nextInvoiceNumber_(mockSheet(['INV-202609-007']), new Date(2026, 9, 1)), 'INV-202610-001');
eq('欠番があっても最大値+1', sandbox.nextInvoiceNumber_(mockSheet(['INV-202609-001', 'INV-202609-012', '']), new Date(2026, 8, 13)), 'INV-202609-013');

console.log('\n■ 台本JSONの取り出し');
eq('素のJSON', sandbox.parseJsonResponse_('{"hook":"こんにちは"}'), { hook: 'こんにちは' });
eq('コードフェンス付き', sandbox.parseJsonResponse_('```json\n{"hook":"a"}\n```'), { hook: 'a' });
eq('前後に説明が付いた場合', sandbox.parseJsonResponse_('はい、작성しました:\n{"hook":"a"}\nよろしく'), { hook: 'a' });
throws('JSONが無ければエラー', () => sandbox.parseJsonResponse_('すみません、作れません'));

console.log('\n' + (fail === 0 ? '✅ 全' + pass + '件パス' : '❌ ' + fail + '件失敗 / ' + pass + '件パス'));
process.exit(fail ? 1 : 0);
