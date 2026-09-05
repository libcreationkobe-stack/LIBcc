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
var CHANNELS = ['Instagram', 'TikTok', 'X', 'YouTube', 'YouTubeショート', 'その他'];

var TOTAL_LABEL = '合計';
var ROWS_PER_MONTH = CHANNELS.length + 1;   // チャネル行＋合計行

var TITLE_ROW = 1;
var HEAD_ROW = 2;
var GUIDE_ROW = 3;   // 目安（悪い／普通／良い）
var FIRST_ROW = 4;
var LAST_ROW = FIRST_ROW + MONTHS.length * ROWS_PER_MONTH - 1;
var YEAR_TOTAL_ROW = LAST_ROW + 2;
var YEAR_AVG_ROW = LAST_ROW + 3;

/** チャネルごとに手で入れる列（C〜K）。 */
var INPUT_COLUMNS = [
  {col: 'C', header: '投稿数', width: 70},
  {col: 'D', header: '表示回数\n(インプ・再生)', width: 110},
  {col: 'E', header: 'リーチ数\n(取れる媒体のみ)', width: 110},
  {col: 'F', header: 'プロフィール表示', width: 110},
  {col: 'G', header: 'リンククリック', width: 100},
  {col: 'H', header: 'LINE友だち追加', width: 105},
  {col: 'I', header: 'エントリー数', width: 95},
  {col: 'J', header: '面接', width: 65},
  {col: 'K', header: '採用数', width: 75}
];

/** 月ぜんぶで1つの数字。合計行にだけ入れる（L列）。 */
var MONTH_COLUMNS = [
  {col: 'L', header: 'LINE友だち\n総数(月末)', width: 105}
];

/** 自動計算する率（M〜U）。 */
var CALC_COLUMNS = [
  {col: 'M', header: 'リーチ率\n(リーチ÷表示)',        formula: '=IFERROR(E{r}/D{r},"")',  format: '0.0%',    width: 105},
  {col: 'N', header: 'プロフ表示率\n(プロフ÷リーチ)',  formula: '=IFERROR(F{r}/E{r},"")',  format: '0.0%',    width: 115},
  {col: 'O', header: 'リンククリック率\n(クリック÷プロフ)', formula: '=IFERROR(G{r}/F{r},"")', format: '0.0%', width: 125},
  {col: 'P', header: 'LINE登録率\n(登録÷クリック)',    formula: '=IFERROR(H{r}/G{r},"")',  format: '0.0%',    width: 115},
  {col: 'Q', header: 'エントリー率\n(応募÷LINE登録)',  formula: '=IFERROR(I{r}/H{r},"")',  format: '0.0%',    width: 115},
  {col: 'R', header: '面接率\n(面接÷エントリー)',      formula: '=IFERROR(J{r}/I{r},"")',  format: '0.0%',    width: 110},
  {col: 'S', header: '採用率\n(採用÷面接)',            formula: '=IFERROR(K{r}/J{r},"")',  format: '0.0%',    width: 100},
  {col: 'T', header: '表示→採用率\n(採用÷表示回数)',   formula: '=IFERROR(K{r}/D{r},"")',  format: '0.000%',  width: 115},
  {col: 'U', header: '1採用あたり\n投稿数',            formula: '=IFERROR(C{r}/K{r},"")',  format: '#,##0.0', width: 100}
];

/**
 * 悪い／普通／良いの判定ライン。bad未満＝赤、bad〜good＝緑、good以上＝黄色。
 * もとはInstagramの一般値。他のチャネルでは水準が変わるので、
 * 実績が溜まったらチャネルの実態に合わせて書き換える。
 */
var BENCHMARKS = [
  {col: 'N', bad: 0.03,    good: 0.05,   labels: ['悪い 〜3%',      '普通 3〜5%',        '良い 5%〜']},
  {col: 'O', bad: 0.05,    good: 0.10,   labels: ['悪い 〜5%',      '普通 5〜10%',       '良い 10%〜']},
  {col: 'P', bad: 0.20,    good: 0.40,   labels: ['悪い 〜20%',     '普通 20〜40%',      '良い 40%〜']},
  {col: 'T', bad: 0.00005, good: 0.0002, labels: ['悪い 〜0.005%',  '普通 0.005〜0.02%', '良い 0.02%〜']}
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

var LAST_COL = 21;   // U列
var MIN_ROWS = 130;

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
 * 入力済みの数字を退避する。
 * 新しい形（月＋チャネル）と、Instagramだけだった古い形の両方を読む。
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

  if (isOld) {
    // 旧レイアウト（1月1行・Instagramのみ）。並び順で月に当てる。
    var seen = 0;
    for (var d = headRow + 1; d < values.length && seen < MONTHS.length; d++) {
      if (!/^\d+月$/.test(String(values[d][0]).trim())) { continue; }
      var old = values[d];
      // 旧: B投稿数 Cインプ Dリーチ Eプロフ Fタップ GLINE H面接 I採用 Jその他問合せ K採用その他
      var row = [old[1], old[2], old[3], old[4], old[5], old[6],
                 old[9], old[7], num_(old[8]) + num_(old[10])];
      if (row.some(function (v) { return v !== '' && v !== null; })) {
        saved[seen + '|' + CHANNELS[0]] = row;
      }
      seen++;
    }
    return saved;
  }

  // 新レイアウト。月ラベルはブロックの先頭行にしか入らないので持ち回る。
  var monthIndex = -1;
  var lastMonth = '';
  for (var i = headRow + 1; i < values.length; i++) {
    var label = String(values[i][0]).trim();
    var channel = String(values[i][1]).trim();
    if (/^\d+月$/.test(label) && label !== lastMonth) { monthIndex++; lastMonth = label; }
    if (monthIndex < 0 || !channel) { continue; }

    var body = values[i].slice(2, 2 + INPUT_COLUMNS.length);
    if (channel === TOTAL_LABEL) {
      var friends = values[i][11];
      if (friends !== '' && friends !== null) { saved[monthIndex + '|' + TOTAL_LABEL] = [friends]; }
      continue;
    }
    if (body.some(function (v) { return v !== '' && v !== null; })) {
      saved[monthIndex + '|' + channel] = body;
    }
  }
  return saved;
}

function num_(v) {
  return typeof v === 'number' ? v : 0;
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
    sheet.getRange(b.col + GUIDE_ROW).setRichTextValue(buildGuideText_(b.labels));
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
      sheet.getRange(r, 2).setValue(channel).setFontSize(10).setFontWeight('bold');
      var key = m + '|' + channel;
      if (saved[key]) {
        sheet.getRange(r, 3, 1, INPUT_COLUMNS.length).setValues([saved[key]]);
      }
      sheet.getRange(r, 3, 1, INPUT_COLUMNS.length).setNumberFormat('#,##0');
      writeCalcCells_(sheet, r);
      sheet.setRowHeight(r, 21);
    });

    // 合計行。チャネル行を足し上げる。
    sheet.getRange(total, 2).setValue(TOTAL_LABEL).setFontWeight('bold');
    INPUT_COLUMNS.forEach(function (c) {
      sheet.getRange(c.col + total)
        .setFormula('=SUM(' + c.col + first + ':' + c.col + (total - 1) + ')')
        .setNumberFormat('#,##0');
    });
    MONTH_COLUMNS.forEach(function (c) {
      var saved2 = saved[m + '|' + TOTAL_LABEL];
      if (saved2) { sheet.getRange(c.col + total).setValue(saved2[0]); }
      sheet.getRange(c.col + total).setNumberFormat('#,##0');
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
    sheet.getRange(c.col + row)
      .setFormula(c.formula.replace(/\{r\}/g, String(row)))
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
      var range = '$' + c.col + '$' + FIRST_ROW + ':$' + c.col + '$' + LAST_ROW;
      sheet.getRange(c.col + spec.row)
        .setFormula('=IFERROR(' + spec.fn + '(' + channelCol + ',"' + TOTAL_LABEL + '",' + range + '),0)')
        .setNumberFormat(spec.row === YEAR_TOTAL_ROW ? '#,##0' : '#,##0.0');
    });
    writeCalcCells_(sheet, spec.row);

    sheet.getRange(spec.row, 1, 1, LAST_COL)
      .setBackground(COLOR_TOTAL_BG).setFontWeight('bold')
      .setBorder(true, true, true, true, null, null, '#808080', SpreadsheetApp.BorderStyle.SOLID);
    sheet.setRowHeight(spec.row, 22);
  });

  // 友だち総数は積み上げないので、合計行は最後の月の値にする。
  MONTH_COLUMNS.forEach(function (c) {
    sheet.getRange(c.col + YEAR_TOTAL_ROW)
      .setFormula('=IFERROR(LOOKUP(2,1/(' + c.col + FIRST_ROW + ':' + c.col + LAST_ROW + '<>""),'
        + c.col + FIRST_ROW + ':' + c.col + LAST_ROW + '),0)');
  });
}

/** 4つの率を 悪い＝赤 / 普通＝緑 / 良い＝黄色 で色分けする。 */
function applyConditionalFormats_(sheet) {
  var rules = [];
  BENCHMARKS.forEach(function (b) {
    var range = sheet.getRange(b.col + FIRST_ROW + ':' + b.col + YEAR_AVG_ROW);
    var cell = '$' + b.col + FIRST_ROW;
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
    ['月ごとにチャネルの行が並んでいます。C〜K列に数字を入れるだけ。合計行と率は自動です。'],
    ['LINE友だち総数（L列）は月全体の数字なので、合計行にだけ入れてください。'],
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
    ['1採用あたり投稿数', '1人採るのに何本投稿したか。チャネルの効率比較に使う']
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
