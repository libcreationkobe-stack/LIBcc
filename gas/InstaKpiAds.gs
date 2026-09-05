/**
 * 広告タブ。CPC・CPMなど広告の中でしか使わない数字をここに集める。
 *
 * オーガニックのファネルとは物差しが違うため、月次KPIとは表を分けている。
 * 入力はこのタブだけ。月次KPIの広告チャネル行は、ここから数式で引く。
 *
 * InstaKpiSheet.gs と同じプロジェクトに置くこと（定数を共有している）。
 */

var AD_SHEET_NAME = '広告';

var AD_TITLE_ROW = 1;
var AD_TARGET_CPA_ROW = 3;      // 目標 採用単価（上限）
var AD_TARGET_CPL_ROW = 4;      // 目標 LINE登録単価（上限）
var AD_HEAD_ROW = 6;
var AD_FIRST_ROW = 7;
/*
 * 行数はチャネル定義（InstaKpiSheet.gs）に合わせて決まる。
 * ファイルの読み込み順に左右されないよう、定数ではなく関数で持つ。
 */
function adRowsPerMonth_() { return PAID_CHANNELS.length + 1; }   // 媒体行＋合計行
function adLastRow_() { return AD_FIRST_ROW + MONTHS.length * adRowsPerMonth_() - 1; }
function adYearTotalRow_() { return adLastRow_() + 2; }
function adYearAvgRow_() { return adLastRow_() + 3; }

/** 広告管理画面から転記する数字。 */
var AD_INPUT_COLUMNS = [
  {key: '広告費',           header: '広告費',           width: 95, money: true},
  {key: 'インプレッション', header: 'インプレッション', width: 110},
  {key: 'リーチ',           header: 'リーチ',           width: 95},
  {key: 'クリック',         header: 'クリック',         width: 85},
  {key: 'LINE友だち追加',   header: 'LINE友だち追加',   width: 105},
  {key: 'エントリー数',     header: 'エントリー数',     width: 95},
  {key: '面接',             header: '面接',             width: 60},
  {key: '採用数',           header: '採用数',           width: 70}
];

/** 広告の効率。すべて自動計算。 */
var AD_CALC_COLUMNS = [
  {key: 'CPM',            header: 'CPM\n(1000回表示の単価)',
   formula: '=IFERROR({広告費}{r}/{インプレッション}{r}*1000,"")', format: '¥#,##0', width: 110},
  {key: 'CPC',            header: 'CPC\n(1クリックの単価)',
   formula: '=IFERROR({広告費}{r}/{クリック}{r},"")', format: '¥#,##0', width: 105},
  {key: 'CTR',            header: 'CTR\n(クリック÷表示)',
   formula: '=IFERROR({クリック}{r}/{インプレッション}{r},"")', format: '0.00%', width: 105},
  {key: 'フリークエンシー', header: 'フリークエンシー\n(表示÷リーチ)',
   formula: '=IFERROR({インプレッション}{r}/{リーチ}{r},"")', format: '0.00"回"', width: 115},
  {key: 'リーチ単価',     header: 'リーチ単価\n(広告費÷リーチ)',
   formula: '=IFERROR({広告費}{r}/{リーチ}{r},"")', format: '¥#,##0.0', width: 105},
  {key: 'LINE登録率',     header: 'LINE登録率\n(登録÷クリック)',
   formula: '=IFERROR({LINE友だち追加}{r}/{クリック}{r},"")', format: '0.0%', width: 110},
  {key: 'LINE登録単価',   header: 'LINE登録単価\n(CPA)',
   formula: '=IFERROR({広告費}{r}/{LINE友だち追加}{r},"")', format: '¥#,##0', width: 110},
  {key: 'エントリー単価', header: 'エントリー単価\n(CPA)',
   formula: '=IFERROR({広告費}{r}/{エントリー数}{r},"")', format: '¥#,##0', width: 110},
  {key: '採用単価',       header: '採用単価\n(CPA)',
   formula: '=IFERROR({広告費}{r}/{採用数}{r},"")', format: '¥#,##0', width: 105}
];

var AD_ALL_COLUMNS = AD_INPUT_COLUMNS.concat(AD_CALC_COLUMNS);
var AD_LAST_COL = 2 + AD_ALL_COLUMNS.length;

var AD_COL_ = null;

function adColMap_() {
  if (!AD_COL_) {
    AD_COL_ = {};
    AD_ALL_COLUMNS.forEach(function (c, i) { AD_COL_[c.key] = columnLetter_(3 + i); });
  }
  return AD_COL_;
}

function adCol_(key) {
  var map = adColMap_();
  if (!map[key]) { throw new Error('広告タブに「' + key + '」の列がありません。'); }
  return map[key];
}

function resolveAdFormula_(template, row) {
  return template.replace(/\{([^}]+)\}/g, function (whole, name) {
    return name === 'r' ? String(row) : adCol_(name);
  });
}

/**
 * 月次KPIの指標名 → 広告タブの指標名。
 * ここに載っている項目は、月次KPIの広告チャネル行へ自動で流れる。
 */
var AD_TO_KPI = {
  '広告費': '広告費',
  '表示回数': 'インプレッション',
  'リーチ数': 'リーチ',
  'リンククリック': 'クリック',
  'LINE友だち追加': 'LINE友だち追加',
  'エントリー数': 'エントリー数',
  '面接': '面接',
  '採用数': '採用数'
};

/** その月・その媒体の行が広告タブの何行目か。 */
function adRow_(monthIndex, platformIndex) {
  return AD_FIRST_ROW + monthIndex * adRowsPerMonth_() + platformIndex;
}

/**
 * 月次KPIの広告チャネル行から広告タブを参照する数式。
 * 対応する項目が無ければ null を返す（その項目は手入力のまま）。
 */
function adPullFormula_(kpiKey, channel, monthIndex) {
  var adKey = AD_TO_KPI[kpiKey];
  var platformIndex = PAID_CHANNELS.indexOf(channel);
  if (!adKey || platformIndex < 0) { return null; }
  // 空欄をそのまま引くと0になる。入れていない月は空のままにする。
  var ref = "'" + AD_SHEET_NAME + "'!" + adCol_(adKey) + adRow_(monthIndex, platformIndex);
  return '=IF(' + ref + '="","",' + ref + ')';
}

/* ---------------- 組み立て ---------------- */

function buildAdSheet_(ss) {
  var saved = readAdInputs_(ss);
  var targets = readAdTargets_(ss);

  var sheet = ss.getSheetByName(AD_SHEET_NAME) || ss.insertSheet(AD_SHEET_NAME);
  removeFilter_(sheet);
  sheet.setFrozenRows(0);
  sheet.setFrozenColumns(0);
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).breakApart();
  sheet.clear();
  sheet.clearConditionalFormatRules();

  if (sheet.getMaxColumns() < AD_LAST_COL) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), AD_LAST_COL - sheet.getMaxColumns());
  }
  if (sheet.getMaxRows() < adYearAvgRow_() + 20) {
    sheet.insertRowsAfter(sheet.getMaxRows(), adYearAvgRow_() + 20 - sheet.getMaxRows());
  }

  writeAdTitle_(sheet);
  writeAdTargets_(sheet, targets);
  writeAdHeaders_(sheet);
  writeAdMonthBlocks_(sheet, saved);
  writeAdYearRows_(sheet);
  writeAdNotes_(sheet);
  applyAdConditionalFormats_(sheet);

  sheet.setColumnWidth(1, 60);
  sheet.setColumnWidth(2, 130);
  AD_ALL_COLUMNS.forEach(function (c, i) { sheet.setColumnWidth(3 + i, c.width); });
  sheet.getRange(AD_HEAD_ROW, 1, adYearAvgRow_() - AD_HEAD_ROW + 1, AD_LAST_COL)
    .setBorder(true, true, true, true, true, true, COLOR_BORDER, SpreadsheetApp.BorderStyle.SOLID);
  sheet.setFrozenRows(AD_HEAD_ROW);
  sheet.setFrozenColumns(2);
  return sheet;
}

function writeAdTitle_(sheet) {
  // 左2列は固定するので結合は3列目から。
  sheet.getRange(AD_TITLE_ROW, 3).setValue(
    '広告（青の見出し＝管理画面から転記／緑の見出し＝自動計算）');
  sheet.getRange(AD_TITLE_ROW, 3, 1, AD_LAST_COL - 2).merge();
  sheet.getRange(AD_TITLE_ROW, 1, 1, AD_LAST_COL)
    .setBackground(COLOR_NAVY).setFontColor('#ffffff')
    .setFontWeight('bold').setFontSize(12).setVerticalAlignment('middle');
  sheet.setRowHeight(AD_TITLE_ROW, 28);
}

/** 許容できる単価の上限。これを超えた月が赤くなる。 */
function writeAdTargets_(sheet, targets) {
  [[AD_TARGET_CPA_ROW, '目標 採用単価（上限）', targets.cpa,
    '1人採るのにいくらまで出せるか。ここを超えた月は赤くなります'],
   [AD_TARGET_CPL_ROW, '目標 LINE登録単価（上限）', targets.cpl,
    '採用が出る前に広告の良し悪しを判断するための線']].forEach(function (t) {
    sheet.getRange(t[0], 1, 1, 2).merge().setValue(t[1])
      .setFontWeight('bold').setFontSize(10).setVerticalAlignment('middle');
    sheet.getRange(t[0], 3).setValue(t[2]).setNumberFormat('¥#,##0')
      .setBackground(COLOR_SETTING_BG).setHorizontalAlignment('right')
      .setBorder(true, true, true, true, false, false, COLOR_BORDER, SpreadsheetApp.BorderStyle.SOLID);
    sheet.getRange(t[0], 4, 1, 6).merge().setValue(t[3])
      .setFontSize(9).setFontColor('#595959');
    sheet.setRowHeight(t[0], 22);
  });
}

function readAdTargets_(ss) {
  var sheet = ss.getSheetByName(AD_SHEET_NAME);
  if (!sheet) { return {cpa: 0, cpl: 0}; }
  return {
    cpa: sheet.getRange(AD_TARGET_CPA_ROW, 3).getValue() || 0,
    cpl: sheet.getRange(AD_TARGET_CPL_ROW, 3).getValue() || 0
  };
}

function writeAdHeaders_(sheet) {
  var headers = ['月', '媒体'];
  AD_ALL_COLUMNS.forEach(function (c) { headers.push(c.header); });

  sheet.getRange(AD_HEAD_ROW, 1, 1, AD_LAST_COL).setValues([headers])
    .setFontColor('#ffffff').setFontWeight('bold').setFontSize(9)
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);

  var inputEnd = 2 + AD_INPUT_COLUMNS.length;
  sheet.getRange(AD_HEAD_ROW, 1, 1, inputEnd).setBackground(COLOR_INPUT);
  sheet.getRange(AD_HEAD_ROW, inputEnd + 1, 1, AD_LAST_COL - inputEnd).setBackground(COLOR_CALC);
  sheet.setRowHeight(AD_HEAD_ROW, 44);
}

function writeAdMonthBlocks_(sheet, saved) {
  for (var m = 0; m < MONTHS.length; m++) {
    var first = adRow_(m, 0);
    var total = first + PAID_CHANNELS.length;

    sheet.getRange(first, 1, adRowsPerMonth_(), 1).merge()
      .setValue(MONTHS[m]).setBackground(COLOR_MONTH_BG)
      .setFontWeight('bold').setFontSize(11)
      .setHorizontalAlignment('center').setVerticalAlignment('middle');

    PAID_CHANNELS.forEach(function (platform, i) {
      var r = first + i;
      sheet.getRange(r, 2).setValue(platform).setFontSize(10).setFontWeight('bold');
      var body = saved[m + '|' + platform] || {};
      AD_INPUT_COLUMNS.forEach(function (c) {
        var cell = sheet.getRange(adCol_(c.key) + r);
        if (body.hasOwnProperty(c.key)) { cell.setValue(body[c.key]); }
        cell.setNumberFormat(hideZero_(c.money ? '¥#,##0' : '#,##0'));
      });
      writeAdCalcCells_(sheet, r);
      sheet.setRowHeight(r, 21);
    });

    sheet.getRange(total, 2).setValue(TOTAL_LABEL).setFontWeight('bold');
    AD_INPUT_COLUMNS.forEach(function (c) {
      var letter = adCol_(c.key);
      sheet.getRange(letter + total)
        .setFormula('=SUM(' + letter + first + ':' + letter + (total - 1) + ')')
        .setNumberFormat(hideZero_(c.money ? '¥#,##0' : '#,##0'));
    });
    writeAdCalcCells_(sheet, total);
    sheet.getRange(total, 2, 1, AD_LAST_COL - 1)
      .setBackground(COLOR_TOTAL_BG).setFontWeight('bold');
    sheet.setRowHeight(total, 22);

    sheet.getRange(first, 1, adRowsPerMonth_(), AD_LAST_COL)
      .setBorder(true, true, true, true, null, null, '#808080', SpreadsheetApp.BorderStyle.SOLID);
  }
}

function writeAdCalcCells_(sheet, row) {
  AD_CALC_COLUMNS.forEach(function (c) {
    sheet.getRange(adCol_(c.key) + row)
      .setFormula(resolveAdFormula_(c.formula, row))
      .setNumberFormat(c.format)
      .setHorizontalAlignment('right')
      .setBackground(COLOR_CALC_BG);
  });
}

function writeAdYearRows_(sheet) {
  var platformCol = '$B$' + AD_FIRST_ROW + ':$B$' + adLastRow_();

  [{row: adYearTotalRow_(), label: '年間合計', fn: 'SUMIF'},
   {row: adYearAvgRow_(), label: '月平均', fn: 'AVERAGEIF'}].forEach(function (spec) {
    sheet.getRange(spec.row, 1, 1, 2).merge().setValue(spec.label)
      .setFontWeight('bold').setHorizontalAlignment('center');

    AD_INPUT_COLUMNS.forEach(function (c) {
      var letter = adCol_(c.key);
      var range = '$' + letter + '$' + AD_FIRST_ROW + ':$' + letter + '$' + adLastRow_();
      sheet.getRange(letter + spec.row)
        .setFormula('=IFERROR(' + spec.fn + '(' + platformCol + ',"' + TOTAL_LABEL + '",' + range + '),0)')
        .setNumberFormat(c.money ? '¥#,##0' : '#,##0');
    });
    writeAdCalcCells_(sheet, spec.row);

    sheet.getRange(spec.row, 1, 1, AD_LAST_COL)
      .setBackground(COLOR_TOTAL_BG).setFontWeight('bold')
      .setBorder(true, true, true, true, null, null, '#808080', SpreadsheetApp.BorderStyle.SOLID);
    sheet.setRowHeight(spec.row, 22);
  });
}

/** 目標の単価を超えたら赤、収まっていれば緑。目標が空なら色を付けない。 */
function applyAdConditionalFormats_(sheet) {
  var rules = [];
  [['採用単価', '$C$' + AD_TARGET_CPA_ROW],
   ['LINE登録単価', '$C$' + AD_TARGET_CPL_ROW]].forEach(function (pair) {
    var letter = adCol_(pair[0]);
    var target = pair[1];
    var range = sheet.getRange(letter + AD_FIRST_ROW + ':' + letter + adYearAvgRow_());
    var cell = '$' + letter + AD_FIRST_ROW;

    [['>' + target, BAD], ['<=' + target, OK]].forEach(function (t) {
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=AND(ISNUMBER(' + cell + '),' + target + '>0,' + cell + t[0] + ')')
        .setBackground(t[1].bg).setFontColor(t[1].fg).setBold(true)
        .setRanges([range]).build());
    });
  });
  sheet.setConditionalFormatRules(rules);
}

function writeAdNotes_(sheet) {
  var start = adYearAvgRow_() + 2;
  var notes = [
    ['■ 使い方'],
    ['広告管理画面の数字を、青い見出しの欄に転記するだけ。CPCなどは自動で出ます。'],
    ['ここに入れた数字は「月次KPI」の広告チャネル行に自動で流れます。あちらに入れ直す必要はありません。'],
    ['上の目標単価を入れると、超えた月が赤く、収まった月が緑になります。'],
    [''],
    ['■ 指標の意味'],
    ['CPM', '1000回表示するのにかかった額。表示の買値。クリエイティブと配信面で変わる'],
    ['CPC', '1クリックの単価。CPMとCTRの両方で決まる。CPMが同じならCTRが高いほど安くなる'],
    ['CTR', 'クリック ÷ 表示。クリエイティブと訴求の当たり外れが一番はっきり出る'],
    ['フリークエンシー', '1人あたり何回見せたか。3回を超えたあたりから効きが落ち、CPCが上がりはじめる'],
    ['リーチ単価', '1人に届けるのにかかった額。認知目的のときはここを見る'],
    ['LINE登録単価', '広告費 ÷ LINE友だち追加。採用が出る前に良し悪しが分かる。'
     + 'LINE友だち追加広告(CPF)の相場は1件100〜150円。オーガニックを含めた全体でここを下回れば健全'],
    ['採用単価', '広告費 ÷ 採用数。続けるか止めるかの最終判断はここ'],
    [''],
    ['■ 見るときの順番'],
    ['採用単価が高いとき、原因は3つのどれか。上から順に見ると早い。'],
    ['① CTRが低い', 'クリエイティブか訴求が合っていない。まず差し替える'],
    ['② CPMが高い', '狙いが狭すぎるか、競合が多い時期。ターゲットか配信面を広げる'],
    ['③ LINE登録率が低い', '広告は機能している。落ちているのはリンク先。LPを直す'],
    [''],
    ['フリークエンシーが3回を超えていたら、上の3つより先に配信対象を広げること。'],
    ['同じ人に何度も見せている状態では、何を変えても数字は戻りません。']
  ];

  notes.forEach(function (n, i) {
    var r = start + i;
    sheet.getRange(r, 1, 1, 2).merge().setValue(n[0])
      .setFontWeight(n[0].indexOf('■') === 0 ? 'bold' : 'normal').setFontSize(10);
    if (n.length > 1) {
      sheet.getRange(r, 3, 1, 7).merge().setValue(n[1])
        .setFontSize(9).setFontColor('#595959').setWrap(true);
    }
  });
}

/** 作り直す前に、転記済みの数字を退避する。 */
function readAdInputs_(ss) {
  var sheet = ss.getSheetByName(AD_SHEET_NAME);
  var saved = {};
  if (!sheet) { return saved; }

  var values = sheet.getDataRange().getValues();
  var headRow = -1;
  for (var r = 0; r < values.length; r++) {
    if (String(values[r][0]).trim() === '月' && String(values[r][1]).trim() === '媒体') {
      headRow = r;
      break;
    }
  }
  if (headRow < 0) { return saved; }

  var byHeader = {};
  AD_ALL_COLUMNS.forEach(function (c) { byHeader[c.header] = c.key; });
  var colKey = {};
  values[headRow].forEach(function (h, i) {
    var key = byHeader[String(h)];
    if (key) { colKey[i] = key; }
  });

  var monthIndex = -1;
  var lastMonth = '';
  for (var i = headRow + 1; i < values.length; i++) {
    var label = String(values[i][0]).trim();
    var platform = String(values[i][1]).trim();
    if (/^\d+月$/.test(label) && label !== lastMonth) { monthIndex++; lastMonth = label; }
    if (monthIndex < 0 || !platform || platform === TOTAL_LABEL) { continue; }

    var body = {};
    var has = false;
    Object.keys(colKey).forEach(function (idx) {
      var v = values[i][idx];
      if (typeof v !== 'number') { return; }
      body[colKey[idx]] = v;
      has = true;
    });
    if (has) { saved[monthIndex + '|' + platform] = body; }
  }
  return saved;
}
