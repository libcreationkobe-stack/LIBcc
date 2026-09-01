/**
 * スプレッドシートを開いたときにカスタムメニューを追加します。
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu('GBP自動化')
    .addItem('下書きを作成（未処理の行）', 'runCreateDrafts')
    .addSeparator()
    .addItem('選択中の行だけ処理', 'runSelectedRow')
    .addToUi();

  ui.createMenu('請求書')
    .addItem('請求書PDFを作成（' + defaultTargetMonth_() + 'ぶん）', 'runCreateInvoices')
    .addItem('対象年月を指定して作成…', 'runCreateInvoicesForMonth')
    .addItem('作り直す（発行済みも上書き）…', 'runRecreateInvoices')
    .addSeparator()
    .addItem('毎月の自動作成をONにする', 'runEnableInvoiceTrigger')
    .addItem('毎月の自動作成をOFFにする', 'runDisableInvoiceTrigger')
    .addSeparator()
    .addItem('シートを準備する', 'runSetupInvoiceSheets')
    .addToUi();
}

/** メニュー: 未処理の行をまとめて処理。 */
function runCreateDrafts() {
  const result = processPendingRows();
  SpreadsheetApp.getUi().alert(
    '完了しました。\n処理: ' + result.processed + ' 件 / エラー: ' + result.errors + ' 件'
  );
}

/** メニュー: いま選択しているセルの行だけを処理。 */
function runSelectedRow() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const row = sheet.getActiveCell().getRow();
  if (row < 2) {
    SpreadsheetApp.getUi().alert('データ行（2行目以降）を選択してください。');
    return;
  }
  processRow(row);
  SpreadsheetApp.getUi().alert('行 ' + row + ' を処理しました。');
}

/** メニュー: 既定の対象月（前月）ぶんの請求書PDFを作成。 */
function runCreateInvoices() {
  const result = createMonthlyInvoices();
  SpreadsheetApp.getUi().alert(formatInvoiceResult_(result));
}

/** メニュー: 対象年月を入力して作成。 */
function runCreateInvoicesForMonth() {
  const month = promptInvoiceMonth_('どの月ぶんの請求書を作成しますか？');
  if (!month) return;
  const result = createMonthlyInvoices(month);
  SpreadsheetApp.getUi().alert(formatInvoiceResult_(result));
}

/** メニュー: 発行済みでも作り直す。 */
function runRecreateInvoices() {
  const ui = SpreadsheetApp.getUi();
  const month = promptInvoiceMonth_('作り直す対象年月を入力してください（発行済みのPDFを上書きします）');
  if (!month) return;
  const confirm = ui.alert(
    month + ' ぶんの請求書を作り直します。同じ請求書番号のPDFは新しいものに置き換わります。よろしいですか？',
    ui.ButtonSet.OK_CANCEL
  );
  if (confirm !== ui.Button.OK) return;
  const result = createMonthlyInvoices(month, { force: true });
  ui.alert(formatInvoiceResult_(result));
}

/** メニュー: 毎月の自動作成をON。 */
function runEnableInvoiceTrigger() {
  setupMonthlyInvoiceTrigger();
  const monthWord = INVOICE_CONFIG.TARGET_MONTH_OFFSET === 0
    ? 'その月'
    : Math.abs(INVOICE_CONFIG.TARGET_MONTH_OFFSET) + 'か月' + (INVOICE_CONFIG.TARGET_MONTH_OFFSET < 0 ? '前' : '先') + 'の月';
  SpreadsheetApp.getUi().alert(
    '毎月 ' + INVOICE_CONFIG.TRIGGER_DAY_OF_MONTH + '日 の ' + INVOICE_CONFIG.TRIGGER_HOUR + '時ごろに、' +
    monthWord + 'ぶんの請求書PDFを自動作成します。'
  );
}

/** メニュー: 毎月の自動作成をOFF。 */
function runDisableInvoiceTrigger() {
  const removed = removeMonthlyInvoiceTrigger();
  SpreadsheetApp.getUi().alert(
    removed > 0 ? '毎月の自動作成をOFFにしました。' : '自動作成は設定されていませんでした。'
  );
}

/** メニュー: 請求書用のシートを用意。 */
function runSetupInvoiceSheets() {
  const created = setupInvoiceSheets();
  SpreadsheetApp.getUi().alert(
    created.length > 0
      ? 'シートを作成しました: ' + created.join(' / ') + '\n「請求先マスタ」「請求明細」に情報を入力してください。'
      : '3つのシートは既にあります。見出し行を最新の状態にしました。'
  );
}

/** 対象年月の入力ダイアログ。キャンセル・不正な書式なら null を返す。 */
function promptInvoiceMonth_(message) {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt(
    message + '\n例: ' + defaultTargetMonth_() + '（yyyy-MM 形式）',
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) return null;

  const month = normalizeMonth_(response.getResponseText());
  if (!/^\d{4}-\d{2}$/.test(month)) {
    ui.alert('対象年月は yyyy-MM 形式で入力してください（例: ' + defaultTargetMonth_() + '）。');
    return null;
  }
  return month;
}

/** 作成結果をダイアログ用の文面にまとめる。 */
function formatInvoiceResult_(result) {
  const lines = [
    result.month + ' ぶんの請求書',
    '作成: ' + result.created.length + ' 件 / スキップ: ' + result.skipped.length + ' 件 / エラー: ' + result.errors.length + ' 件'
  ];
  if (result.created.length > 0) {
    lines.push('', '【作成】');
    result.created.forEach(function (r) {
      lines.push('・' + r.name + '　' + formatYen_(r.total));
    });
  }
  if (result.skipped.length > 0) {
    lines.push('', '【スキップ】');
    result.skipped.forEach(function (r) {
      lines.push('・' + (r.name || r.clientId) + '（' + r.reason + '）');
    });
  }
  if (result.errors.length > 0) {
    lines.push('', '【エラー】');
    result.errors.forEach(function (r) {
      lines.push('・' + (r.name || r.clientId) + ': ' + r.message);
    });
  }
  if (result.created.length === 0 && result.skipped.length === 0 && result.errors.length === 0) {
    lines.push('', '「請求明細」シートに ' + result.month + ' の行が見つかりませんでした。');
  }
  lines.push('', 'PDFは Drive の「' + describeSaveLocation_(result.month) + '」に保存されます。');
  return lines.join('\n');
}
