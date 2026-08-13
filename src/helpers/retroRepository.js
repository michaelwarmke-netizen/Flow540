const { randomUUID } = require("crypto");
const { normalizeOwner, calculateEstimateMinutes, extractParticipantsFromTranscript } = require("../utils/retroActionUtils.ts");
const { normalizeDedupKey } = require("../utils/retroDedup.ts");

function runRetroMigrations(db) {
  let currentVersion = db.pragma("user_version", { simple: true });
  if (currentVersion < 2) {
    const migrateV2 = db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sprint_snapshots (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          start_date TEXT,
          end_date TEXT,
          committed_points INTEGER NOT NULL DEFAULT 0,
          completed_points INTEGER NOT NULL DEFAULT 0,
          total_issues INTEGER NOT NULL DEFAULT 0,
          completed_issues INTEGER NOT NULL DEFAULT 0,
          blocked_issues INTEGER NOT NULL DEFAULT 0,
          burndown_trend TEXT NOT NULL DEFAULT 'on_track',
          velocity INTEGER NOT NULL DEFAULT 0,
          blockers TEXT DEFAULT '',
          is_user_edited INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS retrospectives (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          sprint_id TEXT NOT NULL REFERENCES sprint_snapshots(id),
          transcript TEXT NOT NULL,
          source_kind TEXT NOT NULL DEFAULT 'text',
          audio_path TEXT,
          meeting_owner TEXT,
          processing_state TEXT NOT NULL DEFAULT 'idle',
          analysis_run_count INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS retro_proposals (
          id TEXT PRIMARY KEY,
          retrospective_id TEXT NOT NULL REFERENCES retrospectives(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          basis TEXT,
          source TEXT NOT NULL,
          state TEXT NOT NULL DEFAULT 'pending',
          dedup_key TEXT NOT NULL,
          analysis_run INTEGER NOT NULL DEFAULT 1,
          suggested_owner TEXT,
          suggested_estimate_value REAL,
          suggested_estimate_unit TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS retro_tracked_actions (
          id TEXT PRIMARY KEY,
          proposal_id TEXT REFERENCES retro_proposals(id) ON DELETE SET NULL,
          retrospective_id TEXT REFERENCES retrospectives(id) ON DELETE CASCADE,
          sprint_id TEXT NOT NULL REFERENCES sprint_snapshots(id),
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          original_title TEXT,
          original_description TEXT,
          source TEXT NOT NULL,
          owner TEXT NOT NULL DEFAULT '',
          owner_normalized TEXT NOT NULL DEFAULT '',
          estimate_value REAL NOT NULL DEFAULT 0,
          estimate_unit TEXT NOT NULL DEFAULT 'hours',
          estimate_minutes REAL NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'open',
          jira_key TEXT UNIQUE,
          jira_creation_state TEXT,
          jira_payload_snapshot TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS mock_jira_counter (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          counter INTEGER NOT NULL DEFAULT 1000
        )
      `);

      db.exec(`INSERT OR IGNORE INTO mock_jira_counter (id, counter) VALUES (1, 1000)`);

      // Seed initial mock sprints if table empty
      const count = db.prepare("SELECT COUNT(*) as c FROM sprint_snapshots").get();
      if (count.c === 0) {
        const stmt = db.prepare(`
          INSERT INTO sprint_snapshots (
            id, name, start_date, end_date, committed_points, completed_points,
            total_issues, completed_issues, blocked_issues, burndown_trend, velocity, blockers
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(
          "sprint-23",
          "Sprint 4 — Operational Readiness & Infiltration Testing",
          "2026-08-10",
          "2026-08-21",
          40,
          29,
          14,
          10,
          3,
          "behind trend",
          32,
          "Auxiliary corridor access security breach, Unapproved exhaust collar thickness shortcuts"
        );

        stmt.run(
          "sprint-22",
          "Sprint 3 — Emergency Heat Sinks & Exhaust Audit",
          "2026-07-27",
          "2026-08-07",
          38,
          35,
          12,
          11,
          1,
          "on trend",
          35,
          "Exhaust port structural collar inspection delays"
        );

        stmt.run(
          "sprint-21",
          "Sprint 2 — Superlaser Control & Reactor Shielding",
          "2026-07-13",
          "2026-07-24",
          32,
          26,
          11,
          8,
          3,
          "behind trend",
          26,
          "Superlaser firing control timing synchronization fault, Dual-zone exhaust vent blockage thermal risk"
        );

        stmt.run(
          "sprint-20",
          "Sprint 1 — Primary Structure & Reactor Ring",
          "2026-06-29",
          "2026-07-10",
          34,
          22,
          12,
          7,
          4,
          "behind trend",
          22,
          "Conflicting design revisions on reactor support ring, Nonconforming hardware lot from secondary supplier (suspect fasteners)"
        );
      }

      db.pragma("user_version = 2");
    });
    migrateV2();
    currentVersion = 2;
  }

  if (currentVersion < 3) {
    const migrateV3 = db.transaction(() => {
      try {
        db.exec(`ALTER TABLE retrospectives ADD COLUMN meeting_owner TEXT;`);
      } catch (_) {}
      try {
        db.exec(`ALTER TABLE retro_proposals ADD COLUMN suggested_owner TEXT;`);
      } catch (_) {}
      try {
        db.exec(`ALTER TABLE retro_proposals ADD COLUMN suggested_estimate_value REAL;`);
      } catch (_) {}
      try {
        db.exec(`ALTER TABLE retro_proposals ADD COLUMN suggested_estimate_unit TEXT;`);
      } catch (_) {}

      db.pragma("user_version = 3");
    });
    migrateV3();
  }

  if (currentVersion < 4) {
    const migrateV4 = db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          project_id TEXT NOT NULL UNIQUE,
          slack_channel_id TEXT NOT NULL DEFAULT '',
          description TEXT DEFAULT '',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);

      try {
        db.exec(`ALTER TABLE sprint_snapshots ADD COLUMN project_id TEXT REFERENCES projects(id);`);
      } catch (_) {}
      try {
        db.exec(`ALTER TABLE retrospectives ADD COLUMN project_id TEXT REFERENCES projects(id);`);
      } catch (_) {}

      db.exec(`
        CREATE TABLE IF NOT EXISTS coach_topics (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          sprint_id TEXT NOT NULL REFERENCES sprint_snapshots(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          rationale TEXT NOT NULL DEFAULT '',
          category TEXT NOT NULL DEFAULT 'general',
          priority INTEGER NOT NULL DEFAULT 3,
          state TEXT NOT NULL DEFAULT 'suggested',
          source_data TEXT DEFAULT '{}',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS coach_topic_outcomes (
          id TEXT PRIMARY KEY,
          topic_id TEXT NOT NULL REFERENCES coach_topics(id) ON DELETE CASCADE,
          retrospective_id TEXT NOT NULL REFERENCES retrospectives(id) ON DELETE CASCADE,
          coverage_score REAL NOT NULL DEFAULT 0.0,
          engagement_depth TEXT NOT NULL DEFAULT 'none',
          speaker_count INTEGER NOT NULL DEFAULT 0,
          sentiment TEXT NOT NULL DEFAULT 'neutral',
          produced_actions INTEGER NOT NULL DEFAULT 0,
          agent_notes TEXT DEFAULT '',
          relevant_quotes TEXT DEFAULT '[]',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS coach_insights (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          insight_type TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          confidence REAL NOT NULL DEFAULT 0.5,
          related_sprint_ids TEXT DEFAULT '[]',
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS coach_slack_notifications (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          recipient_name TEXT NOT NULL,
          recipient_slack_id TEXT DEFAULT '',
          message_type TEXT NOT NULL,
          message_content TEXT NOT NULL,
          sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          status TEXT NOT NULL DEFAULT 'sent'
        );
      `);

      const projCount = db.prepare("SELECT COUNT(*) as c FROM projects").get();
      let defaultProjectId = "proj-default-gen-eng";
      if (projCount.c === 0) {
        db.prepare(`
          INSERT INTO projects (id, name, project_id, slack_channel_id, description)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          defaultProjectId,
          "General Engineering",
          "PROJ-GEN-ENG",
          "C012345678",
          "Default engineering team project"
        );
      } else {
        const first = db.prepare("SELECT id FROM projects LIMIT 1").get();
        if (first) defaultProjectId = first.id;
      }

      db.prepare(`UPDATE sprint_snapshots SET project_id = ? WHERE project_id IS NULL OR project_id = ''`).run(defaultProjectId);
      db.prepare(`UPDATE retrospectives SET project_id = ? WHERE project_id IS NULL OR project_id = ''`).run(defaultProjectId);

      db.pragma("user_version = 4");
    });
    migrateV4();
  }

  if (currentVersion < 5) {
    const migrateV5 = db.transaction(() => {
      try {
        db.exec(`ALTER TABLE projects ADD COLUMN notification_settings TEXT DEFAULT '{}';`);
      } catch (_) {}
      db.pragma("user_version = 5");
    });
    migrateV5();
  }

  if (currentVersion < 6) {
    const migrateV6 = db.transaction(() => {
      try {
        db.exec(`ALTER TABLE retrospectives ADD COLUMN supporting_transcripts TEXT;`);
      } catch (_) {}
      db.pragma("user_version = 6");
    });
    migrateV6();
  }

  if (currentVersion < 7) {
    const migrateV7 = db.transaction(() => {
      try {
        db.exec(`ALTER TABLE retrospectives ADD COLUMN speaker_balance_score INTEGER;`);
      } catch (_) {}
      try {
        db.exec(`ALTER TABLE retrospectives ADD COLUMN topic_coverage_score INTEGER;`);
      } catch (_) {}
      try {
        db.exec(`ALTER TABLE retrospectives ADD COLUMN speaker_distribution_json TEXT;`);
      } catch (_) {}
      try {
        db.exec(`ALTER TABLE retrospectives ADD COLUMN topic_coverage_details_json TEXT;`);
      } catch (_) {}
      db.pragma("user_version = 7");
    });
    migrateV7();
  }
}

class RetroRepository {
  constructor(db) {
    this.db = db;
    runRetroMigrations(this.db);
  }

  async listSprints() {
    const rows = this.db
      .prepare("SELECT * FROM sprint_snapshots ORDER BY start_date DESC")
      .all();
    return Promise.resolve(rows);
  }

  async getSprintSnapshot(sprintId) {
    const row = this.db
      .prepare("SELECT * FROM sprint_snapshots WHERE id = ?")
      .get(sprintId);
    return Promise.resolve(row || null);
  }

  async updateSprintMetrics(sprintId, metrics) {
    const {
      name,
      start_date,
      end_date,
      committed_points,
      completed_points,
      total_issues,
      completed_issues,
      blocked_issues,
      burndown_trend,
      velocity,
      blockers,
      project_id,
    } = metrics;

    const existing = this.db.prepare("SELECT id FROM sprint_snapshots WHERE id = ?").get(sprintId);

    if (!existing) {
      const defaultProjectId = project_id || "proj-default-gen-eng";
      const sprintName = name || `Sprint ${sprintId.replace(/[^0-9]/g, "") || "New"}`;
      this.db
        .prepare(`
          INSERT INTO sprint_snapshots (
            id, name, start_date, end_date, committed_points, completed_points,
            total_issues, completed_issues, blocked_issues, burndown_trend, velocity, blockers, is_user_edited, project_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
        `)
        .run(
          sprintId,
          sprintName,
          start_date || new Date().toISOString().split("T")[0],
          end_date || new Date().toISOString().split("T")[0],
          committed_points ?? 0,
          completed_points ?? 0,
          total_issues ?? 0,
          completed_issues ?? 0,
          blocked_issues ?? 0,
          burndown_trend || "on_track",
          velocity ?? 0,
          blockers || "",
          defaultProjectId
        );
    } else {
      this.db
        .prepare(`
          UPDATE sprint_snapshots SET
            name = COALESCE(?, name),
            start_date = COALESCE(?, start_date),
            end_date = COALESCE(?, end_date),
            committed_points = ?,
            completed_points = ?,
            total_issues = ?,
            completed_issues = ?,
            blocked_issues = ?,
            burndown_trend = ?,
            velocity = ?,
            blockers = ?,
            is_user_edited = 1,
            updated_at = datetime('now')
          WHERE id = ?
        `)
        .run(
          name || null,
          start_date || null,
          end_date || null,
          committed_points ?? 0,
          completed_points ?? 0,
          total_issues ?? 0,
          completed_issues ?? 0,
          blocked_issues ?? 0,
          burndown_trend || "on_track",
          velocity ?? 0,
          blockers || "",
          sprintId
        );
    }

    return this.getSprintSnapshot(sprintId);
  }

  async createRetrospective({ sprintId, title, transcript, sourceKind, audioPath, meetingOwner, supportingMeetings }) {
    const id = randomUUID();
    const retroTitle = title || `Retrospective — ${new Date().toLocaleDateString()}`;
    const supportingJson = supportingMeetings?.length
      ? JSON.stringify(supportingMeetings)
      : null;

    this.db
      .prepare(`
        INSERT INTO retrospectives (id, title, sprint_id, transcript, source_kind, audio_path, meeting_owner, supporting_transcripts, processing_state)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'idle')
      `)
      .run(id, retroTitle, sprintId, transcript || "", sourceKind || "text", audioPath || null, meetingOwner || null, supportingJson);

    return this.getRetrospective(id);
  }

  async getRetrospective(id) {
    const row = this.db.prepare("SELECT * FROM retrospectives WHERE id = ?").get(id);
    return Promise.resolve(row || null);
  }

  async listRetrospectives() {
    const rows = this.db
      .prepare(`
        SELECT r.*,
          (SELECT COUNT(*) FROM retro_proposals p WHERE p.retrospective_id = r.id AND (p.state IS NULL OR p.state NOT IN ('accepted', 'dismissed', 'superseded'))) AS pending_proposals_count
        FROM retrospectives r
        ORDER BY r.created_at DESC
      `)
      .all();
    return Promise.resolve(rows);
  }

  async updateRetrospective(id, data) {
    const fields = [];
    const values = [];

    if (data.title !== undefined) {
      fields.push("title = ?");
      values.push(data.title);
    }
    if (data.transcript !== undefined) {
      fields.push("transcript = ?");
      values.push(data.transcript);
    }
    if (data.processing_state !== undefined) {
      fields.push("processing_state = ?");
      values.push(data.processing_state);
    }
    if (data.analysis_run_count !== undefined) {
      fields.push("analysis_run_count = ?");
      values.push(data.analysis_run_count);
    }
    if (data.audio_path !== undefined) {
      fields.push("audio_path = ?");
      values.push(data.audio_path);
    }
    if (data.meeting_owner !== undefined) {
      fields.push("meeting_owner = ?");
      values.push(data.meeting_owner);
    }
    if (data.supporting_transcripts !== undefined) {
      fields.push("supporting_transcripts = ?");
      values.push(
        typeof data.supporting_transcripts === "string"
          ? data.supporting_transcripts
          : JSON.stringify(data.supporting_transcripts)
      );
    }

    if (fields.length > 0) {
      fields.push("updated_at = datetime('now')");
      values.push(id);
      this.db
        .prepare(`UPDATE retrospectives SET ${fields.join(", ")} WHERE id = ?`)
        .run(...values);
    }

    return this.getRetrospective(id);
  }

  async saveProposals(retrospectiveId, proposals, analysisRun = 1) {
    const transaction = this.db.transaction(() => {
      // Mark existing pending proposals for this retro as superseded
      this.db
        .prepare(`
          UPDATE retro_proposals SET state = 'superseded', updated_at = datetime('now')
          WHERE retrospective_id = ? AND state = 'pending'
        `)
        .run(retrospectiveId);

      const insertStmt = this.db.prepare(`
        INSERT INTO retro_proposals (
          id, retrospective_id, title, description, basis, source, state, dedup_key, analysis_run,
          suggested_owner, suggested_estimate_value, suggested_estimate_unit
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)
      `);

      const savedList = [];
      for (const p of proposals) {
        const id = randomUUID();
        const dedupKey = normalizeDedupKey(p.title);
        const sugOwner = p.suggestedOwner || p.owner || null;
        const sugEstVal = p.suggestedEstimateValue ?? p.estimateValue ?? null;
        const sugEstUnit = p.suggestedEstimateUnit || p.estimateUnit || null;

        insertStmt.run(
          id,
          retrospectiveId,
          p.title,
          p.description || "",
          p.basis || null,
          p.source || "explicit",
          dedupKey,
          analysisRun,
          sugOwner,
          sugEstVal,
          sugEstUnit
        );
        savedList.push({
          id,
          retrospective_id: retrospectiveId,
          title: p.title,
          description: p.description || "",
          basis: p.basis || null,
          source: p.source || "explicit",
          state: "pending",
          dedup_key: dedupKey,
          analysis_run: analysisRun,
          suggested_owner: sugOwner,
          suggested_estimate_value: sugEstVal,
          suggested_estimate_unit: sugEstUnit,
        });
      }

      // Update analysis run count on retro
      this.db
        .prepare(`
          UPDATE retrospectives SET analysis_run_count = ?, processing_state = 'review', updated_at = datetime('now')
          WHERE id = ?
        `)
        .run(analysisRun, retrospectiveId);

      return savedList;
    });

    return Promise.resolve(transaction());
  }

  async listProposals(retrospectiveId) {
    const rows = this.db
      .prepare(`
        SELECT * FROM retro_proposals
        WHERE retrospective_id = ? AND (state IS NULL OR state NOT IN ('accepted', 'dismissed', 'superseded'))
        ORDER BY created_at ASC
      `)
      .all(retrospectiveId);
    return Promise.resolve(rows);
  }

  async dismissProposal(proposalId) {
    this.db
      .prepare("UPDATE retro_proposals SET state = 'dismissed', updated_at = datetime('now') WHERE id = ?")
      .run(proposalId);
    return Promise.resolve(true);
  }

  async acceptProposal(proposalId, editedData = {}) {
    const transaction = this.db.transaction(() => {
      const proposal = this.db
        .prepare("SELECT * FROM retro_proposals WHERE id = ?")
        .get(proposalId);

      if (!proposal) {
        throw new Error(`Proposal ${proposalId} not found`);
      }

      const retro = this.db
        .prepare("SELECT sprint_id, meeting_owner FROM retrospectives WHERE id = ?")
        .get(proposal.retrospective_id);

      const title = editedData.title || proposal.title;
      const description = editedData.description !== undefined ? editedData.description : proposal.description;

      let owner = editedData.owner !== undefined && editedData.owner !== null && String(editedData.owner).trim() !== ""
        ? String(editedData.owner).trim()
        : (proposal.suggested_owner || "");

      if (!owner && retro && retro.meeting_owner) {
        owner = retro.meeting_owner;
      }
      if (!owner) {
        owner = "Unassigned";
      }

      const ownerNormalized = normalizeOwner(owner);

      let estimateValue = editedData.estimate_value !== undefined && editedData.estimate_value !== null
        ? Number(editedData.estimate_value)
        : (proposal.suggested_estimate_value !== null && proposal.suggested_estimate_value !== undefined
          ? Number(proposal.suggested_estimate_value)
          : 1);

      let estimateUnit = editedData.estimate_unit || proposal.suggested_estimate_unit || "hours";
      if (!["minutes", "hours", "days"].includes(estimateUnit)) {
        estimateUnit = "hours";
      }
      const estimateMinutes = calculateEstimateMinutes(estimateValue, estimateUnit);

      const actionId = randomUUID();

      this.db
        .prepare(`
          INSERT INTO retro_tracked_actions (
            id, proposal_id, retrospective_id, sprint_id, title, description,
            original_title, original_description, source, owner, owner_normalized,
            estimate_value, estimate_unit, estimate_minutes, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')
        `)
        .run(
          actionId,
          proposal.id,
          proposal.retrospective_id,
          retro ? retro.sprint_id : "",
          title,
          description,
          proposal.title, // Keep original unmodified AI title
          proposal.description, // Keep original unmodified AI description
          proposal.source,
          owner,
          ownerNormalized,
          estimateValue,
          estimateUnit,
          estimateMinutes
        );

      // Update proposal state to accepted
      this.db
        .prepare("UPDATE retro_proposals SET state = 'accepted', updated_at = datetime('now') WHERE id = ?")
        .run(proposalId);

      return this.db
        .prepare("SELECT * FROM retro_tracked_actions WHERE id = ?")
        .get(actionId);
    });

    return Promise.resolve(transaction());
  }

  async createManualAction({ sprintId, title, description, owner, estimate_value, estimate_unit }) {
    const actionId = randomUUID();
    const ownerName = owner || "";
    const ownerNormalized = normalizeOwner(ownerName);
    const estVal = Number(estimate_value) || 0;
    const estUnit = estimate_unit || "hours";
    const estMins = calculateEstimateMinutes(estVal, estUnit);

    this.db
      .prepare(`
        INSERT INTO retro_tracked_actions (
          id, proposal_id, retrospective_id, sprint_id, title, description,
          original_title, original_description, source, owner, owner_normalized,
          estimate_value, estimate_unit, estimate_minutes, status
        ) VALUES (?, NULL, NULL, ?, ?, ?, NULL, NULL, 'manual', ?, ?, ?, ?, ?, 'open')
      `)
      .run(
        actionId,
        sprintId,
        title,
        description || "",
        ownerName,
        ownerNormalized,
        estVal,
        estUnit,
        estMins
      );

    const row = this.db
      .prepare("SELECT * FROM retro_tracked_actions WHERE id = ?")
      .get(actionId);
    return Promise.resolve(row);
  }

  async listTrackedActions(filters = {}) {
    let query = "SELECT * FROM retro_tracked_actions WHERE 1=1";
    const params = [];

    if (filters.status) {
      query += " AND status = ?";
      params.push(filters.status);
    }
    if (filters.owner) {
      query += " AND owner_normalized = ?";
      params.push(normalizeOwner(filters.owner));
    }
    if (filters.sprintId) {
      query += " AND sprint_id = ?";
      params.push(filters.sprintId);
    }
    if (Array.isArray(filters.sprintIds)) {
      if (filters.sprintIds.length === 0) {
        return Promise.resolve([]);
      }
      const placeholders = filters.sprintIds.map(() => "?").join(", ");
      query += ` AND sprint_id IN (${placeholders})`;
      params.push(...filters.sprintIds);
    }

    query += " ORDER BY created_at DESC";

    const rows = this.db.prepare(query).all(...params);
    return Promise.resolve(rows);
  }

  async updateTrackedAction(id, data) {
    const action = this.db
      .prepare("SELECT * FROM retro_tracked_actions WHERE id = ?")
      .get(id);

    if (!action) {
      throw new Error(`Action ${id} not found`);
    }

    const fields = [];
    const values = [];

    if (data.title !== undefined) {
      fields.push("title = ?");
      values.push(data.title);
    }
    if (data.description !== undefined) {
      fields.push("description = ?");
      values.push(data.description);
    }
    if (data.owner !== undefined) {
      fields.push("owner = ?");
      fields.push("owner_normalized = ?");
      values.push(data.owner);
      values.push(normalizeOwner(data.owner));
    }
    if (data.estimate_value !== undefined || data.estimate_unit !== undefined) {
      const val = data.estimate_value !== undefined ? data.estimate_value : action.estimate_value;
      const unit = data.estimate_unit !== undefined ? data.estimate_unit : action.estimate_unit;
      fields.push("estimate_value = ?");
      fields.push("estimate_unit = ?");
      fields.push("estimate_minutes = ?");
      values.push(val);
      values.push(unit);
      values.push(calculateEstimateMinutes(val, unit));
    }
    if (data.status !== undefined) {
      fields.push("status = ?");
      values.push(data.status);
    }

    if (fields.length > 0) {
      fields.push("updated_at = datetime('now')");
      values.push(id);
      this.db
        .prepare(`UPDATE retro_tracked_actions SET ${fields.join(", ")} WHERE id = ?`)
        .run(...values);
    }

    const updated = this.db
      .prepare("SELECT * FROM retro_tracked_actions WHERE id = ?")
      .get(id);
    return Promise.resolve(updated);
  }

  async deleteTrackedAction(id) {
    const res = this.db
      .prepare("DELETE FROM retro_tracked_actions WHERE id = ?")
      .run(id);
    return Promise.resolve(res.changes > 0);
  }

  async listOwners() {
    const namesSet = new Set();

    try {
      const actionRows = this.db
        .prepare(`SELECT DISTINCT owner FROM retro_tracked_actions WHERE owner IS NOT NULL AND owner != ''`)
        .all();
      actionRows.forEach((r) => r.owner && namesSet.add(r.owner.trim()));
    } catch {}

    try {
      const proposalRows = this.db
        .prepare(`SELECT DISTINCT suggested_owner FROM retro_proposals WHERE suggested_owner IS NOT NULL AND suggested_owner != ''`)
        .all();
      proposalRows.forEach((r) => r.suggested_owner && namesSet.add(r.suggested_owner.trim()));
    } catch {}

    try {
      const retroRows = this.db
        .prepare(`SELECT meeting_owner, transcript FROM retrospectives`)
        .all();
      retroRows.forEach((r) => {
        if (r.meeting_owner && r.meeting_owner.trim()) {
          namesSet.add(r.meeting_owner.trim());
        }
        if (r.transcript) {
          const speakers = extractParticipantsFromTranscript(r.transcript);
          speakers.forEach((s) => namesSet.add(s.trim()));
        }
      });
    } catch {}

    const list = Array.from(namesSet).filter((n) => n && n !== "Unassigned");
    list.sort((a, b) => a.localeCompare(b));
    return Promise.resolve(list);
  }

  async createMockJiraTicket(trackedActionId, summary, description) {
    const transaction = this.db.transaction(() => {
      const action = this.db
        .prepare("SELECT * FROM retro_tracked_actions WHERE id = ?")
        .get(trackedActionId);

      if (!action) {
        throw new Error(`Tracked action ${trackedActionId} not found`);
      }

      // Idempotency: if ticket already created for this action, return existing
      if (action.jira_key) {
        return {
          jira_key: action.jira_key,
          jira_creation_state: action.jira_creation_state,
          jira_payload_snapshot: action.jira_payload_snapshot
            ? JSON.parse(action.jira_payload_snapshot)
            : null,
        };
      }

      // Atomic increment counter
      const counterRow = this.db
        .prepare("SELECT counter FROM mock_jira_counter WHERE id = 1")
        .get();
      const nextCounter = (counterRow ? counterRow.counter : 1000) + 1;

      this.db
        .prepare("UPDATE mock_jira_counter SET counter = ? WHERE id = 1")
        .run(nextCounter);

      const jiraKey = `AGILE-${nextCounter}`;
      const payloadSnapshot = JSON.stringify({
        summary: summary || action.title,
        description: description || action.description,
        sprintId: action.sprint_id,
        owner: action.owner,
        estimateValue: action.estimate_value,
        estimateUnit: action.estimate_unit,
        createdAt: new Date().toISOString(),
      });

      this.db
        .prepare(`
          UPDATE retro_tracked_actions
          SET jira_key = ?, jira_creation_state = 'created', jira_payload_snapshot = ?, updated_at = datetime('now')
          WHERE id = ?
        `)
        .run(jiraKey, payloadSnapshot, trackedActionId);

      return {
        jira_key: jiraKey,
        jira_creation_state: "created",
        jira_payload_snapshot: JSON.parse(payloadSnapshot),
      };
    });

    return Promise.resolve(transaction());
  }

  // --- Projects API ---
  async listProjects() {
    const rows = this.db.prepare("SELECT * FROM projects ORDER BY name ASC").all();
    return Promise.resolve(rows);
  }

  async getProject(id) {
    const row = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
    return Promise.resolve(row || null);
  }

  async createProject({ name, project_id, slack_channel_id, description }) {
    const id = randomUUID();
    const pid = (project_id || name.toLowerCase().replace(/[^a-z0-9]/g, "-")).toUpperCase();
    this.db.prepare(`
      INSERT INTO projects (id, name, project_id, slack_channel_id, description)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, name, pid, slack_channel_id || '', description || '');
    return this.getProject(id);
  }

  async updateProject(id, updates) {
    const fields = [];
    const values = [];
    if (updates.name !== undefined) { fields.push("name = ?"); values.push(updates.name); }
    if (updates.project_id !== undefined) { fields.push("project_id = ?"); values.push(updates.project_id); }
    if (updates.slack_channel_id !== undefined) { fields.push("slack_channel_id = ?"); values.push(updates.slack_channel_id); }
    if (updates.description !== undefined) { fields.push("description = ?"); values.push(updates.description); }
    if (updates.notification_settings !== undefined) {
      fields.push("notification_settings = ?");
      values.push(typeof updates.notification_settings === 'object' ? JSON.stringify(updates.notification_settings) : updates.notification_settings);
    }

    if (fields.length > 0) {
      fields.push("updated_at = datetime('now')");
      values.push(id);
      this.db.prepare(`UPDATE projects SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    }
    return this.getProject(id);
  }

  async deleteProject(id) {
    const res = this.db.prepare("DELETE FROM projects WHERE id = ?").run(id);
    return Promise.resolve(res.changes > 0);
  }

  async upsertProjectsFromMcp(mcpProjects) {
    if (!Array.isArray(mcpProjects) || mcpProjects.length === 0) return Promise.resolve([]);

    const upsert = this.db.prepare(`
      INSERT INTO projects (id, name, project_id, slack_channel_id, description, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(project_id) DO UPDATE SET
        name = excluded.name,
        slack_channel_id = CASE
          WHEN excluded.slack_channel_id != '' THEN excluded.slack_channel_id
          ELSE projects.slack_channel_id
        END,
        description = excluded.description,
        updated_at = datetime('now')
    `);

    const transaction = this.db.transaction(() => {
      for (const p of mcpProjects) {
        if (!p) continue;
        const rawPid = p.project_id || p.id || p.name;
        if (!rawPid) continue;
        const pid = String(rawPid).toUpperCase();
        const id = p.id && typeof p.id === 'string' && p.id.length === 36 ? p.id : randomUUID();
        const name = p.name || pid;
        const slackChannelId = p.slack_channel_id || p.slackChannelId || '';
        const description = p.description || '';
        upsert.run(id, name, pid, slackChannelId, description);
      }
    });

    transaction();
    return this.listProjects();
  }

  // --- Coach Topics API ---
  async listTopics(projectId, sprintId) {
    let query = "SELECT * FROM coach_topics WHERE 1=1";
    const params = [];
    if (projectId) { query += " AND project_id = ?"; params.push(projectId); }
    if (sprintId) { query += " AND sprint_id = ?"; params.push(sprintId); }
    query += " ORDER BY priority ASC, created_at DESC";
    const rows = this.db.prepare(query).all(...params);
    return Promise.resolve(rows);
  }

  async clearSuggestedTopics(sprintId) {
    if (!sprintId) return Promise.resolve(0);
    const stmt = this.db.prepare("DELETE FROM coach_topics WHERE sprint_id = ? AND state = 'suggested'");
    const res = stmt.run(sprintId);
    return Promise.resolve(res.changes);
  }

  async saveTopics(topics) {
    const transaction = this.db.transaction(() => {
      const stmt = this.db.prepare(`
        INSERT INTO coach_topics (id, project_id, sprint_id, title, rationale, category, priority, state, source_data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const inserted = [];
      for (const t of topics) {
        const id = t.id || randomUUID();
        stmt.run(
          id,
          t.project_id,
          t.sprint_id,
          t.title,
          t.rationale || '',
          t.category || 'general',
          t.priority || 3,
          t.state || 'suggested',
          typeof t.source_data === 'object' ? JSON.stringify(t.source_data) : (t.source_data || '{}')
        );
        inserted.push(id);
      }
      return inserted;
    });
    return Promise.resolve(transaction());
  }

  async updateTopic(id, updates) {
    const fields = [];
    const values = [];
    if (updates.title !== undefined) { fields.push("title = ?"); values.push(updates.title); }
    if (updates.rationale !== undefined) { fields.push("rationale = ?"); values.push(updates.rationale); }
    if (updates.category !== undefined) { fields.push("category = ?"); values.push(updates.category); }
    if (updates.priority !== undefined) { fields.push("priority = ?"); values.push(updates.priority); }
    if (updates.state !== undefined) { fields.push("state = ?"); values.push(updates.state); }

    if (fields.length > 0) {
      fields.push("updated_at = datetime('now')");
      values.push(id);
      this.db.prepare(`UPDATE coach_topics SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    }
    const row = this.db.prepare("SELECT * FROM coach_topics WHERE id = ?").get(id);
    return Promise.resolve(row || null);
  }

  async acceptTopic(id) {
    return this.updateTopic(id, { state: 'accepted' });
  }

  async dismissTopic(id) {
    return this.updateTopic(id, { state: 'dismissed' });
  }

  // --- Topic Outcomes & Insights ---
  async saveTopicOutcomes(outcomes) {
    const transaction = this.db.transaction(() => {
      const stmt = this.db.prepare(`
        INSERT INTO coach_topic_outcomes (
          id, topic_id, retrospective_id, coverage_score, engagement_depth,
          speaker_count, sentiment, produced_actions, agent_notes, relevant_quotes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const o of outcomes) {
        const id = o.id || randomUUID();
        stmt.run(
          id,
          o.topic_id,
          o.retrospective_id,
          o.coverage_score ?? 0.0,
          o.engagement_depth || 'none',
          o.speaker_count ?? 0,
          o.sentiment || 'neutral',
          o.produced_actions ?? 0,
          o.agent_notes || '',
          typeof o.relevant_quotes === 'object' ? JSON.stringify(o.relevant_quotes) : (o.relevant_quotes || '[]')
        );
      }
    });
    return Promise.resolve(transaction());
  }

  async listTopicOutcomes(retrospectiveId) {
    const rows = this.db.prepare(`
      SELECT o.*, t.title as topic_title, t.category as topic_category
      FROM coach_topic_outcomes o
      JOIN coach_topics t ON o.topic_id = t.id
      WHERE o.retrospective_id = ?
    `).all(retrospectiveId);
    return Promise.resolve(rows);
  }

  async listInsights(projectId) {
    let query = "SELECT * FROM coach_insights WHERE is_active = 1";
    const params = [];
    if (projectId) {
      query += " AND (project_id = ? OR project_id = 'proj-default-ds2' OR project_id = 'proj-default-gen-eng')";
      params.push(projectId);
    }
    query += " ORDER BY confidence DESC, created_at DESC";
    let rows = this.db.prepare(query).all(...params);
    if (!rows || rows.length === 0) {
      rows = this.db.prepare("SELECT * FROM coach_insights WHERE is_active = 1 ORDER BY confidence DESC, created_at DESC").all();
    }
    return Promise.resolve(rows);
  }

  async getMetricsSummary(projectId) {
    const defaultProjectId = "proj-default-ds2";
    const targetProjectId = projectId || defaultProjectId;

    const latestRetro = this.db.prepare(`
      SELECT speaker_balance_score, topic_coverage_score,
             speaker_distribution_json, topic_coverage_details_json
      FROM retrospectives
      WHERE (project_id = ? OR project_id = 'proj-default-gen-eng')
        AND processing_state = 'completed'
        AND (speaker_balance_score IS NOT NULL OR topic_coverage_score IS NOT NULL)
      ORDER BY created_at DESC LIMIT 1
    `).get(targetProjectId);

    const actionStats = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
      FROM retro_tracked_actions ta
      LEFT JOIN retrospectives r ON ta.retrospective_id = r.id
      WHERE (r.project_id = ? OR r.project_id = 'proj-default-gen-eng' OR ta.retrospective_id IS NULL)
    `).get(targetProjectId);

    let speakerDistribution = null;
    if (latestRetro?.speaker_distribution_json) {
      try { speakerDistribution = JSON.parse(latestRetro.speaker_distribution_json); } catch (_) {}
    }

    let topicCoverageDetails = null;
    if (latestRetro?.topic_coverage_details_json) {
      try { topicCoverageDetails = JSON.parse(latestRetro.topic_coverage_details_json); } catch (_) {}
    }

    const totalActions = actionStats?.total || 0;
    const completedActions = actionStats?.completed || 0;
    const actionFollowThrough = totalActions > 0 ? Math.round((completedActions / totalActions) * 100) : 88;

    return Promise.resolve({
      speakerBalance: latestRetro?.speaker_balance_score ?? 82,
      topicCoverage: latestRetro?.topic_coverage_score ?? 86,
      speakerDistribution,
      topicCoverageDetails,
      actionFollowThrough,
      actionCompleted: completedActions,
      actionTotal: totalActions,
    });
  }

  async saveInsight({ project_id, insight_type, title, description, confidence, related_sprint_ids }) {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO coach_insights (id, project_id, insight_type, title, description, confidence, related_sprint_ids)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, project_id, insight_type, title, description,
      confidence ?? 0.5,
      typeof related_sprint_ids === 'object' ? JSON.stringify(related_sprint_ids) : (related_sprint_ids || '[]')
    );
    const row = this.db.prepare("SELECT * FROM coach_insights WHERE id = ?").get(id);
    return Promise.resolve(row);
  }

  async listSlackNotifications(projectId) {
    let query = "SELECT * FROM coach_slack_notifications";
    const params = [];
    if (projectId) { query += " WHERE project_id = ?"; params.push(projectId); }
    query += " ORDER BY sent_at DESC LIMIT 50";
    const rows = this.db.prepare(query).all(...params);
    return Promise.resolve(rows);
  }

  async saveSlackNotification({ project_id, recipient_name, recipient_slack_id, message_type, message_content, status }) {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO coach_slack_notifications (id, project_id, recipient_name, recipient_slack_id, message_type, message_content, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, project_id, recipient_name, recipient_slack_id || '', message_type, message_content, status || 'sent');
    const row = this.db.prepare("SELECT * FROM coach_slack_notifications WHERE id = ?").get(id);
    return Promise.resolve(row);
  }

  async resetDemoData() {
    const txn = this.db.transaction(() => {
      // Preserve notification settings
      const existingProject = this.db.prepare("SELECT notification_settings FROM projects WHERE id = 'proj-default-gen-eng'").get();
      const savedNotificationSettings = existingProject?.notification_settings || '{}';

      // Clear all retro data (order matters for foreign keys - child tables first)
      this.db.exec(`DELETE FROM coach_slack_notifications`);
      this.db.exec(`DELETE FROM coach_topic_outcomes`);
      this.db.exec(`DELETE FROM coach_insights`);
      this.db.exec(`DELETE FROM coach_topics`);
      this.db.exec(`DELETE FROM retro_tracked_actions`);
      this.db.exec(`DELETE FROM retro_proposals`);
      this.db.exec(`DELETE FROM retrospectives`);
      this.db.exec(`DELETE FROM sprint_snapshots`);
      this.db.exec(`DELETE FROM projects`);

      const defaultProjectId = "proj-default-ds2";

      // 1. Re-seed default project with preserved notification settings FIRST
      this.db.prepare(`
        INSERT INTO projects (id, name, project_id, slack_channel_id, description, notification_settings)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        defaultProjectId,
        "Death Star II Construction",
        "PROJ-DS2",
        "C012345678",
        "Second Death Star construction and operational readiness",
        savedNotificationSettings
      );

      // 2. Re-seed sprint snapshots SECOND (referencing defaultProjectId)
      const sprintStmt = this.db.prepare(`
        INSERT INTO sprint_snapshots (
          id, name, start_date, end_date, committed_points, completed_points,
          total_issues, completed_issues, blocked_issues, burndown_trend, velocity, blockers, project_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      sprintStmt.run("sprint-23", "Sprint 4 — Operational Readiness & Infiltration Testing", "2026-08-10", "2026-08-21", 40, 29, 14, 10, 3, "behind trend", 32, "Auxiliary corridor access security breach, Unapproved exhaust collar thickness shortcuts", defaultProjectId);
      sprintStmt.run("sprint-22", "Sprint 3 — Emergency Heat Sinks & Exhaust Audit", "2026-07-27", "2026-08-07", 38, 35, 12, 11, 1, "on trend", 35, "Exhaust port structural collar inspection delays", defaultProjectId);
      sprintStmt.run("sprint-21", "Sprint 2 — Superlaser Control & Reactor Shielding", "2026-07-13", "2026-07-24", 32, 26, 11, 8, 3, "behind trend", 26, "Superlaser firing control timing synchronization fault, Dual-zone exhaust vent blockage thermal risk", defaultProjectId);
      sprintStmt.run("sprint-20", "Sprint 1 — Primary Structure & Reactor Ring", "2026-06-29", "2026-07-10", 34, 22, 12, 7, 4, "behind trend", 22, "Conflicting design revisions on reactor support ring, Nonconforming hardware lot from secondary supplier (suspect fasteners)", defaultProjectId);

      // Re-seed Retrospectives for Sprints 20 and 21
      const retroStmt = this.db.prepare(`
        INSERT INTO retrospectives (id, title, sprint_id, project_id, transcript, source_kind, meeting_owner, processing_state, analysis_run_count, created_at, speaker_balance_score, topic_coverage_score, speaker_distribution_json, topic_coverage_details_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const { calculateSpeakerBalance } = require("../utils/transcriptAnalytics.ts");

      const t20 = `Darth Sidious: Welcome, everyone. Time is credits, and judging by our rework numbers, someone has been setting credits on fire. Health of the project?\nDarth Vader: Overall progress is acceptable. Primary construction reached fifty-three percent and superlaser assembly reached sixty-four percent. Reactor work lost time to alignment correction and suspect hardware.\nDarth Sidious: Very nice, Vader. We built a great deal and then discovered some of it was held together by bargain-bin fasteners. Inspiring.\nGrand Admiral Thrawn: Logistics improved significantly. We recovered delayed focusing components and isolated the supplier-quality problem before it spread further.\nGeneral Grievous: Droid crews performed above expectations. Contractor quality remains inconsistent and caused avoidable rework.\nDarth Maul: Security closed several anomalous access cases. We also identified the supplier incident as a possible sabotage vector.\nDarth Sidious: Look at that-teamwork with a faint scent of treason. My favorite kind.\nGrand Admiral Thrawn: Challenges remain. Reactor support work will carry over, thermal shielding has not started, and superlaser integration is still incomplete.\nGeneral Grievous: We need stricter incoming inspection and controlled engineering revisions.\nDarth Vader: Next sprint, we finish reactor support repairs, begin shielding, and integrate the superlaser control system.\nDarth Maul: I recommend penetration testing against contractor and supplier access paths before the Rebels find them first.\nDarth Sidious: Excellent suggestion. Imagine that, learning before suffering consequences. Vader, perhaps record this historic moment.\nDarth Vader: ...Noted.\nDarth Sidious: Immediate actions: replace the suspect hardware, tighten supplier controls, start shielding, and stop anyone from improvising on a moon-sized weapons platform. Meeting adjourned.`;
      const sb20 = calculateSpeakerBalance(t20);

      retroStmt.run(
        "retro-sprint-20",
        "Sprint 1 Retrospective — Death Star Construction",
        "sprint-20",
        defaultProjectId,
        t20,
        "paste",
        "Darth Sidious",
        "completed",
        1,
        "2026-07-10 10:00:00",
        sb20?.score ?? 82,
        83,
        sb20 ? JSON.stringify(sb20.speakers) : null,
        JSON.stringify([
          { topicId: "topic-20-1", title: "Supplier Fastener Quality & Lot Material Verification", status: "discussed", evidenceQuote: "isolated the supplier-quality problem" },
          { topicId: "topic-20-2", title: "Reactor Ring Alignment & Design Revision Control", status: "discussed", evidenceQuote: "Reactor work lost time to alignment correction" }
        ])
      );

      const t21 = `Darth Sidious: Welcome, everyone. Another sprint concludes, and the second Death Star remains aggressively unfinished. Health of the project?\nDarth Vader: Progress improved. Superlaser control integration is complete, primary construction reached sixty-seven percent, and reactor shielding reached fifty-one percent.\nDarth Sidious: Very nice, Vader. The laser works and half the reactor is protected. It is the sort of confidence-inspiring sentence that keeps insurance companies awake.\nGrand Admiral Thrawn: Logistics stabilized and supplier controls reduced incoming-quality risk. Thermal modeling exposed a dual-zone heat-rejection weakness before operational testing.\nGeneral Grievous: Contractor quality improved. Rework declined significantly, and revised shielding brackets increased installation throughput.\nDarth Maul: Security testing rejected hostile command traffic and closed the overprivileged supplier account. The remaining concern is physical exposure along exhaust and maintenance routes.\nDarth Sidious: Look at that-teamwork. Almost enough to make me believe in organizational culture.\nGrand Admiral Thrawn: Challenges remain. Shielding is barely past halfway, emergency heat sinks are not installed, and the exhaust-route design still needs validation.\nGeneral Grievous: The new thermal mitigation will delay some shielding sections.\nDarth Vader: Next sprint, we complete the heat sinks, accelerate shielding, reinforce the exhaust routes, and run full reactor-load testing.\nDarth Maul: I recommend full penetration testing during the load test, including physical infiltration scenarios.\nDarth Sidious: Excellent. If the Rebels are going to attempt something theatrical, I would like our people to rehearse the humiliation privately first.\nDarth Vader: Understood.\nDarth Sidious: Immediate actions: finish thermal mitigation, push shielding past eighty percent, validate the exhaust architecture, and test this machine like we expect someone clever to attack it. Because, regrettably, someone clever usually does.`;
      const sb21 = calculateSpeakerBalance(t21);

      retroStmt.run(
        "retro-sprint-21",
        "Sprint 2 Retrospective — Superlaser & Shielding",
        "sprint-21",
        defaultProjectId,
        t21,
        "paste",
        "Darth Sidious",
        "completed",
        1,
        "2026-07-24 10:00:00",
        sb21?.score ?? 85,
        86,
        sb21 ? JSON.stringify(sb21.speakers) : null,
        JSON.stringify([
          { topicId: "topic-21-1", title: "Dual-Zone Vent Obstruction & Heat Rejection Modeling", status: "discussed", evidenceQuote: "Thermal modeling exposed a dual-zone heat-rejection weakness" },
          { topicId: "topic-21-2", title: "Superlaser Firing Control Timing Synchronization Safety", status: "discussed", evidenceQuote: "Superlaser control integration is complete" }
        ])
      );

      // Re-seed proposals & tracked actions for Sprints 20, 21
      const propStmt = this.db.prepare(`
        INSERT INTO retro_proposals (id, retrospective_id, title, description, basis, source, state, dedup_key, suggested_owner, suggested_estimate_value, suggested_estimate_unit)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const actionStmt = this.db.prepare(`
        INSERT INTO retro_tracked_actions (id, proposal_id, retrospective_id, sprint_id, title, description, original_title, original_description, source, owner, owner_normalized, estimate_value, estimate_unit, estimate_minutes, status, jira_key, jira_creation_state, jira_payload_snapshot)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      // Sprint 20 Actions (Sprint 1)
      propStmt.run("prop-20-1", "retro-sprint-20", "Complete reactor fastener replacement and pass repeat proof-load testing", "Replace all nonconforming hardware and pass repeat proof-load testing", "Transcript discussion", "explicit", "accepted", "complete reactor fastener replacement and pass repeat proof load testing", "General Grievous", 4, "hours");
      actionStmt.run("act-20-1", "prop-20-1", "retro-sprint-20", "sprint-20", "Complete reactor fastener replacement and pass repeat proof-load testing", "Replace all nonconforming hardware and pass repeat proof-load testing", "Complete reactor fastener replacement and pass repeat proof-load testing", "Replace all nonconforming hardware and pass repeat proof-load testing", "explicit", "General Grievous", "general grievous", 4, "hours", 240, "completed", "AGILE-1001", "created", '{"key":"AGILE-1001","summary":"Complete reactor fastener replacement and pass repeat proof-load testing"}');

      propStmt.run("prop-20-2", "retro-sprint-20", "Implement supplier incoming inspection and independent material testing", "Add lot verification and independent material testing for critical components", "Coach analysis", "coach", "accepted", "implement supplier incoming inspection and independent material testing", "Grand Admiral Thrawn", 2, "hours");
      actionStmt.run("act-20-2", "prop-20-2", "retro-sprint-20", "sprint-20", "Implement supplier incoming inspection and independent material testing", "Add lot verification and independent material testing for critical components", "Implement supplier incoming inspection and independent material testing", "Add lot verification and independent material testing for critical components", "coach", "Grand Admiral Thrawn", "grand admiral thrawn", 2, "hours", 120, "completed", null, null, null);

      propStmt.run("prop-20-3", "retro-sprint-20", "Test contractor and supplier identity workflow access paths", "Run controlled security tests against contractor and supplier identity workflows", "Transcript discussion", "explicit", "accepted", "test contractor and supplier identity workflow access paths", "Darth Maul", 1, "days");
      actionStmt.run("act-20-3", "prop-20-3", "retro-sprint-20", "sprint-20", "Test contractor and supplier identity workflow access paths", "Run controlled security tests against contractor and supplier identity workflows", "Test contractor and supplier identity workflow access paths", "Run controlled security tests against contractor and supplier identity workflows", "explicit", "Darth Maul", "darth maul", 1, "days", 480, "open", "AGILE-1002", "created", '{"key":"AGILE-1002","summary":"Test contractor and supplier identity workflow access paths"}');

      propStmt.run("prop-20-4", "retro-sprint-20", "Start reactor shielding installation after structural acceptance", "Begin shielding installation after structural acceptance is complete", "Transcript discussion", "explicit", "accepted", "start reactor shielding installation after structural acceptance", "Darth Vader", 1, "days");
      actionStmt.run("act-20-4", "prop-20-4", "retro-sprint-20", "sprint-20", "Start reactor shielding installation after structural acceptance", "Begin shielding installation after structural acceptance is complete", "Start reactor shielding installation after structural acceptance", "Begin shielding installation after structural acceptance is complete", "explicit", "Darth Vader", "darth vader", 1, "days", 480, "completed", null, null, null);

      // Sprint 21 Actions (Sprint 2)
      propStmt.run("prop-21-1", "retro-sprint-21", "Install emergency reactor heat sinks in vulnerable vent zones", "Complete supplemental thermal mitigation in vulnerable vent zones", "Transcript discussion", "explicit", "accepted", "install emergency reactor heat sinks in vulnerable vent zones", "General Grievous", 1, "days");
      actionStmt.run("act-21-1", "prop-21-1", "retro-sprint-21", "sprint-21", "Install emergency reactor heat sinks in vulnerable vent zones", "Complete supplemental thermal mitigation in vulnerable vent zones", "Install emergency reactor heat sinks in vulnerable vent zones", "Complete supplemental thermal mitigation in vulnerable vent zones", "explicit", "General Grievous", "general grievous", 1, "days", 480, "completed", null, null, null);

      propStmt.run("prop-21-2", "retro-sprint-21", "Accelerate reactor shielding installation to reach 75% completion", "Accelerate shielding crews and clear engineering blockers", "Transcript discussion", "explicit", "accepted", "accelerate reactor shielding installation to reach 75% completion", "Darth Vader", 4, "hours");
      actionStmt.run("act-21-2", "prop-21-2", "retro-sprint-21", "sprint-21", "Accelerate reactor shielding installation to reach 75% completion", "Accelerate shielding crews and clear engineering blockers", "Accelerate reactor shielding installation to reach 75% completion", "Accelerate shielding crews and clear engineering blockers", "explicit", "Darth Vader", "darth vader", 4, "hours", 240, "completed", "AGILE-1003", "created", '{"key":"AGILE-1003","summary":"Accelerate reactor shielding installation to reach 75% completion"}');

      propStmt.run("prop-21-3", "retro-sprint-21", "Execute physical infiltration test against critical reactor and targeting systems", "Use elite teams to attempt access to critical reactor and targeting systems", "Transcript discussion", "explicit", "accepted", "execute physical infiltration test against critical reactor and targeting systems", "Darth Maul", 1, "days");
      actionStmt.run("act-21-3", "prop-21-3", "retro-sprint-21", "sprint-21", "Execute physical infiltration test against critical reactor and targeting systems", "Use elite teams to attempt access to critical reactor and targeting systems", "Execute physical infiltration test against critical reactor and targeting systems", "Use elite teams to attempt access to critical reactor and targeting systems", "explicit", "Darth Maul", "darth maul", 1, "days", 480, "completed", null, null, null);

      propStmt.run("prop-21-4", "retro-sprint-21", "Validate dual-zone thermal resilience and material support for accelerated shielding", "Confirm dual-zone thermal resilience and material support for accelerated shielding", "Coach analysis", "coach", "accepted", "validate dual zone thermal resilience and material support for accelerated shielding", "Grand Admiral Thrawn", 4, "hours");
      actionStmt.run("act-21-4", "prop-21-4", "retro-sprint-21", "sprint-21", "Validate dual-zone thermal resilience and material support for accelerated shielding", "Confirm dual-zone thermal resilience and material support for accelerated shielding", "Validate dual-zone thermal resilience and material support for accelerated shielding", "Confirm dual-zone thermal resilience and material support for accelerated shielding", "coach", "Grand Admiral Thrawn", "grand admiral thrawn", 4, "hours", 240, "completed", null, null, null);

      // Re-seed coach topics for Sprints 20, 21, 22
      const topicStmt = this.db.prepare(`
        INSERT INTO coach_topics (id, project_id, sprint_id, title, rationale, category, priority, state)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      topicStmt.run("topic-20-1", defaultProjectId, "sprint-20", "Supplier Fastener Quality & Lot Material Verification", "Nonconforming hardware lot caused 4 blocked issues and rework consuming 14% of capacity", "metric_driven", 1, "accepted");
      topicStmt.run("topic-20-2", defaultProjectId, "sprint-20", "Reactor Ring Alignment & Design Revision Control", "Conflicting design revisions issued to separate contractor teams caused 3cm alignment variance", "blind_spot", 2, "accepted");

      topicStmt.run("topic-21-1", defaultProjectId, "sprint-21", "Dual-Zone Vent Obstruction & Heat Rejection Modeling", "Thermal model failure under dual-zone blockage required emergency heat sink carryover", "metric_driven", 1, "accepted");
      topicStmt.run("topic-21-2", defaultProjectId, "sprint-21", "Superlaser Firing Control Timing Synchronization Safety", "Firing-control bus commanded reactor draw 70ms before targeting lock confirmation", "recurring", 2, "accepted");

      topicStmt.run("topic-22-1", defaultProjectId, "sprint-22", "Exhaust Port Structural Reinforcement & Contractor Quality", "Contractors reduced reinforcement thickness without approval, creating structural and security weakness", "best_practice", 1, "accepted");
      topicStmt.run("topic-22-2", defaultProjectId, "sprint-22", "Reactor Load Testing & Operational Readiness Criteria", "Full reactor load simulation and penetration testing required to validate shielding and security gates", "metric_driven", 2, "accepted");

      // Re-seed coach insights
      const insightStmt = this.db.prepare(`
        INSERT INTO coach_insights (id, project_id, insight_type, title, description, confidence, related_sprint_ids)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      insightStmt.run(
        "insight-1",
        defaultProjectId,
        "recurring_issue",
        "Exhaust Vent & Thermal Dissipation Vulnerability Pattern",
        "Thermal limits and exhaust paths have recurred as potential single points of failure in every sprint review. Sprint 1 identified heat-rejection dependencies, Sprint 2 exposed dual-zone thermal model failure, and contractor shortcuts on exhaust collars continued into Sprint 3.",
        0.88,
        JSON.stringify(["sprint-20", "sprint-21", "sprint-23"])
      );

      insightStmt.run(
        "insight-2",
        defaultProjectId,
        "improving_trend",
        "Contractor Quality Control Arc",
        "Material inspection controls introduced after Sprint 1's nonconforming fastener lot reduced contractor rework by 35% in Sprint 2. Droid workforce uptime exceeded 99% in Sprint 3. However, unauthorized design shortcuts on exhaust collars indicate contractor process discipline remains inconsistent.",
        0.92,
        JSON.stringify(["sprint-20", "sprint-21", "sprint-22"])
      );

      insightStmt.run(
        "insight-3",
        defaultProjectId,
        "blind_spot",
        "Physical & Credential Security Access Vectors",
        "Third-party supplier integrations and contractor credential management represent recurring unmonitored risk vectors. Sprint 1 found anomalous contractor credentials and a disguised reconnaissance relay. Sprint 2 closed an overprivileged supplier service account. Red-team infiltration in Sprint 3 reached an auxiliary reactor-control corridor through a maintenance route.",
        0.75,
        JSON.stringify(["sprint-20", "sprint-21", "sprint-23"])
      );

      // Reset Jira counter
      this.db.exec(`UPDATE mock_jira_counter SET counter = 1004 WHERE id = 1`);
    });

    txn();
    return Promise.resolve({ success: true });
  }
}

module.exports = {
  runRetroMigrations,
  RetroRepository,
};
