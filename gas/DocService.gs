/**
 * Googleドキュメント／Driveフォルダ操作の共通ヘルパー。
 * 請求書（テンプレート差し込み）と台本（新規組み立て）の両方から使います。
 */

/** 名前でDriveフォルダを取得（無ければ作成）。 */
function getOrCreateFolder_(name) {
  const folders = DriveApp.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : DriveApp.createFolder(name);
}

/** ファイルを指定フォルダへ移動する。 */
function moveFileToFolder_(fileId, folder) {
  return DriveApp.getFileById(fileId).moveTo(folder);
}

/** ドキュメントをPDFに書き出し、同じフォルダへ保存する。 */
function exportDocAsPdf_(docId, folder, name) {
  const pdf = DriveApp.getFileById(docId).getAs(MimeType.PDF).setName(name + '.pdf');
  return folder.createFile(pdf);
}

/** 本文と全テーブルセルに対して置換を行う（{{キー}} → 値）。 */
function replacePlaceholders_(body, map) {
  Object.keys(map).forEach(function (key) {
    const value = map[key] === null || map[key] === undefined ? '' : String(map[key]);
    // replaceText は正規表現として解釈されるため {} をエスケープする
    body.replaceText('\\{\\{' + key + '\\}\\}', value);
  });
}

/** 本文から、指定文字列を含むテーブルを探す。見つからなければ null。 */
function findTableContaining_(body, needle) {
  const tables = body.getTables();
  for (let i = 0; i < tables.length; i++) {
    if (tables[i].getText().indexOf(needle) !== -1) return tables[i];
  }
  return null;
}

/** テーブル内で、指定文字列を含む行のインデックスを返す。無ければ -1。 */
function findTableRowIndexContaining_(table, needle) {
  for (let r = 0; r < table.getNumRows(); r++) {
    if (table.getRow(r).getText().indexOf(needle) !== -1) return r;
  }
  return -1;
}

/** テーブル行の各セルに置換をかける。 */
function replaceInTableRow_(row, map) {
  for (let c = 0; c < row.getNumCells(); c++) {
    const cell = row.getCell(c);
    Object.keys(map).forEach(function (key) {
      const value = map[key] === null || map[key] === undefined ? '' : String(map[key]);
      cell.replaceText('\\{\\{' + key + '\\}\\}', value);
    });
  }
}

/** 金額を「¥1,234」形式に整形する。 */
function formatYen_(n) {
  const num = Math.round(Number(n) || 0);
  return '¥' + num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 数値を「1,234」形式に整形する。 */
function formatNumber_(n) {
  const num = Number(n) || 0;
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Date を「2026年9月13日」形式に整形する。 */
function formatDateJa_(date) {
  return Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy年M月d日');
}

/** Date を「2026-09-13」形式に整形する。 */
function formatDateIso_(date) {
  return Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy-MM-dd');
}

/** 現在時刻の文字列（更新日時スタンプ用）。 */
function nowStamp_() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
}

/** 値を Date に変換する。空なら fallback を返す。 */
function toDate_(value, fallback) {
  if (!value) return fallback;
  if (Object.prototype.toString.call(value) === '[object Date]') return value;
  const d = new Date(value);
  return isNaN(d.getTime()) ? fallback : d;
}

/** 翌月末の日付を返す。 */
function endOfNextMonth_(baseDate) {
  const d = baseDate || new Date();
  return new Date(d.getFullYear(), d.getMonth() + 2, 0);
}

/** ファイル名に使えない文字を除去する。 */
function sanitizeFileName_(name) {
  return String(name || '').replace(/[\\\/:*?"<>|]/g, '_').trim().slice(0, 80) || '無題';
}
