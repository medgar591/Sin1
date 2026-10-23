# Sin1

A phone-first game about the inside of a megacorporation in the Sinless setting.
You are the new CEO of a zaibatsu with a deep, simulated hierarchy of ~400 people
who squabble, scheme and compete. Keep the company growing and the board happy,
or lose your job. See [docs/DESIGN.md](docs/DESIGN.md).

## Play

The game is a static web app that installs to your phone's home screen and works
offline. Pushing to `main` deploys it to GitHub Pages
(`.github/workflows/deploy.yml`) once Pages is enabled for the repository
(Settings → Pages → Source: GitHub Actions).

## Develop

```sh
npm install
npm run dev        # local dev server
npm test           # unit, soak and balance tests
npm run typecheck
npm run build      # production build into dist/
```

- `src/sim/` is the simulation: plain TypeScript, no DOM, deterministic from a
  seed. `turn.ts` runs a month; `bots.ts` and `balance.test.ts` play whole games
  to check balance.
- `src/ui/` is the Preact interface.
