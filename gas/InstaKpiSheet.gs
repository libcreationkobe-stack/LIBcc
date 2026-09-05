/**
 * 採用の月次KPIシート。SNS各チャネルの数字を1枚で追う。
 *
 * 行は「月 × チャネル」。月ごとにチャネル行が並び、最後に合計行が入る。
 * チャネルを増やすときは CHANNELS に足して作り直すだけでよい。
 *
 * 使い方:
 *   1. シートを開く
 *   2. 拡張機能 → Apps Script にこのファイルの中身を貼り付けて保存
 *   3. 関数 setupKpiSheet を実行（初回のみ承認が必要）
 *
 * 入力済みの数字は月とチャネルで突き合わせて引き継ぐ。
 */

var SHEET_NAME = '月次KPI';

var MONTHS = ['8月', '9月', '10月', '11月', '12月', '1月', '2月',
              '3月', '4月', '5月', '6月', '7月', '8月'];

/** 追うチャネル。増減させたら setupKpiSheet を実行し直す。 */
var CHANNELS = ['Instagram', 'TikTok', 'X', 'YouTube', 'YouTubeショート',
                'Facebook', 'Meta広告', 'TikTokプロモート'];

/** 広告費が発生するチャネル。0円のままだと単価が出ないので目印にする。 */
var PAID_CHANNELS = ['Meta広告', 'TikTokプロモート'];

var TOTAL_LABEL = '合計';
var ROWS_PER_MONTH = CHANNELS.length + 1;   // チャネル行＋合計行

var TITLE_ROW = 1;
var HEAD_ROW = 2;
var GUIDE_ROW = 3;   // 目安（悪い／普通／良い）
var FIRST_ROW = 4;
var LAST_ROW = FIRST_ROW + MONTHS.length * ROWS_PER_MONTH - 1;
var YEAR_TOTAL_ROW = LAST_ROW + 2;
var YEAR_AVG_ROW = LAST_ROW + 3;

/**
 * 列の定義。key は参照用の名前、header は画面に出す文字。
 * 数式は {指標名} を書いておくと、書き込むときに列文字へ差し替わる。
 * 列を足したり並べ替えても、参照している側を直さなくてよい。
 */
var INPUT_COLUMNS = [
  {key: '投稿数',           header: '投稿数',                  width: 70},
  {key: '広告費',           header: '広告費',                  width: 90,  money: true},
  {key: 'フォロワー数',     header: 'フォロワー数\n(月末)',    width: 100, stock: true},
  {key: '表示回数',         header: '表示回数\n(インプ・再生)', width: 105},
  {key: 'リーチ数',         header: 'リーチ数\n(取れる媒体のみ)', width: 105},
  {key: '保存・シェア',     header: '保存＋シェア',            width: 95},
  {key: 'プロフィール表示', header: 'プロフィール表示',        width: 105},
  {key: 'リンククリック',   header: 'リンククリック',          width: 95},
  {key: 'LINE友だち追加',   header: 'LINE友だち追加',          width: 100},
  {key: 'エントリー数',     header: 'エントリー数',            width: 90},
  {key: '面接',             header: '面接',                    width: 60},
  {key: '採用数',           header: '採用数',                  width: 70},
  {key: '3ヶ月定着数',      header: '3ヶ月定着数\n(3ヶ月後に記入)', width: 105}
];

/** 月ぜんぶで1つの数字。合計行にだけ入れる。 */
var MONTH_COLUMNS = [
  {key: 'LINE友だち総数', header: 'LINE友だち\n総数(月末)', width: 100}
];

/** 自動計算する率と単価。 */
var CALC_COLUMNS = [
  {key: 'リーチ率',         header: 'リーチ率\n(リーチ÷表示)',
   formula: '=IFERROR({リーチ数}{r}/{表示回数}{r},"")', format: '0.0%', width: 100},
  {key: '保存シェア率',     header: '保存シェア率\n(保存＋シェア÷リーチ)',
   formula: '=IFERROR({保存・シェア}{r}/{リーチ数}{r},"")', format: '0.00%', width: 125},
  {key: 'プロフ表示率',     header: 'プロフ表示率\n(プロフ÷リーチ)',
   formula: '=IFERROR({プロフィール表示}{r}/{リーチ数}{r},"")', format: '0.0%', width: 110},
  {key: 'リンククリック率', header: 'リンククリック率\n(クリック÷プロフ)',
   formula: '=IFERROR({リンククリック}{r}/{プロフィール表示}{r},"")', format: '0.0%', width: 120},
  {key: 'LINE登録率',       header: 'LINE登録率\n(登録÷クリック)',
   formula: '=IFERROR({LINE友だち追加}{r}/{リンククリック}{r},"")', format: '0.0%', width: 110},
  {key: 'エントリー率',     header: 'エントリー率\n(応募÷LINE登録)',
   formula: '=IFERROR({エントリー数}{r}/{LINE友だち追加}{r},"")', format: '0.0%', width: 110},
  {key: '面接率',           header: '面接率\n(面接÷エントリー)',
   formula: '=IFERROR({面接}{r}/{エントリー数}{r},"")', format: '0.0%', width: 105},
  {key: '採用率',           header: '採用率\n(採用÷面接)',
   formula: '=IFERROR({採用数}{r}/{面接}{r},"")', format: '0.0%', width: 95},
  {key: '定着率',           header: '定着率\n(3ヶ月定着÷採用数)',
   formula: '=IFERROR({3ヶ月定着数}{r}/{採用数}{r},"")', format: '0.0%', width: 115},
  {key: '表示→採用率',      header: '表示→採用率\n(採用÷表示回数)',
   formula: '=IFERROR({採用数}{r}/{表示回数}{r},"")', format: '0.000%', width: 110},
  {key: '1採用あたり投稿数', header: '1採用あたり\n投稿数',
   formula: '=IFERROR({投稿数}{r}/{採用数}{r},"")', format: '#,##0.0', width: 95},
  {key: '採用単価',         header: '採用単価\n(広告費÷採用数)',
   formula: '=IFERROR(IF({広告費}{r}=0,"",{広告費}{r}/{採用数}{r}),"")', format: '¥#,##0', width: 110},
  {key: 'LINE登録単価',     header: 'LINE登録単価\n(広告費÷LINE追加)',
   formula: '=IFERROR(IF({広告費}{r}=0,"",{広告費}{r}/{LINE友だち追加}{r}),"")', format: '¥#,##0', width: 115}
];

var ALL_COLUMNS = INPUT_COLUMNS.concat(MONTH_COLUMNS).concat(CALC_COLUMNS);
var LAST_COL = 2 + ALL_COLUMNS.length;   // A列=月, B列=チャネル

/** 指標名 → 列文字。列を並べ替えてもここが自動で追従する。 */
var KPI_COL = (function () {
  var map = {};
  ALL_COLUMNS.forEach(function (c, i) { map[c.key] = columnLetter_(3 + i); });
  return map;
})();

/** 1始まりの列番号を A, B, ... AA のような文字にする。 */
function columnLetter_(index) {
  var letter = '';
  while (index > 0) {
    var rem = (index - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    index = Math.floor((index - 1) / 26);
  }
  return letter;
}

/** 指標名から列文字を返す。他のファイルからも使う。 */
function col_(key) {
  if (!KPI_COL[key]) { throw new Error('KPIシートに「' + key + '」の列がありません。'); }
  return KPI_COL[key];
}

/** 数式の {指標名} を列文字に、{r} を行番号に差し替える。 */
function resolveFormula_(template, row) {
  return template.replace(/\{([^}]+)\}/g, function (whole, name) {
    return name === 'r' ? String(row) : col_(name);
  });
}

/**
 * 悪い／普通／良いの判定ライン。bad未満＝赤、bad〜good＝緑、good以上＝黄色。
 * もとはInstagramの一般値。他のチャネルでは水準が変わるので、
 * 実績が溜まったらチャネルの実態に合わせて書き換える。
 */
var BENCHMARKS = [
  {key: 'プロフ表示率',     bad: 0.03,    good: 0.05,   labels: ['悪い 〜3%',     '普通 3〜5%',        '良い 5%〜']},
  {key: 'リンククリック率', bad: 0.05,    good: 0.10,   labels: ['悪い 〜5%',     '普通 5〜10%',       '良い 10%〜']},
  {key: 'LINE登録率',       bad: 0.20,    good: 0.40,   labels: ['悪い 〜20%',    '普通 20〜40%',      '良い 40%〜']},
  {key: '表示→採用率',      bad: 0.00005, good: 0.0002, labels: ['悪い 〜0.005%', '普通 0.005〜0.02%', '良い 0.02%〜']},
  {key: '定着率',           bad: 0.70,    good: 0.90,   labels: ['悪い 〜70%',    '普通 70〜90%',      '良い 90%〜']}
];

var BAD = {bg: '#f4cccc', fg: '#990000'};
var OK = {bg: '#d9ead3', fg: '#274e13'};
var GOOD = {bg: '#fff2cc', fg: '#7f6000'};

var COLOR_NAVY = '#1f3864';
var COLOR_INPUT = '#2e75b6';
var COLOR_CALC = '#548235';
var COLOR_MONTH_HEAD = '#3e63a3';
var COLOR_CALC_BG = '#edf3e9';
var COLOR_TOTAL_BG = '#fff2cc';
var COLOR_MONTH_BG = '#f2f2f2';
var COLOR_BORDER = '#bfbfbf';

var MIN_ROWS = 190;

/** スプレッドシートを開いたときにメニューを出す。 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('KPIシート')
    .addItem('シートを整える（数式・色分けを入れ直す）', 'setupKpiSheet')
    .addSeparator()
    .addItem('月次レビューシートを作る', 'buildReviewSheet')
    .addItem('この月の総評をAIに書かせる', 'writeReviewForSelectedMonth')
    .addSeparator()
    .addItem('この月のレポートを作る（総評＋スライド）', 'buildMonthlyReport')
    .addItem('この月のスライドだけ作り直す', 'buildMonthlyDeck')
    .addSeparator()
    .addItem('Claude APIの設定を確認する', 'checkClaudeSettings')
    .addToUi();
}

/** フィルタが掛かっていれば外す。掛かっていなければ何もしない。 */
function removeFilter_(sheet) {
  var filter = sheet.getFilter();
  if (filter) { filter.remove(); }
}

/** その月の合計行が何行目か。 */
function summaryRow_(monthIndex) {
  return FIRST_ROW + monthIndex * ROWS_PER_MONTH + CHANNELS.length;
}

/** その月のチャネル行の先頭。 */
function channelFirstRow_(monthIndex) {
  return FIRST_ROW + monthIndex * ROWS_PER_MONTH;
}

/** メインの処理。シートを作り直して数式・書式・色分けを入れる。 */
function setupKpiSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];

  var saved = readExistingInputs_(sheet);

  // シートを消してから書き戻すまでの間に落ちると、入力が消えてしまう。
  // 消す前に控えを取り、次回そこから拾えるようにしておく。
  saved = mergeWithBackup_(saved);
  saveBackup_(saved);

  // 2回目以降に備えて、フィルタ・固定・結合を先に解除する。
  // フィルタが残っていると、その境界をまたぐ結合ができない。
  removeFilter_(sheet);
  sheet.setFrozenRows(0);
  sheet.setFrozenColumns(0);
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).breakApart();

  sheet.clear();
  sheet.clearConditionalFormatRules();
  sheet.setName(SHEET_NAME);
  if (sheet.getMaxColumns() < LAST_COL) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), LAST_COL - sheet.getMaxColumns());
  }
  if (sheet.getMaxRows() < MIN_ROWS) {
    sheet.insertRowsAfter(sheet.getMaxRows(), MIN_ROWS - sheet.getMaxRows());
  }

  writeTitle_(sheet);
  writeHeaders_(sheet);
  writeGuideRow_(sheet);
  writeMonthBlocks_(sheet, saved);
  writeYearRows_(sheet);
  writeNotes_(sheet);
  applyConditionalFormats_(sheet);
  finishLayout_(sheet);

  SpreadsheetApp.getActive().toast('KPIシートを整えました。チャネルごとに数字を入れてください。');
}

/**
 * 入力済みの数字を退避する。値は指標名で持つので、
 * 列を足したり並べ替えたりしても正しい列に戻る。
 * Instagramだけだった古い形も読み、Instagram行へ移す。
 */
function readExistingInputs_(sheet) {
  var saved = {};
  var values = sheet.getDataRange().getValues();
  if (!values.length) { return saved; }

  var headRow = -1;
  var isOld = false;
  for (var r = 0; r < values.length; r++) {
    var a = String(values[r][0]).trim();
    var b = String(values[r][1]).trim();
    if (a === '月' && b === 'チャネル') { headRow = r; break; }
    if (a === '月' && b === '投稿数') { headRow = r; isOld = true; break; }
  }
  if (headRow < 0) { return saved; }

  if (isOld) { return readOldLayout_(values, headRow); }

  // 見出しの文字から「この列は何の指標か」を引く。
  var byHeader = {};
  ALL_COLUMNS.forEach(function (c) { byHeader[c.header] = c.key; });
  var colKey = {};
  values[headRow].forEach(function (h, i) {
    var key = byHeader[String(h)];
    if (key) { colKey[i] = key; }
  });

  var monthIndex = -1;
  var lastMonth = '';
  for (var i = headRow + 1; i < values.length; i++) {
    var label = String(values[i][0]).trim();
    var channel = String(values[i][1]).trim();
    if (/^\d+月$/.test(label) && label !== lastMonth) { monthIndex++; lastMonth = label; }
    if (monthIndex < 0 || !channel) { continue; }

    var body = {};
    var has = false;
    Object.keys(colKey).forEach(function (idx) {
      var v = values[i][idx];
      if (v === '' || v === null || typeof v === 'string') { return; }
      body[colKey[idx]] = v;
      has = true;
    });
    if (has) { saved[monthIndex + '|' + channel] = body; }
  }
  return saved;
}

/** Instagramだけだった古い形（1月1行）を読む。 */
function readOldLayout_(values, headRow) {
  var saved = {};
  var seen = 0;
  for (var d = headRow + 1; d < values.length && seen < MONTHS.length; d++) {
    if (!/^\d+月$/.test(String(values[d][0]).trim())) { continue; }
    var o = values[d];
    // 旧: B投稿数 Cインプ Dリーチ Eプロフ Fタップ GLINE H面接 I採用 Jその他問合せ K採用その他
    var body = {
      '投稿数': o[1], '表示回数': o[2], 'リーチ数': o[3], 'プロフィール表示': o[4],
      'リンククリック': o[5], 'LINE友だち追加': o[6], 'エントリー数': o[9],
      '面接': o[7], '採用数': num_(o[8]) + num_(o[10])
    };
    var has = Object.keys(body).some(function (k) {
      return typeof body[k] === 'number' && body[k] !== 0;
    });
    if (has) { saved[seen + '|' + CHANNELS[0]] = body; }
    seen++;
  }
  return saved;
}

function num_(v) {
  return typeof v === 'number' ? v : 0;
}

var BACKUP_KEY = 'KPI_INPUT_BACKUP';

/**
 * 前回の控えと突き合わせる。シートから読めた分を優先し、
 * 読めなかった月・チャネルだけ控えから補う。
 */
function mergeWithBackup_(saved) {
  var backup = loadBackup_();
  Object.keys(backup).forEach(function (key) {
    if (!saved[key]) { saved[key] = backup[key]; }
  });
  return saved;
}

/** 入力値の控えをスプレッドシートのプロパティに残す。 */
function saveBackup_(saved) {
  if (!Object.keys(saved).length) { return; }
  try {
    PropertiesService.getDocumentProperties()
      .setProperty(BACKUP_KEY, JSON.stringify(saved));
  } catch (e) {
    // 控えが取れなくても本来の処理は続ける。
    Logger.log('入力の控えを保存できませんでした: ' + e.message);
  }
}

function loadBackup_() {
  try {
    var raw = PropertiesService.getDocumentProperties().getProperty(BACKUP_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    Logger.log('入力の控えを読めませんでした: ' + e.message);
    return {};
  }
}

function writeTitle_(sheet) {
  // 左2列は固定するので、結合は3列目から。固定の境目をまたぐと弾かれる。
  sheet.getRange(TITLE_ROW, 3).setValue(
    '採用 月次KPI（青の見出し＝入力欄／緑の見出し＝自動計算）');
  sheet.getRange(TITLE_ROW, 3, 1, LAST_COL - 2).merge();
  sheet.getRange(TITLE_ROW, 1, 1, LAST_COL)
    .setBackground(COLOR_NAVY).setFontColor('#ffffff')
    .setFontWeight('bold').setFontSize(12).setVerticalAlignment('middle');
  sheet.setRowHeight(TITLE_ROW, 28);
}

function writeHeaders_(sheet) {
  var headers = ['月', 'チャネル'];
  INPUT_COLUMNS.forEach(function (c) { headers.push(c.header); });
  MONTH_COLUMNS.forEach(function (c) { headers.push(c.header); });
  CALC_COLUMNS.forEach(function (c) { headers.push(c.header); });

  sheet.getRange(HEAD_ROW, 1, 1, LAST_COL).setValues([headers])
    .setFontColor('#ffffff').setFontWeight('bold').setFontSize(9)
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);

  var inputEnd = 2 + INPUT_COLUMNS.length + MONTH_COLUMNS.length;
  sheet.getRange(HEAD_ROW, 1, 1, inputEnd).setBackground(COLOR_INPUT);
  sheet.getRange(HEAD_ROW, inputEnd + 1, 1, LAST_COL - inputEnd).setBackground(COLOR_CALC);
  sheet.setRowHeight(HEAD_ROW, 46);
}

/** 見出しのすぐ下に、悪い／普通／良いの目安を色付きで書く。 */
function writeGuideRow_(sheet) {
  sheet.getRange(GUIDE_ROW, 1, 1, 2).merge().setValue('目安')
    .setFontWeight('bold').setBackground(COLOR_MONTH_BG)
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sheet.getRange(GUIDE_ROW, 3, 1, LAST_COL - 2)
    .setBackground('#ffffff').setFontSize(8)
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);

  BENCHMARKS.forEach(function (b) {
    sheet.getRange(col_(b.key) + GUIDE_ROW).setRichTextValue(buildGuideText_(b.labels));
  });
  sheet.getRange(GUIDE_ROW, 1, 1, LAST_COL)
    .setBorder(true, true, true, true, true, true, COLOR_BORDER, SpreadsheetApp.BorderStyle.SOLID);
  sheet.setRowHeight(GUIDE_ROW, 32);
}

/** 「悪い〜3% / 普通 3〜5% / 良い 5%〜」を1セル内で3色に塗り分ける。 */
function buildGuideText_(labels) {
  var sep = ' / ';
  var builder = SpreadsheetApp.newRichTextValue().setText(labels.join(sep));
  var colors = [BAD.fg, OK.fg, GOOD.fg];
  var pos = 0;
  for (var i = 0; i < labels.length; i++) {
    builder.setTextStyle(pos, pos + labels[i].length,
      SpreadsheetApp.newTextStyle().setForegroundColor(colors[i]).setBold(true).build());
    pos += labels[i].length + sep.length;
  }
  return builder.build();
}

/** 月ごとにチャネル行と合計行を書く。 */
function writeMonthBlocks_(sheet, saved) {
  for (var m = 0; m < MONTHS.length; m++) {
    var first = channelFirstRow_(m);
    var total = summaryRow_(m);

    sheet.getRange(first, 1, ROWS_PER_MONTH, 1).merge()
      .setValue(MONTHS[m])
      .setBackground(COLOR_MONTH_BG).setFontWeight('bold').setFontSize(11)
      .setHorizontalAlignment('center').setVerticalAlignment('middle');

    CHANNELS.forEach(function (channel, i) {
      var r = first + i;
      var paid = PAID_CHANNELS.indexOf(channel) >= 0;
      sheet.getRange(r, 2).setValue(channel).setFontSize(10).setFontWeight('bold')
        .setFontColor(paid ? '#8a6100' : '#303030');

      var body = saved[m + '|' + channel] || {};
      INPUT_COLUMNS.forEach(function (c) {
        var cell = sheet.getRange(col_(c.key) + r);
        if (body.hasOwnProperty(c.key)) { cell.setValue(body[c.key]); }
        cell.setNumberFormat(c.money ? '¥#,##0' : '#,##0');
      });
      writeCalcCells_(sheet, r);
      sheet.setRowHeight(r, 21);
    });

    // 合計行。チャネル行を足し上げる。
    sheet.getRange(total, 2).setValue(TOTAL_LABEL).setFontWeight('bold');
    INPUT_COLUMNS.forEach(function (c) {
      var letter = col_(c.key);
      sheet.getRange(letter + total)
        .setFormula('=SUM(' + letter + first + ':' + letter + (total - 1) + ')')
        .setNumberFormat(c.money ? '¥#,##0' : '#,##0');
    });
    MONTH_COLUMNS.forEach(function (c) {
      var body = saved[m + '|' + TOTAL_LABEL] || {};
      var cell = sheet.getRange(col_(c.key) + total);
      if (body.hasOwnProperty(c.key)) { cell.setValue(body[c.key]); }
      cell.setNumberFormat('#,##0');
    });
    writeCalcCells_(sheet, total);
    sheet.getRange(total, 2, 1, LAST_COL - 1).setBackground(COLOR_TOTAL_BG).setFontWeight('bold');
    sheet.setRowHeight(total, 22);

    sheet.getRange(first, 1, ROWS_PER_MONTH, LAST_COL)
      .setBorder(true, true, true, true, null, null, '#808080', SpreadsheetApp.BorderStyle.SOLID);
  }
}

/** 率の列に数式と表示形式を入れる。 */
function writeCalcCells_(sheet, row) {
  CALC_COLUMNS.forEach(function (c) {
    sheet.getRange(col_(c.key) + row)
      .setFormula(resolveFormula_(c.formula, row))
      .setNumberFormat(c.format)
      .setHorizontalAlignment('right')
      .setBackground(COLOR_CALC_BG);
  });
}

/** 年間の合計と平均。合計行だけを拾って集計する。 */
function writeYearRows_(sheet) {
  var channelCol = '$B$' + FIRST_ROW + ':$B$' + LAST_ROW;

  [{row: YEAR_TOTAL_ROW, label: '年間合計', fn: 'SUMIF'},
   {row: YEAR_AVG_ROW, label: '月平均', fn: 'AVERAGEIF'}].forEach(function (spec) {
    sheet.getRange(spec.row, 1, 1, 2).merge().setValue(spec.label)
      .setFontWeight('bold').setHorizontalAlignment('center');

    INPUT_COLUMNS.concat(MONTH_COLUMNS).forEach(function (c) {
      var letter = col_(c.key);
      var range = '$' + letter + '$' + FIRST_ROW + ':$' + letter + '$' + LAST_ROW;
      sheet.getRange(letter + spec.row)
        .setFormula('=IFERROR(' + spec.fn + '(' + channelCol + ',"' + TOTAL_LABEL + '",' + range + '),0)')
        .setNumberFormat(c.money ? '¥#,##0' : (spec.row === YEAR_TOTAL_ROW ? '#,##0' : '#,##0.0'));
    });
    writeCalcCells_(sheet, spec.row);

    sheet.getRange(spec.row, 1, 1, LAST_COL)
      .setBackground(COLOR_TOTAL_BG).setFontWeight('bold')
      .setBorder(true, true, true, true, null, null, '#808080', SpreadsheetApp.BorderStyle.SOLID);
    sheet.setRowHeight(spec.row, 22);
  });

  // フォロワー数や友だち総数は積み上げる数字ではないので、
  // 年間合計は足さずに「最後に入っている値」を出す。
  INPUT_COLUMNS.concat(MONTH_COLUMNS).forEach(function (c) {
    if (!c.stock && MONTH_COLUMNS.indexOf(c) < 0) { return; }
    var letter = col_(c.key);
    var range = letter + FIRST_ROW + ':' + letter + LAST_ROW;
    sheet.getRange(letter + YEAR_TOTAL_ROW)
      .setFormula('=IFERROR(LOOKUP(2,1/(' + range + '<>""),' + range + '),0)');
  });
}

/** 4つの率を 悪い＝赤 / 普通＝緑 / 良い＝黄色 で色分けする。 */
function applyConditionalFormats_(sheet) {
  var rules = [];
  BENCHMARKS.forEach(function (b) {
    var letter = col_(b.key);
    var range = sheet.getRange(letter + FIRST_ROW + ':' + letter + YEAR_AVG_ROW);
    var cell = '$' + letter + FIRST_ROW;
    // 空欄を赤くしないよう ISNUMBER で必ず絞る。
    [[cell + '<' + b.bad, BAD],
     [cell + '>=' + b.bad + ',' + cell + '<' + b.good, OK],
     [cell + '>=' + b.good, GOOD]].forEach(function (t) {
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=AND(ISNUMBER(' + cell + '),' + t[0] + ')')
        .setBackground(t[1].bg).setFontColor(t[1].fg).setBold(true)
        .setRanges([range]).build());
    });
  });
  sheet.setConditionalFormatRules(rules);
}

function writeNotes_(sheet) {
  var start = YEAR_AVG_ROW + 2;
  var notes = [
    ['■ 使い方'],
    ['月ごとにチャネルの行が並んでいます。左の入力欄に数字を入れるだけ。合計行と率は自動です。'],
    ['LINE友だち総数は月全体の数字なので、合計行にだけ入れてください。'],
    ['広告費はMeta広告・TikTokプロモートの行に入れます。入れると採用単価とLINE登録単価が出ます。'],
    ['3ヶ月定着数は3ヶ月後に分かる数字です。8月に採用した人が11月に残っていたら、8月の行に入れます。'],
    ['全部を毎月埋めようとしないでください。主力チャネルだけ全項目、他は表示回数・LINE追加・採用数の3つで十分です。'],
    ['チャネルを増やしたいときは、スクリプトの CHANNELS に足して「シートを整える」を実行します。'],
    [''],
    ['■ 色分け（プロフ表示率／リンククリック率／LINE登録率／表示→採用率）'],
    ['赤＝悪い　緑＝普通　黄色＝良い'],
    ['目安はもともとInstagramの一般値です。TikTokやYouTubeは母数の数え方が違うため水準もずれます。'],
    ['まずは自社の実績を3〜6ヶ月ためて、チャネルごとの実態に合わせて BENCHMARKS を書き換えてください。'],
    [''],
    ['■ 指標の意味'],
    ['表示回数', 'インプレッション・再生回数。媒体によって呼び名が違うだけで、表示された延べ回数'],
    ['リーチ数', '重複を除いた到達人数。取れない媒体は空欄でよい（率も出ません）'],
    ['プロフィール表示', 'プロフィール／チャンネルを見に来た数'],
    ['リンククリック', 'プロフィールから外部リンクへ出た数'],
    ['LINE友だち追加', 'その月に増えた友だち数（フロー）'],
    ['LINE友だち総数', '月末時点の友だち数（ストック）。合計行にだけ入れる'],
    ['エントリー数', '応募・問い合わせの件数'],
    ['表示→採用率', '採用数 ÷ 表示回数。チャネルをまたいで比べられる最終CVR'],
    ['1採用あたり投稿数', '1人採るのに何本投稿したか。オーガニックの効率比較に使う'],
    ['フォロワー数', '月末時点の数（ストック）。唯一の資産で、これが増えないと毎月ゼロから表示を取りに行くことになる'],
    ['保存＋シェア', '伸びの先行指標。保存が増えた翌月に表示回数が伸びる。他は全部「起きた後」の数字だが、これだけは先が読める'],
    ['保存シェア率', '（保存＋シェア）÷ リーチ数。規模の違うチャネルを同じ物差しで比べるための率'],
    ['3ヶ月定着数', '採用した人のうち3ヶ月後に残っている数。3ヶ月後に、採用した月の行へさかのぼって入れる'],
    ['定着率', '3ヶ月定着数 ÷ 採用数。ここを見ていないと「採る→辞める」を数字上は成功として繰り返す'],
    ['広告費', 'そのチャネルにその月かけた金額。オーガニックの行は空欄でよい'],
    ['採用単価', '広告費 ÷ 採用数。広告を続けるか止めるかはこの数字で決める'],
    ['LINE登録単価', '広告費 ÷ LINE友だち追加。採用が出る前でも広告の良し悪しが早く分かる']
  ];

  notes.forEach(function (n, i) {
    var r = start + i;
    sheet.getRange(r, 1, 1, 2).merge().setValue(n[0])
      .setFontWeight(n[0].indexOf('■') === 0 ? 'bold' : 'normal').setFontSize(10);
    if (n.length > 1) {
      sheet.getRange(r, 3, 1, 8).merge().setValue(n[1])
        .setFontSize(9).setFontColor('#595959').setWrap(true);
    }
  });
}

function finishLayout_(sheet) {
  sheet.setColumnWidth(1, 60);
  sheet.setColumnWidth(2, 115);
  var widths = INPUT_COLUMNS.concat(MONTH_COLUMNS).concat(CALC_COLUMNS);
  widths.forEach(function (c, i) { sheet.setColumnWidth(3 + i, c.width); });

  sheet.getRange(HEAD_ROW, 1, YEAR_AVG_ROW - HEAD_ROW + 1, LAST_COL)
    .setBorder(true, true, true, true, true, true, COLOR_BORDER, SpreadsheetApp.BorderStyle.SOLID);

  sheet.setFrozenRows(GUIDE_ROW);
  sheet.setFrozenColumns(2);
}
