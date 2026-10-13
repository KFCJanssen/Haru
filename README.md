# Haru (하루)

Daily Korean study with spaced repetition. Runs in the browser and installs as an app on Windows and phones.

**Live app:** https://kfcjanssen.github.io/Haru/

## What it does (v0.4)

- **Four tabs: Vocabulary, Grammar, Listening, Speaking**, each sorted by TOPIK level (1–6). The structure lives in deck names (`Grammar::TOPIK 2::Evita sentences`), so it survives export to Anki. A sentence's Read card sits in its main tab, its Listen card under Listening and its Produce card under Speaking (grammar keeps Produce in Grammar).
- **Sort into tabs**: one click splits the Evita, Grammar Cheat Sheet, Sounds of Korean and starter decks into tabs and levels, keeping all progress. Any other deck can be moved with Options → Move.
- Each TOPIK level has its own new-cards-per-day limit; studying a level or tab never adds up every sub-deck's limit (same as Anki)
- A sentence's Listen and Speaking cards start the day after you first learned its Read card

- **FSRS scheduling** (the same algorithm modern Anki uses) with a 90% target recall by default
- **Sentence cards** with the target word marked: each sentence gives three cards
  - **Read**: Korean sentence → meaning
  - **Listen**: audio only → meaning (browser text-to-speech when the card has no recording)
  - **Produce**: English + sentence with a gap → type the missing Korean word
- Daily new-card limit per deck and per level; sibling cards of the same sentence are spread over different days
- Starter deck of 30 TOPIK II sentences
- Add sentences, browse/search, suspend and delete notes
- **Anki import**: .apkg files from AnkiWeb or Anki (all three file formats), with audio, images, sub-decks and cloze cards; re-importing updates instead of duplicating
- **Anki export** of any deck (optionally with your progress)
- **Sync between devices** (PC, phone, any browser) through a free Supabase project: decks, audio, progress and settings; works offline and catches up later
- Backup and restore to a JSON file
- Works offline once loaded

Keyboard: `Space` shows the answer (then grades Good), `1`–`4` grade, `R` replays audio, `Ctrl+Z` undoes.

## Roadmap

1. ~~Foundation + review loop~~
2. ~~Anki `.apkg` import (all formats, with audio) and export~~
3. ~~Sync between PC and phone (Supabase)~~
4. Card editor + Korean Learners' Dictionary auto-fill
5. Reader + sentence mining
6. Shadowing + minimal-pair ear training
7. Grammar points + progress stats (NIKL 6,000 words)
8. Design polish

## Development

```bash
npm install
npm run dev      # http://localhost:5173/
npm test
HARU_DECKS=./test-fixtures npm test   # also tests against real .apkg files placed there
npm run build    # output in dist/ (not committed)
```

Pushing to `main` builds and deploys to GitHub Pages via `.github/workflows/deploy.yml`.

Stack: React, TypeScript, Vite, vite-plugin-pwa, Dexie (IndexedDB), ts-fsrs, Supabase (auth, Postgres, storage).

## Sync setup

The Supabase schema is in `supabase/schema.sql` (run it once in the project's SQL editor). The project URL and publishable key in `src/supabase.ts` are public by design; row-level security limits every user to their own rows and files.
