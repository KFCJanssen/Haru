# Haru (하루)

Daily Korean study with spaced repetition. Runs in the browser and installs as an app on Windows and phones.

**Live app:** https://kfcjanssen.github.io/haru/

## What it does (v0.1, phase 1)

- **FSRS scheduling** (the same algorithm modern Anki uses) with a 90% target recall by default
- **Sentence cards** with the target word marked: each sentence gives three cards
  - **Read**: Korean sentence → meaning
  - **Listen**: audio only → meaning (browser text-to-speech when the card has no recording)
  - **Produce**: English + sentence with a gap → type the missing Korean word
- Daily new-card limit per deck; sibling cards of the same sentence are spread over different days
- Starter deck of 30 TOPIK II sentences
- Add sentences, browse/search, suspend and delete notes
- Backup and restore to a JSON file
- Works offline once loaded

Keyboard: `Space` shows the answer (then grades Good), `1`–`4` grade, `R` replays audio, `Ctrl+Z` undoes.

## Roadmap

1. ~~Foundation + review loop~~
2. Anki `.apkg` import (all formats, with audio) and export
3. Sync between PC and phone (Supabase)
4. Card editor + Korean Learners' Dictionary auto-fill
5. Reader + sentence mining
6. Shadowing + minimal-pair ear training
7. Grammar points + progress stats (NIKL 6,000 words)
8. Design polish

## Development

```bash
npm install
npm run dev      # http://localhost:5173/haru/
npm test
npm run build    # output in dist/ (not committed)
```

Pushing to `main` builds and deploys to GitHub Pages via `.github/workflows/deploy.yml`.

Stack: React, TypeScript, Vite, vite-plugin-pwa, Dexie (IndexedDB), ts-fsrs.
