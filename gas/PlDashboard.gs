/**
 * LIB経営管理シートに、経営判断用のタブを足すスクリプト。
 *
 * 既存のPL入力表には一切手を触れない。ラベルを頼りに値を引くので、
 * 行を足しても列を足しても壊れない。
 *
 * 使い方:
 *   拡張機能 → Apps Script にこのファイルを貼り、setupManagementSheets を実行。
 *   以降はメニュー「経営管理」から。
 *
 * ※ 税額はすべて資金繰りのための概算。申告額そのものではないので、
 *   実際の申告・納付額は顧問税理士に確認すること。
 */

var SHEET_CONFIG = '設定';
var SHEET_DASH = 'ダッシュボード';
var SHEET_CASH = '資金繰り予測';
var SHEET_TAX = '納税カレンダー';
var SHEET_PAY = '支払い予定';
var SHEET_DAILY = '月内の資金繰り';

var C_NAVY = '#1f3864';
var C_HEAD = '#3e63a3';
var C_INPUT = '#eaf1fb';   // 入力してほしいセル
var C_CALC = '#f5f5f3';    // 自動計算
var C_INK = '#303030';
var C_SUB = '#595959';
var C_RULE = '#d9d9d9';
var C_OK = '#dcf0dc';
var C_WARN = '#fdeecd';
var C_BAD = '#f7dede';
var C_INK_OK = '#0b6b0b';
var C_INK_WARN = '#8a6100';
var C_INK_BAD = '#8f2020';

var YEN = '¥#,##0;[Red]-¥#,##0';
var PCT = '0.0%';

/** 設定タブの項目。key で参照する。 */
var CONFIG_ITEMS = [
  ['section', '会社の基本'],
  ['closingMonth', '決算月', 11, '事業年度の最終月。11なら12月〜11月が事業年度。'],
  ['cashOnHand', '現在の預金残高', 0, '資金繰り予測の起点。手元の全口座の合計。'],
  ['cashAsOf', '残高の基準日', '', '上の残高がいつ時点かを入れる（例 2026/09/01）。'
    + 'その月の月初残高として扱い、ここから先の月を積み上げます。'],

  ['section', '目標と安全ライン'],
  ['targetMargin', '目標利益率', 0.30, '利益 ÷ 売上。これを下回ると警告を出す。'],
  ['safetyMonths', '安全在庫（月数）', 3, '直近3ヶ月の平均支払額の何ヶ月分を手元に残したいか。'],

  ['section', '法人税等（年間概算に使う税率）'],
  ['ctLowRate', '法人税率（所得800万円以下）', 0.15, '中小法人の軽減税率。'],
  ['ctHighRate', '法人税率（800万円超）', 0.232, ''],
  ['ctBracket', '軽減税率の上限所得', 8000000, ''],
  ['localCtRate', '地方法人税率', 0.103, '法人税額に対してかかる。'],
  ['residentRate', '住民税 法人税割', 0.070, '法人税額に対して。都道府県＋市町村の標準税率。'],
  ['perCapita', '住民税 均等割（年額）', 70000, '赤字でも必ずかかる。資本金1000万円以下・従業員50人以下の目安。'],
  ['bizRate1', '事業税率（所得400万円以下）', 0.035, ''],
  ['bizRate2', '事業税率（400〜800万円）', 0.053, ''],
  ['bizRate3', '事業税率（800万円超）', 0.070, ''],
  ['specialBizRate', '特別法人事業税率', 0.37, '事業税額に対してかかる。'],

  ['section', '消費税'],
  ['taxableFrom', '課税事業者になる事業年度の開始', '2026/12/01', 'この日以降の売上から積み立てを始める。'],
  ['consumptionRate', '積立率（売上に対する）', 0.045, '簡易課税・第5種（サービス業／みなし仕入率50%）を想定した概算。'
    + ' 税込売上 × 10/110 × 50% ≒ 4.5%。区分が違うならここを変える。'],

  ['section', 'PL入力表の読み取り設定'],
  ['plSheet', 'PLシート名', '', '空なら「支払い合計」がある表を自動で探す。'],
  ['rowSales', '売上の行ラベル', '売り上げ', 'B列に書いてある文字と完全に一致させる。'],
  ['rowPaid', '支払合計の行ラベル', '支払い合計', '']
];

/** 納税カレンダーの中身。決算月から時期を計算する。 */
var TAX_EVENTS = [
  {name: '法人税・地方法人税', when: 'closing+2', detail: '確定申告と納付。決算日の翌日から2ヶ月以内。', kind: 'corp'},
  {name: '法人住民税・事業税', when: 'closing+2', detail: '同上。均等割はここに含まれ、赤字でもかかる。', kind: 'corp'},
  {name: '法人税等 中間納付', when: 'closing+8', detail: '前期の法人税が20万円を超えた年だけ。前期納税額の半分が目安。', kind: 'corpMid'},
  {name: '消費税 確定申告', when: 'closing+2', detail: '課税事業者になった事業年度から。', kind: 'consumption'},
  {name: '源泉所得税', when: 'monthly10', detail: '毎月10日。納期の特例を受けていれば7/10と1/20の年2回。', kind: 'fixed'},
  {name: '社会保険料', when: 'monthlyEnd', detail: '毎月末（前月分）。口座振替。', kind: 'fixed'},
  {name: '住民税（特別徴収）', when: 'monthly10', detail: '毎月10日。従業員の給与から預かった分。', kind: 'fixed'},
  {name: '労働保険料', when: 'july', detail: '年度更新。7月10日までに申告・納付（分割可）。', kind: 'fixed'}
];

/* ---------------- 入口 ---------------- */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('経営管理')
    .addItem('タブを作る／整え直す', 'setupManagementSheets')
    .addSeparator()
    .addItem('支払い予定の項目をPLから読み直す', 'refreshPaymentItems')
    .addToUi();
}

function setupManagementSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var pl = findPlSheet_(ss);
  if (!pl) {
    throw new Error('PLの入力表が見つかりません。B列に「支払い合計」がある表を用意するか、'
      + '設定タブの「PLシート名」に名前を入れてください。');
  }

  // 先に全タブの器を作る。参照先のタブが無い状態で数式を書くと、
  // Googleスプレッドシートがその参照を #REF! に固定してしまう。
  [SHEET_CONFIG, SHEET_CASH, SHEET_DASH, SHEET_TAX, SHEET_PAY, SHEET_DAILY].forEach(function (name) {
    if (!ss.getSheetByName(name)) { ss.insertSheet(name); }
  });

  // 参照される側から順に作る（設定 → 資金繰り → ダッシュボード → …）。
  buildConfigSheet_(ss, pl);
  buildCashFlow_(ss, pl);
  buildDashboard_(ss, pl);
  buildTaxCalendar_(ss);
  buildPaymentSheet_(ss, pl);
  buildDailyCash_(ss, pl);

  toast_('経営管理タブを整えました。まず「設定」を埋めてください。');
}

/* ---------------- PL表の読み取り ---------------- */

/** B列に支払合計ラベルがあるシートを探す。設定で指定があればそれを使う。 */
function findPlSheet_(ss) {
  var configured = getConfig_(ss, 'plSheet');
  if (configured) {
    var s = ss.getSheetByName(String(configured).trim());
    if (s) { return s; }
  }
  var paidLabel = String(getConfig_(ss, 'rowPaid') || '支払い合計').trim();

  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var name = sheets[i].getName();
    if ([SHEET_CONFIG, SHEET_DASH, SHEET_CASH, SHEET_TAX, SHEET_PAY].indexOf(name) >= 0) { continue; }
    var col = sheets[i].getRange(1, 2, Math.min(sheets[i].getMaxRows(), 200), 1).getValues();
    for (var r = 0; r < col.length; r++) {
      if (String(col[r][0]).trim() === paidLabel) { return sheets[i]; }
    }
  }
  return null;
}

/** PL表の1行目から「◯月」の列を拾う。 */
function readPlMonths_(pl) {
  var head = pl.getRange(1, 1, 1, Math.min(pl.getMaxColumns(), 60)).getValues()[0];
  var months = [];
  for (var c = 0; c < head.length; c++) {
    var v = String(head[c]).trim();
    if (/^\d{1,2}月$/.test(v)) { months.push(v); }
  }
  return months;
}

/**
 * PL表から値を引く数式。行はラベル、列は月名で探すので、
 * 行を挿入しても列を足しても壊れない。
 */
function plLookup_(plName, labelRef, monthRef) {
  var q = "'" + plName + "'!";
  return 'IFERROR(INDEX(' + q + '$A:$BZ,'
    + 'MATCH(' + labelRef + ',' + q + '$B:$B,0),'
    + 'MATCH(' + monthRef + ',' + q + '$1:$1,0)),0)';
}

/* ---------------- 設定タブ ---------------- */

function buildConfigSheet_(ss, pl) {
  // 消す前に読む。resetSheet_ のあとでは空のシートを読むことになる。
  var saved = readConfigValues_(ss);
  var sheet = resetSheet_(ss, SHEET_CONFIG);

  title_(sheet, '設定', '色のついたセルだけ埋めてください。ここを変えると全タブの計算が変わります。', 4);

  var row = 4;
  CONFIG_ITEMS.forEach(function (item) {
    if (item[0] === 'section') {
      sheet.getRange(row, 1, 1, 4).merge()
        .setValue(item[1])
        .setBackground(C_HEAD).setFontColor('#ffffff').setFontWeight('bold').setFontSize(10);
      sheet.setRowHeight(row, 24);
      row += 1;
      return;
    }

    var key = item[0];
    var value = saved.hasOwnProperty(key) ? saved[key] : item[2];
    if (key === 'plSheet' && !value) { value = pl.getName(); }

    sheet.getRange(row, 1).setValue(item[1]).setFontWeight('bold').setFontSize(10);
    if (configFormat_(key) === 'yyyy/mm/dd' && typeof value === 'string' && value) {
      value = new Date(value);
    }
    sheet.getRange(row, 2).setValue(value)
      .setBackground(C_INPUT)
      .setBorder(true, true, true, true, false, false, C_RULE, SpreadsheetApp.BorderStyle.SOLID)
      .setHorizontalAlignment('right')
      .setNumberFormat(configFormat_(key));
    sheet.getRange(row, 3).setValue(key).setFontColor('#b7b7b7').setFontSize(8);
    sheet.getRange(row, 4).setValue(item[3]).setFontSize(9).setFontColor(C_SUB).setWrap(true);
    sheet.setRowHeight(row, 22);
    row += 1;
  });

  sheet.getRange(row + 1, 2, 1, 3).merge()
    .setValue('※ ここで出る税額はすべて資金繰りのための概算です。実際の申告・納付額は顧問税理士に確認してください。')
    .setFontSize(9).setFontColor(C_INK_BAD).setWrap(true);

  sheet.setColumnWidth(1, 240);
  sheet.setColumnWidth(2, 130);
  sheet.setColumnWidth(3, 130);
  sheet.setColumnWidth(4, 420);
  sheet.setFrozenRows(3);
}

function configFormat_(key) {
  if (['targetMargin', 'ctLowRate', 'ctHighRate', 'localCtRate', 'residentRate',
       'bizRate1', 'bizRate2', 'bizRate3', 'specialBizRate', 'consumptionRate'].indexOf(key) >= 0) {
    return '0.0%';
  }
  if (['cashOnHand', 'perCapita', 'ctBracket'].indexOf(key) >= 0) { return YEN; }
  if (['cashAsOf', 'taxableFrom'].indexOf(key) >= 0) { return 'yyyy/mm/dd'; }
  if (['closingMonth', 'safetyMonths'].indexOf(key) >= 0) { return '0'; }
  return '@';
}

/** 設定タブの現在値を key => value で読む。 */
function readConfigValues_(ss) {
  var sheet = ss.getSheetByName(SHEET_CONFIG);
  var out = {};
  if (!sheet) { return out; }
  var values = sheet.getDataRange().getValues();
  values.forEach(function (r) {
    var key = String(r[2]).trim();
    if (key) { out[key] = r[1]; }
  });
  return out;
}

function getConfig_(ss, key) {
  var v = readConfigValues_(ss);
  return v.hasOwnProperty(key) ? v[key] : null;
}

/** 設定値を指す参照文字列。数式の中で使う。 */
function cfg_(key) {
  return "INDEX('" + SHEET_CONFIG + "'!$B:$B,MATCH(\"" + key + "\",'" + SHEET_CONFIG + "'!$C:$C,0))";
}

/* ---------------- 資金繰り予測 ---------------- */

/**
 * 12ヶ月の残高推移。黒字でも現金が尽きる月を先に見つけるための表。
 * 年間の着地見込みを上に置き、そこから月々の積立と納税予定を出す。
 */
function buildCashFlow_(ss, pl) {
  var sheet = resetSheet_(ss, SHEET_CASH);
  var plName = pl.getName();
  var closing = Number(getConfig_(ss, 'closingMonth')) || 11;
  var months = fiscalMonths_(closing);

  title_(sheet, '資金繰り予測',
    '黒字でも現金が尽きれば止まります。残高がマイナスになる月を先に見つけるための表です。', 10);

  var top = 4;    // 年間の見通しブロック
  var tableHead = 12;
  var first = 13;
  var last = first + months.length - 1;

  var salesCol = 'B', paidCol = 'C', opCol = 'D', taxCol = 'G', balCol = 'H';
  var salesRange = salesCol + first + ':' + salesCol + last;
  var opRange = opCol + first + ':' + opCol + last;
  var paidRange = paidCol + first + ':' + paidCol + last;

  var elapsed = 'MAX(COUNTIF(' + salesRange + ',">0"),0)';
  var annualProfit = '$B$' + (top + 4);
  var annualSales = '$B$' + (top + 3);

  section_(sheet, top - 1, '年間の見通し（実績のある月から年換算）', 10);
  var view = [
    ['経過月数（売上が入っている月）', '=' + elapsed, '0"ヶ月"'],
    ['累計売上', '=SUM(' + salesRange + ')', YEN],
    ['累計利益', '=SUM(' + opRange + ')', YEN],
    ['年間着地 売上', '=IF($B$' + (top + 0) + '=0,0,$B$' + (top + 1) + '/$B$' + (top + 0) + '*12)', YEN],
    ['年間着地 利益（＝概算の所得）', '=IF($B$' + (top + 0) + '=0,0,$B$' + (top + 2) + '/$B$' + (top + 0) + '*12)', YEN],
    ['法人税等 年間見込み', '=' + corporateTaxFormula_(annualProfit), YEN],
    ['消費税 年間見込み', '=IF(TODAY()>=' + cfg_('taxableFrom') + ',' + annualSales + '*' + cfg_('consumptionRate') + ',0)', YEN],
    ['安全ライン（平均の月間支払 × 安全月数）',
     '=IFERROR(AVERAGEIF(' + paidRange + ',">0")*' + cfg_('safetyMonths') + ',0)', YEN]
  ];
  view.forEach(function (v, i) {
    var r = top + i;
    sheet.getRange(r, 1).setValue(v[0]).setFontWeight('bold').setFontSize(10);
    sheet.getRange(r, 2).setFormula(v[1]).setNumberFormat(v[2])
      .setBackground(C_CALC).setHorizontalAlignment('right');
    sheet.setRowHeight(r, 21);
  });
  sheet.getRange(top + 5, 3).setValue('← 資金繰り用の概算。申告額は税理士に確認')
    .setFontSize(9).setFontColor(C_SUB);

  // 月次テーブル
  var headers = ['月', '売上', '支払', '営業収支', '法人税等 積立', '消費税 積立', '納税（予定）',
                 '月初残高', '月末残高', '判定'];
  tableHeader_(sheet, tableHead, headers);

  var corpAnnual = '$B$' + (top + 5);
  var consAnnual = '$B$' + (top + 6);
  var safety = '$B$' + (top + 7);
  var closeRef = cfg_('closingMonth');

  // 残高は「残高の基準日」の月から積み上げる。基準日が空なら期首から。
  var startMonth = 'IFERROR(MONTH(' + cfg_('cashAsOf') + ')&"月",$A$' + first + ')';

  months.forEach(function (m, i) {
    var r = first + i;

    sheet.getRange(r, 1).setValue(m).setFontWeight('bold').setHorizontalAlignment('center');
    sheet.getRange(r, 2).setFormula('=' + plLookup_(plName, cfg_('rowSales'), '$A' + r));
    sheet.getRange(r, 3).setFormula('=' + plLookup_(plName, cfg_('rowPaid'), '$A' + r));
    sheet.getRange(r, 4).setFormula('=B' + r + '-C' + r);
    sheet.getRange(r, 5).setFormula('=IF(B' + r + '=0,0,' + corpAnnual + '/12)');
    sheet.getRange(r, 6).setFormula('=IF(B' + r + '=0,0,' + consAnnual + '/12)');

    // 確定申告は決算月の2ヶ月後、中間は8ヶ月後。中間は前期税額20万円超の年だけ。
    sheet.getRange(r, 7).setFormula(
      '=IF(A' + r + '=(MOD(' + closeRef + '+2-1,12)+1&"月"),' + corpAnnual + '+' + consAnnual + ',0)'
      + '+IF(A' + r + '=(MOD(' + closeRef + '+8-1,12)+1&"月"),' + corpAnnual + '/2,0)');

    // 月初残高は、基準月なら入力値、それ以降は前月の月末残高を引き継ぐ。
    sheet.getRange(r, 8).setFormula(
      '=IF($A' + r + '=' + startMonth + ',' + cfg_('cashOnHand') + ','
      + (i === 0 ? '""' : 'IF(ISNUMBER(I' + (r - 1) + '),I' + (r - 1) + ',"")') + ')');
    sheet.getRange(r, 9).setFormula('=IF(ISNUMBER(H' + r + '),H' + r + '+D' + r + '-G' + r + ',"")');
    sheet.getRange(r, 10).setFormula(
      '=IF(NOT(ISNUMBER(I' + r + ')),"—",IF(I' + r + '<0,"危険：残高がマイナス",'
      + 'IF(I' + r + '<' + safety + ',"注意：安全ラインを下回る","良好")))');

    sheet.getRange(r, 2, 1, 8).setNumberFormat(YEN);
    sheet.getRange(r, 10).setHorizontalAlignment('center');
    sheet.setRowHeight(r, 22);
  });

  banding_(sheet, first, last, headers.length);
  statusRules_(sheet, 'J' + first + ':J' + last);
  sheet.getRange('I' + first + ':I' + last).setFontWeight('bold');

  sheet.getRange(last + 2, 2, 1, 9).merge().setValue(
    '※ 納税（予定）は決算月から逆算した概算です。中間納付は前期の法人税が20万円を超えた年だけ発生します。'
    + '消費税は設定の「課税事業者になる事業年度の開始」以降のみ積み立てます。')
    .setFontSize(9).setFontColor(C_SUB).setWrap(true);

  sheet.setColumnWidth(1, 70);
  for (var c = 2; c <= 9; c++) { sheet.setColumnWidth(c, 112); }
  sheet.setColumnWidth(10, 170);
  sheet.setFrozenRows(tableHead);
  sheet.setFrozenColumns(1);
}

/**
 * 年間所得から法人税等の合計を出す数式。
 * 法人税・地方法人税・住民税（法人税割＋均等割）・事業税・特別法人事業税の合計。
 * 赤字の年でも均等割はかかる。
 */
function corporateTaxFormula_(incomeRef) {
  var income = 'MAX(' + incomeRef + ',0)';
  var bracket = cfg_('ctBracket');
  var corp = '(MIN(' + income + ',' + bracket + ')*' + cfg_('ctLowRate')
    + '+MAX(' + income + '-' + bracket + ',0)*' + cfg_('ctHighRate') + ')';
  var biz = '(MIN(' + income + ',4000000)*' + cfg_('bizRate1')
    + '+MIN(MAX(' + income + '-4000000,0),4000000)*' + cfg_('bizRate2')
    + '+MAX(' + income + '-8000000,0)*' + cfg_('bizRate3') + ')';

  return 'ROUND(' + corp + '*(1+' + cfg_('localCtRate') + '+' + cfg_('residentRate') + ')'
    + '+' + biz + '*(1+' + cfg_('specialBizRate') + ')'
    + '+' + cfg_('perCapita') + ',-2)';
}

/** 決算月から事業年度の12ヶ月を並べる。決算11月なら12月始まり。 */
function fiscalMonths_(closing) {
  var out = [];
  for (var i = 1; i <= 12; i++) {
    out.push(((closing + i - 1) % 12 + 1) + '月');
  }
  return out;
}

/* ---------------- ダッシュボード ---------------- */

/** 今月どうなのか、いくら使っていいのかを1画面で見る。 */
function buildDashboard_(ss, pl) {
  var sheet = resetSheet_(ss, SHEET_DASH);
  var plName = pl.getName();
  var months = readPlMonths_(pl);

  title_(sheet, 'ダッシュボード', '対象月を選ぶと、その月の状態と使っていい金額が出ます。', 5);

  sheet.getRange(4, 1).setValue('対象月').setFontWeight('bold');
  sheet.getRange(4, 2).setValue(months.length ? months[months.length - 1] : '')
    .setBackground(C_INPUT).setHorizontalAlignment('center').setFontWeight('bold')
    .setBorder(true, true, true, true, false, false, C_RULE, SpreadsheetApp.BorderStyle.SOLID);
  if (months.length) {
    sheet.getRange(4, 2).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(months, true).build());
  }
  sheet.getRange(4, 3).setValue('← ここを切り替えると全部の数字が入れ替わります')
    .setFontSize(9).setFontColor(C_SUB);

  var cash = "'" + SHEET_CASH + "'!";
  var sales = plLookup_(plName, cfg_('rowSales'), '$B$4');
  var paid = plLookup_(plName, cfg_('rowPaid'), '$B$4');

  section_(sheet, 6, '今月の実績', 5);
  var rows = [
    ['売上', '=' + sales, YEN],
    ['支払合計', '=' + paid, YEN],
    ['利益（売上 − 支払）', '=B7-B8', YEN],
    ['利益率', '=IFERROR(B9/B7,0)', PCT],
    ['目標利益率との差', '=B10-' + cfg_('targetMargin'), PCT]
  ];
  writeRows_(sheet, 7, rows);
  sheet.getRange(12, 1).setValue('判定').setFontWeight('bold');
  sheet.getRange(12, 2).setFormula(
    '=IF(B7=0,"数値が未入力",IF(B9<0,"赤字",IF(B10>=' + cfg_('targetMargin') + ',"目標達成","目標未達")))')
    .setHorizontalAlignment('center').setFontWeight('bold');
  statusRules_(sheet, 'B12');

  section_(sheet, 14, '今月おろさずに残しておくお金', 5);
  writeRows_(sheet, 15, [
    ['法人税等の積立', '=IF(B7=0,0,' + cash + '$B$9/12)', YEN],
    ['消費税の積立', '=IF(B7=0,0,' + cash + '$B$10/12)', YEN],
    ['積立の合計', '=B15+B16', YEN]
  ]);
  sheet.getRange(18, 1).setValue('今月 使っていい金額').setFontWeight('bold').setFontSize(11);
  sheet.getRange(18, 2).setFormula('=B9-B17').setNumberFormat(YEN)
    .setFontWeight('bold').setFontSize(12).setBackground('#fff2cc')
    .setBorder(true, true, true, true, false, false, C_NAVY, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  sheet.getRange(18, 3).setValue('利益から税金の積立を引いた額。ここまでなら使っても後で困りません。')
    .setFontSize(9).setFontColor(C_SUB);

  section_(sheet, 20, '危険信号', 5);
  var checks = [
    ['今月が赤字', '=IF(B7=0,"—",IF(B9<0,"該当：支出が売上を超えています","問題なし"))'],
    ['利益率が目標を下回る', '=IF(B7=0,"—",IF(B10<' + cfg_('targetMargin')
      + ',"該当：目標'+'"&TEXT(' + cfg_('targetMargin') + ',"0%")&"に対して"&TEXT(B10,"0.0%"),"問題なし"))'],
    ['この先、残高がマイナスになる月がある',
     '=IF(COUNTIF(' + cash + '$J$13:$J$24,"危険*")>0,"該当："&COUNTIF(' + cash
     + '$J$13:$J$24,"危険*")&"ヶ月ある。資金繰り予測を確認","問題なし")'],
    ['この先、安全ラインを下回る月がある',
     '=IF(COUNTIF(' + cash + '$J$13:$J$24,"注意*")>0,"該当："&COUNTIF(' + cash
     + '$J$13:$J$24,"注意*")&"ヶ月ある","問題なし")'],
    ['月の途中で残高がマイナスになる',
     '=IF(COUNTIF(\'' + SHEET_DAILY + '\'!$E$15:$E$45,"危険*")>0,'
     + '"該当：月内の資金繰りを確認。入金前に出金が集中しています","問題なし")'],
    ['預金残高が未入力', '=IF(' + cfg_('cashOnHand') + '<=0,"該当：設定タブに現在の預金残高を入れてください","問題なし")']
  ];
  checks.forEach(function (c, i) {
    var r = 21 + i;
    sheet.getRange(r, 1).setValue(c[0]).setFontSize(10);
    sheet.getRange(r, 2, 1, 4).merge().setFormula(c[1]).setFontSize(10).setWrap(true);
    sheet.setRowHeight(r, 22);
  });
  dangerRules_(sheet, 'B21:B26');

  section_(sheet, 28, '年間の見通し', 5);
  writeRows_(sheet, 29, [
    ['年間着地 売上', '=' + cash + '$B$7', YEN],
    ['年間着地 利益', '=' + cash + '$B$8', YEN],
    ['法人税等 年間見込み', '=' + cash + '$B$9', YEN],
    ['消費税 年間見込み', '=' + cash + '$B$10', YEN],
    ['安全ライン（手元に残したい額）', '=' + cash + '$B$11', YEN]
  ]);

  sheet.setColumnWidth(1, 250);
  sheet.setColumnWidth(2, 150);
  for (var c = 3; c <= 5; c++) { sheet.setColumnWidth(c, 150); }
  sheet.setFrozenRows(4);
}

/* ---------------- 納税カレンダー ---------------- */

function buildTaxCalendar_(ss) {
  var sheet = resetSheet_(ss, SHEET_TAX);
  var closing = Number(getConfig_(ss, 'closingMonth')) || 11;
  var cash = "'" + SHEET_CASH + "'!";

  title_(sheet, '納税カレンダー',
    '決算月' + closing + '月から逆算した、いつ何を払うかの一覧です。', 4);

  var settle = (closing + 2 - 1) % 12 + 1;
  var mid = (closing + 8 - 1) % 12 + 1;

  var when = {
    'closing+2': settle + '月末',
    'closing+8': mid + '月末',
    'monthly10': '毎月10日',
    'monthlyEnd': '毎月末',
    'july': '7月10日'
  };
  var amount = {
    corp: '=' + cash + '$B$9',
    corpMid: '=' + cash + '$B$9/2',
    consumption: '=' + cash + '$B$10',
    fixed: ''
  };

  tableHeader_(sheet, 4, ['支払うもの', '時期', '概算', '中身']);
  TAX_EVENTS.forEach(function (e, i) {
    var r = 5 + i;
    sheet.getRange(r, 1).setValue(e.name).setFontWeight('bold').setFontSize(10);
    sheet.getRange(r, 2).setValue(when[e.when]).setHorizontalAlignment('center').setFontSize(10);
    if (amount[e.kind]) {
      sheet.getRange(r, 3).setFormula(amount[e.kind]).setNumberFormat(YEN);
    } else {
      sheet.getRange(r, 3).setValue('毎月の支払い予定へ').setFontColor(C_SUB).setFontSize(9);
    }
    sheet.getRange(r, 3).setHorizontalAlignment('right');
    sheet.getRange(r, 4).setValue(e.detail).setFontSize(9).setFontColor(C_SUB).setWrap(true);
    sheet.setRowHeight(r, 26);
  });
  banding_(sheet, 5, 4 + TAX_EVENTS.length, 4);

  var note = 6 + TAX_EVENTS.length;
  section_(sheet, note, '押さえておくこと', 4);
  [
    ['均等割は赤字でもかかる', '年' + (Number(getConfig_(ss, 'perCapita')) || 70000).toLocaleString()
      + '円ほど。利益が出ていない年でも必ず出ていくので、資金繰り予測にも入れてあります。'],
    ['中間納付は全部の年に来るわけではない', '前期の法人税が20万円を超えた年だけです。'
      + '超えた翌年は、決算の8ヶ月後に前期の半分を先に払います。'],
    ['消費税は預かっているだけのお金', '売上に含まれて入ってきますが、会社のお金ではありません。'
      + '使ってしまうと納付月に現金が足りなくなります。毎月そのぶんを別口座に移すのが確実です。'],
    ['納付が遅れると延滞税がかかる', '資金が足りない見込みなら、期限前に税務署へ相談すると分割の余地があります。']
  ].forEach(function (n, i) {
    var r = note + 1 + i;
    sheet.getRange(r, 1).setValue(n[0]).setFontWeight('bold').setFontSize(10);
    sheet.getRange(r, 2, 1, 3).merge().setValue(n[1]).setFontSize(9).setFontColor(C_SUB).setWrap(true);
    sheet.setRowHeight(r, 32);
  });

  sheet.setColumnWidth(1, 230);
  sheet.setColumnWidth(2, 110);
  sheet.setColumnWidth(3, 130);
  sheet.setColumnWidth(4, 430);
  sheet.setFrozenRows(4);
}

/* ---------------- 支払い予定 ---------------- */

/**
 * PLの項目を並べて、支払日と方法を書き込めるようにする。
 * 日付を入れると下に日付順の一覧が出るので、月内のどこで現金が出るか分かる。
 */
function buildPaymentSheet_(ss, pl) {
  // 支払日などの入力も、消す前に読んでおく。
  var saved = readPaymentDetails_(ss);
  var items = readPlItems_(ss, pl);
  var sheet = resetSheet_(ss, SHEET_PAY);

  title_(sheet, '支払い予定',
    '支払日と方法を一度入れておけば、毎月「いつ現金が出るか」が下に日付順で並びます。', 5);

  tableHeader_(sheet, 4, ['項目（PLの行名）', '支払日', '支払方法', 'メモ', '今月の金額']);
  var first = 5;
  items.forEach(function (label, i) {
    var r = first + i;
    var d = saved[label] || ['', '', ''];
    sheet.getRange(r, 1).setValue(label).setFontSize(10);
    sheet.getRange(r, 2).setValue(d[0]).setBackground(C_INPUT).setHorizontalAlignment('center')
      .setNumberFormat('0"日"');
    sheet.getRange(r, 3).setValue(d[1]).setBackground(C_INPUT).setFontSize(10);
    sheet.getRange(r, 4).setValue(d[2]).setBackground(C_INPUT).setFontSize(10);
    sheet.getRange(r, 5).setFormula('=' + plLookup_(pl.getName(), '$A' + r, "'" + SHEET_DASH + "'!$B$4"))
      .setNumberFormat(YEN).setBackground(C_CALC);
    sheet.setRowHeight(r, 21);
  });
  var last = first + items.length - 1;
  banding_(sheet, first, last, 5);

  var listTop = last + 3;
  section_(sheet, listTop, '今月の支払い（日付順）', 5);
  sheet.getRange(listTop + 1, 1).setValue('ダッシュボードで選んだ月の金額です。支払日を入れた項目だけ並びます。')
    .setFontSize(9).setFontColor(C_SUB);
  sheet.getRange(listTop + 2, 1, 1, 4).setValues([['支払日', '項目', '金額', '方法']])
    .setBackground(C_HEAD).setFontColor('#ffffff').setFontWeight('bold').setFontSize(10)
    .setHorizontalAlignment('center');
  sheet.getRange(listTop + 3, 1).setFormula(
    '=IFERROR(SORT(FILTER({B' + first + ':B' + last + ',A' + first + ':A' + last
    + ',E' + first + ':E' + last + ',C' + first + ':C' + last + '},'
    + 'B' + first + ':B' + last + '<>"",E' + first + ':E' + last + '<>0),1,TRUE),"支払日を入れてください")');
  sheet.getRange(listTop + 3, 1, items.length + 1, 1).setNumberFormat('0"日"')
    .setHorizontalAlignment('center');
  sheet.getRange(listTop + 3, 3, items.length + 1, 1).setNumberFormat(YEN);

  sheet.setColumnWidth(1, 220);
  sheet.setColumnWidth(2, 80);
  sheet.setColumnWidth(3, 150);
  sheet.setColumnWidth(4, 260);
  sheet.setColumnWidth(5, 130);
  sheet.setFrozenRows(4);
}

/** PLの明細項目（合計行より上のB列ラベル）を拾う。 */
function readPlItems_(ss, pl) {
  var paidLabel = String(getConfig_(ss, 'rowPaid') || '支払い合計').trim();
  var salesLabel = String(getConfig_(ss, 'rowSales') || '売り上げ').trim();
  var values = pl.getRange(1, 2, Math.min(pl.getMaxRows(), 200), 1).getValues();

  var items = [];
  for (var r = 1; r < values.length; r++) {
    var v = String(values[r][0]).trim();
    if (v === paidLabel) { break; }
    if (v === '' || v === salesLabel) { continue; }
    if (items.indexOf(v) < 0) { items.push(v); }
  }
  return items;
}

/** 作り直す前に、入力済みの支払日・方法・メモを退避する。 */
function readPaymentDetails_(ss) {
  var sheet = ss.getSheetByName(SHEET_PAY);
  var out = {};
  if (!sheet) { return out; }
  sheet.getDataRange().getValues().forEach(function (r) {
    var label = String(r[0]).trim();
    if (label && (r[1] !== '' || r[2] !== '' || r[3] !== '')) {
      out[label] = [r[1], r[2], r[3]];
    }
  });
  return out;
}

/** PLに項目を足したあと、支払い予定の行を作り直す。入力済みの内容は残る。 */
function refreshPaymentItems() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var pl = findPlSheet_(ss);
  if (!pl) { throw new Error('PLの入力表が見つかりません。'); }
  buildPaymentSheet_(ss, pl);
  toast_('支払い予定の項目を読み直しました。');
}

/* ---------------- 月内の資金繰り ---------------- */

/** 入金予定の初期値。実際の入出金のリズムに合わせて書き換える。 */
var INCOME_DEFAULTS = [
  ['25日の入金', 25, 0.5, ''],
  ['月末の入金', 31, 0.5, ''],
  ['', '', '', ''],
  ['', '', '', '']
];

var DAILY_INCOME_FIRST = 8;
var DAILY_INCOME_LAST = 11;
var DAILY_DAY_FIRST = 15;

/**
 * 月内の日ごとの残高。出金が月の前半、入金が後半にあると、
 * 月末が黒字でも途中で一度ショートすることがある。月単位では見えない。
 */
function buildDailyCash_(ss, pl) {
  var saved = readIncomePlan_(ss);
  var sheet = resetSheet_(ss, SHEET_DAILY);
  var plName = pl.getName();
  var cash = "'" + SHEET_CASH + "'!";
  var pay = "'" + SHEET_PAY + "'!";
  var month = "'" + SHEET_DASH + "'!$B$4";

  title_(sheet, '月内の資金繰り',
    '月末が黒字でも、月の途中で現金が尽きれば止まります。日ごとの残高を追う表です。', 6);

  sheet.getRange(3, 1).setValue('対象月').setFontWeight('bold');
  sheet.getRange(3, 2).setFormula('=' + month).setHorizontalAlignment('center').setFontWeight('bold');
  sheet.getRange(3, 3).setValue('← ダッシュボードで選んだ月と連動します')
    .setFontSize(9).setFontColor(C_SUB);

  sheet.getRange(4, 1).setValue('月初残高').setFontWeight('bold');
  sheet.getRange(4, 2).setFormula(
    '=IFERROR(INDEX(' + cash + '$H$13:$H$24,MATCH($B$3,' + cash + '$A$13:$A$24,0)),0)')
    .setNumberFormat(YEN).setBackground(C_CALC).setHorizontalAlignment('right');
  sheet.getRange(4, 3).setValue('資金繰り予測から引いています')
    .setFontSize(9).setFontColor(C_SUB);

  // 入金予定
  section_(sheet, 6, '入金予定（入金日と、月の売上に対する割合）', 6);
  tableHeader_(sheet, 7, ['入金元', '入金日', '売上に対する割合', '固定額（あれば優先）', '今月の入金額', '']);
  var sales = plLookup_(plName, cfg_('rowSales'), month);
  for (var i = 0; i < INCOME_DEFAULTS.length; i++) {
    var r = DAILY_INCOME_FIRST + i;
    var d = saved[i] || INCOME_DEFAULTS[i];
    sheet.getRange(r, 1).setValue(d[0]).setBackground(C_INPUT);
    sheet.getRange(r, 2).setValue(d[1]).setBackground(C_INPUT)
      .setNumberFormat('0"日"').setHorizontalAlignment('center');
    sheet.getRange(r, 3).setValue(d[2]).setBackground(C_INPUT).setNumberFormat('0%');
    sheet.getRange(r, 4).setValue(d[3]).setBackground(C_INPUT).setNumberFormat(YEN);
    sheet.getRange(r, 5).setFormula(
      '=IF($A' + r + '="",0,IF($D' + r + '<>"",$D' + r + ',' + sales + '*$C' + r + '))')
      .setNumberFormat(YEN).setBackground(C_CALC);
    sheet.setRowHeight(r, 21);
  }
  sheet.getRange(DAILY_INCOME_LAST + 1, 2, 1, 5).merge().setValue(
    '月末の入金は「31日」として入れてください（末日として扱います）。'
    + '割合の合計が100%になるようにすると、月の売上と入金額が合います。')
    .setFontSize(9).setFontColor(C_SUB).setWrap(true);

  // 日別の残高
  section_(sheet, 13, '日ごとの残高', 6);
  tableHeader_(sheet, 14, ['日', '入金', '出金', '残高', '判定', 'その日に出ていくもの']);

  var incomeDay = '$B$' + DAILY_INCOME_FIRST + ':$B$' + DAILY_INCOME_LAST;
  var incomeAmt = '$E$' + DAILY_INCOME_FIRST + ':$E$' + DAILY_INCOME_LAST;
  var taxThisMonth = 'IFERROR(INDEX(' + cash + '$G$13:$G$24,MATCH($B$3,' + cash + '$A$13:$A$24,0)),0)';

  for (var day = 1; day <= 31; day++) {
    var r = DAILY_DAY_FIRST + day - 1;
    sheet.getRange(r, 1).setValue(day).setNumberFormat('0"日"')
      .setHorizontalAlignment('center').setFontWeight(day === 31 ? 'bold' : 'normal');

    sheet.getRange(r, 2).setFormula('=SUMIF(' + incomeDay + ',$A' + r + ',' + incomeAmt + ')');
    sheet.getRange(r, 3).setFormula(
      '=SUMIF(' + pay + '$B$5:$B$200,$A' + r + ',' + pay + '$E$5:$E$200)'
      + (day === 31 ? '+' + taxThisMonth : ''));
    sheet.getRange(r, 4).setFormula(
      '=' + (day === 1 ? '$B$4' : 'D' + (r - 1)) + '+B' + r + '-C' + r);
    sheet.getRange(r, 5).setFormula(
      '=IF(D' + r + '<0,"危険：資金ショート",IF(AND(C' + r + '>0,D' + r + '=MIN($D$'
      + DAILY_DAY_FIRST + ':$D$' + (DAILY_DAY_FIRST + 30) + ')),"注意：今月の底",""))');
    sheet.getRange(r, 6).setFormula(
      '=IFERROR(TEXTJOIN("、",TRUE,FILTER(' + pay + '$A$5:$A$200,' + pay + '$B$5:$B$200=$A' + r + ')),"")'
      + (day === 31 ? '&IF(' + taxThisMonth + '>0,"、納税","")' : ''));

    sheet.getRange(r, 2, 1, 3).setNumberFormat(YEN);
    sheet.getRange(r, 5).setHorizontalAlignment('center');
    sheet.getRange(r, 6).setFontSize(9).setFontColor(C_SUB);
    sheet.setRowHeight(r, 20);
  }
  var dayLast = DAILY_DAY_FIRST + 30;
  banding_(sheet, DAILY_DAY_FIRST, dayLast, 6);
  statusRules_(sheet, 'E' + DAILY_DAY_FIRST + ':E' + dayLast);
  sheet.getRange('D' + DAILY_DAY_FIRST + ':D' + dayLast).setFontWeight('bold');

  var sum = dayLast + 2;
  section_(sheet, sum, '今月いちばん細るところ', 6);
  writeRows_(sheet, sum + 1, [
    ['最低残高', '=MIN($D$' + DAILY_DAY_FIRST + ':$D$' + dayLast + ')', YEN],
    ['その日', '=IFERROR(INDEX($A$' + DAILY_DAY_FIRST + ':$A$' + dayLast
      + ',MATCH(B' + (sum + 1) + ',$D$' + DAILY_DAY_FIRST + ':$D$' + dayLast + ',0)),"")', '0"日"']
  ]);
  sheet.getRange(sum + 3, 1).setValue('判定').setFontWeight('bold');
  sheet.getRange(sum + 3, 2).setFormula(
    '=IF(B' + (sum + 1) + '<0,"危険：この日に足りません","問題なし")')
    .setHorizontalAlignment('center').setFontWeight('bold');
  dangerRules_(sheet, 'B' + (sum + 3));

  sheet.setColumnWidth(1, 60);
  for (var c = 2; c <= 4; c++) { sheet.setColumnWidth(c, 120); }
  sheet.setColumnWidth(5, 150);
  sheet.setColumnWidth(6, 300);
  sheet.setFrozenRows(14);
}

/** 作り直す前に、入金予定の入力を退避する。 */
function readIncomePlan_(ss) {
  var sheet = ss.getSheetByName(SHEET_DAILY);
  if (!sheet) { return {}; }
  var out = {};
  for (var i = 0; i < INCOME_DEFAULTS.length; i++) {
    var row = sheet.getRange(DAILY_INCOME_FIRST + i, 1, 1, 4).getValues()[0];
    if (String(row[0]).trim() !== '') { out[i] = row; }
  }
  return out;
}

/* ---------------- 見た目の部品 ---------------- */

/** タブを作り直す。既存の内容・書式・条件付き書式を消してから返す。 */
function resetSheet_(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) { return ss.insertSheet(name); }
  sheet.setFrozenRows(0);
  sheet.setFrozenColumns(0);
  sheet.getDataRange().breakApart();
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearDataValidations();
  sheet.clear();
  sheet.clearConditionalFormatRules();
  return sheet;
}

/**
 * 見出しの帯。1列目を固定するタブがあるため、結合は2列目から始める。
 * 結合が固定の境目をまたぐと Google スプレッドシートに弾かれる。
 * 色は行全体に敷くので、見た目は1本の帯になる。
 */
function title_(sheet, heading, note, width) {
  sheet.getRange(1, 1, 1, width).setBackground(C_NAVY);
  bandText_(sheet, 1, width, heading,
    {size: 13, color: '#ffffff', bold: true, middle: true});
  sheet.setRowHeight(1, 30);
  bandText_(sheet, 2, width, note, {size: 9, color: C_SUB});
}

function section_(sheet, row, label, width) {
  sheet.getRange(row, 1, 1, width).setBackground(C_HEAD);
  bandText_(sheet, row, width, label, {size: 10, color: '#ffffff', bold: true});
  sheet.setRowHeight(row, 24);
}

/** 2列目から右を結合して文字を置く。幅が2未満なら結合しない。 */
function bandText_(sheet, row, width, value, opt) {
  var col = width >= 2 ? 2 : 1;
  if (width >= 3) { sheet.getRange(row, col, 1, width - 1).merge(); }
  var cell = sheet.getRange(row, col)
    .setValue(value)
    .setFontSize(opt.size)
    .setFontColor(opt.color)
    .setFontWeight(opt.bold ? 'bold' : 'normal');
  if (opt.middle) { cell.setVerticalAlignment('middle'); }
  return cell;
}

function tableHeader_(sheet, row, headers) {
  sheet.getRange(row, 1, 1, headers.length).setValues([headers])
    .setBackground(C_HEAD).setFontColor('#ffffff').setFontWeight('bold').setFontSize(10)
    .setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
  sheet.setRowHeight(row, 28);
}

/** ラベル・数式・表示形式の3つ組をまとめて書く。 */
function writeRows_(sheet, startRow, rows) {
  rows.forEach(function (r, i) {
    var row = startRow + i;
    sheet.getRange(row, 1).setValue(r[0]).setFontWeight('bold').setFontSize(10);
    sheet.getRange(row, 2).setFormula(r[1]).setNumberFormat(r[2])
      .setBackground(C_CALC).setHorizontalAlignment('right');
    sheet.setRowHeight(row, 21);
  });
}

function banding_(sheet, first, last, cols) {
  if (last < first) { return; }
  for (var r = first; r <= last; r++) {
    if ((r - first) % 2 === 1) {
      sheet.getRange(r, 1, 1, cols).setBackground('#fafafa');
    }
  }
  sheet.getRange(first, 1, last - first + 1, cols)
    .setBorder(true, true, true, true, true, true, C_RULE, SpreadsheetApp.BorderStyle.SOLID);
}

/** 良好／注意／危険の色分け。文字も残るので色だけに頼らない。 */
function statusRules_(sheet, a1) {
  addTextRules_(sheet, a1, [
    ['危険', C_BAD, C_INK_BAD], ['赤字', C_BAD, C_INK_BAD],
    ['注意', C_WARN, C_INK_WARN], ['未達', C_WARN, C_INK_WARN],
    ['良好', C_OK, C_INK_OK], ['達成', C_OK, C_INK_OK]
  ]);
}

/** 危険信号の欄。「該当」は赤、「問題なし」は緑。 */
function dangerRules_(sheet, a1) {
  addTextRules_(sheet, a1, [
    ['該当', C_BAD, C_INK_BAD],
    ['問題なし', C_OK, C_INK_OK]
  ]);
}

function addTextRules_(sheet, a1, specs) {
  var range = sheet.getRange(a1);
  var rules = sheet.getConditionalFormatRules();
  specs.forEach(function (s) {
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains(s[0])
      .setBackground(s[1])
      .setFontColor(s[2])
      .setRanges([range])
      .build());
  });
  sheet.setConditionalFormatRules(rules);
}

/** スプレッドシートの右下に出す通知。エディタから実行したときはログに落とす。 */
function toast_(message) {
  try {
    SpreadsheetApp.getActive().toast(message);
  } catch (e) {
    Logger.log(message);
  }
}
