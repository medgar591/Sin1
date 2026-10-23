# Sin1: Design

A phone-first management game about running a megacorporation in the Sinless
setting. You are the CEO of a young zaibatsu in a walled enclave with no
government, fighting other corps for holdings, stock and people while keeping
your own board from replacing you.

This document is the working design. Sections marked **(open)** still need a
decision.

## Pillars

1. **Running the corp is the game.** Growing subsidiaries, moving money and
   managing people come first. Everything else serves that.
2. **Stock is the weapon.** Corps fight mostly through ownership: buying
   stakes, swapping shares, proxy fights and hostile takeovers.
3. **People make it personal.** Every corp is a cast of executives with
   loyalties, ambitions and grudges. Deals are cut with people, not
   spreadsheets, and your own people can turn on you.
4. **The executive's view.** You see charts, maps, org charts and reports.
   Your people handle the details, and you live with how they do it.
5. **Runs are a tool, not the main loop.** Covert jobs are fleshed out
   but sit alongside deals and stock moves as one option among several.
6. **Played straight.** The tone is serious corporate drama, not satire.

## Setting

- Sinless, in 2090. We use the Sinless core facts (the grid and Metatron,
  SINs and the sinless, the DIRE act, the zuzu (ㄓ), uplifts, synths, AI ranks,
  the thinning Shan-Effort field, Mammon's quarantine) and the Sinless
  timeline.
- The game takes place in a **generic walled enclave** with no governing
  body. Corps and factions squabble over it directly. The enclave doesn't
  have a fixed identity. It's generated per game.
- Timeline events surface as news and move markets (for example, the field
  dropping to 60% in August 2090 boosts manon-related demand).

## Game setup

- **Your corp:** name, colour, and two **culture traits** (e.g. Ruthless,
  Paternalistic, Image-Obsessed, Lean, Secretive, Innovative). Traits bias
  board expectations, staff loyalty, crew pricing and how others react to
  you. You pick the industry of your first subsidiary.
- **Opponents:** a configurable number of AI corps. Each one gets a
  configurable **size** (e.g. Startup, Mid-cap, Large, Megacorp). Megacorps
  are DIRE-sovereign giants: very hard to take over and slow to act, but
  dangerous when provoked.
- **Seed:** each game is generated from a seed that can be shared to replay
  the same enclave and opponents.

## Time

- **One turn = one month.**
- **Every third turn is a quarter:** earnings land, guidance is judged, and the
  board meets.
- Open-ended. The game ends when you are ousted, or when you choose to retire.

## The map

- The enclave is a set of **sectors** shown on a stylised map.
- Each sector shows **who holds what there**: every corp's facilities and
  holdings, plus faction turf. It works at a glance, like a territory map.
- Sectors differ in wealth, risk and which industries thrive there.
  Facilities in a sector pay its costs and share its risks: faction trouble,
  rival pressure, events.
- This deliberately isn't the full Sinless sector sheet. Sectors exist to
  place holdings and show territory, not to be ground through resource by
  resource.

## Corps and subsidiaries

Every corp, yours included, is a **holding company with subsidiaries**.

- **Industries:** Food, Pharma, Security, Cyberware, Media, Logistics,
  Finance, Construction, Grid Services, Manastelliate.
- **A subsidiary** has an industry, the sectors its facilities sit in,
  revenue, margin, assets, headcount, morale, R&D level, and a **division
  head**.
- **Your levers per subsidiary:** invest capital, set a stance (expand,
  maintain, harvest, cut costs), open or close facilities, and appoint or
  fire its head.
- **Portfolio moves:** found a new subsidiary, buy one, sell or spin one off,
  merge two.
- **Synergies:** industries feed each other. Logistics cheapens Food,
  Security protects everything, Media softens scandals, Finance lowers
  borrowing costs. Building a chain that supports itself is core strategy.

## Markets

- Each industry is a market with total demand, which moves with events and
  the timeline, and market share held by the corps in it.
- A subsidiary's revenue comes from its share of its market. Share moves
  with investment, R&D, price, reputation and rival action.

## Stock and ownership (the main battleground)

- **Every corp is public** and has a share registry: founders and insiders,
  board members, other corps, and the float.
- **Share price** responds to earnings vs guidance, growth, scandals, rumours
  and visible buying pressure.
- **Moves:**
  - Buy or sell any corp's shares on the market (large buys move the price
    and get noticed).
  - **Cross-holdings:** swap shares with an ally to lock up votes and defend
    against takeovers.
  - **Tender offers:** offer shareholders a premium directly.
  - **Proxy fights:** win shareholder votes to replace board members.
  - **Hostile takeover:** gain control of a corp through majority stake or
    board control. You absorb its subsidiaries and its people (who may not
    be happy about it).
  - **Defence:** buybacks, issuing shares to friendly holders, poison pills,
    white knights.
  - **Your own stake:** you personally hold shares in your corp. Diluting it
    to raise cash weakens your grip on the board.

## People

A full cast, in every corp.

- **Characters** have a role, competence in a few areas, loyalty, ambition,
  traits (greedy, principled, paranoid, vain, etc.), a personal share stake,
  and **relationships** (allies, rivals, mentors, lovers, grudges) with
  other characters, across corps too.
- **Roles:** CEO, board members, division heads, key staff (head of security,
  CFO, fixer contact, chief researcher), and their deputies.
- **Career mechanics:** salary, bonuses, raises, promotions and succession.
  People ask for raises, fight over bonus pools, resent being passed over,
  and groom successors.
- **Drama:** events come from the cast. Someone leaks, someone defects,
  two division heads feud, a deputy undermines their boss, a board member
  courts your CFO to replace you.
- **Meetings:** you can meet characters in other corps and cut deals. For
  example, a rival division head might:
  - sell you their personal shares, or vote them your way;
  - leak earnings, plans or dirt;
  - sabotage their own division to drop the share price before your takeover;
  - defect to you, bringing staff or a whole subsidiary with them;
  - in return for money, a promotion promise, protection, or the head of
    their rival.

  Deals are negotiated, and a character's traits and relationships set what
  they want and whether they keep their word.
- **Your own people** are subject to all of this too. Rivals court them.

## The board and your job

- Your board has 5–7 members, each with an agenda (growth, safety,
  dividends, an outside corp's interests, personal ambition). Corps that buy
  into you can win seats.
- **Quarterly guidance:** you announce a target. Beating it builds board
  confidence and raises the share price. Missing it, or a scandal that traces
  to you, does the reverse.
- **Board confidence** falls to a no-confidence vote, which you can fight by
  lobbying members and cutting side deals. Lose it and the game ends, scored
  by how you went out.

## Runs

A secondary but fleshed-out tool for covert action against corps,
characters and factions.

1. **Design the job:** target (a facility, a subsidiary, a character, a
   faction), goal (steal R&D, sabotage, extract, eliminate, plant evidence,
   gather blackmail, protect), high-level **restrictions** (no killing, no
   trace, deadline) and **bonuses** for actions you want (extra paydata, zero
   casualties).
2. **Canvas and negotiate:** a fixer brings candidate crews. Crew members
   have roles, skills, reputation, quirks and outside ties. You haggle over
   pay, advance and support. Restrictions change price and the chance they
   get broken.
3. **The run:** hands-off once negotiation closes. It's lightly simulated in
   phases (legwork, entry, objective, exit) using Sinless-style dice pools
   against the target's security, with operational heat rising as it goes
   wrong.
4. **Debrief and reaction:** an after-action report (outcome, collateral,
   traceability, betrayal), then one reaction: pay in full, short them, bury
   it, or clean up loose ends. Each has consequences.

Rival corps run operations against you too. Your security spending and your
Security subsidiary decide how well you hold up.

## Factions

Gangs, street groups and other non-corp powers that share the enclave. They
stay light: they hold turf on the map, raise or lower the cost and risk of
operating in a sector, and can be paid off, hired or fought.

## Interface

Built for a phone, one-handed, portrait.

- **Dashboard:** cash, revenue, upkeep, share price, board confidence; trend
  charts.
- **Map:** sectors and holdings.
- **Portfolio:** subsidiaries and their numbers.
- **Markets & Stock:** share registries, prices, ownership moves.
- **People:** org charts for every corp, character cards, relationships.
- **Ops:** runs being planned, active and debriefed.
- **Inbox:** this turn's news, requests and events needing decisions.

## Technology

- TypeScript web app, installable to the phone home screen (PWA), works
  offline, hosted on GitHub Pages.
- Saves in local storage, with export and import.
- Simulation separated from UI, driven by a seeded RNG so games are
  reproducible and the sim can be unit-tested.

## Proposed v1 scope

**In v1:**

- Corp founding and opponent configuration (count and size).
- A generated enclave map with holdings.
- Subsidiaries, a core set of industries, markets and basic synergies.
- Share registries, trading, cross-holdings, tender offers and hostile
  takeover of whole corps.
- The cast: characters with loyalty, ambition, traits and relationships;
  salaries, bonuses, raises, promotion and succession; a starter set of drama
  events.
- Meetings and deals with rival characters.
- Your board, quarterly guidance and the no-confidence vote.
- Runs: job design, crew negotiation, simulated run, debrief and one reaction.
- AI rivals that invest, trade stock, make deals and occasionally run ops.
- Light factions.

**Later:**

- Proxy fights and advanced defences (poison pills, white knights).
- R&D projects and named products.
- Deeper factions and sector events.
- Magic and grid specialisms.
- Crossing the DIRE line into sovereignty.
- Expansion beyond the enclave.

## Open questions

- **(open)** Does crossing the DIRE line (ㄓ1B GDP) matter in v1: a milestone, a
  score, or nothing yet?
- **(open)** Is the player a character in the cast: stats, relationships, a
  personal fortune, someone others can scheme against directly?
- **(open)** How is a game scored when it ends?
- **(open)** Visual style.
