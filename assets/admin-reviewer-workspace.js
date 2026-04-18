const REVIEW_ENTITY_TASKS_KEY = "bth_review_entity_tasks_v1";

export function createReviewerWorkspace(dependencies) {
  function readReviewEntityTasks() {
    try {
      var tasks = JSON.parse(window.localStorage.getItem(REVIEW_ENTITY_TASKS_KEY) || "{}");
      return tasks && typeof tasks === "object" ? tasks : {};
    } catch (_error) {
      return {};
    }
  }

  function writeReviewEntityTasks(value) {
    try {
      window.localStorage.setItem(REVIEW_ENTITY_TASKS_KEY, JSON.stringify(value || {}));
    } catch (_error) {
      // Ignore storage errors and keep the UI usable.
    }
  }

  function buildReviewEntityTaskKey(entityType, entityId) {
    return String(entityType || "") + ":" + String(entityId || "");
  }

  function getReviewEntityTask(entityType, entityId) {
    var state = dependencies.getRuntimeState();
    if (entityType === "therapist") {
      var therapist = (dependencies.getPublishedTherapists() || []).find(function (item) {
        return String(item && item.id) === String(entityId);
      });
      if (therapist && therapist.review_follow_up) {
        return therapist.review_follow_up;
      }
    }
    if (state.dataMode === "sanity") {
      if (entityType === "application") {
        var remoteApplication = (state.remoteApplications || []).find(function (item) {
          return item.id === entityId;
        });
        return remoteApplication && remoteApplication.review_follow_up
          ? remoteApplication.review_follow_up
          : null;
      }
      if (entityType === "candidate") {
        var remoteCandidate = (state.remoteCandidates || []).find(function (item) {
          return item.id === entityId;
        });
        return remoteCandidate && remoteCandidate.review_follow_up
          ? remoteCandidate.review_follow_up
          : null;
      }
    }
    var tasks = readReviewEntityTasks();
    return tasks[buildReviewEntityTaskKey(entityType, entityId)] || null;
  }

  function saveWorkItem(entityType, entityId, updates) {
    if (dependencies.getRuntimeState().dataMode === "sanity" && entityType !== "therapist") {
      return;
    }
    var tasks = readReviewEntityTasks();
    var key = buildReviewEntityTaskKey(entityType, entityId);
    var current = tasks[key] || {};
    tasks[key] = {
      status: updates.status || current.status || "open",
      note: updates.note !== undefined ? updates.note : current.note || "",
      due_at: updates.due_at !== undefined ? updates.due_at : current.due_at || "",
      updated_at: new Date().toISOString(),
    };
    writeReviewEntityTasks(tasks);
  }

  function getStartOfToday() {
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  }

  function getFollowUpDueLabel(item) {
    if (!item || !item.due_at) return "";
    var dueDate = new Date(item.due_at);
    var dueTime = dueDate.getTime();
    if (!Number.isFinite(dueTime)) return "";
    var today = getStartOfToday();
    var dayMs = 24 * 60 * 60 * 1000;
    var dayDiff = Math.round((dueTime - today.getTime()) / dayMs);
    if (item.status !== "done" && dueTime < today.getTime()) {
      var overdueDays = Math.max(1, Math.round((today.getTime() - dueTime) / dayMs));
      return "Overdue by " + overdueDays + " day" + (overdueDays === 1 ? "" : "s");
    }
    if (item.status !== "done" && dayDiff === 0) {
      return "Due today";
    }
    if (item.status !== "done" && dayDiff === 1) {
      return "Due tomorrow";
    }
    if (item.status !== "done" && dayDiff > 1) {
      return "Due in " + dayDiff + " days";
    }
    return "Due " + dependencies.formatDate(item.due_at);
  }

  function isFollowUpStale(item) {
    if (!item || item.status === "done") return false;
    var updatedTime = new Date(item.updated_at || 0).getTime();
    if (!Number.isFinite(updatedTime) || !updatedTime) return false;
    return Date.now() - updatedTime >= 3 * 24 * 60 * 60 * 1000;
  }

  function getFollowUpStaleLabel(item) {
    if (!isFollowUpStale(item)) return "";
    var updatedTime = new Date(item.updated_at).getTime();
    var staleDays = Math.max(3, Math.floor((Date.now() - updatedTime) / (24 * 60 * 60 * 1000)));
    return "Stale for " + staleDays + " days";
  }

  function getReviewTaskStatusLabel(status) {
    if (status === "done") return "Done";
    if (status === "waiting") return "Waiting";
    if (status === "blocked") return "Blocked";
    return "Open";
  }

  function renderReviewEntityTaskHtml(entityType, entityId) {
    var task = getReviewEntityTask(entityType, entityId);
    if (!task || (!task.note && !task.due_at && task.status === "open")) {
      return "";
    }
    var status = task.status || "open";
    var note = task.note || "";
    var dueAt = task.due_at || "";
    var dueLabel = getFollowUpDueLabel(task);
    var staleLabel = getFollowUpStaleLabel(task);
    var updatedAt = task.updated_at ? dependencies.formatDate(task.updated_at) : "";
    var metaParts = [
      dueAt ? "Due: " + dependencies.formatDate(dueAt) : "",
      dueLabel,
      staleLabel,
    ].filter(Boolean);
    return (
      '<div class="notes-box"><label><strong>Follow-up note</strong></label>' +
      '<div style="display:flex;justify-content:space-between;gap:0.75rem;align-items:flex-start;flex-wrap:wrap">' +
      '<div class="subtle">Auto-logged follow-up for this record.</div>' +
      '<span class="tag">' +
      dependencies.escapeHtml(getReviewTaskStatusLabel(status)) +
      "</span></div>" +
      (note
        ? '<div style="margin-top:0.55rem;font-size:0.88rem;color:var(--slate)">' +
          dependencies.escapeHtml(note) +
          "</div>"
        : "") +
      (metaParts.length
        ? '<div class="subtle" style="margin-top:0.45rem">' +
          dependencies.escapeHtml(metaParts.join(" · ")) +
          "</div>"
        : "") +
      (updatedAt
        ? '<div class="subtle" style="margin-top:0.45rem">Last updated: ' +
          dependencies.escapeHtml(updatedAt) +
          "</div>"
        : "") +
      "</div>"
    );
  }

  return {
    getReviewEntityTask: getReviewEntityTask,
    renderReviewEntityTaskHtml: renderReviewEntityTaskHtml,
    saveWorkItem: saveWorkItem,
  };
}
