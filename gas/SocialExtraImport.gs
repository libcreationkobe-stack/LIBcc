/**
 * 「詳細データ」タブ。月次KPIに載せるほどではないが、見たい数字をまとめて取る。
 *
 * 月次KPIは クライアントに見せる数字だけを載せる場所なので、
 * 反応の内訳やフォロワーの属性はここに分ける。自社用。
 *
 * 取るもの:
 *   Instagram  いいね・コメント・保存・シェア・総反応・反応した人数・フォロー増減（月ごと）
 *              フォロワーの年齢／性別／地域（今日時点）
 *              フォロワーがオンラインの時間帯
 *   Facebook   ページの表示回数・リーチ・反応・ページ表示・いいね増減（月ごと）
 *
 * トークンは月次KPIと同じものを使う。追加の権限は Facebook を見るときだけ:
 *   read_insights（ページのインサイト）
 * Instagram側は instagram_manage_insights があれば足りる。
 *
 * Metaは版ごとに指標を止めるので、指標は1つずつ諦められる作りにしてある。
 * 取れなかったものは、シートの一番下に理由付きで残す。
 */

var EXTRA_SHEET_NAME = '詳細データ';
var FB_PAGE_PROP = 'FB_PAGE_ID';

/** 月ごとに取るInstagramの反応。1回でまとめて聞く。 */
var IG_ENGAGE_METRICS = [
  {api: 'likes',              label: 'いいね'},
  {api: 'comments',           label: 'コメント'},
  {api: 'saves',              label: '保存'},
  {api: 'shares',             label: 'シェア'},
  {api: 'total_interactions', label: '総反応'},
  {api: 'accounts_engaged',   label: '反応した人数'}
];

/** フォロワーの属性。lifetime なので過去にさかのぼれない。 */
var IG_DEMOGRAPHICS = [
  {breakdown: 'age',     title: 'フォロワーの年齢',   limit: 0},
  {breakdown: 'gender',  title: 'フォロワーの性別',   limit: 0},
  {breakdown: 'city',    title: 'フォロワーの地域（市区町村・上位10）', limit: 10},
  {breakdown: 'country', title: 'フォロワーの地域（国・上位5）',        limit: 5}
];

/**
 * Facebookページの指標。Metaがよく止めるので、使う前に1度だけ試して
 * 通ったものだけを使う。ここに並べたものが全部通る前提では書かない。
 */
var FB_METRICS = [
  {api: 'page_impressions',        label: '表示回数',   mode: 'sum'},
  {api: 'page_impressions_unique', label: 'リーチ',     mode: 'sum'},
  {api: 'page_post_engagements',   label: '反応',       mode: 'sum'},
  {api: 'page_views_total',        label: 'ページ表示', mode: 'sum'},
  {api: 'page_fan_adds',           label: 'いいね増',   mode: 'sum'},
  {api: 'page_fans',               label: 'ページいいね', mode: 'last'}
];

/**
 * Facebookの数字のうち、月次KPIのFacebook行にも入れるもの。
 *
 * リーチは入れない。日ごとの重複しない人数を足し上げた数なので、
 * 月のリーチとしては多すぎる。詳細データ側に注記付きで置くだけにする。
 */
var FB_TO_KPI = [
  {api: 'page_impressions', key: '表示回数'},
  {api: 'page_views_total', key: 'プロフィール表示'},
  {api: 'page_fans',        key: 'フォロワー数'}
];

/* ---------------- 入口 ---------------- */

/** メニューから実行する。タブを作り直して、今日までの月を埋める。 */
function importSocialExtras() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var token = metaToken_();
  var account = igAccount_(token);
  var start = igStartMonth_(ss);
  var months = exPastMonths_(start);

  var notes = [];
  var blocks = [];

  blocks.push(exInstagramEngagement_(token, account.id, start, months, notes));
  IG_DEMOGRAPHICS.forEach(function (d) {
    var block = exDemographics_(token, account.id, d, notes);
    if (block) { blocks.push(block); }
  });
  var online = exOnlineFollowers_(token, account.id, notes);
  if (online) { blocks.push(online); }

  var page = exFacebookPage_(token, notes);
  var fbMonths = 0;
  if (page) {
    var fb = exFacebookBlock_(token, page, start, months, notes);
    if (fb) {
      blocks.push(fb);
      fbMonths = exWriteFacebookToKpi_(ss, fb.monthly);
    }
  }

  exRender_(ss, account, page, blocks, notes);

  var message = ['「' + EXTRA_SHEET_NAME + '」タブを更新しました。',
                 'アカウント：@' + account.username];
  if (page) { message.push('Facebookページ：' + page.name); }
  else { message.push('Facebookページ：見ていません'); }
  if (fbMonths) {
    message.push('月次KPIのFacebook行にも ' + fbMonths + 'ヶ月ぶん入れました'
      + '（表示回数・ページ表示・フォロワー数）。');
  }
  if (notes.length) {
    message.push('', '取れなかったもの（シート下部にも出ています）：');
    message = message.concat(notes.map(function (n) { return '・' + n; }));
  }
  metaNotify_('詳細データの取り込み', message.join('\n'));
}

/** どのFacebookページを見ているかを選び直す。 */
function resetFacebookPage() {
  PropertiesService.getScriptProperties().deleteProperty(FB_PAGE_PROP);
  SpreadsheetApp.getActive().toast(
    '次に「詳細データを取り込む」を実行したとき、どのFacebookページか聞き直します。');
}

/* ---------------- Instagram ---------------- */

/** 月ごとの反応。フォロー増減だけは内訳で聞かないと足し算になってしまう。 */
function exInstagramEngagement_(token, accountId, start, months, notes) {
  var head = ['月'].concat(IG_ENGAGE_METRICS.map(function (m) { return m.label; }))
                   .concat(['フォロー増', 'フォロー解除', '純増']);
  var rows = [];
  var missed = {};
  var dropped = {};   // 一度ダメだった指標は、残りの月では聞かない

  months.forEach(function (month) {
    var span = metaMonthSpan_(start, month.index);
    var totals = {};

    igWindows_(span).forEach(function (w) {
      var wanted = IG_ENGAGE_METRICS.map(function (m) { return m.api; })
        .filter(function (api) { return !dropped[api]; });
      var got = wanted.length
        ? exTotalValues_(token, accountId, wanted,
                         {since: w.since, until: w.until}, missed, dropped)
        : {};
      Object.keys(got).forEach(function (k) { totals[k] = (totals[k] || 0) + got[k]; });

      var follow = exBreakdown_(token, accountId, 'follows_and_unfollows', 'follow_type',
                                {since: w.since, until: w.until}, missed);
      (follow || []).forEach(function (item) {
        var key = /UN/i.test(item.key) ? '解除' : '増';
        totals[key] = (totals[key] || 0) + item.value;
      });
    });

    var row = [month.label];
    IG_ENGAGE_METRICS.forEach(function (m) { row.push(exCell_(totals[m.api])); });
    row.push(exCell_(totals['増']), exCell_(totals['解除']));
    row.push(typeof totals['増'] === 'number' || typeof totals['解除'] === 'number'
      ? (totals['増'] || 0) - (totals['解除'] || 0) : '');
    rows.push(row);
  });

  exCarryNotes_(missed, notes);
  return {title: '反応の内訳（Instagram・月ごと）', head: head, rows: rows};
}

/** フォロワーの属性。100人未満のアカウントはMetaが返さない。 */
function exDemographics_(token, accountId, spec, notes) {
  var missed = {};
  var items = exBreakdown_(token, accountId, 'follower_demographics', spec.breakdown,
                           {period: 'lifetime', timeframe: 'this_month'}, missed);
  exCarryNotes_(missed, notes);
  if (!items || !items.length) { return null; }

  items.sort(function (a, b) { return b.value - a.value; });
  if (spec.limit) { items = items.slice(0, spec.limit); }
  if (spec.breakdown === 'age') {
    items.sort(function (a, b) { return a.key < b.key ? -1 : 1; });
  }

  var total = 0;
  items.forEach(function (i) { total += i.value; });

  return {
    title: spec.title,
    head: ['区分', '人数', '割合'],
    rows: items.map(function (i) {
      return [exGenderLabel_(i.key), i.value, total ? i.value / total : ''];
    }),
    percentColumn: 3
  };
}

/** フォロワーが見ている時間帯。投稿時間を決めるのに使う。 */
function exOnlineFollowers_(token, accountId, notes) {
  var missed = {};
  var data = exRequest_(token, accountId, 'online_followers',
                        {period: 'lifetime'}, missed);
  exCarryNotes_(missed, notes);
  if (!data) { return null; }

  // 日ごとに「0時台に何人」という形で返る。日をまたいで平均する。
  var sums = {}, days = 0;
  ((data.values) || []).forEach(function (v) {
    if (!v.value || typeof v.value !== 'object') { return; }
    days++;
    Object.keys(v.value).forEach(function (hour) {
      sums[hour] = (sums[hour] || 0) + v.value[hour];
    });
  });
  if (!days) { return null; }

  var rows = [];
  for (var h = 0; h < 24; h++) {
    if (sums[h] === undefined) { continue; }
    rows.push([h + '時台', Math.round(sums[h] / days)]);
  }
  if (!rows.length) { return null; }

  return {title: 'フォロワーがオンラインの時間帯（1日平均）', head: ['時間', '人数'], rows: rows};
}

/* ---------------- Facebook ---------------- */

/**
 * 見るページを決める。1つしか無ければ黙って決める。
 * ページのインサイトはユーザートークンでは読めないので、ページトークンも一緒に持つ。
 */
function exFacebookPage_(token, notes) {
  var props = PropertiesService.getScriptProperties();
  var saved = props.getProperty(FB_PAGE_PROP);
  var pages;
  try {
    pages = exListPages_(token);
  } catch (e) {
    notes.push('Facebookページの一覧を取れませんでした：' + e.message);
    return null;
  }

  if (!pages.length) {
    notes.push('Facebookページが見つかりません。'
      + 'トークンに pages_show_list と read_insights が入っているか確認してください。');
    return null;
  }

  for (var i = 0; i < pages.length; i++) {
    if (pages[i].id === saved) { return pages[i]; }
  }

  var chosen = pages.length === 1 ? pages[0] : exAskPage_(pages);
  if (!chosen) { return null; }
  props.setProperty(FB_PAGE_PROP, chosen.id);
  return chosen;
}

/** 複数あるときに選んでもらう。選ばなければFacebookは飛ばす。 */
function exAskPage_(pages) {
  var ui;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {
    return null;    // エディタから実行した。Facebookだけ飛ばす。
  }
  var menu = pages.map(function (p, i) { return (i + 1) + '. ' + p.name; }).join('\n');
  var res = ui.prompt('どのFacebookページの数字を取り込みますか',
    menu + '\n\n番号を入れてください。空のままOKを押すと、Facebookは取り込みません。',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) { return null; }

  var index = parseInt(res.getResponseText().trim(), 10) - 1;
  if (isNaN(index) || index < 0 || index >= pages.length) { return null; }
  return pages[index];
}

/** トークンで見えるページを、ページトークン付きで集める。 */
function exListPages_(token) {
  var out = [];
  var seen = {};

  var collect = function (path) {
    var data = igTry_(function () {
      return igRequest_(igUrl_(path, {fields: 'name,access_token', limit: 100}, token));
    });
    (((data || {}).data) || []).forEach(function (page) {
      if (!page.id || seen[page.id]) { return; }
      seen[page.id] = true;
      out.push({id: page.id, name: page.name || page.id, token: page.access_token || token});
    });
  };

  collect('me/accounts');
  var businesses = igTry_(function () {
    return igRequest_(igUrl_('me/businesses', {fields: 'name', limit: 100}, token));
  });
  (((businesses || {}).data) || []).forEach(function (biz) {
    collect(biz.id + '/owned_pages');
    collect(biz.id + '/client_pages');
  });

  return out;
}

/** ページの月ごとの数字。通る指標を先に見極めてから、月をまわす。 */
function exFacebookBlock_(token, page, start, months, notes) {
  if (!months.length) { return null; }

  var probe = metaMonthSpan_(start, months[months.length - 1].index);
  var usable = FB_METRICS.filter(function (m) {
    return exFbFetch_(page, [m.api], probe) !== null;
  });
  FB_METRICS.forEach(function (m) {
    if (usable.indexOf(m) < 0) {
      notes.push('Facebookの「' + m.label + '」は、いまのAPIでは取れませんでした。');
    }
  });
  if (!usable.length) { return null; }

  var monthly = [];
  var rows = months.map(function (month) {
    var span = metaMonthSpan_(start, month.index);
    var got = exFbFetch_(page, usable.map(function (m) { return m.api; }), span) || {};
    var values = {};
    var row = [month.label];

    usable.forEach(function (m) {
      var series = got[m.api];
      if (!series || !series.length) { row.push(''); return; }
      var value;
      if (m.mode === 'last') {
        value = series[series.length - 1];
      } else {
        value = 0;
        series.forEach(function (v) { value += v; });
      }
      values[m.api] = value;
      row.push(value);
    });

    monthly.push({index: month.index, values: values});
    return row;
  });

  return {
    title: 'Facebookページ（月ごと）　' + page.name,
    head: ['月'].concat(usable.map(function (m) { return m.label; })),
    rows: rows,
    monthly: monthly,
    note: 'リーチは日ごとの数を足しています。同じ人を複数日で数えるので、実人数より多く出ます。'
  };
}

/** ページのインサイトを日別で取る。取れなければ null。 */
function exFbFetch_(page, metrics, span) {
  var data = igTry_(function () {
    return igRequest_(igUrl_(page.id + '/insights',
      {metric: metrics.join(','), period: 'day',
       since: span.since, until: span.until}, page.token));
  });
  if (!data || !data.data) { return null; }

  var out = {};
  data.data.forEach(function (m) {
    var series = [];
    (m.values || []).forEach(function (v) {
      if (typeof v.value === 'number') { series.push(v.value); }
    });
    out[m.name] = series;
  });
  return out;
}

/**
 * 月次KPIのFacebook行に転記する。書けた月数を返す。
 *
 * 詳細データはあくまで自社用なので、クライアントに見せる表にも出しておく。
 * Facebook行はこれまで手入力だった。
 */
function exWriteFacebookToKpi_(ss, monthly) {
  var kpi = ss.getSheetByName(SHEET_NAME);
  if (!kpi || !monthly || !monthly.length) { return 0; }

  var channelIndex = CHANNELS.indexOf('Facebook');
  if (channelIndex < 0) { return 0; }

  var wrote = 0;
  monthly.forEach(function (month) {
    var row = channelFirstRow_(month.index) + channelIndex;
    var any = false;
    FB_TO_KPI.forEach(function (m) {
      var value = month.values[m.api];
      if (typeof value !== 'number') { return; }
      kpi.getRange(col_(m.key) + row).setValue(value);
      any = true;
    });
    if (any) { wrote++; }
  });
  return wrote;
}

/* ---------------- Metaへの問い合わせ ---------------- */

/** metric_type=total_value で数値だけ取る。取れなかった指標は missed に理由を残す。 */
function exTotalValues_(token, accountId, metrics, params, missed, dropped) {
  var out = {};
  var ask = function (names) {
    var query = {metric: names.join(','), period: 'day', metric_type: 'total_value'};
    Object.keys(params).forEach(function (k) { query[k] = params[k]; });

    var data;
    try {
      data = igRequest_(igUrl_(accountId + '/insights', query, token));
    } catch (e) {
      return e;
    }
    (data.data || []).forEach(function (m) {
      var v = m.total_value && m.total_value.value;
      if (typeof v === 'number') { out[m.name] = v; }
    });
    return null;
  };

  // まとめて聞いて、1つでも弾かれたら1つずつ聞き直す。
  // どれが原因かは返事に書かれないので、切り分けはこちらでやるしかない。
  if (ask(metrics)) {
    metrics.forEach(function (name) {
      var err = ask([name]);
      if (!err) { return; }
      missed[name] = err.message;
      if (dropped) { dropped[name] = true; }
    });
  }
  return out;
}

/** 内訳付きで取る。[{key, value}] を返す。 */
function exBreakdown_(token, accountId, metric, breakdown, params, missed) {
  var query = {metric: metric, metric_type: 'total_value', breakdown: breakdown};
  if (!params.period) { query.period = 'day'; }
  Object.keys(params).forEach(function (k) { query[k] = params[k]; });

  var data;
  try {
    data = igRequest_(igUrl_(accountId + '/insights', query, token));
  } catch (e) {
    missed[metric + '（' + breakdown + '）'] = e.message;
    return null;
  }

  var out = [];
  (data.data || []).forEach(function (m) {
    var breakdowns = (m.total_value || {}).breakdowns || [];
    breakdowns.forEach(function (b) {
      (b.results || []).forEach(function (r) {
        var key = (r.dimension_values || [])[0];
        if (key === undefined || typeof r.value !== 'number') { return; }
        out.push({key: String(key), value: r.value});
      });
    });
  });
  return out;
}

/** 内訳の要らない、昔ながらの形の指標を取る。 */
function exRequest_(token, accountId, metric, params, missed) {
  var query = {metric: metric};
  Object.keys(params).forEach(function (k) { query[k] = params[k]; });

  var data;
  try {
    data = igRequest_(igUrl_(accountId + '/insights', query, token));
  } catch (e) {
    missed[metric] = e.message;
    return null;
  }
  return (data.data || [])[0] || null;
}

/* ---------------- シートに書く ---------------- */

/** 今日までの月だけを返す。未来の月に空行を並べても読みにくいだけなので。 */
function exPastMonths_(start) {
  var today = new Date();
  var out = [];
  for (var i = 0; i < MONTHS.length; i++) {
    if (metaMonthSpan_(start, i).first > today) { break; }
    out.push({index: i, label: MONTHS[i]});
  }
  return out;
}

/** ブロックを上から順に並べる。列数はブロックごとに違ってよい。 */
function exRender_(ss, account, page, blocks, notes) {
  var sheet = ss.getSheetByName(EXTRA_SHEET_NAME);
  if (!sheet) { sheet = ss.insertSheet(EXTRA_SHEET_NAME); }

  sheet.clear();
  sheet.clearNotes();
  var width = 1;
  blocks.forEach(function (b) { width = Math.max(width, b.head.length); });
  width = Math.max(width, 4);

  sheet.getRange(1, 1, 1, width).merge()
    .setValue('詳細データ（自社用）')
    .setBackground(COLOR_NAVY).setFontColor('#ffffff')
    .setFontSize(14).setFontWeight('bold').setVerticalAlignment('middle');
  sheet.setRowHeight(1, 32);

  sheet.getRange(2, 1, 1, width).merge().setValue(
    '@' + account.username
    + '　/　Facebook：' + (page ? page.name : '見ていません')
    + '　/　更新：' + Utilities.formatDate(new Date(), 'JST', 'yyyy/MM/dd HH:mm'))
    .setFontColor('#666666');

  var row = 4;
  blocks.forEach(function (block) {
    row = exWriteBlock_(sheet, row, block, width);
  });

  if (notes.length) {
    sheet.getRange(row, 1).setValue('取れなかったもの').setFontWeight('bold')
      .setFontColor('#c00000');
    row++;
    notes.forEach(function (n) {
      sheet.getRange(row, 1, 1, width).merge().setValue('・' + n).setFontColor('#666666');
      row++;
    });
    row++;
  }

  sheet.setColumnWidth(1, 150);
  for (var c = 2; c <= width; c++) { sheet.setColumnWidth(c, 110); }
  sheet.setFrozenRows(2);
}

/** 見出し・ヘッダー・中身を1ブロックぶん書いて、次の開始行を返す。 */
function exWriteBlock_(sheet, row, block, width) {
  sheet.getRange(row, 1, 1, width).merge().setValue('■ ' + block.title)
    .setBackground(COLOR_MONTH_BG).setFontWeight('bold');
  row++;

  var cols = block.head.length;
  sheet.getRange(row, 1, 1, cols).setValues([block.head])
    .setBackground(COLOR_MONTH_HEAD).setFontColor('#ffffff')
    .setFontWeight('bold').setHorizontalAlignment('center');
  row++;

  if (block.rows.length) {
    var body = sheet.getRange(row, 1, block.rows.length, cols);
    body.setValues(block.rows);
    body.setBorder(true, true, true, true, true, true, COLOR_BORDER,
                   SpreadsheetApp.BorderStyle.SOLID);
    if (cols > 1) {
      sheet.getRange(row, 2, block.rows.length, cols - 1).setNumberFormat('#,##0');
    }
    if (block.percentColumn) {
      sheet.getRange(row, block.percentColumn, block.rows.length, 1)
        .setNumberFormat('0.0%');
    }
    row += block.rows.length;
  }

  if (block.note) {
    sheet.getRange(row, 1, 1, width).merge().setValue('※ ' + block.note)
      .setFontColor('#666666').setFontSize(9);
    row++;
  }
  return row + 1;
}

/** 数字が無いときは空にする。0と「取れなかった」を混ぜない。 */
function exCell_(value) {
  return typeof value === 'number' ? value : '';
}

/** 指標ごとの失敗理由を、重複を潰してまとめる。名前は日本語に直す。 */
function exCarryNotes_(missed, notes) {
  Object.keys(missed).forEach(function (key) {
    var line = exMetricLabel_(key) + '：' + missed[key];
    if (notes.indexOf(line) < 0) { notes.push(line); }
  });
}

/** APIの指標名を、シートに出している日本語に直す。 */
function exMetricLabel_(api) {
  for (var i = 0; i < IG_ENGAGE_METRICS.length; i++) {
    if (IG_ENGAGE_METRICS[i].api === api) { return IG_ENGAGE_METRICS[i].label; }
  }
  if (api.indexOf('follows_and_unfollows') === 0) { return 'フォロー増減'; }
  if (api.indexOf('follower_demographics') === 0) {
    var m = api.match(/（(.+)）/);
    return 'フォロワーの属性' + (m ? '（' + m[1] + '）' : '');
  }
  if (api === 'online_followers') { return 'オンラインの時間帯'; }
  return api;
}

/** Metaが返す区分名を日本語にする。年齢や地名はそのまま。 */
function exGenderLabel_(key) {
  if (key === 'M') { return '男性'; }
  if (key === 'F') { return '女性'; }
  if (key === 'U') { return '不明'; }
  return key;
}
