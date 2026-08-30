/**
 * Instagram採用 月次KPIシートの整形スクリプト。
 *
 * 使い方:
 *   1. KPIシートを開く
 *   2. 拡張機能 → Apps Script → このファイルの中身を貼り付けて保存
 *   3. 関数 setupKpiSheet を実行（初回のみ承認が必要）
 *
 * B〜K列に入力済みの数字は引き継がれる。
 */

var SHEET_NAME = '月次KPI';

var MONTHS = ['8月', '9月', '10月', '11月', '12月', '1月', '2月',
              '3月', '4月', '5月', '6月', '7月', '8月'];

var TITLE_ROW = 1;
var HEAD_ROW = 2;
var GUIDE_ROW = 3;   // 目安（悪い／普通／良い）
var FIRST_ROW = 4;
var LAST_ROW = FIRST_ROW + MONTHS.length - 1;   // 16
var TOTAL_ROW = LAST_ROW + 1;                   // 17
var AVG_ROW = LAST_ROW + 2;                     // 18

/** 手入力する列（B〜K）。 */
var INPUT_HEADERS = ['投稿数', 'インプレッション', 'リーチ数', 'プロフアクセス数',
                     'リンクタップ数', 'LINE登録', '面接', '採用数(LINE経由)',
                     'その他問い合わせ', '採用数(その他経由)'];

/**
 * 自動計算する列（L〜W）。
 * formula は行番号 {r} を差し込むテンプレート。
 */
var CALC_COLUMNS = [
  {col: 'L', header: '採用数 合計',                    formula: '=IFERROR(IF(COUNT(I{r}:K{r})=0,"",SUM(I{r},K{r})),"")', format: '#,##0',   width: 90},
  {col: 'M', header: '1投稿あたり\nインプ',            formula: '=IFERROR(C{r}/B{r},"")',                                format: '#,##0',   width: 105},
  {col: 'N', header: 'リーチ率\n(リーチ÷インプ)',      formula: '=IFERROR(D{r}/C{r},"")',                                format: '0.0%',    width: 110},
  {col: 'O', header: 'プロフアクセス率\n(プロフ÷リーチ)', formula: '=IFERROR(E{r}/D{r},"")',                             format: '0.0%',    width: 135},
  {col: 'P', header: 'リンクタップ率\n(タップ÷プロフ)', formula: '=IFERROR(F{r}/E{r},"")',                                format: '0.0%',    width: 135},
  {col: 'Q', header: 'LINE登録率\n(登録÷タップ)',      formula: '=IFERROR(G{r}/F{r},"")',                                format: '0.0%',    width: 135},
  {col: 'R', header: '面接率\n(面接÷LINE登録)',        formula: '=IFERROR(H{r}/G{r},"")',                                format: '0.0%',    width: 115},
  {col: 'S', header: '採用率\n(採用÷面接)',            formula: '=IFERROR(I{r}/H{r},"")',                                format: '0.0%',    width: 105},
  {col: 'T', header: 'LINE→採用率\n(採用÷LINE登録)',   formula: '=IFERROR(I{r}/G{r},"")',                                format: '0.0%',    width: 120},
  {col: 'U', header: 'その他採用率\n(採用÷その他問合せ)', formula: '=IFERROR(K{r}/J{r},"")',                              format: '0.0%',    width: 130},
  {col: 'V', header: 'リーチ→採用率\n(採用合計÷リーチ)', formula: '=IFERROR(L{r}/D{r},"")',                              format: '0.000%',  width: 135},
  {col: 'W', header: '1採用あたり\n投稿数',            formula: '=IFERROR(B{r}/L{r},"")',                                format: '#,##0.0', width: 105}
];

/**
 * 悪い／普通／良いの判定ライン。bad未満＝赤、bad〜good＝緑、good以上＝黄色。
 * label は目安行に出す文言。
 */
var BENCHMARKS = [
  {col: 'O', bad: 0.03,    good: 0.05,   labels: ['悪い 〜3%',      '普通 3〜5%',        '良い 5%〜']},
  {col: 'P', bad: 0.05,    good: 0.10,   labels: ['悪い 〜5%',      '普通 5〜10%',       '良い 10%〜']},
  {col: 'Q', bad: 0.20,    good: 0.40,   labels: ['悪い 〜20%',     '普通 20〜40%',      '良い 40%〜']},
  {col: 'V', bad: 0.00005, good: 0.0002, labels: ['悪い 〜0.005%',  '普通 0.005〜0.02%', '良い 0.02%〜']}
];

var BAD = {bg: '#f4cccc', fg: '#990000'};
var OK = {bg: '#d9ead3', fg: '#274e13'};
var GOOD = {bg: '#fff2cc', fg: '#7f6000'};

var COLOR_NAVY = '#1f3864';
var COLOR_INPUT = '#2e75b6';
var COLOR_CALC = '#548235';
var COLOR_CALC_BG = '#edf3e9';
var COLOR_SUM_BG = '#fff2cc';
var COLOR_MONTH_BG = '#f2f2f2';
var COLOR_BORDER = '#bfbfbf';

var LAST_COL = 23;   // W列

/** スプレッドシートを開いたときにメニューを出す。 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('KPIシート')
    .addItem('シートを整える（数式・色分けを入れ直す）', 'setupKpiSheet')
    .addToUi();
}

/** メインの処理。シートを作り直して数式・書式・色分けを入れる。 */
function setupKpiSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];

  var saved = readExistingInputs_(sheet);

  // 2回目以降の実行に備えて、固定と結合を先に解除しておく。
  // 固定列が残ったままタイトル行を結合しようとすると Google 側で弾かれる。
  sheet.setFrozenRows(0);
  sheet.setFrozenColumns(0);
  sheet.getDataRange().breakApart();

  sheet.clear();
  sheet.clearConditionalFormatRules();
  sheet.setName(SHEET_NAME);
  if (sheet.getMaxColumns() < LAST_COL) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), LAST_COL - sheet.getMaxColumns());
  }

  writeTitle_(sheet);
  writeHeaders_(sheet);
  writeGuideRow_(sheet);
  writeMonthRows_(sheet, saved);
  writeSummaryRows_(sheet);
  writeNotes_(sheet);
  applyConditionalFormats_(sheet);
  finishLayout_(sheet);

  SpreadsheetApp.getActive().toast('KPIシートを整えました。B〜K列に数字を入れてください。');
}

/** 既存シートのB〜K列の入力値を月ラベルごとに拾っておく。 */
function readExistingInputs_(sheet) {
  var saved = {};
  var values = sheet.getDataRange().getValues();

  for (var r = 0; r < values.length; r++) {
    if (String(values[r][0]).trim() !== '月' || String(values[r][1]).trim() !== '投稿数') {
      continue;
    }
    // 見出し行が見つかった。以降の「◯月」行を拾う。
    var seen = 0;
    for (var d = r + 1; d < values.length && seen < MONTHS.length; d++) {
      var label = String(values[d][0]).trim();
      if (!/^\d+月$/.test(label)) { continue; }
      var row = [];
      var hasValue = false;
      for (var c = 1; c <= 10; c++) {
        var v = values[d][c];
        row.push(v === '' || v === null ? '' : v);
        if (v !== '' && v !== null) { hasValue = true; }
      }
      if (hasValue) { saved[seen] = row; }
      seen++;
    }
    break;
  }
  return saved;
}

function writeTitle_(sheet) {
  var cell = sheet.getRange(TITLE_ROW, 1);
  cell.setValue('Instagram採用 月次KPI（青の見出し＝入力欄／緑の見出し＝自動計算）');
  sheet.getRange(TITLE_ROW, 1, 1, LAST_COL)
    .merge()
    .setBackground(COLOR_NAVY)
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setFontSize(12)
    .setVerticalAlignment('middle');
  sheet.setRowHeight(TITLE_ROW, 28);
}

function writeHeaders_(sheet) {
  var headers = ['月'].concat(INPUT_HEADERS);
  CALC_COLUMNS.forEach(function (c) { headers.push(c.header); });

  var range = sheet.getRange(HEAD_ROW, 1, 1, LAST_COL);
  range.setValues([headers])
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setFontSize(10)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(true);

  // A〜K列は入力欄（青）、L〜W列は自動計算（緑）。
  sheet.getRange(HEAD_ROW, 1, 1, 11).setBackground(COLOR_INPUT);
  sheet.getRange(HEAD_ROW, 12, 1, LAST_COL - 11).setBackground(COLOR_CALC);
  sheet.setRowHeight(HEAD_ROW, 50);
}

/** 見出しのすぐ下に、悪い／普通／良いの目安を色付きで書く。 */
function writeGuideRow_(sheet) {
  sheet.getRange(GUIDE_ROW, 1).setValue('目安');
  sheet.getRange(GUIDE_ROW, 1, 1, LAST_COL)
    .setBackground('#ffffff')
    .setFontSize(9)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(true)
    .setBorder(true, true, true, true, true, true, COLOR_BORDER, SpreadsheetApp.BorderStyle.SOLID);
  sheet.getRange(GUIDE_ROW, 1).setFontWeight('bold').setBackground(COLOR_MONTH_BG);

  BENCHMARKS.forEach(function (b) {
    sheet.getRange(b.col + GUIDE_ROW).setRichTextValue(buildGuideText_(b.labels));
  });
  sheet.setRowHeight(GUIDE_ROW, 34);
}

/** 「悪い〜3% / 普通 3〜5% / 良い 5%〜」を1セル内で3色に塗り分ける。 */
function buildGuideText_(labels) {
  var sep = ' / ';
  var text = labels.join(sep);
  var builder = SpreadsheetApp.newRichTextValue().setText(text);
  var colors = [BAD.fg, OK.fg, GOOD.fg];
  var pos = 0;

  for (var i = 0; i < labels.length; i++) {
    var style = SpreadsheetApp.newTextStyle()
      .setForegroundColor(colors[i])
      .setBold(true)
      .build();
    builder.setTextStyle(pos, pos + labels[i].length, style);
    pos += labels[i].length + sep.length;
  }
  return builder.build();
}

function writeMonthRows_(sheet, saved) {
  for (var i = 0; i < MONTHS.length; i++) {
    var row = FIRST_ROW + i;

    sheet.getRange(row, 1)
      .setValue(MONTHS[i])
      .setBackground(COLOR_MONTH_BG)
      .setFontWeight('bold')
      .setHorizontalAlignment('center');

    if (saved[i]) {
      sheet.getRange(row, 2, 1, 10).setValues([saved[i]]);
    }
    sheet.getRange(row, 2, 1, 10).setNumberFormat('#,##0');

    writeCalcCells_(sheet, row);
    sheet.getRange(row, 12, 1, LAST_COL - 11).setBackground(COLOR_CALC_BG);
    sheet.setRowHeight(row, 22);
  }
}

/** L〜W列に数式と表示形式を入れる。 */
function writeCalcCells_(sheet, row) {
  CALC_COLUMNS.forEach(function (c) {
    var cell = sheet.getRange(c.col + row);
    cell.setFormula(c.formula.replace(/\{r\}/g, String(row)));
    cell.setNumberFormat(c.format);
    cell.setHorizontalAlignment('right');
  });
}

/** 合計行と平均行。実数は合計/平均、率は合計値どうしで割り直す。 */
function writeSummaryRows_(sheet) {
  var rows = [
    {row: TOTAL_ROW, label: '合計', fn: 'SUM', format: '#,##0'},
    {row: AVG_ROW, label: '平均', fn: 'AVERAGE', format: '#,##0.0'}
  ];

  rows.forEach(function (spec) {
    sheet.getRange(spec.row, 1).setValue(spec.label).setHorizontalAlignment('center');

    for (var c = 2; c <= 11; c++) {
      var letter = columnLetter_(c);
      var ref = letter + FIRST_ROW + ':' + letter + LAST_ROW;
      sheet.getRange(spec.row, c)
        .setFormula('=IFERROR(IF(COUNT(' + ref + ')=0,"",' + spec.fn + '(' + ref + ')),"")')
        .setNumberFormat(spec.format)
        .setHorizontalAlignment('right');
    }
    writeCalcCells_(sheet, spec.row);

    sheet.getRange(spec.row, 1, 1, LAST_COL)
      .setBackground(COLOR_SUM_BG)
      .setFontWeight('bold');
    sheet.setRowHeight(spec.row, 22);
  });

  sheet.getRange(TOTAL_ROW, 1, 1, LAST_COL)
    .setBorder(true, null, null, null, null, null, '#808080', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
}

/** 4つの率に、悪い＝赤／普通＝緑／良い＝黄色の条件付き書式を入れる。 */
function applyConditionalFormats_(sheet) {
  var rules = [];
  var top = FIRST_ROW;

  BENCHMARKS.forEach(function (b) {
    var range = sheet.getRange(b.col + top + ':' + b.col + AVG_ROW);
    var cell = '$' + b.col + top;
    // 空欄を赤くしないよう ISNUMBER で必ず絞る。
    var tiers = [
      {cond: 'AND(ISNUMBER(' + cell + '),' + cell + '<' + b.bad + ')', color: BAD},
      {cond: 'AND(ISNUMBER(' + cell + '),' + cell + '>=' + b.bad + ',' + cell + '<' + b.good + ')', color: OK},
      {cond: 'AND(ISNUMBER(' + cell + '),' + cell + '>=' + b.good + ')', color: GOOD}
    ];

    tiers.forEach(function (t) {
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=' + t.cond)
        .setBackground(t.color.bg)
        .setFontColor(t.color.fg)
        .setBold(true)
        .setRanges([range])
        .build());
    });
  });

  sheet.setConditionalFormatRules(rules);
}

function writeNotes_(sheet) {
  var start = AVG_ROW + 2;
  var notes = [
    ['■ 使い方'],
    ['B列〜K列（投稿数〜採用数(その他経由)）に毎月の数字を入れるだけ。L列から右は自動計算なので触らない。'],
    ['数字が入っていない月は空欄のまま（エラー表示は出ません）。'],
    [''],
    ['■ 色分けの意味（プロフアクセス率／リンクタップ率／LINE登録率／リーチ→採用率）'],
    ['赤＝悪い（テコ入れが必要）　緑＝普通（一般的な水準）　黄色＝良い（伸びている）'],
    [''],
    ['■ 目安の根拠'],
    ['プロフアクセス率 3〜5%', 'Instagram運用の一般的な目標値。3%未満は投稿がプロフィールまで引っ張れていない'],
    ['リンクタップ率 5〜10%', '10%が分岐点。10%を超えていればプロフィール文とハイライトが機能している'],
    ['LINE登録率 20〜40%', 'LINE友だち追加のCVR一般値。特典と導線が強いと50%超も出る'],
    ['リーチ→採用率 0.005〜0.02%', '公開ベンチマークがないため上の3つ＋面接率・採用率から逆算した値。自社の実績が溜まったら書き換える'],
    [''],
    ['■ 指標の意味'],
    ['採用数 合計', '採用数(LINE経由) ＋ 採用数(その他経由)'],
    ['1投稿あたりインプ', 'インプレッション ÷ 投稿数。投稿1本の平均パワー'],
    ['リーチ率', 'リーチ数 ÷ インプレッション。低いと同じ人に何度も表示されている'],
    ['プロフアクセス率', 'プロフアクセス数 ÷ リーチ数。投稿→プロフの興味喚起力'],
    ['リンクタップ率', 'リンクタップ数 ÷ プロフアクセス数。プロフ文とハイライトの出来'],
    ['LINE登録率', 'LINE登録 ÷ リンクタップ数。LP・登録導線の出来'],
    ['面接率', '面接 ÷ LINE登録。LINE内トークの出来'],
    ['採用率', '採用数(LINE経由) ÷ 面接。面接の見極め・訴求力'],
    ['LINE→採用率', '採用数(LINE経由) ÷ LINE登録。LINE1件あたりの価値'],
    ['その他採用率', '採用数(その他経由) ÷ その他問い合わせ'],
    ['リーチ→採用率', '採用数 合計 ÷ リーチ数。全体の最終CVR'],
    ['1採用あたり投稿数', '投稿数 ÷ 採用数 合計。1人採るのに必要な投稿本数']
  ];

  for (var i = 0; i < notes.length; i++) {
    sheet.getRange(start + i, 1).setValue(notes[i][0]).setFontWeight(
      notes[i][0].indexOf('■') === 0 ? 'bold' : 'normal');
    if (notes[i].length > 1) {
      sheet.getRange(start + i, 2).setValue(notes[i][1]);
    }
  }
}

function finishLayout_(sheet) {
  sheet.setColumnWidth(1, 60);
  var inputWidths = [70, 120, 90, 120, 115, 90, 60, 120, 120, 130];
  for (var i = 0; i < inputWidths.length; i++) {
    sheet.setColumnWidth(2 + i, inputWidths[i]);
  }
  CALC_COLUMNS.forEach(function (c, i) {
    sheet.setColumnWidth(12 + i, c.width);
  });

  sheet.getRange(HEAD_ROW, 1, AVG_ROW - HEAD_ROW + 1, LAST_COL)
    .setBorder(true, true, true, true, true, true, COLOR_BORDER, SpreadsheetApp.BorderStyle.SOLID);

  sheet.setFrozenRows(GUIDE_ROW);
  sheet.setFrozenColumns(1);
}

function columnLetter_(index) {
  var letter = '';
  while (index > 0) {
    var rem = (index - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    index = Math.floor((index - 1) / 26);
  }
  return letter;
}
