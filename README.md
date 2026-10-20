# 观潮 · XXBO personal dashboard

A buildless personal finance and news dashboard hosted on GitHub Pages.

- Quotes: Tencent Finance snapshot; each card retains the provider's quote time.
- News: Google News RSS searches with The Verge, BBC Chinese RSS and EastMoney fast-news fallbacks. Titles and source links only; no generated summaries.
- Economic calendar: EastMoney adapter; currently returns no valid report, so the UI explicitly shows unavailable and links to the source page.
- Watchlist, reading status and saved items: localStorage on the current browser. No private holdings are published.
- Scheduled snapshot: `.github/workflows/refresh-dashboard.yml`, every two hours at minute 23, plus manual dispatch. GitHub scheduling can be delayed.

## Refresh locally

Python 3.10+; standard library only:

```sh
python scripts/update_data.py
```

Successful sources replace their own snapshot. Failed sources preserve prior data and expose status; fetch timestamps do not imply live market data. The refresh button only reloads the most recently published JSON; it does not trigger a new server-side fetch.

## Deployment

Set Pages source to **GitHub Actions**. The workflow uploads only `index.html`, `style.css`, `app.js`, `pages.js` and `data/` as the Pages artifact. Script/workflow changes trigger a refresh; manual dispatch also publishes changes to the UI.

## References

The data-source mapping, explicit provenance and cached-snapshot design were informed by [CNEquity](https://github.com/rootSunc/CNEquity). This project uses its own small collector rather than copying CNEquity's code or distributing its data lake. Source availability, formats and usage conditions are controlled by their respective providers. News categories are based on search queries and simple keyword rules, not editorial fact checking.


## Internal pages

Hash routes remain on GitHub Pages and work with refresh, direct links and browser back/forward:

- `#/overview`, `#/news/全部`, `#/news/科技`, `#/watch`, `#/saved`
- `#/news/<category>/article/<id>`: source metadata, available source excerpt, related articles, local personal notes and an explicit external full-article link
- `#/markets/<id>`: quote, daily close chart, period selector, watchlist action
- `#/markets/<id>/history`: daily close records
- `#/calendar`, `#/calendar/<event-id>`: calendar and individual event information when provided

Most feeds supply only titles and links; the site clearly indicates when no excerpt/body is available. It does not embed or claim to host source articles. The most recent 100 opened articles and personal notes are retained only in the current browser.
