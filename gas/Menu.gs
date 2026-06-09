/**
 * スプレッドシートを開いたときにカスタムメニューを追加します。
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('GBP自動化')
    .addItem('下書きを作成（未処理の行）', 'runCreateDrafts')
    .addSeparator()
    .addItem('選択中の行だけ処理', 'runSelectedRow')
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
