/**
 * スプレッドシートの読み書きヘルパー。
 */

/** 管理用シートを取得（無ければエラー）。 */
function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) throw new Error('シート "' + CONFIG.SHEET_NAME + '" が見つかりません。');
  return sheet;
}

function getCell_(sheet, row, col) {
  return sheet.getRange(row, col).getValue();
}

function setCell_(sheet, row, col, value) {
  sheet.getRange(row, col).setValue(value);
}

function stampUpdatedAt_(sheet, row) {
  const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
  setCell_(sheet, row, CONFIG.COL.UPDATED_AT, now);
}

/** 種別・ソース・ファイル参照・メモがすべて空なら空行とみなす。 */
function isRowEmpty_(sheet, row) {
  const c = CONFIG.COL;
  return !getCell_(sheet, row, c.TYPE) &&
         !getCell_(sheet, row, c.SOURCE) &&
         !getCell_(sheet, row, c.FILE_REF) &&
         !getCell_(sheet, row, c.NOTE);
}
