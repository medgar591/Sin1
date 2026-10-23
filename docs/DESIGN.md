# Sin1: Design

A phone-first game about the inside of a megacorporation in the Sinless
setting. You are the CEO of a zaibatsu. Beneath you is a deep, simulated
hierarchy of people who squabble, scheme and compete. Keep the company
growing and keep the board happy, or lose your job.

This document is the working design. Sections marked **(open)** still need a
decision.

## Pillars

1. **The org is the game.** The company is a deep, irregular hierarchy of
   people. Managing that hierarchy is how you run the company.
2. **People make it personal.** Everyone has loyalties, ambitions, grudges
   and secrets. Feuds, alliances and backstabbing come out of the simulation.
3. **The executive's view.** You see org charts, reports and numbers. Your
   people handle the details, and you live with how they do it.
4. **Keep your job.** Growth satisfies the board. Losing the board ends the
   game.
5. **Played straight.** Serious corporate drama, not satire.

## Setting

- Sinless, in 2090. We use the Sinless core facts (the grid and Metatron,
  SINs and the sinless, the DIRE act, the zuzu (ㄓ), uplifts, synths, AI ranks,
  the thinning Shan-Effort field, Mammon's quarantine) and the Sinless
  timeline.
- The outside world is abstract: market conditions, timeline news, and
  unnamed rival corps that poach staff or make offers.

## The company

- A zaibatsu with **3 divisions** in different industries, each with 100–150
  people, plus small corporate-function teams under the C-suite.
- Each division is a business line with its own
  budget, revenue, costs, growth, morale and output.
- Corp-level numbers: cash, quarterly profit, an abstract share price driven
  by profit against guidance, and **board confidence**.

## The hierarchy

The company is a tree of **org units**, each led by a person.

| Level | Led by | Notes |
| --- | --- | --- |
| Board | Chair | 5–7 directors. They oversee you. They aren't part of the tree. |
| CEO | You | |
| C-suite | Officers | COO, CFO, Head of Security, Head of Personnel, General Counsel. Each runs a corporate function. |
| Divisions | Division heads | One per business line. |
| Sub-divisions | Sub-division heads | Optional. |
| Teams | Team leads | |
| Sub-teams | Sub-team leads | Optional. |
| Workers | | The people doing the work. |

- **The tree is irregular.** A division may have no sub-divisions, with
  teams reporting straight to its head. A team may have no sub-teams. A small
  corporate function might be a single team.
- **Every unit has a lead**, a budget, a headcount, morale and output. A
  unit's output rolls up into its parent's, and divisions roll up into the
  company.
- **Managers matter.** A unit's output depends on its lead's Work skill, how
  well the lead and their reports get along, morale, budget, and infighting.
  A bad manager drags down everything under them. A feud between two team
  leads hurts the sub-division above them.

## People

- Name, age, heritage (human, Green, Blighted, uplift, synth), and a generated
  portrait or icon.
- Every worker is simulated as an individual person, not as headcount.
- Skills:
  - **Work:** how well they do their job. For a manager, it's a big part of
    how well their unit performs.
  - Management, Operations, Finance and Guile.
- Personality: Loyalty (to their boss, and to you), Ambition, Greed, and two
  traits (principled, paranoid, vain, ruthless and so on).
- Career: role, salary, satisfaction, tenure, performance, and promotion
  history.
- **Most people are neutral.** Plenty of them just do their job. They have no
  strong feelings, no schemes and no clique, and they only stir when something
  happens to them.
- **Relationships:** opinions of the people they work with, tagged as mentor,
  protégé, rival, lover or grudge. A relationship that skips levels has
  pull: a worker close to a senior manager can be shielded from being fired,
  or pulled into that manager's unit.
- **Cliques:** informal factions that cut across the tree, backing their own
  people for promotions and leaning on whoever they can reach.
- **Secrets:** hidden facts (embezzlement, an affair, a pre-hire past, a
  rival corp's payroll) that can be uncovered and used.
- **You** are a person too, with a personal stake, a reputation, and secrets
  others can dig up.

## Your turn (one month)

You have limited **attention**: about three actions a month. You can:

- **Budget:** allocate money down the tree.
- **Personnel:** hire, fire, promote, demote, reassign, set salaries, split the
  bonus pool and grant stock options.
- **Restructure:** move units, merge or split them, or create and dissolve
  levels.
- **Reaching down the tree:** you can act on anyone below you, not just your
  direct reports. Going around the person who should handle it costs you
  their loyalty, and the loyalty of those in between.
  - **Exception:** a person who has come to your attention (a scandal, a
    breakthrough, a viral moment) can be dealt with directly for a short
    time without that penalty.
- **Meet:** one-on-ones to build rapport, make promises, threaten, or probe
  for information. Promises are tracked, and breaking one costs you.
- **Investigate:** have Security dig into a person or a unit. The numbers you
  see are accurate, but what's going on inside a unit (feuds, cliques,
  secrets, who's really doing the work) stays hidden until someone digs.
- **Board:** lobby individual directors.
- **Inbox:** rule on requests and events (raise demands, feuds, accusations,
  resignations, outside offers).
- **Fixer requests:** see below.

## What the NPCs do

Every month each person acts according to their traits, relationships and
place in the tree. They can:

- work, and their performance feeds their unit's output;
- ask for raises, budget or promotion;
- take credit and shift blame up and down the chain;
- undermine a rival;
- form or break alliances;
- court their boss's boss, or the board;
- leak, embezzle;
- quit or defect to an outside corp;
- plot to replace their boss, all the way up to you.

Managers make decisions too: they hire, fire and promote inside their own
units, according to their own loyalties and judgement.

## Quarters

- Earnings are judged against the guidance you set.
- The bonus pool is fought over, from the C-suite down.
- The board meets. Directors raise motions, such as replacing an executive,
  cutting a division's budget, or a no-confidence vote in you. Votes follow
  each director's opinion of you and their ties to whoever is plotting.
- **Succession:** empty seats get filled from below. Cliques lobby, and
  people who are passed over resent it.

## Fixer requests

A stripped-down Sinless run. You ask a fixer to get something: scarce
materials for a unit, a special hire extracted from elsewhere, or dirt on
someone. You pick the budget and whether it must be clean. A report comes
back later with the result and any blowback.

## Ending

The game ends if a no-confidence vote passes, or if you retire. Your score
counts tenure, company growth and your personal fortune, adjusted by how you
left.

## Lives you changed

The people in the company are meant to feel like people, not drones.

- The game keeps a record of every way your decisions touched each person:
  hired, fired, promoted, passed over, given a raise, investigated, exposed,
  rescued, ruined.
- When the game ends (whether you retire or are ousted), an epilogue shows
  the people whose lives you changed the most, for better and worse. Each
  gets a short account of what happened to them under you, and where they
  ended up.

## Interface

Built for a phone, one-handed, portrait. A dark, data-dense corporate
terminal look.

- **Dashboard:** cash, profit, share price, board confidence; trend charts.
- **Org chart:** drill down the tree from the C-suite to the workers.
- **People:** character cards, relationships, cliques, and each person's
  history with you.
- **Board:** directors, their agendas and the vote count.
- **Inbox:** this month's requests and events.

## Technology

- TypeScript web app, installable to the phone home screen (PWA), works
  offline, hosted on GitHub Pages.
- Saves in local storage, with export and import.
- Simulation separated from UI, driven by a seeded RNG so games are
  reproducible and the sim can be unit-tested.

## Open questions

None right now.
