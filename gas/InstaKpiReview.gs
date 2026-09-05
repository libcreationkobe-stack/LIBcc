/**
 * 月次レビューシート。KPIの数字を読んで、総評・良かった点・ボトルネック・
 * 改善アクションを Claude に書かせる。
 *
 * InstaKpiSheet.gs と同じプロジェクトに置くこと（定数を共有している）。
 *
 * 事前準備:
 *   プロジェクトの設定 → スクリプト プロパティ に
 *   ANTHROPIC_API_KEY     = Anthropic の APIキー（必須）
 *   ANTHROPIC_WORKSPACE_ID = ワークスペースID（wrkspc_...）
 *     個人に紐づいたキーを使う場合のみ必要。ワークスペース単位で
 *     発行したキーなら不要。
 */

var REVIEW_SHEET_NAME = '月次レビュー';

var REVIEW_HEAD_ROW = 2;
var REVIEW_FIRST_ROW = 3;

/** レビューシートの列。text列はClaudeが書き込む。 */
var REVIEW_COLUMNS = [
  {header: '月',             width: 60},
  {header: 'ランク',         width: 70},
  {header: '数値サマリー',   width: 330},
  {header: '総評',           width: 380, text: true},
  {header: '良かった点',     width: 280, text: true},
  {header: 'ボトルネック',   width: 280, text: true},
  {header: '改善アクション', width: 340, text: true},
  {header: '更新日時',       width: 130},
  {header: 'スライド',       width: 120, link: true},
  {header: 'PPTX',           width: 110, link: true}
];

/** 列番号を見出しの名前で引く。列を足しても書き込み先がずれない。 */
var REVIEW_COL = (function () {
  var map = {};
  REVIEW_COLUMNS.forEach(function (c, i) { map[c.header] = i + 1; });
  return map;
})();

var REVIEW_LAST_COL = REVIEW_COLUMNS.length;
var REVIEW_BODY_START = REVIEW_COL['総評'];                        // 本文の先頭列
var REVIEW_BODY_COLS = REVIEW_LAST_COL - REVIEW_BODY_START + 1;   // 総評からリンクまで

/** Claudeへの依頼で使う指標。列はKPIシートの定義から名前で引く。 */
var REVIEW_METRICS = [
  {label: '投稿数',            key: '投稿数'},
  {label: '広告費',            key: '広告費', money: true},
  {label: 'フォロワー数',      key: 'フォロワー数'},
  {label: '表示回数',          key: '表示回数'},
  {label: 'リーチ数',          key: 'リーチ数'},
  {label: '保存＋シェア',      key: '保存・シェア'},
  {label: '保存シェア率',      key: '保存シェア率',     rate: true},
  {label: 'プロフ表示率',      key: 'プロフ表示率',     rate: true, bench: true},
  {label: 'リンククリック率',  key: 'リンククリック率', rate: true, bench: true},
  {label: 'LINE登録率',        key: 'LINE登録率',       rate: true, bench: true},
  {label: 'エントリー率',      key: 'エントリー率',     rate: true},
  {label: '面接率',            key: '面接率',           rate: true},
  {label: '採用率(面接→採用)', key: '採用率',           rate: true},
  {label: 'LINE友だち追加',    key: 'LINE友だち追加'},
  {label: 'LINE追加 目標',     key: 'LINE追加目標'},
  {label: 'LINE追加 達成率',   key: '達成率',           rate: true, bench: true},
  {label: 'LINE友だち総数',    key: 'LINE友だち総数'},
  {label: 'エントリー数',      key: 'エントリー数'},
  {label: '面接数',            key: '面接'},
  {label: '採用数',            key: '採用数'},
  {label: '3ヶ月定着数',       key: '3ヶ月定着数'},
  {label: '定着率',            key: '定着率',           rate: true, bench: true},
  {label: '表示→採用率',       key: '表示→採用率',      rate: true, bench: true},
  {label: '採用単価',          key: '採用単価',         money: true},
  {label: 'LINE登録単価',      key: 'LINE登録単価',     money: true}
];

var CLAUDE_MODEL_REVIEW = 'claude-opus-5';
var CLAUDE_MAX_TOKENS_REVIEW = 4000;

var SECTION_HEADINGS = ['【総評】', '【良かった点】', '【ボトルネック】', '【改善アクション】'];

/**
 * 設定の確認用。エディタかメニューから実行すると、スクリプト プロパティの
 * 中身を表示したうえで、実際にAPIを1回叩いて結果まで見せる。
 * APIキーは全体を出さず、前後だけ表示する。
 */
function checkClaudeSettings() {
  var props = PropertiesService.getScriptProperties().getProperties();
  var names = Object.keys(props);
  var lines = ['保存されているプロパティ: ' + (names.length ? names.join(', ') : '（1つもありません）'), ''];

  var key = props['ANTHROPIC_API_KEY'];
  if (!key) {
    lines.push('✗ ANTHROPIC_API_KEY … 未設定');
  } else {
    lines.push('✓ ANTHROPIC_API_KEY … ' + key.slice(0, 14) + '…' + key.slice(-4)
      + '（' + key.length + '文字）');
    if (key !== key.trim()) { lines.push('  ⚠ 前後に空白が入っています'); }
  }

  var ws = props['ANTHROPIC_WORKSPACE_ID'];
  lines.push(ws
    ? '・ANTHROPIC_WORKSPACE_ID … 「' + ws + '」'
    : '・ANTHROPIC_WORKSPACE_ID … 未設定（レガシーキーなら不要）');

  lines.push('', '─── 接続テスト ───');
  if (key) {
    lines.push(pingClaude_(key));
  } else {
    lines.push('APIキーが無いのでテストできません。');
  }

  // 先にログへ出す。ダイアログはOKが押されるまで実行が止まるので、
  // 押されないまま6分でタイムアウトしても結果が残るようにしておく。
  Logger.log(lines.join('\n'));
  try {
    var ui = SpreadsheetApp.getUi();
    ui.alert('Claude APIの設定', lines.join('\n'), ui.ButtonSet.OK);
  } catch (e) {
    Logger.log('ダイアログは出せませんでした（' + e.message + '）。上の内容を見てください。');
  }
}

/** ごく短いリクエストを1回だけ送って、通るかどうかを確かめる。 */
function pingClaude_(apiKey) {
  var res = postToClaude_(apiKey, {
    model: CLAUDE_MODEL_REVIEW,
    max_tokens: 16,
    messages: [{role: 'user', content: 'ping'}]
  });

  var code = res.getResponseCode();
  var body = res.getContentText();
  Logger.log('接続テスト HTTP ' + code + ': ' + body);

  if (code === 200) {
    return '✓ 成功（HTTP 200）。総評を書ける状態です。';
  }

  var detail = body;
  try {
    var parsed = JSON.parse(body);
    if (parsed.error && parsed.error.message) { detail = parsed.error.message; }
  } catch (e) { /* JSONでなければ本文をそのまま出す */ }

  if (detail.indexOf('anthropic-workspace-id') >= 0) {
    return '✗ HTTP ' + code + '：まだ「個人に紐づいたキー」が使われています。\n'
      + '新しいキーが保存されていない可能性が高いです。\n'
      + '→ プロジェクトの設定 → スクリプト プロパティ で ANTHROPIC_API_KEY の値を\n'
      + '　 新しいキーに置き換え、必ず「スクリプト プロパティを保存」を押してください。';
  }
  if (code === 401) {
    return '✗ HTTP 401：キーが正しくありません。コピー漏れが無いか確認してください。';
  }
  if (detail.indexOf('credit') >= 0 || detail.indexOf('balance') >= 0) {
    return '✗ HTTP ' + code + '：残高が足りません。\n'
      + 'platform.claude.com の Billing でチャージしてください。';
  }
  return '✗ HTTP ' + code + '\n' + detail;
}

/** レビューシートを作る／整える。 */
function buildReviewSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(REVIEW_SHEET_NAME);
  var saved = sheet ? readExistingReviews_(sheet) : {};

  if (!sheet) {
    sheet = ss.insertSheet(REVIEW_SHEET_NAME);
  }
  // フィルタが残っていると、その境界をまたぐ結合ができない。
  removeFilter_(sheet);
  sheet.setFrozenRows(0);
  sheet.setFrozenColumns(0);
  // 結合はシート全体を指定して解除する。getDataRange だと結合範囲を
  // 覆いきれず「結合範囲のすべてのセルを選択する必要があります」で落ちる。
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).breakApart();
  sheet.clear();

  var lastRow = REVIEW_FIRST_ROW + MONTHS.length - 1;
  if (sheet.getMaxColumns() < REVIEW_LAST_COL) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), REVIEW_LAST_COL - sheet.getMaxColumns());
  }
  if (sheet.getMaxRows() < lastRow + 4) {
    sheet.insertRowsAfter(sheet.getMaxRows(), lastRow + 4 - sheet.getMaxRows());
  }

  // タイトル。1列目は固定するので結合に含めない。
  sheet.getRange(1, 2).setValue('月次レビュー（KPIシートの数字から Claude が下書きします）');
  sheet.getRange(1, 2, 1, REVIEW_LAST_COL - 1).merge();
  sheet.getRange(1, 1, 1, REVIEW_LAST_COL)
    .setBackground(COLOR_NAVY)
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setFontSize(12)
    .setVerticalAlignment('middle');
  sheet.setRowHeight(1, 28);

  var headers = REVIEW_COLUMNS.map(function (c) { return c.header; });
  sheet.getRange(REVIEW_HEAD_ROW, 1, 1, REVIEW_LAST_COL)
    .setValues([headers])
    .setBackground(COLOR_CALC)
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setFontSize(10)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sheet.setRowHeight(REVIEW_HEAD_ROW, 30);

  for (var i = 0; i < MONTHS.length; i++) {
    var row = REVIEW_FIRST_ROW + i;
    var kpiRow = summaryRow_(i);

    sheet.getRange(row, 1)
      .setValue(MONTHS[i])
      .setBackground(COLOR_MONTH_BG)
      .setFontWeight('bold')
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');

    // ランクはKPIシートの合計行から引く。判定はあちらの数式が持っている。
    sheet.getRange(row, REVIEW_COL['ランク'])
      .setFormula("='" + SHEET_NAME + "'!" + col_('ランク') + kpiRow)
      .setFontSize(16).setFontWeight('bold')
      .setHorizontalAlignment('center').setVerticalAlignment('middle');

    sheet.getRange(row, REVIEW_COL['数値サマリー'])
      .setFormula(summaryFormula_(kpiRow))
      .setBackground(COLOR_CALC_BG)
      .setVerticalAlignment('middle')
      .setWrap(true);

    if (saved[MONTHS[i] + '_' + i]) {
      sheet.getRange(row, REVIEW_BODY_START, 1, REVIEW_BODY_COLS)
        .setValues([saved[MONTHS[i] + '_' + i]]);
    }
    sheet.getRange(row, REVIEW_BODY_START, 1, 4).setVerticalAlignment('top').setWrap(true);
    sheet.getRange(row, REVIEW_COL['更新日時'], 1, 3)
      .setVerticalAlignment('middle').setHorizontalAlignment('center');
    sheet.setRowHeight(row, 120);
  }

  sheet.getRange(REVIEW_HEAD_ROW, 1, lastRow - REVIEW_HEAD_ROW + 1, REVIEW_LAST_COL)
    .setBorder(true, true, true, true, true, true, COLOR_BORDER, SpreadsheetApp.BorderStyle.SOLID);

  REVIEW_COLUMNS.forEach(function (c, i) { sheet.setColumnWidth(i + 1, c.width); });
  sheet.setFrozenRows(REVIEW_HEAD_ROW);
  sheet.setFrozenColumns(1);

  var note = lastRow + 2;
  sheet.getRange(note, 1).setValue('使い方');
  sheet.getRange(note, 1).setFontWeight('bold');
  sheet.getRange(note + 1, 1).setValue(
    '書きたい月の行をどこでもいいのでクリックして、メニュー「KPIシート」→「この月の総評をAIに書かせる」。'
    + '総評〜改善アクションの4列はあとから手で直してOK。もう一度実行すると上書きされます。');
  sheet.getRange(note + 2, 1).setValue(
    'ランク列はKPIシートの合計行から自動で入ります。業界の目安ではなく、数字が入っている月どうしを'
    + '比べた相対評価です。厳しさはKPIシート2行目の「評価：〜」で変えられます（既定は甘め）。'
    + '先月よりスコアが上がった月にはCを付けません。3ヶ月ぶんたまるまでは空欄です。');

  SpreadsheetApp.getActive().toast('月次レビューシートを用意しました。');
}

/**
 * 作り直す前に、書いてあるレビュー本文とリンクを月ごとに退避する。
 * リンク列は表示文字ではなく数式で持ち越す。
 */
function readExistingReviews_(sheet) {
  var saved = {};
  var range = sheet.getDataRange();
  var values = range.getValues();
  var formulas = range.getFormulas();

  for (var i = 0; i < MONTHS.length; i++) {
    var row = REVIEW_FIRST_ROW + i - 1;   // 0始まり
    if (row >= values.length) { break; }
    if (String(values[row][0]).trim() !== MONTHS[i]) { continue; }

    var body = [];
    var hasText = false;
    for (var c = REVIEW_BODY_START - 1; c < REVIEW_BODY_START - 1 + REVIEW_BODY_COLS; c++) {
      var f = formulas[row] ? formulas[row][c] : '';
      var v = f ? f : values[row][c];
      body.push(v === null || v === undefined ? '' : v);
      if (String(v).trim() !== '') { hasText = true; }
    }
    if (hasText) { saved[MONTHS[i] + '_' + i] = body; }
  }
  return saved;
}

/** 数値サマリー列に出す数式。KPIシートを参照する。 */
function summaryFormula_(kpiRow) {
  var s = "'" + SHEET_NAME + "'!";
  var at = function (key) { return s + col_(key) + kpiRow; };
  return '=IFERROR(IF(' + at('表示回数') + '=0,"（KPIシートに数値が未入力）",'
    + '"表示 "&TEXT(' + at('表示回数') + ',"#,##0")'
    + '&"　プロフ "&TEXT(' + at('プロフ表示率') + ',"0.0%")'
    + '&"　クリック "&TEXT(' + at('リンククリック率') + ',"0.0%")'
    + '&"　LINE "&' + at('LINE友だち追加') + '&"人"'
    + '&"　応募 "&' + at('エントリー数') + '&"件"'
    + '&"　採用 "&' + at('採用数') + '&"人"'
    + '&IF(' + at('広告費') + '>0,"　広告費 "&TEXT(' + at('広告費') + ',"¥#,##0"),"")),"")';
}

/** メニュー用。選択中の行の月について総評を書かせる。 */
function writeReviewForSelectedMonth() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(REVIEW_SHEET_NAME);
  if (!sheet) {
    throw new Error('「' + REVIEW_SHEET_NAME + '」シートがありません。先に「月次レビューシートを作る」を実行してください。');
  }

  var index = selectedMonthIndex_(ss, sheet);
  var kpiRow = summaryRow_(index);
  var data = collectMonthData_(index);

  if (data.reach === '' || data.reach === null) {
    throw new Error(MONTHS[index] + ' はKPIシートに数値が入っていません。'
      + '「月次KPI」の' + kpiRow + '行目に数字を入れてから実行してください。');
  }

  SpreadsheetApp.getActive().toast(MONTHS[index] + 'の総評を書いています…（20秒ほどかかります）');

  var sections = parseSections_(callClaudeForReview_(data));
  var row = REVIEW_FIRST_ROW + index;

  sheet.getRange(row, REVIEW_BODY_START, 1, 4).setValues([[
    sections['【総評】'], sections['【良かった点】'],
    sections['【ボトルネック】'], sections['【改善アクション】']
  ]]);
  sheet.getRange(row, REVIEW_COL['更新日時']).setValue(
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm'));

  sheet.activate();
  sheet.setActiveRange(sheet.getRange(row, REVIEW_BODY_START));
  SpreadsheetApp.getActive().toast(MONTHS[index] + 'の総評を書きました。');
}

/**
 * どの月を書くか決める。レビューシートで選択中の行を優先し、
 * 月の行を選んでいなければ、数値が入っている一番新しい月にする。
 */
function selectedMonthIndex_(ss, sheet) {
  if (ss.getActiveSheet().getName() === REVIEW_SHEET_NAME) {
    var row = sheet.getActiveRange().getRow();
    var index = row - REVIEW_FIRST_ROW;
    if (index >= 0 && index < MONTHS.length) { return index; }
  }

  var kpi = ss.getSheetByName(SHEET_NAME);
  for (var i = MONTHS.length - 1; i >= 0; i--) {
    var v = kpi.getRange(col_('表示回数') + summaryRow_(i)).getValue();
    if (v !== '' && v !== null && v !== 0) { return i; }
  }
  throw new Error(
    'KPIシートにまだ数値が入っていません。\n\n'
    + '「' + SHEET_NAME + '」タブの ' + channelFirstRow_(0) + '行目（' + MONTHS[0] + '・'
    + CHANNELS[0] + 'の行）から、表示回数などを入れてください。\n'
    + '合計行（' + summaryRow_(0) + '行目）は自動計算なので、直接入れても集計されません。\n\n'
    + '以前の数字が消えている場合は、ファイル → 版の履歴 から戻せます。');
}

/** 指定した月の数値と、目安に対する判定を集める。 */
function collectMonthData_(index) {
  var kpi = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  var row = summaryRow_(index);

  var metrics = REVIEW_METRICS.map(function (m) {
    var value = kpi.getRange(col_(m.key) + row).getValue();
    return {
      label: m.label,
      value: value,
      rate: !!m.rate,
      money: !!m.money,
      judgement: m.bench ? judge_(m.key, value) : ''
    };
  });

  var prev = null;
  if (index > 0) {
    var prevRow = summaryRow_(index - 1);
    if (kpi.getRange(col_('表示回数') + prevRow).getValue() !== '') {
      prev = REVIEW_METRICS.map(function (m) {
        return {label: m.label, value: kpi.getRange(col_(m.key) + prevRow).getValue(),
                rate: !!m.rate, money: !!m.money};
      });
    }
  }

  return {
    month: MONTHS[index],
    prevMonth: index > 0 ? MONTHS[index - 1] : '',
    rank: rankInfo_(kpi, index),
    reach: kpi.getRange(col_('表示回数') + row).getValue(),
    channels: readChannelRows_(kpi, index),
    metrics: metrics,
    prev: prev
  };
}

/**
 * その月のランクと順位。判定そのものはKPIシートの数式が持っているので、
 * ここでは結果を読むだけ。順位は同じ列の他の月と比べて出す。
 */
function rankInfo_(kpi, index) {
  var row = summaryRow_(index);
  var letter = String(kpi.getRange(col_('ランク') + row).getValue() || '').trim();
  var score = kpi.getRange(col_('総合スコア') + row).getValue();
  if (!letter) { return null; }
  return {rank: letter, score: typeof score === 'number' ? score : null};
}

/** ランクを一行の文にする。総評とスライドで同じ言い方をそろえる。 */
function rankText_(rank) {
  if (!rank || !rank.rank) { return ''; }
  return rank.rank + (rank.score === null ? '' : '（市場スコア ' + rank.score + '点／100点満点）');
}

/** その月のチャネル別の実績。スライドの比較に使う。 */
function readChannelRows_(kpi, index) {
  var first = channelFirstRow_(index);
  var pick = ['表示回数', '広告費', 'フォロワー数', 'LINE友だち追加', 'エントリー数', '採用数'];
  return CHANNELS.map(function (name, i) {
    var row = first + i;
    var out = {name: name};
    pick.forEach(function (key) { out[key] = kpi.getRange(col_(key) + row).getValue(); });
    return {
      name: name,
      views: out['表示回数'],
      cost: out['広告費'],
      followers: out['フォロワー数'],
      line: out['LINE友だち追加'],
      entry: out['エントリー数'],
      hires: out['採用数']
    };
  });
}

/** 目安に照らして 悪い／普通／良い を返す。指標名で引く。 */
function judge_(key, value) {
  if (typeof value !== 'number') { return ''; }
  var list = activeBenchmarks_();
  for (var i = 0; i < list.length; i++) {
    var b = list[i];
    if (b.key !== key) { continue; }
    if (value < b.bad) { return '悪い'; }
    if (value < b.good) { return '普通'; }
    return '良い';
  }
  return '';
}

/** 目安を文章にする（Claudeに判断基準を渡すため）。 */
function benchmarkText_() {
  return activeBenchmarks_().map(function (b) {
    return '- ' + b.key + '：' + benchLabels_(b).join(' / ');
  }).join('\n');
}

/** 数値を読みやすい文字列にする。 */
function formatValue_(m) {
  if (m.value === '' || m.value === null || m.value === undefined) { return '（未入力）'; }
  if (typeof m.value !== 'number') { return String(m.value); }
  if (m.rate) { return (m.value * 100).toFixed(m.value < 0.001 ? 3 : 1) + '%'; }
  if (m.money) { return '¥' + Math.round(m.value).toLocaleString(); }
  return Math.round(m.value).toLocaleString();
}

/** Claudeに渡す本文を組み立てる。 */
function buildReviewPrompt_(data) {
  var lines = ['【対象月】' + data.month, '', '【今月の数値】'];

  data.metrics.forEach(function (m) {
    lines.push('- ' + m.label + '：' + formatValue_(m) + (m.judgement ? '（目安では「' + m.judgement + '」）' : ''));
  });

  if (data.prev) {
    lines.push('', '【前月（' + data.prevMonth + '）の数値】');
    data.prev.forEach(function (m) {
      lines.push('- ' + m.label + '：' + formatValue_(m));
    });
  } else {
    lines.push('', '【前月の数値】比較できる前月データはありません。前月比には触れないでください。');
  }

  if (data.rank) {
    lines.push('', '【今月のランク】' + rankText_(data.rank),
      '業界の目安に対する評価です。指標ごとに 良い2点／普通1点／悪い0点で採点し、'
      + '100点満点に直したものが市場スコアで、50点が業界の「普通」の水準にあたります。'
      + '自社の他の月との比較ではないので、「何ヶ月中何位」という言い方はしないでください。'
      + '総評では、どの指標が点を落としているかに触れてください。');
  }

  lines.push('', '【指標の目安】', benchmarkText_());
  lines.push('', '【ファネルの流れ】',
    '表示 → リーチ → プロフィール表示 → リンククリック → LINE友だち追加 → エントリー → 面接 → 採用。',
    '数字は ' + CHANNELS.join('・') + ' の合計です。');

  if (data.channels) {
    lines.push('', '【チャネル別の実績】');
    data.channels.forEach(function (c) {
      if (!c.views && !c.line && !c.hires && !c.cost && !c.followers) { return; }
      var line = '- ' + c.name + '：フォロワー ' + (c.followers || 0).toLocaleString()
        + ' / 表示 ' + (c.views || 0).toLocaleString()
        + ' / LINE ' + (c.line || 0) + ' / 応募 ' + (c.entry || 0) + ' / 採用 ' + (c.hires || 0);
      if (c.cost) {
        line += ' / 広告費 ¥' + Math.round(c.cost).toLocaleString();
        if (c.hires) { line += '（採用単価 ¥' + Math.round(c.cost / c.hires).toLocaleString() + '）'; }
      }
      lines.push(line);
    });
    lines.push('どのチャネルが効いているかにも触れてください。');
    lines.push('広告（Meta広告・TikTokプロモート）は、採用単価が見合っているかを必ず評価してください。');
  }

  lines.push('', '【見るときの注意】',
    '保存＋シェアは伸びの先行指標です。ここが増えていれば来月の表示回数が伸びます。',
    'フォロワー数は積み上がる資産です。増えていないなら、今月の数字が良くても来月また同じ苦労をします。',
    '3ヶ月定着数は3ヶ月遅れて入るため、直近の月は空欄が普通です。空欄の月の定着率には触れないでください。');

  return lines.join('\n');
}

/** Claude Messages API を呼んでレビュー本文を返す。 */
function callClaudeForReview_(data) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) {
    throw new Error(
      'APIキーが未設定です。Apps Scriptの「プロジェクトの設定」→「スクリプト プロパティ」で '
      + 'ANTHROPIC_API_KEY にAnthropicのAPIキーを登録してください。');
  }

  var system =
    'あなたは店舗のInstagram採用運用を見ているコンサルタントです。'
    + '渡された月次KPIを読み、経営者向けのレビューを日本語で書きます。\n\n'
    + '出力の形式（これ以外は一切書かない）:\n'
    + '【総評】\n3〜4文。今月がどういう月だったかを一言で言い切る。\n'
    + '【良かった点】\n「・」で始まる箇条書き2〜3個。必ず数字を添える。\n'
    + '【ボトルネック】\n「・」で始まる箇条書き1〜2個。ファネルのどこで人が落ちているかを特定し、'
    + '目安のどの水準かを数字で示す。\n'
    + '【改善アクション】\n「・」で始まる箇条書き3個。来月すぐ着手できる具体策。'
    + '「誰が何をするか」まで書く。抽象論は書かない。\n\n'
    + '守ること:\n'
    + '- 渡された数字だけを使う。無い数字は推測しない。未入力の項目には触れない。\n'
    + '- 一番効く1箇所に絞って指摘する。全部を平均的に指摘しない。\n'
    + '- 前置き・あいさつ・まとめの再掲は書かない。';

  // 基本のリクエスト。effort を上げるほど深く考えるが時間もかかる。
  // Apps Script の通信は待たされすぎると打ち切られるため low から始める。
  // 物足りなければ 'medium' や 'high' に変える。
  var payload = {
    model: CLAUDE_MODEL_REVIEW,
    max_tokens: CLAUDE_MAX_TOKENS_REVIEW,
    thinking: {type: 'adaptive'},
    output_config: {effort: 'low'},
    system: system,
    messages: [{role: 'user', content: buildReviewPrompt_(data)}]
  };

  var res = postToClaude_(apiKey, payload);

  // 400 はリクエストの書式をAPIが受け付けなかったということ。
  // 契約プランによっては thinking や effort が使えないことがあるので、
  // 一度だけ最小構成に落として送り直す。
  if (res.getResponseCode() === 400) {
    Logger.log('1回目が400。最小構成で再送します: ' + res.getContentText());
    delete payload.thinking;
    delete payload.output_config;
    res = postToClaude_(apiKey, payload);
  }

  var code = res.getResponseCode();
  var body = res.getContentText();
  if (code !== 200) {
    Logger.log('Claude API失敗: ' + body);
    throw new Error(claudeErrorMessage_(code, body));
  }

  var json = JSON.parse(body);
  if (json.stop_reason === 'refusal') {
    throw new Error('Claudeがこの内容の生成を見送りました。数値に不自然な入力がないか確認してください。');
  }

  // content は thinking / text ブロックの配列。text だけ連結する。
  var text = (json.content || [])
    .filter(function (b) { return b.type === 'text'; })
    .map(function (b) { return b.text; })
    .join('')
    .trim();

  if (!text) { throw new Error('Claudeの応答に本文が含まれていません: ' + body); }
  return text;
}

/** Messages API にPOSTする。 */
function postToClaude_(apiKey, payload) {
  var headers = {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01'
  };

  // 個人に紐づいたキー（identity-linked）は、どのワークスペースでの
  // リクエストかを一緒に送らないと400になる。ワークスペース単位で
  // 発行したキーの場合は不要なので、設定されていれば載せる。
  var workspaceId = PropertiesService.getScriptProperties()
    .getProperty('ANTHROPIC_WORKSPACE_ID');
  if (workspaceId) {
    headers['anthropic-workspace-id'] = workspaceId.trim();
  }

  return UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: headers,
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
}

/** APIのエラーを、何をすればいいか分かる日本語にする。 */
function claudeErrorMessage_(code, body) {
  var detail = body;
  try {
    var parsed = JSON.parse(body);
    if (parsed.error && parsed.error.message) { detail = parsed.error.message; }
  } catch (e) { /* JSONでなければ本文をそのまま出す */ }

  if (detail.indexOf('anthropic-workspace-id') >= 0) {
    return 'このAPIキーは「個人に紐づいたキー」なので、ワークスペースIDも必要です。\n\n'
      + '対処は2つ。どちらかでOKです。\n'
      + '(A) スクリプト プロパティに ANTHROPIC_WORKSPACE_ID を追加し、'
      + 'platform.claude.com の Settings → Workspaces で開いたワークスペースのID'
      + '（wrkspc_ で始まる文字列）を入れる。\n'
      + '(B) platform.claude.com の API Keys で、ワークスペースを指定して'
      + 'キーを作り直し、ANTHROPIC_API_KEY を差し替える。';
  }
  if (code === 401) {
    return 'APIキーが正しくありません。スクリプト プロパティの ANTHROPIC_API_KEY を確認してください。\n\n' + detail;
  }
  if (code === 400 && detail.indexOf('credit') >= 0) {
    return 'Anthropicの残高が足りません。platform.claude.com の Billing でチャージしてください。\n\n' + detail;
  }
  if (code === 429) {
    return 'リクエストが多すぎます。少し待ってからもう一度実行してください。\n\n' + detail;
  }
  return 'Claude API失敗 (HTTP ' + code + ')\n\n' + detail;
}

/** 【総評】などの見出しで本文を4つに切り分ける。 */
function parseSections_(text) {
  var result = {};
  SECTION_HEADINGS.forEach(function (h) { result[h] = ''; });

  var current = null;
  var buffer = [];

  text.split('\n').forEach(function (line) {
    var heading = null;
    SECTION_HEADINGS.forEach(function (h) {
      if (line.indexOf(h) === 0) { heading = h; }
    });

    if (heading) {
      if (current) { result[current] = buffer.join('\n').trim(); }
      current = heading;
      buffer = [];
      // 見出しと同じ行に本文が続く場合を拾う。
      var rest = line.slice(heading.length).trim();
      if (rest) { buffer.push(rest); }
    } else if (current) {
      buffer.push(line);
    }
  });
  if (current) { result[current] = buffer.join('\n').trim(); }

  // 見出しが1つも取れなかったときは、全文を総評に入れて取りこぼさない。
  var any = SECTION_HEADINGS.some(function (h) { return result[h] !== ''; });
  if (!any) { result['【総評】'] = text; }

  return result;
}
