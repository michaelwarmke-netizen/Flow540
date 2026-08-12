# 📝 Plan: Revise Demo Seed Data to Match Death Star Transcripts

## Executive Summary
This plan revises the retrospective demo seed data in the application (`src/helpers/retroRepository.js`) and documentation (`docs/hackathon_demo_plan.md`) to use the **Galactic Empire / Death Star Construction** theme from `docs/transcripts/`.

### Sprint Timeline & Status (Relative to Current Date: Aug 12, 2026)

| Sprint ID | Display Name | Start Date | End Date | Status | Retro Transcript Uploaded? |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `sprint-20` | **Sprint 1 — Primary Structure & Reactor Ring** | 2026-06-29 | 2026-07-10 | Past Sprint | Yes (`retro-sprint-20`) |
| `sprint-21` | **Sprint 2 — Superlaser Control & Reactor Shielding** | 2026-07-13 | 2026-07-24 | Past Sprint | Yes (`retro-sprint-21`) |
| `sprint-22` | **Sprint 3 — Emergency Heat Sinks & Exhaust Audit** | 2026-07-27 | 2026-08-07 | Completed | No (Pending Intake) |
| `sprint-23` | **Sprint 4 — Operational Readiness & Infiltration Testing** | 2026-08-10 | 2026-08-21 | Current Sprint | In Progress (Live Retro Demo) |

> **Note on Sprint IDs**: We keep the existing database IDs (`sprint-20` through `sprint-23`) unchanged to avoid breakage in tests and component fallbacks. Only the display names, dates, and thematic content change.

---

## 1. Character & Narrative Mapping

### Team & Participants
| Character | Role / Specialty |
| :--- | :--- |
| **Darth Sidious** | Executive Owner / Emperor (Meeting Owner) |
| **Darth Vader** | Primary Engineering & Superlaser Lead |
| **Grand Admiral Thrawn** | Logistics, Supply Chain & Material QA Lead |
| **General Grievous** | Droid Workforce & Physical Construction Lead |
| **Darth Maul** | Security, Audit & Penetration Testing Lead |
| **Count Dooku** | Architecture & Requirements Stakeholder |

### Project Name
Change from `"General Engineering"` / `"PROJ-GEN-ENG"` to:
- **Name**: `"Death Star II Construction"`
- **Project ID**: `"PROJ-DS2"`
- **Description**: `"Second Death Star construction and operational readiness"`

---

## 2. Seed Data Metrics & Structure

### A. Sprint Snapshots (`sprint_snapshots`)

| Sprint ID | Name | Dates | Committed | Completed | Issues | Completed | Blocked | Trend | Velocity | Blockers Summary |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `sprint-23` | Sprint 4 — Operational Readiness & Infiltration Testing | 2026-08-10 to 2026-08-21 | 40 | 29 | 14 | 10 | 3 | behind trend | 32 | Auxiliary corridor access security breach, Unapproved exhaust collar thickness shortcuts |
| `sprint-22` | Sprint 3 — Emergency Heat Sinks & Exhaust Audit | 2026-07-27 to 2026-08-07 | 38 | 35 | 12 | 11 | 1 | on trend | 35 | Exhaust port structural collar inspection delays |
| `sprint-21` | Sprint 2 — Superlaser Control & Reactor Shielding | 2026-07-13 to 2026-07-24 | 32 | 26 | 11 | 8 | 3 | behind trend | 26 | Superlaser firing control timing synchronization fault, Dual-zone exhaust vent blockage thermal risk |
| `sprint-20` | Sprint 1 — Primary Structure & Reactor Ring | 2026-06-29 to 2026-07-10 | 34 | 22 | 12 | 7 | 4 | behind trend | 22 | Conflicting design revisions on reactor support ring, Nonconforming hardware lot from secondary supplier (suspect fasteners) |

---

### B. Retrospective Transcripts (`retrospectives`)

#### `retro-sprint-20` — "Sprint 1 Retrospective — Death Star Construction"
- **Owner**: `Darth Sidious`
- **Date**: `2026-07-10 10:00:00`
- **Source**: Dialogue from `docs/transcripts/2026-08-14 - Sprint 1 Retrospective.md`
- **Key Topics**: Reactor housing alignment rework, inferior nonconforming hardware lot from secondary supplier, contractor quality vs droid efficiency, access path security testing

**Transcript text** (escaped for database insertion):
```
Darth Sidious: Welcome, everyone. Time is credits, and judging by our rework numbers, someone has been setting credits on fire. Health of the project?
Darth Vader: Overall progress is acceptable. Primary construction reached fifty-three percent and superlaser assembly reached sixty-four percent. Reactor work lost time to alignment correction and suspect hardware.
Darth Sidious: Very nice, Vader. We built a great deal and then discovered some of it was held together by bargain-bin fasteners. Inspiring.
Grand Admiral Thrawn: Logistics improved significantly. We recovered delayed focusing components and isolated the supplier-quality problem before it spread further.
General Grievous: Droid crews performed above expectations. Contractor quality remains inconsistent and caused avoidable rework.
Darth Maul: Security closed several anomalous access cases. We also identified the supplier incident as a possible sabotage vector.
Darth Sidious: Look at that-teamwork with a faint scent of treason. My favorite kind.
Grand Admiral Thrawn: Challenges remain. Reactor support work will carry over, thermal shielding has not started, and superlaser integration is still incomplete.
General Grievous: We need stricter incoming inspection and controlled engineering revisions.
Darth Vader: Next sprint, we finish reactor support repairs, begin shielding, and integrate the superlaser control system.
Darth Maul: I recommend penetration testing against contractor and supplier access paths before the Rebels find them first.
Darth Sidious: Excellent suggestion. Imagine that, learning before suffering consequences. Vader, perhaps record this historic moment.
Darth Vader: ...Noted.
Darth Sidious: Immediate actions: replace the suspect hardware, tighten supplier controls, start shielding, and stop anyone from improvising on a moon-sized weapons platform. Meeting adjourned.
```

#### `retro-sprint-21` — "Sprint 2 Retrospective — Superlaser & Shielding"
- **Owner**: `Darth Sidious`
- **Date**: `2026-07-24 10:00:00`
- **Source**: Dialogue from `docs/transcripts/2026-08-28 - Sprint 2 Retrospective.md`
- **Key Topics**: Superlaser control bus integration completed, reactor shielding at 51%, dual-zone heat rejection thermal model failure requiring emergency heat sinks, exhaust path physical exposure

**Transcript text** (escaped for database insertion):
```
Darth Sidious: Welcome, everyone. Another sprint concludes, and the second Death Star remains aggressively unfinished. Health of the project?
Darth Vader: Progress improved. Superlaser control integration is complete, primary construction reached sixty-seven percent, and reactor shielding reached fifty-one percent.
Darth Sidious: Very nice, Vader. The laser works and half the reactor is protected. It is the sort of confidence-inspiring sentence that keeps insurance companies awake.
Grand Admiral Thrawn: Logistics stabilized and supplier controls reduced incoming-quality risk. Thermal modeling exposed a dual-zone heat-rejection weakness before operational testing.
General Grievous: Contractor quality improved. Rework declined significantly, and revised shielding brackets increased installation throughput.
Darth Maul: Security testing rejected hostile command traffic and closed the overprivileged supplier account. The remaining concern is physical exposure along exhaust and maintenance routes.
Darth Sidious: Look at that-teamwork. Almost enough to make me believe in organizational culture.
Grand Admiral Thrawn: Challenges remain. Shielding is barely past halfway, emergency heat sinks are not installed, and the exhaust-route design still needs validation.
General Grievous: The new thermal mitigation will delay some shielding sections.
Darth Vader: Next sprint, we complete the heat sinks, accelerate shielding, reinforce the exhaust routes, and run full reactor-load testing.
Darth Maul: I recommend full penetration testing during the load test, including physical infiltration scenarios.
Darth Sidious: Excellent. If the Rebels are going to attempt something theatrical, I would like our people to rehearse the humiliation privately first.
Darth Vader: Understood.
Darth Sidious: Immediate actions: finish thermal mitigation, push shielding past eighty percent, validate the exhaust architecture, and test this machine like we expect someone clever to attack it. Because, regrettably, someone clever usually does.
```

#### Sprint 3 Retrospective
- **Status**: No retrospective entry exists in database. Sprint completed; transcript awaiting intake during demo workflow. The Sprint 3 retrospective transcript from `docs/transcripts/2026-09-11 - Sprint 3 Retrospective.md` is available for the presenter to paste during live demo.

#### Sprint 4 Retrospective
- **Status**: Current active sprint. Target for live retro demo analysis.

---

### C. Proposals & Tracked Action Items (`retro_proposals` & `retro_tracked_actions`)

#### Sprint 1 (sprint-20) — 4 actions from the retrospective transcript

1. **`prop-20-1` / `act-20-1`**: Complete reactor fastener replacement and pass repeat proof-load testing
   - Owner: `General Grievous` | Estimate: `4 hours` | Source: `explicit` | Jira: `AGILE-1001` | Status: `completed`

2. **`prop-20-2` / `act-20-2`**: Implement supplier incoming inspection and independent material testing
   - Owner: `Grand Admiral Thrawn` | Estimate: `2 hours` | Source: `coach` | Jira: *none* | Status: `completed`

3. **`prop-20-3` / `act-20-3`**: Test contractor and supplier identity workflow access paths
   - Owner: `Darth Maul` | Estimate: `1 day` | Source: `explicit` | Jira: `AGILE-1002` | Status: `open`

4. **`prop-20-4` / `act-20-4`**: Start reactor shielding installation after structural acceptance
   - Owner: `Darth Vader` | Estimate: `1 day` | Source: `explicit` | Jira: *none* | Status: `completed`

#### Sprint 2 (sprint-21) — 4 actions from the retrospective transcript

1. **`prop-21-1` / `act-21-1`**: Install emergency reactor heat sinks in vulnerable vent zones
   - Owner: `General Grievous` | Estimate: `1 day` | Source: `explicit` | Jira: *none* | Status: `completed`

2. **`prop-21-2` / `act-21-2`**: Accelerate reactor shielding to reach 75% completion
   - Owner: `Darth Vader` | Estimate: `4 hours` | Source: `explicit` | Jira: `AGILE-1003` | Status: `completed`

3. **`prop-21-3` / `act-21-3`**: Execute physical infiltration test against critical reactor and targeting systems
   - Owner: `Darth Maul` | Estimate: `1 day` | Source: `explicit` | Jira: *none* | Status: `completed`

4. **`prop-21-4` / `act-21-4`**: Validate dual-zone thermal resilience and material logistics for accelerated shielding
   - Owner: `Grand Admiral Thrawn` | Estimate: `4 hours` | Source: `coach` | Jira: *none* | Status: `completed`

---

### D. Coach Topics (`coach_topics`)

| ID | Sprint | Title | Rationale | Category | Priority |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `topic-20-1` | `sprint-20` | Supplier Fastener Quality & Lot Material Verification | Nonconforming hardware lot caused 4 blocked issues and rework consuming 14% of capacity | metric_driven | 1 |
| `topic-20-2` | `sprint-20` | Reactor Ring Alignment & Design Revision Control | Conflicting design revisions issued to separate contractor teams caused 3cm alignment variance | blind_spot | 2 |
| `topic-21-1` | `sprint-21` | Dual-Zone Vent Obstruction & Heat Rejection Modeling | Thermal model failure under dual-zone blockage required emergency heat sink carryover | metric_driven | 1 |
| `topic-21-2` | `sprint-21` | Superlaser Firing Control Timing Synchronization Safety | Firing-control bus commanded reactor draw 70ms before targeting lock confirmation | recurring | 2 |
| `topic-22-1` | `sprint-22` | Exhaust Port Structural Reinforcement & Contractor Quality | Contractors reduced reinforcement thickness without approval, creating structural and security weakness | best_practice | 1 |
| `topic-22-2` | `sprint-22` | Reactor Load Testing & Operational Readiness Criteria | Full reactor load simulation and penetration testing required to validate shielding and security gates | metric_driven | 2 |

---

### E. Coach Insights (`coach_insights`)

| ID | Type | Title | Description | Confidence | Related Sprints |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `insight-1` | `recurring_issue` | Exhaust Vent & Thermal Dissipation Vulnerability Pattern | Thermal limits and exhaust paths have recurred as potential single points of failure in every sprint review. Sprint 1 identified heat-rejection dependencies, Sprint 2 exposed dual-zone thermal model failure, and contractor shortcuts on exhaust collars continued into Sprint 3. | 0.88 | `sprint-20`, `sprint-21`, `sprint-23` |
| `insight-2` | `improving_trend` | Contractor Quality Control Arc | Material inspection controls introduced after Sprint 1's nonconforming fastener lot reduced contractor rework by 35% in Sprint 2. Droid workforce uptime exceeded 99% in Sprint 3. However, unauthorized design shortcuts on exhaust collars indicate contractor process discipline remains inconsistent. | 0.92 | `sprint-20`, `sprint-21`, `sprint-22` |
| `insight-3` | `blind_spot` | Physical & Credential Security Access Vectors | Third-party supplier integrations and contractor credential management represent recurring unmonitored risk vectors. Sprint 1 found anomalous contractor credentials and a disguised reconnaissance relay. Sprint 2 closed an overprivileged supplier service account. Red-team infiltration in Sprint 3 reached an auxiliary reactor-control corridor through a maintenance route. | 0.75 | `sprint-20`, `sprint-21`, `sprint-23` |

---

## 3. Sprint 4 Live Demo Transcript

The existing sample transcript in `hackathon_demo_plan.md` (featuring Alex, Sarah, Jordan, Marcus) must be replaced with a Death Star–themed Sprint 4 transcript. This is the transcript the presenter pastes during the live demo:

```
Darth Sidious: Welcome, everyone. Sprint 4 retrospective. The station is nearly operational, which historically is when everything goes wrong. Health of the project?

Darth Vader: Reactor shielding reached ninety-one percent last sprint. Construction crews exceeded goals. However, the auxiliary corridor security breach during penetration testing exposed a weakness we had not anticipated.

Darth Sidious: Wonderful. Ninety-one percent protected and the remaining nine percent is apparently a guided tour for Rebel commandos.

Grand Admiral Thrawn: Logistics remained stable. Supply routes were uninterrupted and we have thirty days of consumable inventory staged. The completion risk forecast shows we are recoverable if shielding closes this sprint.

General Grievous: Droid workforce uptime exceeded ninety-nine percent. However, contractor shortcuts on exhaust port reinforcement collars created three separate structural findings. Two were not caught by the normal inspection process.

Darth Sidious: Contractors again. At this point I am genuinely curious whether they are incompetent or actively assisting the Rebellion. Either way, the outcome is identical.

Darth Maul: The red team reached an auxiliary reactor-control corridor through a maintenance route before being intercepted. They came within two security barriers of critical systems. After remediation, the hardened corridor resisted the repeat attempt, but the initial success is concerning.

Darth Vader: We added blast doors, physical barriers, and restricted segmentation. The engineering changes preserve maintenance and emergency access.

Darth Sidious: Good. What about the exhaust port situation? I have developed what I believe is a reasonable anxiety about exhaust architecture.

General Grievous: All three nonconforming collars have been restored to approved design thickness and passed structural inspection. But the fact that contractors deviated from controlled drawings without detection suggests our inspection gates need strengthening.

Grand Admiral Thrawn: I recommend mandatory dual-sign-off on any structural modification in exhaust-adjacent sections. The pattern of unauthorized changes is the real risk, not any single collar.

Darth Sidious: Excellent suggestion. Thrawn, implement that control.

Darth Maul: I also recommend we run a final comprehensive security review — physical and cyber — before we declare operational readiness. The infiltration test proved our remediation works, but we have not tested the full station perimeter since the corridor hardening.

Darth Vader: Agreed. We should combine the final security review with the remaining shielding acceptance testing. One integrated operational readiness exercise.

Darth Sidious: Very good. Immediate actions: close the final shielding, implement the dual-sign-off inspection control, run the integrated readiness exercise, and stop the contractors from treating engineering drawings as creative suggestions. Meeting adjourned.
```

---

## 4. Files Targeted for Modification

### Primary Changes

1. **`src/helpers/retroRepository.js`**
   - **`runRetroMigrations` (V2 migration initial seed)**: Replace sprint display names, dates, blockers, and metrics for `sprint-20` through `sprint-23`.
   - **`resetDemoData()`**: Replace all seed data — project name/ID, sprint snapshots, retrospective transcripts and titles, proposals, tracked actions, coach topics, and coach insights.

2. **`docs/hackathon_demo_plan.md`**
   - Replace sprint data table with Death Star sprints.
   - Replace sample Sprint 24 live demo transcript with Sprint 4 Death Star transcript (Section 3 above).
   - Update character names and narrative description throughout.
   - Update project name references from "General Engineering" to "Death Star II Construction".

### Reference Updates (No ID Changes Needed)

Since we are keeping the existing sprint IDs (`sprint-20` through `sprint-23`), these files require **no changes** to their ID references:

3. **`src/components/retrospectives/RetrospectiveDashboard.tsx`** — Fallback `"sprint-23"` still valid ✅
4. **`src/components/retrospectives/RetrospectiveIntake.tsx`** — Fallback `"sprint-23"` still valid ✅
5. **`test/retro/retroRepository.test.js`** — Sprint ID references still valid ✅

---

## 5. Execution Plan

1. Edit `retroRepository.js` — update V2 migration seed data and `resetDemoData()` with all new thematic content.
2. Edit `hackathon_demo_plan.md` — update demo narrative, sprint tables, sample transcript, and character references.
3. Run `npm test` to verify zero test regressions.
4. Manual verification: launch app, navigate to Retrospectives, confirm sprint names/dates/actions render correctly.
