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
    .addItem('請求書を作成（未処理の行）', 'runCreateInvoices')
    .addItem('選択中の行だけ作成', 'runSelectedInvoice')
    .addSeparator()
    .addItem('シートを準備', 'runSetupInvoiceSheet')
    .addItem('テンプレートを作成', 'runCreateInvoiceTemplate')
    .addToUi();

  ui.createMenu('台本')
    .addItem('台本を作成（未処理の行）', 'runCreateScenarios')
    .addItem('選択中の行だけ作成', 'runSelectedScenario')
    .addSeparator()
    .addItem('シートを準備', 'runSetupScenarioSheet')
    .addToUi();
}

// ───────────────────────────── GBP投稿 ─────────────────────────────

/** メニュー: 未処理の行をまとめて処理。 */
function runCreateDrafts() {
  const result = processPendingRows();
  SpreadsheetApp.getUi().alert(
    '完了しました。\n処理: ' + result.processed + ' 件 / エラー: ' + result.errors + ' 件'
  );
}

/** メニュー: いま選択しているセルの行だけを処理。 */
function runSelectedRow() {
  const row = activeDataRow_(CONFIG.SHEET_NAME);
  if (!row) return;
  processRow(row);
  SpreadsheetApp.getUi().alert('行 ' + row + ' を処理しました。');
}

// ───────────────────────────── 請求書 ─────────────────────────────

/** メニュー: 未処理の請求書をまとめて作成。 */
function runCreateInvoices() {
  const result = processPendingInvoices();
  SpreadsheetApp.getUi().alert(
    '請求書を作成しました。\n作成: ' + result.processed + ' 件 / エラー: ' + result.errors + ' 件\n' +
    '（Driveの「' + CONFIG.INVOICE.FOLDER_NAME + '」フォルダに保存されています）'
  );
}

/** メニュー: 選択行の請求書だけ作成。 */
function runSelectedInvoice() {
  const row = activeDataRow_(CONFIG.INVOICE.SHEET_NAME);
  if (!row) return;
  const result = createInvoiceForRow(row);
  SpreadsheetApp.getUi().alert(
    '請求書を作成しました。\n合計: ' + formatYen_(result.total) + '\n' + result.docUrl
  );
}

/** メニュー: 請求書シートを準備。 */
function runSetupInvoiceSheet() {
  setupInvoiceSheet();
  SpreadsheetApp.getUi().alert('「' + CONFIG.INVOICE.SHEET_NAME + '」シートを用意しました。');
}

/** メニュー: 請求書テンプレートを作成。 */
function runCreateInvoiceTemplate() {
  const ui = SpreadsheetApp.getUi();
  if (getPropOptional_('INVOICE_TEMPLATE_DOC_ID')) {
    const res = ui.alert(
      'テンプレートは既に登録されています。新しく作り直しますか？（今のテンプレートは残ります）',
      ui.ButtonSet.YES_NO
    );
    if (res !== ui.Button.YES) return;
  }
  const tpl = createInvoiceTemplate();
  ui.alert('請求書テンプレートを作成しました。\n自社名・振込先などを整えてください。\n' + tpl.url);
}

// ───────────────────────────── 台本 ─────────────────────────────

/** メニュー: 未処理の台本をまとめて作成。 */
function runCreateScenarios() {
  const result = processPendingScenarios();
  SpreadsheetApp.getUi().alert(
    '台本を作成しました。\n作成: ' + result.processed + ' 件 / エラー: ' + result.errors + ' 件\n' +
    '（Driveの「' + CONFIG.SCENARIO.FOLDER_NAME + '」フォルダに保存されています）'
  );
}

/** メニュー: 選択行の台本だけ作成。 */
function runSelectedScenario() {
  const row = activeDataRow_(CONFIG.SCENARIO.SHEET_NAME);
  if (!row) return;
  const doc = createScenarioForRow(row);
  SpreadsheetApp.getUi().alert('台本を作成しました。\n' + doc.url);
}

// ───────────────────────────── 共通 ─────────────────────────────

/**
 * 選択中のデータ行を返す。
 * 対象シート以外を開いていたり、見出し行を選択している場合はアラートを出して null。
 */
function activeDataRow_(expectedSheetName) {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSheet();

  if (expectedSheetName && sheet.getName() !== expectedSheetName) {
    ui.alert('「' + expectedSheetName + '」シートを開いてから実行してください。\n' +
      '（今開いているのは「' + sheet.getName() + '」です）');
    return null;
  }
  const row = sheet.getActiveCell().getRow();
  if (row < 2) {
    ui.alert('データ行（2行目以降）を選択してください。');
    return null;
  }
  return row;
}
