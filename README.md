# Googleビジネスプロフィール 投稿・写真 自動下書きツール（GAS）

スプレッドシートを管理画面にして、**Googleビジネスプロフィール（GBP）の「最新情報」投稿文と写真を自動で下書き準備**するための Google Apps Script プロジェクトです。

- リール動画 → **Notta(+Zapier)で文字起こし** → Claude で投稿文に要約（**パターンA**）
- 写真 + メモ → Claude で投稿文に整形（**パターンB**）
- 完成した投稿文はスプレッドシートに、写真は Drive の「投稿準備済」フォルダに集約

> ⚠️ **このツールは「下書き準備」までを自動化します。** GBP への最終投稿は人が確認してから行う運用です（GBP の Business Profile API は利用申請・審査が必要なため、まずは審査不要のこの形から始められます）。

詳しい全体設計・運用フローは [`docs/SETUP.md`](docs/SETUP.md) を参照してください。

## できること

| 機能 | 内容 |
|------|------|
| 文字起こし | Notta(+Zapier) でリール動画を文字に変換 → 結果をシート/Driveで受け取り |
| 文章生成 | 文字起こし結果・メモ・写真情報から GBP 投稿文を Claude が作成 |
| 写真整理 | Drive / Dropbox から写真を取得し「投稿準備済」フォルダへ |
| 進捗管理 | スプレッドシートで `下書き作成中 → 確認待ち → 投稿済` を管理 |

## 構成ファイル

```
gas/
  appsscript.json   … マニフェスト（権限スコープ）
  Config.gs         … 設定・APIキー（スクリプトプロパティ）
  Menu.gs           … スプレッドシートのカスタムメニュー
  Main.gs           … メイン処理（行を走査して下書きを作る）
  SheetService.gs   … シート読み書き
  DriveService.gs   … Google Drive のファイル取得・整理
  DropboxService.gs … Dropbox のファイル取得
  Transcribe.gs     … Nottaの文字起こし結果を受け取る（シートE列 / Driveの.txt）
  Claude.gs         … Claude API 呼び出し（投稿文生成）
docs/
  SETUP.md          … 導入手順・全体設計
```

## クイックスタート

1. [clasp](https://github.com/google/clasp) を使うか、Apps Script エディタに `gas/` の中身を貼り付け
2. スプレッドシートに「投稿管理」シートを用意（列は `docs/SETUP.md` 参照）
3. スクリプトプロパティに API キーを登録（`Config.gs` 参照）
4. シートのメニュー **［GBP自動化］→［下書きを作成］** を実行
