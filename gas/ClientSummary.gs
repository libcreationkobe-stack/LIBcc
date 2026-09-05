/**
 * 全クライアントの数字を1枚に並べるまとめシート。
 *
 * クライアントごとのKPIシートは1ファイル＝1社で分かれている。
 * それぞれを開いて回るのは現実的でないので、主要な数字だけを集めて横に並べる。
 *
 * 使い方:
 *   1. 新しいスプレッドシートを作る（クライアントには共有しない、自社用）
 *   2. 拡張機能 → Apps Script に、このファイルの中身を貼る
 *   3. シートを再読み込みして、メニュー「まとめ」→「シートを整える」
 *   4. 「クライアント」タブに、社名とKPIシートのURLを1行ずつ入れる
 *   5. メニュー「まとめ」→「最新の数字に更新する」
 *
 * 各社のシートは見出しの文字で読む。列を足したり並べ替えたりしても、
 * こちらを直す必要はない。
 */

var SUMMARY_SHEET = 'まとめ';
var CLIENT_SHEET = 'クライアント';
var CLIENT_FIRST_ROW = 3;
var CLIENT_MAX = 60;

var KPI_SHEET_NAME = '月次KPI';
var KPI_TOTAL_LABEL = '合計';

var SUM_NAVY = '#1f3864';
var SUM_HEAD = '#2e75b6';
var SUM_BG = '#f2f2f2';
var SUM_BORDER = '#bfbfbf';
var SUM_SETTING = '#fffbe6';

var SUM_RANK_COLORS = {
  S: {bg: '#fff2cc', fg: '#7f6000'},
  A: {bg: '#d9ead3', fg: '#274e13'},
  B: {bg: '#eeeeee', fg: '#444444'},
  C: {bg: '#f4cccc', fg: '#990000'}
};

/**
 * まとめに出す列。
 * header は各社のKPIシートの見出し（先頭が一致すればよい）。
 * scope が month ならその月の合計行、total なら数字が入っている月の合計。
 */
var SUMMARY_COLUMNS = [
  {label: 'クライアント',   width: 190, kind: 'name'},
  {label: '最新の月',       width: 70,  kind: 'month'},
  {label: 'ランク',         width: 70,  kind: 'rank',  header: 'ランク'},
  {label: '運用スコア',     width: 85,  header: '運用スコア', format: '0'},
  {label: 'フォロワー数',   width: 95,  header: 'フォロワー数', format: '#,##0'},
  {label: '表示回数',       width: 95,  header: '表示回数',     format: '#,##0'},
  {label: 'LINE友だち追加', width: 105, header: 'LINE友だち追加', format: '#,##0'},
  {label: '達成率',         width: 75,  header: 'LINE追加 達成率', format: '0%'},
  {label: 'エントリー',     width: 85,  header: 'エントリー数', format: '#,##0'},
  {label: '採用数',         width: 70,  header: '採用数',       format: '#,##0'},
  {label: '広告費',         width: 90,  header: '広告費',       format: '¥#,##0'},
  {label: '採用単価',       width: 95,  header: '採用単価',     format: '¥#,##0'},
  {label: '通期 採用数',    width: 90,  header: '採用数', scope: 'total', format: '#,##0'},
  {label: '通期 広告費',    width: 100, header: '広告費', scope: 'total', format: '¥#,##0'},
  {label: '状態',           width: 240, kind: 'note'}
];

/* ---------------- メニュー ---------------- */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('まとめ')
    .addItem('シートを整える', 'setupSummarySheet')
    .addItem('最新の数字に更新する', 'refreshSummary')
    .addSeparator()
    .addItem('毎朝7時に自動で更新する', 'installSummaryTrigger')
    .addToUi();
}

/* ---------------- 組み立て ---------------- */

function setupSummarySheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  buildClientSheet_(ss);
  buildSummarySheet_(ss);
  ss.setActiveSheet(ss.getSheetByName(CLIENT_SHEET));
  SpreadsheetApp.getActive().toast(
    '「' + CLIENT_SHEET + '」タブに、社名とKPIシートのURLを入れてください。');
}

/** クライアントの一覧。ここだけが手入力。 */
function buildClientSheet_(ss) {
  var saved = readClients_(ss);
  var sheet = ss.getSheetByName(CLIENT_SHEET) || ss.insertSheet(CLIENT_SHEET);
  sumReset_(sheet);

  sheet.getRange(1, 1).setValue('クライアント一覧（ここに社名とKPIシートのURLを入れます）');
  sheet.getRange(1, 1, 1, 3).merge()
    .setBackground(SUM_NAVY).setFontColor('#ffffff').setFontWeight('bold').setFontSize(12);
  sheet.setRowHeight(1, 28);

  sheet.getRange(2, 1, 1, 3).setValues([['社名', 'KPIシートのURL', 'メモ']])
    .setBackground(SUM_HEAD).setFontColor('#ffffff').setFontWeight('bold')
    .setHorizontalAlignment('center');

  sheet.getRange(CLIENT_FIRST_ROW, 1, CLIENT_MAX, 2).setBackground(SUM_SETTING);
  saved.forEach(function (c, i) {
    if (i >= CLIENT_MAX) { return; }
    sheet.getRange(CLIENT_FIRST_ROW + i, 1, 1, 3).setValues([[c.name, c.url, c.memo]]);
  });

  sheet.setColumnWidth(1, 220);
  sheet.setColumnWidth(2, 520);
  sheet.setColumnWidth(3, 260);
  sheet.getRange(2, 1, CLIENT_MAX + 1, 3)
    .setBorder(true, true, true, true, true, true, SUM_BORDER, SpreadsheetApp.BorderStyle.SOLID);
  sheet.setFrozenRows(2);

  var note = CLIENT_FIRST_ROW + CLIENT_MAX + 2;
  [['■ 入れ方'],
   ['社名はまとめに出る名前です。URLはKPIシートを開いてアドレスバーからコピーしてください。'],
   ['行の順番がまとめの並び順になります。空の行は飛ばします。'],
   [''],
   ['■ 読めないとき'],
   ['「開けません」と出る場合、そのファイルにこのアカウントでアクセスできていません。'],
   ['「月次KPIが見つかりません」と出る場合は、URLが別のファイルを指しています。']
  ].forEach(function (line, i) {
    sheet.getRange(note + i, 1, 1, 3).merge().setValue(line[0])
      .setFontWeight(line[0].indexOf('■') === 0 ? 'bold' : 'normal').setFontSize(10);
  });
}

function buildSummarySheet_(ss) {
  var sheet = ss.getSheetByName(SUMMARY_SHEET) || ss.insertSheet(SUMMARY_SHEET, 0);
  sumReset_(sheet);

  var last = SUMMARY_COLUMNS.length;
  // 1列目は固定するので、結合は2列目から。固定の境目をまたぐ結合は弾かれる。
  sheet.getRange(1, 2).setValue('全クライアント まとめ');
  sheet.getRange(1, 2, 1, last - 1).merge();
  sheet.getRange(1, 1, 1, last)
    .setBackground(SUM_NAVY).setFontColor('#ffffff').setFontWeight('bold').setFontSize(13)
    .setVerticalAlignment('middle');
  sheet.setRowHeight(1, 30);

  sheet.getRange(2, 1).setValue('更新日時');
  sheet.getRange(2, 2, 1, last - 1).merge()
    .setValue('メニュー「まとめ」→「最新の数字に更新する」で読み込みます')
    .setFontSize(9).setFontColor('#595959');

  sheet.getRange(3, 1, 1, last)
    .setValues([SUMMARY_COLUMNS.map(function (c) { return c.label; })])
    .setBackground(SUM_HEAD).setFontColor('#ffffff').setFontWeight('bold').setFontSize(10)
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
  sheet.setRowHeight(3, 34);

  SUMMARY_COLUMNS.forEach(function (c, i) { sheet.setColumnWidth(i + 1, c.width); });
  sheet.setFrozenRows(3);
  sheet.setFrozenColumns(1);
}

/* ---------------- 更新 ---------------- */

function refreshSummary() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SUMMARY_SHEET);
  if (!sheet) {
    throw new Error('「' + SUMMARY_SHEET + '」タブがありません。先に「シートを整える」を実行してください。');
  }

  var clients = readClients_(ss).filter(function (c) { return c.name && c.url; });
  var last = SUMMARY_COLUMNS.length;

  // 前回の内容を消す。件数が減ったときに古い行が残らないように。
  if (sheet.getMaxRows() > 4) {
    sheet.getRange(4, 1, sheet.getMaxRows() - 3, last).clearContent().clearFormat();
  }
  if (!clients.length) {
    SpreadsheetApp.getActive().toast('「' + CLIENT_SHEET + '」タブが空です。');
    return;
  }

  var rows = clients.map(function (c) { return readClient_(c); });

  rows.forEach(function (row, i) {
    var r = 4 + i;
    SUMMARY_COLUMNS.forEach(function (col, j) {
      var cell = sheet.getRange(r, j + 1);
      var v = row[col.label];
      if (v !== undefined && v !== null && v !== '') { cell.setValue(v); }
      if (col.format) { cell.setNumberFormat(col.format); }
    });

    // 先に行全体を塗ってから、ランクのセルだけ塗り直す。順番が逆だと消える。
    sheet.getRange(r, 1, 1, last).setBackground(i % 2 ? SUM_BG : '#ffffff');
    sheet.getRange(r, 1).setFontWeight('bold');

    var style = SUM_RANK_COLORS[String(row['ランク'] || '').trim()];
    var rankCell = sheet.getRange(r, 3).setHorizontalAlignment('center');
    if (style) {
      rankCell.setBackground(style.bg).setFontColor(style.fg)
        .setFontWeight('bold').setFontSize(12);
    }
    sheet.setRowHeight(r, 22);
  });

  sheet.getRange(4, 1, rows.length, last)
    .setBorder(true, true, true, true, true, true, SUM_BORDER, SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange(2, 2).setValue(
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm') + ' 更新');

  SpreadsheetApp.getActive().toast(rows.length + '社ぶん読み込みました。');
}

/** 毎朝、まとめを最新にしておく。 */
function installSummaryTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'refreshSummary') { ScriptApp.deleteTrigger(t); }
  });
  ScriptApp.newTrigger('refreshSummary').timeBased().everyDays(1).atHour(7).create();
  SpreadsheetApp.getActive().toast('毎朝7時に自動で更新します。');
}

/* ---------------- 各社のシートを読む ---------------- */

/**
 * 1社ぶんの数字。見出しの文字で列を探すので、
 * 各社のシートで列が増えたり並びが変わっても読める。
 */
function readClient_(client) {
  var out = {'クライアント': client.name, '状態': ''};

  var ss;
  try {
    ss = SpreadsheetApp.openByUrl(client.url);
  } catch (e) {
    out['状態'] = '開けません（URLか共有設定を確認してください）';
    return out;
  }

  var sheet = ss.getSheetByName(KPI_SHEET_NAME);
  if (!sheet) {
    out['状態'] = '「' + KPI_SHEET_NAME + '」タブが見つかりません';
    return out;
  }

  var values = sheet.getDataRange().getValues();
  var head = -1;
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim() === '月' && String(values[i][1]).trim() === 'チャネル') {
      head = i;
      break;
    }
  }
  if (head < 0) {
    out['状態'] = '見出しの行が見つかりません（シートを整えてください）';
    return out;
  }

  var index = sumHeaderIndex_(values[head]);
  var viewCol = index['表示回数'];
  if (viewCol === undefined) {
    out['状態'] = '表示回数の列が見つかりません';
    return out;
  }

  // 合計行を上から拾い、数字が入っている最後の月を「最新の月」とする。
  var months = [];
  var month = '';
  for (var r = head + 1; r < values.length; r++) {
    var label = String(values[r][0]).trim();
    if (/^\d+月$/.test(label)) { month = label; }
    if (String(values[r][1]).trim() !== KPI_TOTAL_LABEL) { continue; }
    months.push({month: month, row: values[r]});
  }

  var latest = null;
  months.forEach(function (m) {
    if (sumNum_(m.row[viewCol]) > 0) { latest = m; }
  });

  if (!latest) {
    out['状態'] = 'まだ数字が入っていません';
    return out;
  }
  out['最新の月'] = latest.month;

  SUMMARY_COLUMNS.forEach(function (col) {
    if (!col.header) { return; }
    var at = index[col.header];
    if (at === undefined) { return; }

    if (col.scope === 'total') {
      var sum = 0;
      months.forEach(function (m) { sum += sumNum_(m.row[at]); });
      out[col.label] = sum;
      return;
    }
    var v = latest.row[at];
    out[col.label] = typeof v === 'number' ? v : String(v || '').trim();
  });

  return out;
}

/** 見出しの文字 → 列番号。改行と空白を落として、先頭一致で探す。 */
function sumHeaderIndex_(headerRow) {
  var wanted = [];
  SUMMARY_COLUMNS.forEach(function (c) {
    if (c.header && wanted.indexOf(c.header) < 0) { wanted.push(c.header); }
  });

  var index = {};
  headerRow.forEach(function (text, i) {
    var flat = String(text).replace(/[\s\n]/g, '');
    wanted.forEach(function (name) {
      var key = name.replace(/[\s\n]/g, '');
      if (index[name] === undefined && flat.indexOf(key) === 0) { index[name] = i; }
    });
  });
  return index;
}

function sumNum_(v) {
  return typeof v === 'number' ? v : 0;
}

/* ---------------- 共通 ---------------- */

function readClients_(ss) {
  var sheet = ss.getSheetByName(CLIENT_SHEET);
  if (!sheet) { return []; }
  var last = Math.max(0, sheet.getLastRow() - CLIENT_FIRST_ROW + 1);
  if (!last) { return []; }

  return sheet.getRange(CLIENT_FIRST_ROW, 1, last, 3).getValues()
    .map(function (row) {
      return {name: String(row[0] || '').trim(),
              url: String(row[1] || '').trim(),
              memo: String(row[2] || '').trim()};
    })
    .filter(function (c) { return c.name || c.url; });
}

/** 作り直す前に、固定・結合・フィルタを外してから消す。 */
function sumReset_(sheet) {
  var filter = sheet.getFilter();
  if (filter) { filter.remove(); }
  sheet.setFrozenRows(0);
  sheet.setFrozenColumns(0);
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).breakApart();
  sheet.clear();
}
