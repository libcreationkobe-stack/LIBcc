/**
 * YouTubeの実績を、月次KPIの「YouTube」「YouTubeショート」行へ取り込む。
 *
 * MetaとちがってGoogleの中なので、トークンを自分で持たなくていい。
 * スクリプトを動かしている Googleアカウント の権限で読む。
 *
 * 事前準備:
 *   1. Apps Script の左「サービス」＋ から
 *        YouTube Data API v3        （識別子 YouTube）
 *        YouTube Analytics API      （識別子 YouTubeAnalytics）
 *      の2つを追加する
 *   2. 見たいチャンネルに、このスクリプトを動かすGoogleアカウントを
 *      「管理者」として追加してもらう（YouTube Studio → 設定 → 権限）
 *      ※ ここが通っていないと、コードが正しくても数字は返ってこない
 *   3. メニュー「YouTubeの数字を取り込む」
 *
 * 自分のチャンネルなら準備2は要らない。
 */

var YT_CHANNEL_PROP = 'YT_CHANNEL_ID';

/** ショートと通常の境目。YouTubeは3分までをショートとして扱う。 */
var YT_SHORT_SECONDS = 180;

/** チャンネル名（KPIシートのチャネル行）と、YouTube側の区分の対応。 */
var YT_ROWS = [
  {channel: 'YouTube',         type: 'VIDEO_ON_DEMAND'},
  {channel: 'YouTubeショート', type: 'SHORTS'}
];

/* ---------------- 入口 ---------------- */

/** メニューから実行する。今日までの月をまとめて取り込む。 */
function importYouTube() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var kpi = ss.getSheetByName(SHEET_NAME);
  if (!kpi) { throw new Error('「' + SHEET_NAME + '」タブがありません。'); }

  var channel = ytChannel_();
  var start = igStartMonth_(ss);
  var today = new Date();

  // 投稿数は動画の公開日から数える。1回だけ全部読んで、月ごとに振り分ける。
  var uploads = ytUploadsByMonth_(channel.id, start);

  var split = true;          // ショートと通常を分けられたか
  var wrote = [];
  var empty = [];
  var failed = [];
  var latestIndex = -1;

  for (var i = 0; i < MONTHS.length; i++) {
    var span = metaMonthSpan_(start, i);
    if (span.first > today) { break; }

    var report;
    try {
      report = ytReport_(channel.id, span, split);
    } catch (e) {
      if (split && ytIsDimensionError_(e)) {
        // このチャンネルでは区分で分けられない。以降は分けずに続ける。
        split = false;
        failed.push('ショートと通常を分けられなかったので、'
          + 'すべて「YouTube」行にまとめています。');
        i--;
        continue;
      }
      failed.push(MONTHS[i] + '：' + e.message);
      continue;
    }

    if (!report) { empty.push(MONTHS[i]); continue; }

    ytWriteMonth_(kpi, i, report, uploads[ytMonthKey_(span.first)] || {}, split);
    latestIndex = i;
    wrote.push(MONTHS[i]);
  }

  // 登録者数は「いま何人か」しか取れない。一番新しい月にだけ入れる。
  var subscribers = ytSubscribers_(channel.id);
  if (subscribers !== null && latestIndex >= 0) {
    kpi.getRange(col_('フォロワー数') + ytRow_(latestIndex, 'YouTube')).setValue(subscribers);
  }

  var lines = ['チャンネル：' + channel.title];
  if (wrote.length) { lines.push('取り込んだ月：' + wrote.join('・')); }
  if (empty.length) { lines.push('記録が無かった月：' + empty.join('・')); }
  if (failed.length) { lines.push('', failed.join('\n')); }
  if (subscribers !== null) {
    lines.push('登録者数：' + subscribers.toLocaleString()
      + '人（今日の数字なので、一番新しい月にだけ入れています）');
  }
  lines.push('', 'YouTubeにはリーチ・プロフィール表示にあたる数字がないので、'
    + 'その列は空のままです。');

  var message = lines.join('\n');
  Logger.log(message);
  metaNotify_('YouTubeの取り込み', message);
}

/** どのチャンネルを見ているかだけ確かめる。数字は書き込まない。 */
function checkYouTubeSettings() {
  var lines = [];
  var saved = PropertiesService.getScriptProperties().getProperty(YT_CHANNEL_PROP);
  lines.push('チャンネルID：' + (saved || '未設定（自分のチャンネルを使います）'));

  try {
    var channel = ytChannel_();
    lines.push('チャンネル名：' + channel.title);
    lines.push('登録者数：' + (ytSubscribers_(channel.id) || '—'));
  } catch (e) {
    lines.push('チャンネルを読めません：' + e.message);
    lines.push('', 'Apps Scriptの「サービス」に YouTube と YouTubeAnalytics を'
      + '追加しているか確認してください。');
    metaNotify_('YouTubeの設定', lines.join('\n'));
    return;
  }

  // 一番古い月で試すと、後から始めたチャンネルでは必ず空になる。直近の月で試す。
  var start = igStartMonth_(SpreadsheetApp.getActiveSpreadsheet());
  try {
    var span = metaMonthSpan_(start, tkLatestPastIndex_(start));
    lines.push('接続テスト：' + (ytReport_(channel.id, span, true) ? '成功' : '記録なし'));
  } catch (e) {
    lines.push('接続テスト：失敗　' + e.message);
  }

  metaNotify_('YouTubeの設定', lines.join('\n'));
}

/** 他人のチャンネルを見るとき、チャンネルIDを手で入れる。 */
function setYouTubeChannelId() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('YouTubeチャンネルIDを入れる',
    'UC で始まる24文字です。YouTube Studio → 設定 → チャンネル → 詳細設定 に出ています。'
    + '\n空のままOKを押すと、自分のチャンネルに戻ります。', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) { return; }

  var props = PropertiesService.getScriptProperties();
  var id = res.getResponseText().trim();
  if (!id) {
    props.deleteProperty(YT_CHANNEL_PROP);
    ui.alert('自分のチャンネルを見ます。', ui.ButtonSet.OK);
    return;
  }

  var title;
  try {
    title = ytChannelTitle_(id);
  } catch (e) {
    ui.alert('そのチャンネルを読めませんでした', e.message
      + '\n\nIDが正しいか、このGoogleアカウントが管理者に入っているか確認してください。',
      ui.ButtonSet.OK);
    return;
  }

  props.setProperty(YT_CHANNEL_PROP, id);
  ui.alert('設定しました', title + ' の数字を取り込みます。', ui.ButtonSet.OK);
}

/* ---------------- チャンネル ---------------- */

/** 見るチャンネル。指定が無ければ、動かしているアカウント自身のもの。 */
function ytChannel_() {
  var saved = PropertiesService.getScriptProperties().getProperty(YT_CHANNEL_PROP);
  if (saved) { return {id: saved, title: ytChannelTitle_(saved)}; }

  var res = YouTube.Channels.list('id,snippet', {mine: true});
  var items = (res || {}).items || [];
  if (!items.length) {
    throw new Error('このGoogleアカウントにチャンネルがありません。'
      + 'メニューの「YouTubeチャンネルIDを入れる」で指定してください。');
  }
  return {id: items[0].id, title: items[0].snippet.title};
}

function ytChannelTitle_(id) {
  var items = ((YouTube.Channels.list('snippet', {id: id}) || {}).items) || [];
  if (!items.length) { throw new Error('チャンネルが見つかりません。'); }
  return items[0].snippet.title;
}

/** いまの登録者数。非公開にしているチャンネルでは取れない。 */
function ytSubscribers_(id) {
  try {
    var items = ((YouTube.Channels.list('statistics', {id: id}) || {}).items) || [];
    var n = Number((((items[0] || {}).statistics) || {}).subscriberCount);
    return isNaN(n) ? null : n;
  } catch (e) {
    Logger.log('登録者数を取れませんでした: ' + e.message);
    return null;
  }
}

/* ---------------- 実績 ---------------- */

/**
 * その月の再生数など。ショートと通常で分けて返す。
 *
 * 分けるのに使う creatorContentType は、チャンネルによっては通らない。
 * そのときは呼び出し側が split=false で呼び直す。
 */
function ytReport_(channelId, span, split) {
  var range = ytClampSpan_(span);
  var query = {
    ids: 'channel==' + channelId,
    startDate: range.since,
    endDate: range.until,
    metrics: 'views,likes,comments,shares,subscribersGained,subscribersLost'
  };
  if (split) { query.dimensions = 'creatorContentType'; }

  var res = YouTubeAnalytics.Reports.query(query);
  var rows = (res || {}).rows || [];
  if (!rows.length) { return null; }

  var headers = ((res.columnHeaders) || []).map(function (h) { return h.name; });
  var out = {};
  var any = false;

  rows.forEach(function (row) {
    var record = {};
    headers.forEach(function (name, i) { record[name] = row[i]; });
    var type = split ? String(record.creatorContentType || '') : 'ALL';
    out[type] = record;
    if (Number(record.views) > 0) { any = true; }
  });

  return any ? out : null;
}

/**
 * 期間の終わりを今日までにする。TikTokの取り込みからも呼ぶ。
 *
 * 今月を取りにいくと月末が未来の日付になる。Metaは黙って今日までで返すが、
 * YouTubeとTikTokは「まだ来ていない日を含む期間」として弾いてくる。
 */
function ytClampSpan_(span) {
  var today = new Date();
  if (span.last <= today) { return span; }
  return {first: span.first, last: today, since: span.since, until: metaDate_(today)};
}

/** 「その分け方には対応していない」というエラーかどうか。 */
function ytIsDimensionError_(e) {
  return /creatorContentType|dimension/i.test(String(e && e.message));
}

/** 1ヶ月ぶんをKPIシートへ書く。 */
function ytWriteMonth_(kpi, monthIndex, report, uploads, split) {
  YT_ROWS.forEach(function (spec) {
    var record = split ? report[spec.type] : (spec.channel === 'YouTube' ? report.ALL : null);
    var posts = split ? uploads[spec.type] : (spec.channel === 'YouTube' ? uploads.ALL : null);
    if (!record && posts === undefined) { return; }

    var row = ytRow_(monthIndex, spec.channel);
    if (posts !== undefined && posts !== null) {
      kpi.getRange(col_('投稿数') + row).setValue(posts);
    }
    if (!record) { return; }

    var views = Number(record.views);
    if (!isNaN(views)) { kpi.getRange(col_('表示回数') + row).setValue(views); }

    var shares = Number(record.shares);
    if (!isNaN(shares)) { kpi.getRange(col_('保存・シェア') + row).setValue(shares); }
  });
}

/** その月・そのチャネルの行番号。 */
function ytRow_(monthIndex, channel) {
  var index = CHANNELS.indexOf(channel);
  if (index < 0) { throw new Error('CHANNELS に「' + channel + '」がありません。'); }
  return channelFirstRow_(monthIndex) + index;
}

/* ---------------- 投稿数 ---------------- */

/**
 * 公開日ごとの投稿数を数える。ショートかどうかは長さで見分ける。
 *
 * Analytics APIは投稿数を返さないので、動画の一覧から数えるしかない。
 * アップロード用の再生リストを辿るのが一番安く済む（検索は100倍のコストがかかる）。
 */
function ytUploadsByMonth_(channelId, start) {
  var out = {};
  var playlist;
  try {
    var items = ((YouTube.Channels.list('contentDetails', {id: channelId}) || {}).items) || [];
    playlist = (((items[0] || {}).contentDetails || {}).relatedPlaylists || {}).uploads;
  } catch (e) {
    Logger.log('投稿数を数えられませんでした: ' + e.message);
    return out;
  }
  if (!playlist) { return out; }

  var videos = [];
  var pageToken = null;
  var guard = 0;
  do {
    var page = YouTube.PlaylistItems.list('contentDetails', {
      playlistId: playlist, maxResults: 50, pageToken: pageToken
    });
    ((page || {}).items || []).forEach(function (item) {
      var d = item.contentDetails || {};
      if (!d.videoId || !d.videoPublishedAt) { return; }
      videos.push({id: d.videoId, published: new Date(d.videoPublishedAt)});
    });
    pageToken = (page || {}).nextPageToken;
    guard++;
    // 起点より前の動画まで遡ったら、そこで打ち切る（新しい順に並んでいる）
    if (videos.length && videos[videos.length - 1].published < start) { break; }
  } while (pageToken && guard < 20);

  var lengths = ytDurations_(videos.map(function (v) { return v.id; }));

  videos.forEach(function (video) {
    if (video.published < start) { return; }
    var key = ytMonthKey_(video.published);
    if (!out[key]) { out[key] = {ALL: 0}; }

    var seconds = lengths[video.id];
    var type = seconds === undefined ? null
             : (seconds <= YT_SHORT_SECONDS ? 'SHORTS' : 'VIDEO_ON_DEMAND');
    out[key].ALL++;
    if (type) { out[key][type] = (out[key][type] || 0) + 1; }
  });
  return out;
}

/** 動画の長さを秒で。50本ずつまとめて聞く。 */
function ytDurations_(ids) {
  var out = {};
  for (var i = 0; i < ids.length; i += 50) {
    var chunk = ids.slice(i, i + 50);
    var res;
    try {
      res = YouTube.Videos.list('contentDetails', {id: chunk.join(',')});
    } catch (e) {
      Logger.log('動画の長さを取れませんでした: ' + e.message);
      return out;
    }
    ((res || {}).items || []).forEach(function (item) {
      out[item.id] = ytSeconds_((item.contentDetails || {}).duration);
    });
  }
  return out;
}

/** ISO8601（PT1M30S）を秒に直す。 */
function ytSeconds_(iso) {
  var m = String(iso || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) { return undefined; }
  return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
}

function ytMonthKey_(date) {
  return date.getFullYear() + '-' + (date.getMonth() + 1);
}
