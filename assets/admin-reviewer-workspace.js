const REVIEW_ENTITY_TASKS_KEY = "bth_review_entity_tasks_v1";
const REVIEWER_DIRECTORY_KEY = "bth_reviewer_directory_v1";
const REVIEWER_PREFERENCE_KEY = "bth_reviewer_preference_v1";

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

  function readReviewerDirectory() {
    try {
      var reviewers = JSON.parse(window.localStorage.getItem(REVIEWER_DIRECTORY_KEY) || "[]");
      return Array.isArray(reviewers) ? reviewers : [];
    } catch (_error) {
      return [];
    }
  }

  function normalizeReviewerEntry(value) {
    if (!value) {
      return null;
    }
    if (typeof value === "string") {
      return {
        id: String(value)
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, ""),
        name: String(value).trim(),
        active: true,
      };
    }
    var name = String(value.name || "").trim();
    var id = String(
      value.id ||
        value.reviewerId ||
        value.reviewer_id ||
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, ""),
    ).trim();
    if (!id || !name) {
      return null;
    }
    return {
      id: id,
      name: name,
      active: value.active !== false,
    };
  }

  function writeReviewerDirectory(value) {
    try {
      window.localStorage.setItem(
        REVIEWER_DIRECTORY_KEY,
        JSON.stringify(Array.isArray(value) ? value : []),
      );
    } catch (_error) {
      // Ignore storage errors and keep the UI usable.
    }
  }

  function readReviewerPreference() {
    try {
      if (typeof window === "undefined" || !window.localStorage) {
        return { reviewer: "", reviewer_id: "", my_queue_mode: false };
      }
      var stored = JSON.parse(window.localStorage.getItem(REVIEWER_PREFERENCE_KEY) || "{}");
      return {
        reviewer: String(stored.reviewer || "").trim(),
        reviewer_id: String(stored.reviewer_id || "").trim(),
        my_queue_mode: Boolean(stored.my_queue_mode),
      };
    } catch (_error) {
      return { reviewer: "", reviewer_id: "", my_queue_mode: false };
    }
  }

  function writeReviewerPreference(value) {
    try {
      if (typeof window === "undefined" || !window.localStorage) {
        return;
      }
      window.localStorage.setItem(
        REVIEWER_PREFERENCE_KEY,
        JSON.stringify({
          reviewer: String((value && value.reviewer) || "").trim(),
          reviewer_id: String((value && value.reviewer_id) || "").trim(),
          my_queue_mode: Boolean(value && value.my_queue_mode),
        }),
      );
    } catch (_error) {
      // Ignore storage errors and keep the UI usable.
    }
  }

  function getPreferredReviewer() {
    return readReviewerPreference().reviewer || dependencies.getAdminActorName() || "";
  }

  function getPreferredReviewerId() {
    return readReviewerPreference().reviewer_id || dependencies.getAdminActorId() || "";
  }

  function setPreferredReviewer(name, reviewerId) {
    var trimmedName = String(name || "").trim();
    var current = readReviewerPreference();
    writeReviewerPreference({
      reviewer: trimmedName,
      reviewer_id: String(reviewerId || "").trim(),
      my_queue_mode: current.my_queue_mode,
    });
  }

  function setReviewerMyQueueMode(enabled) {
    dependencies.uiState.myQueueMode = Boolean(enabled);
    writeReviewerPreference({
      reviewer: getPreferredReviewer(),
      reviewer_id: getPreferredReviewerId(),
      my_queue_mode: dependencies.uiState.myQueueMode,
    });
  }

  function getScopedReviewerName() {
    if (!dependencies.uiState.myQueueMode) {
      return "";
    }
    return getPreferredReviewer();
  }

  function filterItemsForReviewerScope(items, options) {
    var config = options || {};
    var list = Array.isArray(items) ? items.slice() : [];
    var scopedReviewer = getScopedReviewerName();
    if (scopedReviewer) {
      list = list.filter(function (item) {
        return item.assignee === scopedReviewer || (config.includeUnassigned && !item.assignee);
      });
    }
    if (dependencies.uiState.workloadFilter) {
      list = list.filter(function (item) {
        return item.assignee === dependencies.uiState.workloadFilter;
      });
    }
    return list;
  }

  function getReviewerRoster() {
    var state = dependencies.getRuntimeState();
    var seedNames =
      state.dataMode === "sanity" &&
      Array.isArray(state.remoteReviewerRoster) &&
      state.remoteReviewerRoster.length
        ? state.remoteReviewerRoster.map(function (entry) {
            return entry && entry.name ? entry.name : "";
          })
        : readReviewerDirectory();
    var names = seedNames
      .concat(
        getAllReviewFollowUpItems().map(function (item) {
          return item.assignee || "";
        }),
      )
      .map(function (value) {
        return String(value || "").trim();
      })
      .filter(Boolean);
    return Array.from(new Set(names)).sort(function (a, b) {
      return a.localeCompare(b);
    });
  }

  function getReviewerDirectoryEntries() {
    var state = dependencies.getRuntimeState();
    var seedEntries =
      state.dataMode === "sanity" &&
      Array.isArray(state.remoteReviewerRoster) &&
      state.remoteReviewerRoster.length
        ? state.remoteReviewerRoster
        : readReviewerDirectory();
    return seedEntries
      .map(normalizeReviewerEntry)
      .filter(Boolean)
      .sort(function (a, b) {
        return a.name.localeCompare(b.name);
      });
  }

  function findReviewerEntryByName(name) {
    var trimmedName = String(name || "").trim();
    return (
      getReviewerDirectoryEntries().find(function (entry) {
        return entry.name === trimmedName;
      }) || null
    );
  }

  function buildReviewerIdFromName(name) {
    return String(name || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
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

  function saveReviewEntityTask(entityType, entityId, updates) {
    if (dependencies.getRuntimeState().dataMode === "sanity" && entityType !== "therapist") {
      return;
    }
    var tasks = readReviewEntityTasks();
    var key = buildReviewEntityTaskKey(entityType, entityId);
    var current = tasks[key] || {};
    var assigneeName =
      updates.assignee_name !== undefined
        ? updates.assignee_name
        : updates.assignee !== undefined
          ? updates.assignee
          : current.assignee_name || current.assignee || "";
    tasks[key] = {
      status: updates.status || current.status || "open",
      note: updates.note !== undefined ? updates.note : current.note || "",
      assignee_id:
        updates.assignee_id !== undefined ? updates.assignee_id : current.assignee_id || "",
      assignee_name: assigneeName,
      assignee: assigneeName,
      due_at: updates.due_at !== undefined ? updates.due_at : current.due_at || "",
      updated_at: new Date().toISOString(),
    };
    writeReviewEntityTasks(tasks);
  }

  function deleteReviewEntityTask(entityType, entityId) {
    if (dependencies.getRuntimeState().dataMode === "sanity" && entityType !== "therapist") {
      return;
    }
    var tasks = readReviewEntityTasks();
    delete tasks[buildReviewEntityTaskKey(entityType, entityId)];
    writeReviewEntityTasks(tasks);
  }

  async function persistReviewEntityTask(entityType, entityId, nextPayload, options) {
    var config = options || {};
    if (entityType === "therapist") {
      if (config.clear) {
        deleteReviewEntityTask(entityType, entityId);
      } else {
        saveReviewEntityTask(entityType, entityId, nextPayload);
      }
      renderAttentionQueue();
      renderReviewerWorkload();
      dependencies.renderTherapistOpsQueues();
      return;
    }
    if (dependencies.getRuntimeState().dataMode === "sanity") {
      if (entityType === "application") {
        await dependencies.updateTherapistApplication(entityId, {
          review_follow_up: nextPayload,
        });
        await dependencies.loadData();
        return;
      }
      if (entityType === "candidate") {
        await dependencies.updateTherapistCandidate(entityId, {
          review_follow_up: nextPayload,
        });
        await dependencies.loadData();
        return;
      }
      return;
    }

    if (config.clear) {
      deleteReviewEntityTask(entityType, entityId);
    } else {
      saveReviewEntityTask(entityType, entityId, nextPayload);
    }

    renderAttentionQueue();
    renderReviewerWorkload();
    if (entityType === "application") {
      dependencies.renderApplications();
      return;
    }
    if (entityType === "candidate") {
      dependencies.renderCandidateQueue();
    }
  }

  function getReviewTaskStatusLabel(status) {
    if (status === "done") return "Done";
    if (status === "waiting") return "Waiting";
    if (status === "blocked") return "Blocked";
    return "Open";
  }

  function getAllReviewFollowUpItems() {
    var state = dependencies.getRuntimeState();
    var items = [];
    var applications =
      state.dataMode === "sanity" ? state.remoteApplications : dependencies.getApplications();
    var candidates = state.dataMode === "sanity" ? state.remoteCandidates : [];
    var therapists = dependencies.getPublishedTherapists();

    (Array.isArray(applications) ? applications : []).forEach(function (item) {
      var followUp = item && item.review_follow_up ? item.review_follow_up : null;
      if (
        !followUp ||
        !(followUp.note || followUp.assignee || followUp.due_at || followUp.status !== "open")
      ) {
        return;
      }
      items.push({
        entity_type: "application",
        id: item.id,
        name: item.name || item.id || "Application",
        assignee_id: followUp.assignee_id || "",
        assignee_name: followUp.assignee_name || followUp.assignee || "",
        assignee: followUp.assignee_name || followUp.assignee || "",
        due_at: followUp.due_at || "",
        updated_at: followUp.updated_at || item.updated_at || "",
        status: followUp.status || "open",
        note: followUp.note || "",
      });
    });

    (Array.isArray(candidates) ? candidates : []).forEach(function (item) {
      var followUp = item && item.review_follow_up ? item.review_follow_up : null;
      if (
        !followUp ||
        !(followUp.note || followUp.assignee || followUp.due_at || followUp.status !== "open")
      ) {
        return;
      }
      items.push({
        entity_type: "candidate",
        id: item.id,
        name: item.name || item.id || "Candidate",
        assignee_id: followUp.assignee_id || "",
        assignee_name: followUp.assignee_name || followUp.assignee || "",
        assignee: followUp.assignee_name || followUp.assignee || "",
        due_at: followUp.due_at || "",
        updated_at: followUp.updated_at || item.updated_at || "",
        status: followUp.status || "open",
        note: followUp.note || "",
      });
    });

    (Array.isArray(therapists) ? therapists : []).forEach(function (item) {
      var followUp = getReviewEntityTask("therapist", item.id);
      if (
        !followUp ||
        !(followUp.note || followUp.assignee || followUp.due_at || followUp.status !== "open")
      ) {
        return;
      }
      items.push({
        entity_type: "therapist",
        id: item.id,
        name: item.name || item.slug || item.id || "Listing",
        assignee_id: followUp.assignee_id || "",
        assignee_name: followUp.assignee_name || followUp.assignee || "",
        assignee: followUp.assignee_name || followUp.assignee || "",
        due_at: followUp.due_at || "",
        updated_at: followUp.updated_at || item.updated_at || "",
        status: followUp.status || "open",
        note: followUp.note || "",
      });
    });

    return items;
  }

  function isFollowUpOverdue(item) {
    if (!item || !item.due_at) return false;
    var dueTime = new Date(item.due_at).getTime();
    if (!Number.isFinite(dueTime)) return false;
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    return dueTime < today.getTime() && item.status !== "done";
  }

  function getStartOfToday() {
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  }

  function getStartOfTomorrow() {
    var tomorrow = getStartOfToday();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow;
  }

  function getStartOfNextWeek() {
    var nextWeek = getStartOfToday();
    nextWeek.setDate(nextWeek.getDate() + 7);
    return nextWeek;
  }

  function isFollowUpDueToday(item) {
    if (!item || !item.due_at || item.status === "done") return false;
    var dueTime = new Date(item.due_at).getTime();
    if (!Number.isFinite(dueTime)) return false;
    return dueTime >= getStartOfToday().getTime() && dueTime < getStartOfTomorrow().getTime();
  }

  function isFollowUpDueThisWeek(item) {
    if (!item || !item.due_at || item.status === "done") return false;
    var dueTime = new Date(item.due_at).getTime();
    if (!Number.isFinite(dueTime)) return false;
    return dueTime >= getStartOfToday().getTime() && dueTime < getStartOfNextWeek().getTime();
  }

  function getFollowUpDueLabel(item) {
    if (!item || !item.due_at) return "";
    var dueDate = new Date(item.due_at);
    var dueTime = dueDate.getTime();
    if (!Number.isFinite(dueTime)) return "";
    var today = getStartOfToday();
    var tomorrow = getStartOfTomorrow();
    var dayMs = 24 * 60 * 60 * 1000;
    var dayDiff = Math.round((dueTime - today.getTime()) / dayMs);
    if (item.status !== "done" && dueTime < today.getTime()) {
      var overdueDays = Math.max(1, Math.round((today.getTime() - dueTime) / dayMs));
      return "Overdue by " + overdueDays + " day" + (overdueDays === 1 ? "" : "s");
    }
    if (item.status !== "done" && dueTime >= today.getTime() && dueTime < tomorrow.getTime()) {
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
    return "Needs nudge · stale for " + staleDays + " days";
  }

  function getFollowUpPriorityWeight(item) {
    if (isFollowUpOverdue(item)) return 0;
    if (isFollowUpDueToday(item)) return 1;
    if (isFollowUpStale(item)) return 2;
    if (item && item.status === "blocked") return 3;
    if (item && item.status === "waiting") return 5;
    return 4;
  }

  async function claimReviewEntityTask(entityType, entityId) {
    if (!entityType || !entityId) return;
    var currentTask = getReviewEntityTask(entityType, entityId) || {
      status: "open",
      note: "",
    };
    var preferredReviewer = getPreferredReviewer();
    var nextAssignee = preferredReviewer;
    if (!nextAssignee) {
      var roster = getReviewerRoster();
      nextAssignee = window.prompt(
        roster.length
          ? "Who owns this work item? Available reviewers: " + roster.join(", ")
          : "Who owns this work item?",
        String(currentTask.assignee || ""),
      );
      if (nextAssignee === null) return;
    }
    await persistReviewEntityTask(entityType, entityId, {
      status: currentTask.status || "open",
      note: currentTask.note || "",
      assignee_id:
        preferredReviewer && getPreferredReviewerId()
          ? getPreferredReviewerId()
          : (findReviewerEntryByName(nextAssignee) || {}).id || "",
      assignee_name: String(nextAssignee || "").trim(),
      assignee: String(nextAssignee || "").trim(),
      due_at: currentTask.due_at || "",
    });
  }

  async function assignReviewEntityTask(entityType, entityId, assigneeName) {
    if (!entityType || !entityId) return;
    var currentTask = getReviewEntityTask(entityType, entityId) || {
      status: "open",
      note: "",
    };
    var trimmedAssignee = String(assigneeName || "").trim();
    var selectedReviewer = findReviewerEntryByName(trimmedAssignee);
    await persistReviewEntityTask(entityType, entityId, {
      status: currentTask.status || "open",
      note: currentTask.note || "",
      assignee_id: selectedReviewer ? selectedReviewer.id : "",
      assignee_name: trimmedAssignee,
      assignee: trimmedAssignee,
      due_at: currentTask.due_at || "",
    });
  }

  async function updateReviewEntityTaskStatus(entityType, entityId, status) {
    if (!entityType || !entityId || !status) return;
    var currentTask = getReviewEntityTask(entityType, entityId) || {
      status: "open",
      note: "",
    };
    await persistReviewEntityTask(entityType, entityId, {
      status: status,
      note: currentTask.note || "",
      assignee_id: currentTask.assignee_id || "",
      assignee_name: currentTask.assignee_name || currentTask.assignee || "",
      assignee: currentTask.assignee || "",
      due_at: currentTask.due_at || "",
    });
  }

  async function saveReviewEntityTaskState(entityType, entityId, updates) {
    if (!entityType || !entityId || !updates || typeof updates !== "object") return;
    var currentTask = getReviewEntityTask(entityType, entityId) || {
      status: "open",
      note: "",
    };
    var assigneeName =
      updates.assignee_name !== undefined
        ? updates.assignee_name
        : updates.assignee !== undefined
          ? updates.assignee
          : currentTask.assignee_name || currentTask.assignee || "";
    var selectedReviewer = findReviewerEntryByName(assigneeName);
    await persistReviewEntityTask(entityType, entityId, {
      status: updates.status || currentTask.status || "open",
      note: updates.note !== undefined ? updates.note : currentTask.note || "",
      assignee_id:
        updates.assignee_id !== undefined
          ? updates.assignee_id
          : selectedReviewer
            ? selectedReviewer.id
            : currentTask.assignee_id || "",
      assignee_name: String(assigneeName || "").trim(),
      assignee: String(assigneeName || "").trim(),
      due_at: updates.due_at !== undefined ? updates.due_at : currentTask.due_at || "",
    });
  }

  function getNextDueFollowUpItem(items) {
    var list = Array.isArray(items) ? items.slice() : [];
    if (!list.length) return null;
    return list.sort(function (a, b) {
      var aWeight = getFollowUpPriorityWeight(a);
      var bWeight = getFollowUpPriorityWeight(b);
      if (aWeight !== bWeight) return aWeight - bWeight;
      var aDue = a && a.due_at ? new Date(a.due_at).getTime() : Number.POSITIVE_INFINITY;
      var bDue = b && b.due_at ? new Date(b.due_at).getTime() : Number.POSITIVE_INFINITY;
      return aDue - bDue;
    })[0];
  }

  function getAttentionQueueItems(limit) {
    var items = getAllReviewFollowUpItems().filter(function (item) {
      return isFollowUpOverdue(item) || isFollowUpStale(item) || !item.assignee;
    });
    return items
      .sort(function (a, b) {
        var aUnassigned = a.assignee ? 0 : 1;
        var bUnassigned = b.assignee ? 0 : 1;
        var aWeight = getFollowUpPriorityWeight(a);
        var bWeight = getFollowUpPriorityWeight(b);
        if (aWeight !== bWeight) return aWeight - bWeight;
        if (bUnassigned !== aUnassigned) return bUnassigned - aUnassigned;
        var aDue = a && a.due_at ? new Date(a.due_at).getTime() : Number.POSITIVE_INFINITY;
        var bDue = b && b.due_at ? new Date(b.due_at).getTime() : Number.POSITIVE_INFINITY;
        if (aDue !== bDue) return aDue - bDue;
        var aUpdated = a && a.updated_at ? new Date(a.updated_at).getTime() : 0;
        var bUpdated = b && b.updated_at ? new Date(b.updated_at).getTime() : 0;
        return aUpdated - bUpdated;
      })
      .slice(0, limit || 6);
  }

  function getAttentionQueueReason(item) {
    var reasons = [];
    if (!item) return "";
    if (isFollowUpOverdue(item)) {
      reasons.push(getFollowUpDueLabel(item));
    } else if (isFollowUpDueToday(item)) {
      reasons.push("Due today");
    }
    if (isFollowUpStale(item)) reasons.push(getFollowUpStaleLabel(item));
    if (!item.assignee) reasons.push("Unassigned");
    if (item.status === "blocked") reasons.push("Blocked");
    return reasons.join(" · ");
  }

  function sortFollowUpItems(items) {
    return (Array.isArray(items) ? items.slice() : []).sort(function (a, b) {
      var aWeight = getFollowUpPriorityWeight(a);
      var bWeight = getFollowUpPriorityWeight(b);
      if (aWeight !== bWeight) return aWeight - bWeight;
      var aDue = a && a.due_at ? new Date(a.due_at).getTime() : Number.POSITIVE_INFINITY;
      var bDue = b && b.due_at ? new Date(b.due_at).getTime() : Number.POSITIVE_INFINITY;
      if (aDue !== bDue) return aDue - bDue;
      var aUpdated = a && a.updated_at ? new Date(a.updated_at).getTime() : 0;
      var bUpdated = b && b.updated_at ? new Date(b.updated_at).getTime() : 0;
      return aUpdated - bUpdated;
    });
  }

  function getRecentlyCompletedItems(limit) {
    return getAllReviewFollowUpItems()
      .filter(function (item) {
        return item && item.status === "done";
      })
      .sort(function (a, b) {
        var aUpdated = a && a.updated_at ? new Date(a.updated_at).getTime() : 0;
        var bUpdated = b && b.updated_at ? new Date(b.updated_at).getTime() : 0;
        return bUpdated - aUpdated;
      })
      .slice(0, limit || 6);
  }

  function getHumanWorkQueueSnapshot(limit) {
    var preferredReviewer = getPreferredReviewer();
    var items = getAllReviewFollowUpItems().filter(function (item) {
      return item && item.status !== "done";
    });
    return {
      preferredReviewer: preferredReviewer,
      myTasks: preferredReviewer
        ? sortFollowUpItems(
            items.filter(function (item) {
              return item.assignee === preferredReviewer;
            }),
          ).slice(0, limit || 6)
        : [],
      unassigned: sortFollowUpItems(
        items.filter(function (item) {
          return !item.assignee;
        }),
      ).slice(0, limit || 6),
      dueToday: sortFollowUpItems(
        items.filter(function (item) {
          return isFollowUpDueToday(item) || isFollowUpOverdue(item);
        }),
      ).slice(0, limit || 6),
      doneRecently: getRecentlyCompletedItems(limit || 6),
    };
  }

  function renderAttentionQueue() {
    var root = document.getElementById("reviewAttentionQueue");
    var scopeMeta = document.getElementById("reviewAttentionQueueScope");
    if (!root) return;
    if (dependencies.getRuntimeState().authRequired) {
      root.innerHTML = "";
      if (scopeMeta) scopeMeta.textContent = "";
      return;
    }
    var items = filterItemsForReviewerScope(getAttentionQueueItems(12), {
      includeUnassigned: true,
    }).slice(0, 6);
    if (scopeMeta) {
      scopeMeta.textContent = getScopedReviewerName()
        ? "Showing " + getScopedReviewerName() + "'s queue plus unassigned work."
        : "Showing shared attention across the full review team.";
    }
    if (!items.length) {
      root.innerHTML =
        '<div class="empty">No overdue, stale, or unassigned work needs immediate attention.</div>';
      return;
    }
    root.innerHTML =
      '<div style="display:grid;gap:0.7rem">' +
      items
        .map(function (item) {
          return (
            '<div class="mini-card" style="padding:0.85rem 0.95rem">' +
            '<div style="display:flex;justify-content:space-between;gap:0.8rem;align-items:flex-start;flex-wrap:wrap">' +
            '<div><div style="font-weight:700;color:var(--navy)">' +
            dependencies.escapeHtml(item.name) +
            '</div><div class="subtle" style="margin-top:0.2rem">' +
            dependencies.escapeHtml(
              (item.entity_type === "application" ? "Application" : "Candidate") +
                " · " +
                getReviewTaskStatusLabel(item.status) +
                (item.assignee ? " · Owner: " + item.assignee : ""),
            ) +
            "</div></div>" +
            '<span class="tag">' +
            dependencies.escapeHtml(getAttentionQueueReason(item) || "Needs attention") +
            "</span>" +
            "</div>" +
            (item.note
              ? '<div style="margin-top:0.45rem;font-size:0.84rem;color:var(--slate)">' +
                dependencies.escapeHtml(item.note) +
                "</div>"
              : "") +
            '<div class="queue-actions" style="margin-top:0.7rem">' +
            '<button class="btn-secondary" type="button" data-attention-open="' +
            dependencies.escapeHtml(item.entity_type) +
            '" data-attention-id="' +
            dependencies.escapeHtml(item.id) +
            '">Open record</button>' +
            '<button class="btn-secondary" type="button" data-attention-assign-me="' +
            dependencies.escapeHtml(item.entity_type) +
            '" data-attention-id="' +
            dependencies.escapeHtml(item.id) +
            '">' +
            dependencies.escapeHtml(getPreferredReviewer() ? "Assign to me" : "Assign owner") +
            "</button>" +
            '<button class="btn-secondary" type="button" data-attention-reviewed="' +
            dependencies.escapeHtml(item.entity_type) +
            '" data-attention-id="' +
            dependencies.escapeHtml(item.id) +
            '">Mark reviewed today</button>' +
            "</div>" +
            "</div>"
          );
        })
        .join("") +
      "</div>";
  }

  function buildDataAttributeSelector(attribute, value) {
    return (
      "[" +
      attribute +
      '="' +
      String(value || "")
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"') +
      '"]'
    );
  }

  function openAttentionRecord(entityType, entityId) {
    if (entityType === "application") {
      dependencies.applicationFilters.q = "";
      dependencies.applicationFilters.status = "";
      dependencies.applicationFilters.focus = "";
      dependencies.applicationFilters.goal = "balanced";
      var applicationSearch = document.getElementById("applicationSearch");
      if (applicationSearch) applicationSearch.value = "";
      var applicationStatusFilter = document.getElementById("applicationStatusFilter");
      if (applicationStatusFilter) applicationStatusFilter.value = "";
      var applicationFocusFilter = document.getElementById("applicationFocusFilter");
      if (applicationFocusFilter) applicationFocusFilter.value = "";
      var applicationGoalFilter = document.getElementById("applicationGoalFilter");
      if (applicationGoalFilter) applicationGoalFilter.value = "balanced";
      dependencies.renderApplications();
      window.requestAnimationFrame(function () {
        var card = document.querySelector(
          buildDataAttributeSelector("data-application-card-id", entityId),
        );
        if (card && typeof card.scrollIntoView === "function") {
          card.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
      return;
    }
    if (entityType === "candidate") {
      dependencies.candidateFilters.q = "";
      dependencies.candidateFilters.review_status = "";
      dependencies.candidateFilters.dedupe_status = "";
      dependencies.candidateFilters.review_lane = "";
      var candidateSearch = document.getElementById("candidateSearch");
      if (candidateSearch) candidateSearch.value = "";
      var candidateReviewStatusFilter = document.getElementById("candidateReviewStatusFilter");
      if (candidateReviewStatusFilter) candidateReviewStatusFilter.value = "";
      var candidateDedupeStatusFilter = document.getElementById("candidateDedupeStatusFilter");
      if (candidateDedupeStatusFilter) candidateDedupeStatusFilter.value = "";
      var candidateReviewLaneFilter = document.getElementById("candidateReviewLaneFilter");
      if (candidateReviewLaneFilter) candidateReviewLaneFilter.value = "";
      dependencies.renderCandidateQueue();
      window.requestAnimationFrame(function () {
        var card = document.querySelector(
          buildDataAttributeSelector("data-candidate-card-id", entityId),
        );
        if (card && typeof card.scrollIntoView === "function") {
          card.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
      return;
    }
    if (entityType === "therapist") {
      var therapistPanels = [
        document.getElementById("importBlockerSprint"),
        document.getElementById("confirmationQueue"),
        document.getElementById("confirmationSprint"),
        document.getElementById("refreshQueue"),
      ];
      window.requestAnimationFrame(function () {
        for (var i = 0; i < therapistPanels.length; i += 1) {
          var scope = therapistPanels[i];
          if (!scope) continue;
          var card = scope.querySelector(
            buildDataAttributeSelector("data-review-task-id", entityId),
          );
          if (card) {
            var row = card.closest(".queue-card, .mini-card");
            if (row && typeof row.scrollIntoView === "function") {
              row.scrollIntoView({ behavior: "smooth", block: "start" });
            }
            return;
          }
        }
      });
    }
  }

  function renderReviewerWorkload() {
    var root = document.getElementById("reviewerWorkload");
    var filterEl = document.getElementById("reviewerWorkloadFilter");
    var sliceEl = document.getElementById("reviewerWorkloadSlice");
    var myQueueButton = document.getElementById("reviewerMyQueueToggle");
    if (!root) return;
    if (dependencies.getRuntimeState().authRequired) {
      root.innerHTML = "";
      return;
    }

    var roster = getReviewerRoster();
    if (filterEl) {
      filterEl.innerHTML =
        '<option value="">All reviewers</option>' +
        roster
          .map(function (name) {
            return (
              '<option value="' +
              dependencies.escapeHtml(name) +
              '">' +
              dependencies.escapeHtml(name) +
              "</option>"
            );
          })
          .join("");
      filterEl.value = dependencies.uiState.workloadFilter;
    }
    if (sliceEl) sliceEl.value = dependencies.uiState.workloadSlice;
    if (myQueueButton) {
      var scopedReviewer = getScopedReviewerName();
      myQueueButton.textContent = scopedReviewer ? "My work: " + scopedReviewer : "My work";
      myQueueButton.setAttribute(
        "aria-pressed",
        dependencies.uiState.myQueueMode ? "true" : "false",
      );
      myQueueButton.classList.toggle("is-active", dependencies.uiState.myQueueMode);
      myQueueButton.disabled = false;
    }

    var items = getAllReviewFollowUpItems();
    if (!items.length) {
      root.innerHTML = '<div class="empty">No shared work is currently assigned or queued.</div>';
      return;
    }

    items = filterItemsForReviewerScope(items, {
      includeUnassigned: Boolean(getScopedReviewerName()),
    });

    if (dependencies.uiState.workloadSlice === "overdue") {
      items = items.filter(isFollowUpOverdue);
    } else if (dependencies.uiState.workloadSlice === "today") {
      items = items.filter(isFollowUpDueToday);
    } else if (dependencies.uiState.workloadSlice === "this_week") {
      items = items.filter(isFollowUpDueThisWeek);
    } else if (dependencies.uiState.workloadSlice === "stale") {
      items = items.filter(isFollowUpStale);
    } else if (dependencies.uiState.workloadSlice === "blocked") {
      items = items.filter(function (item) {
        return item.status === "blocked";
      });
    } else if (dependencies.uiState.workloadSlice === "unassigned") {
      items = items.filter(function (item) {
        return !item.assignee;
      });
    }

    if (!items.length) {
      root.innerHTML = '<div class="empty">No work matches the current reviewer view.</div>';
      return;
    }

    var summaryOverdueCount = items.filter(isFollowUpOverdue).length;
    var summaryDueTodayCount = items.filter(isFollowUpDueToday).length;
    var summaryDueThisWeekCount = items.filter(isFollowUpDueThisWeek).length;
    var summaryBlockedCount = items.filter(function (item) {
      return item.status === "blocked";
    }).length;
    var summaryStaleCount = items.filter(isFollowUpStale).length;
    var summaryUnassignedCount = items.filter(function (item) {
      return !item.assignee;
    }).length;
    var nextDueItem = getNextDueFollowUpItem(items);

    var assigneeMap = new Map();
    var unassigned = [];
    items.forEach(function (item) {
      if (!item.assignee) {
        unassigned.push(item);
        return;
      }
      if (!assigneeMap.has(item.assignee)) {
        assigneeMap.set(item.assignee, []);
      }
      assigneeMap.get(item.assignee).push(item);
    });

    var assigneeCards = Array.from(assigneeMap.entries())
      .sort(function (a, b) {
        var aItems = a[1];
        var bItems = b[1];
        var aOverdue = aItems.filter(isFollowUpOverdue).length;
        var bOverdue = bItems.filter(isFollowUpOverdue).length;
        if (bOverdue !== aOverdue) return bOverdue - aOverdue;
        var aBlocked = aItems.filter(function (item) {
          return item.status === "blocked";
        }).length;
        var bBlocked = bItems.filter(function (item) {
          return item.status === "blocked";
        }).length;
        if (bBlocked !== aBlocked) return bBlocked - aBlocked;
        return a[0].localeCompare(b[0]);
      })
      .map(function (entry) {
        var assignee = entry[0];
        var reviewerItems = entry[1];
        var openCount = reviewerItems.filter(function (item) {
          return item.status === "open";
        }).length;
        var blockedCount = reviewerItems.filter(function (item) {
          return item.status === "blocked";
        }).length;
        var staleCount = reviewerItems.filter(isFollowUpStale).length;
        var overdueCount = reviewerItems.filter(isFollowUpOverdue).length;
        var dueTodayCount = reviewerItems.filter(isFollowUpDueToday).length;
        var topItem = getNextDueFollowUpItem(reviewerItems);
        return (
          '<button type="button" class="queue-insight-card" data-reviewer-workload-focus="' +
          dependencies.escapeHtml(assignee) +
          '"><div class="queue-insight-label"><strong>' +
          dependencies.escapeHtml(assignee) +
          '</strong></div><div class="queue-insight-note">' +
          dependencies.escapeHtml(
            reviewerItems.length +
              " assigned · " +
              openCount +
              " open · " +
              dueTodayCount +
              " due today · " +
              staleCount +
              " needs nudge · " +
              blockedCount +
              " blocked · " +
              overdueCount +
              " overdue",
          ) +
          "</div>" +
          (topItem
            ? '<div class="queue-insight-note">Top item: ' +
              dependencies.escapeHtml(
                topItem.name +
                  " · " +
                  getFollowUpDueLabel(topItem) +
                  (getFollowUpStaleLabel(topItem) ? " · " + getFollowUpStaleLabel(topItem) : "") +
                  (topItem.note ? " · " + topItem.note : ""),
              ) +
              "</div>"
            : "") +
          "</button>"
        );
      })
      .join("");

    root.innerHTML =
      '<div class="queue-insights"><div class="queue-insights-title">Needs-action summary</div><div class="queue-insights-grid">' +
      [
        {
          label: "Overdue",
          value: summaryOverdueCount,
          note: summaryOverdueCount > 0 ? "Work already past due." : "No overdue work right now.",
        },
        {
          label: "Due today",
          value: summaryDueTodayCount,
          note:
            summaryDueTodayCount > 0 ? "Needs movement before end of day." : "Nothing due today.",
        },
        {
          label: "Due this week",
          value: summaryDueThisWeekCount,
          note:
            summaryDueThisWeekCount > 0
              ? "Upcoming work that should be planned now."
              : "No dated work in the next week.",
        },
        {
          label: "Blocked",
          value: summaryBlockedCount,
          note:
            summaryBlockedCount > 0 ? "Items waiting on an unblock." : "No currently blocked work.",
        },
        {
          label: "Needs nudge",
          value: summaryStaleCount,
          note:
            summaryStaleCount > 0 ? "Open work untouched for 3+ days." : "No stale work right now.",
        },
        {
          label: "Unassigned",
          value: summaryUnassignedCount,
          note:
            summaryUnassignedCount > 0
              ? "Needs an owner before it slips."
              : "All visible work has an owner.",
        },
      ]
        .map(function (summary) {
          return (
            '<div class="queue-insight-card" style="cursor:default"><div class="queue-insight-label"><strong>' +
            dependencies.escapeHtml(summary.label) +
            '</strong></div><div style="font-size:1.4rem;font-weight:800;color:var(--navy);margin-top:0.15rem">' +
            dependencies.escapeHtml(String(summary.value)) +
            '</div><div class="queue-insight-note">' +
            dependencies.escapeHtml(summary.note) +
            "</div></div>"
          );
        })
        .join("") +
      "</div>" +
      (nextDueItem
        ? '<div class="mini-status" style="margin-top:0.75rem"><strong>Next attention item:</strong> ' +
          dependencies.escapeHtml(
            nextDueItem.name +
              " · " +
              (nextDueItem.assignee ? nextDueItem.assignee + " · " : "") +
              getFollowUpDueLabel(nextDueItem) +
              (getFollowUpStaleLabel(nextDueItem)
                ? " · " + getFollowUpStaleLabel(nextDueItem)
                : ""),
          ) +
          (nextDueItem.note
            ? '<div class="subtle" style="margin-top:0.35rem">' +
              dependencies.escapeHtml(nextDueItem.note) +
              "</div>"
            : "") +
          "</div>"
        : "") +
      '</div><div class="queue-insights"><div class="queue-insights-title">Ownership snapshot</div>' +
      (dependencies.uiState.workloadFilter || dependencies.uiState.workloadSlice !== "all"
        ? '<div class="mini-status" style="margin-bottom:0.75rem"><strong>View:</strong> ' +
          dependencies.escapeHtml(
            [
              dependencies.uiState.workloadFilter
                ? "Reviewer: " + dependencies.uiState.workloadFilter
                : "",
              getScopedReviewerName() ? "My work: " + getScopedReviewerName() : "",
              dependencies.uiState.workloadSlice === "overdue"
                ? "Overdue only"
                : dependencies.uiState.workloadSlice === "today"
                  ? "Due today"
                  : dependencies.uiState.workloadSlice === "this_week"
                    ? "Due this week"
                    : dependencies.uiState.workloadSlice === "stale"
                      ? "Needs nudge"
                      : dependencies.uiState.workloadSlice === "blocked"
                        ? "Blocked only"
                        : dependencies.uiState.workloadSlice === "unassigned"
                          ? "Unassigned only"
                          : "",
            ]
              .filter(Boolean)
              .join(" · "),
          ) +
          ' <button class="btn-secondary" type="button" id="reviewerWorkloadClearFilter" style="margin-left:0.65rem">Clear</button></div>'
        : "") +
      '<div class="queue-insights-grid">' +
      assigneeCards +
      "</div></div>" +
      (unassigned.length
        ? '<div class="queue-insights"><div class="queue-insights-title">Unassigned work</div><div class="subtle" style="margin-bottom:0.7rem">These records need an owner before they fall through the cracks.</div><div style="display:grid;gap:0.65rem">' +
          unassigned
            .slice(0, 8)
            .map(function (item) {
              return (
                '<div class="mini-card" style="padding:0.8rem 0.9rem"><div style="font-weight:700;color:var(--navy)">' +
                dependencies.escapeHtml(item.name) +
                '</div><div class="subtle" style="margin-top:0.2rem">' +
                dependencies.escapeHtml(
                  (item.entity_type === "application"
                    ? "Application"
                    : item.entity_type === "candidate"
                      ? "Candidate"
                      : "Listing") +
                    " · " +
                    getReviewTaskStatusLabel(item.status) +
                    (getFollowUpDueLabel(item) ? " · " + getFollowUpDueLabel(item) : "") +
                    (getFollowUpStaleLabel(item) ? " · " + getFollowUpStaleLabel(item) : ""),
                ) +
                "</div>" +
                (item.note
                  ? '<div style="margin-top:0.35rem;font-size:0.84rem;color:var(--slate)">' +
                    dependencies.escapeHtml(item.note) +
                    "</div>"
                  : "") +
                "</div>"
              );
            })
            .join("") +
          "</div></div>"
        : "");
  }

  function renderReviewEntityTaskHtml(entityType, entityId) {
    var task = getReviewEntityTask(entityType, entityId);
    var status = (task && task.status) || "open";
    var note = (task && task.note) || "";
    var assignee = (task && task.assignee) || "";
    var dueAt = (task && task.due_at) || "";
    var dueLabel = getFollowUpDueLabel(task);
    var staleLabel = getFollowUpStaleLabel(task);
    var updatedAt = task && task.updated_at ? dependencies.formatDate(task.updated_at) : "";
    return (
      '<div class="notes-box"><label><strong>Follow-up workspace</strong></label><div style="display:flex;justify-content:space-between;gap:0.75rem;align-items:flex-start;flex-wrap:wrap">' +
      '<div class="subtle">' +
      dependencies.escapeHtml(
        note
          ? "Track the next review action directly on this record."
          : "Capture the next action, blocker, or handoff note for this record.",
      ) +
      '</div><span class="tag">' +
      dependencies.escapeHtml(getReviewTaskStatusLabel(status)) +
      "</span></div>" +
      (note
        ? '<div style="margin-top:0.55rem;font-size:0.88rem;color:var(--slate)">' +
          dependencies.escapeHtml(note) +
          "</div>"
        : '<div style="margin-top:0.55rem;font-size:0.84rem;color:var(--muted)">No work note yet.</div>') +
      (assignee || dueAt
        ? '<div class="subtle" style="margin-top:0.45rem">' +
          dependencies.escapeHtml(
            [
              assignee ? "Owner: " + assignee : "",
              dueAt ? "Due: " + dependencies.formatDate(dueAt) : "",
              dueLabel ? dueLabel : "",
              staleLabel ? staleLabel : "",
            ]
              .filter(Boolean)
              .join(" · "),
          ) +
          "</div>"
        : "") +
      (updatedAt
        ? '<div class="subtle" style="margin-top:0.45rem">Last updated: ' +
          dependencies.escapeHtml(updatedAt) +
          "</div>"
        : "") +
      '<div class="queue-actions" style="margin-top:0.75rem"><button class="btn-secondary" type="button" data-review-task-edit="' +
      dependencies.escapeHtml(entityType) +
      '" data-review-task-id="' +
      dependencies.escapeHtml(entityId) +
      '">Edit task</button><button class="btn-secondary" type="button" data-review-task-toggle="' +
      dependencies.escapeHtml(entityType) +
      '" data-review-task-id="' +
      dependencies.escapeHtml(entityId) +
      '">' +
      dependencies.escapeHtml(status === "done" ? "Mark Open" : "Mark Done") +
      '</button><button class="btn-secondary" type="button" data-review-task-block="' +
      dependencies.escapeHtml(entityType) +
      '" data-review-task-id="' +
      dependencies.escapeHtml(entityId) +
      '">' +
      dependencies.escapeHtml(status === "blocked" ? "Unblock" : "Mark Blocked") +
      '</button><button class="btn-secondary" type="button" data-review-task-clear="' +
      dependencies.escapeHtml(entityType) +
      '" data-review-task-id="' +
      dependencies.escapeHtml(entityId) +
      '">Clear</button></div></div>'
    );
  }

  async function handleReviewEntityTaskAction(event) {
    var editButton = event.target.closest("[data-review-task-edit]");
    var toggleButton = event.target.closest("[data-review-task-toggle]");
    var blockButton = event.target.closest("[data-review-task-block]");
    var clearButton = event.target.closest("[data-review-task-clear]");
    var button = editButton || toggleButton || blockButton || clearButton;
    if (!button) return;

    var entityType =
      button.getAttribute("data-review-task-edit") ||
      button.getAttribute("data-review-task-toggle") ||
      button.getAttribute("data-review-task-block") ||
      button.getAttribute("data-review-task-clear") ||
      "";
    var entityId = button.getAttribute("data-review-task-id") || "";
    if (!entityType || !entityId) return;

    var currentTask = getReviewEntityTask(entityType, entityId) || { status: "open", note: "" };
    var nextPayload = null;
    if (editButton) {
      var roster = getReviewerRoster();
      var nextNote = window.prompt(
        "Follow-up note for this record:",
        String(currentTask.note || ""),
      );
      if (nextNote === null) return;
      var nextAssignee = window.prompt(
        roster.length
          ? "Who owns this work item? Available reviewers: " + roster.join(", ")
          : "Who owns this work item?",
        String(currentTask.assignee || ""),
      );
      if (nextAssignee === null) return;
      var nextDueAt = window.prompt(
        "Due date for this work item (YYYY-MM-DD):",
        String(currentTask.due_at || ""),
      );
      if (nextDueAt === null) return;
      var selectedReviewer = findReviewerEntryByName(nextAssignee);
      nextPayload = {
        status: currentTask.status || "open",
        note: String(nextNote || "").trim(),
        assignee_id: selectedReviewer ? selectedReviewer.id : "",
        assignee_name: String(nextAssignee || "").trim(),
        assignee: String(nextAssignee || "").trim(),
        due_at: String(nextDueAt || "").trim(),
      };
    } else if (toggleButton) {
      nextPayload = {
        status: currentTask.status === "done" ? "open" : "done",
        note: currentTask.note || "",
        assignee_id: currentTask.assignee_id || "",
        assignee_name: currentTask.assignee_name || currentTask.assignee || "",
        assignee: currentTask.assignee || "",
        due_at: currentTask.due_at || "",
      };
    } else if (blockButton) {
      nextPayload = {
        status: currentTask.status === "blocked" ? "open" : "blocked",
        note: currentTask.note || "",
        assignee_id: currentTask.assignee_id || "",
        assignee_name: currentTask.assignee_name || currentTask.assignee || "",
        assignee: currentTask.assignee || "",
        due_at: currentTask.due_at || "",
      };
    } else if (clearButton) {
      var shouldClear = window.confirm("Clear the work workspace for this record?");
      if (!shouldClear) return;
      nextPayload = {
        status: "open",
        note: "",
        assignee_id: "",
        assignee_name: "",
        assignee: "",
        due_at: "",
      };
    }

    if (!nextPayload) return;

    await persistReviewEntityTask(entityType, entityId, nextPayload, {
      clear: Boolean(clearButton),
    });
  }

  function bindEventHandlers() {
    var workloadFilterEl = document.getElementById("reviewerWorkloadFilter");
    if (workloadFilterEl) {
      workloadFilterEl.addEventListener("change", function (event) {
        dependencies.uiState.workloadFilter = event.target.value || "";
        renderReviewerWorkload();
      });
    }

    var workloadSliceEl = document.getElementById("reviewerWorkloadSlice");
    if (workloadSliceEl) {
      workloadSliceEl.addEventListener("change", function (event) {
        dependencies.uiState.workloadSlice = event.target.value || "all";
        renderReviewerWorkload();
      });
    }

    var myQueueToggleEl = document.getElementById("reviewerMyQueueToggle");
    if (myQueueToggleEl)
      myQueueToggleEl.addEventListener("click", function () {
        var preferredReviewer = getPreferredReviewer();
        if (!dependencies.uiState.myQueueMode && !preferredReviewer) {
          var roster = getReviewerRoster();
          var selectedReviewer = window.prompt(
            roster.length
              ? "Who should My work belong to? Available reviewers: " + roster.join(", ")
              : "Who should My work belong to?",
            "",
          );
          if (selectedReviewer === null) return;
          preferredReviewer = String(selectedReviewer || "").trim();
          if (!preferredReviewer) return;
          var selectedReviewerEntry = findReviewerEntryByName(preferredReviewer);
          setPreferredReviewer(
            preferredReviewer,
            selectedReviewerEntry ? selectedReviewerEntry.id : "",
          );
          writeReviewerDirectory(
            Array.from(new Set(getReviewerRoster().concat([preferredReviewer]))).sort(
              function (a, b) {
                return a.localeCompare(b);
              },
            ),
          );
        }
        setReviewerMyQueueMode(!dependencies.uiState.myQueueMode);
        renderAttentionQueue();
        renderReviewerWorkload();
      });

    var rosterAddEl = document.getElementById("reviewerRosterAdd");
    if (rosterAddEl)
      rosterAddEl.addEventListener("click", function () {
        void (async function () {
          var name = window.prompt("Add reviewer name:", "");
          if (!name) return;
          var trimmedName = name.trim();
          if (!trimmedName) return;
          var nextRoster = Array.from(new Set(getReviewerRoster().concat([trimmedName]))).sort(
            function (a, b) {
              return a.localeCompare(b);
            },
          );
          if (dependencies.getRuntimeState().dataMode === "sanity") {
            dependencies.setRemoteReviewerRoster(
              await dependencies.updateTherapistReviewers(
                nextRoster.map(function (item) {
                  var existing = findReviewerEntryByName(item);
                  return {
                    id: existing ? existing.id : buildReviewerIdFromName(item),
                    name: item,
                    active: true,
                  };
                }),
              ),
            );
          } else {
            writeReviewerDirectory(nextRoster);
          }
          renderAttentionQueue();
          renderReviewerWorkload();
        })();
      });

    var rosterRemoveEl = document.getElementById("reviewerRosterRemove");
    if (rosterRemoveEl)
      rosterRemoveEl.addEventListener("click", function () {
        void (async function () {
          var name =
            dependencies.uiState.workloadFilter || window.prompt("Remove which reviewer?", "");
          if (!name) return;
          var trimmedName = String(name || "").trim();
          if (!trimmedName) return;
          var nextRoster = getReviewerRoster().filter(function (item) {
            return item !== trimmedName;
          });
          if (dependencies.getRuntimeState().dataMode === "sanity") {
            dependencies.setRemoteReviewerRoster(
              await dependencies.updateTherapistReviewers(
                nextRoster.map(function (item) {
                  var existing = findReviewerEntryByName(item);
                  return {
                    id: existing ? existing.id : buildReviewerIdFromName(item),
                    name: item,
                    active: true,
                  };
                }),
              ),
            );
          } else {
            writeReviewerDirectory(nextRoster);
          }
          if (dependencies.uiState.workloadFilter === trimmedName) {
            dependencies.uiState.workloadFilter = "";
          }
          if (getPreferredReviewer() === trimmedName) {
            setPreferredReviewer("", "");
            setReviewerMyQueueMode(false);
          }
          renderAttentionQueue();
          renderReviewerWorkload();
        })();
      });

    var reviewerWorkloadEl = document.getElementById("reviewerWorkload");
    if (reviewerWorkloadEl)
      reviewerWorkloadEl.addEventListener("click", function (event) {
        var focusButton = event.target.closest("[data-reviewer-workload-focus]");
        if (focusButton) {
          dependencies.uiState.workloadFilter =
            focusButton.getAttribute("data-reviewer-workload-focus") || "";
          renderReviewerWorkload();
          return;
        }
        if (event.target.closest("#reviewerWorkloadClearFilter")) {
          dependencies.uiState.workloadFilter = "";
          dependencies.uiState.workloadSlice = "all";
          renderReviewerWorkload();
        }
      });

    var applicationsListEl = document.getElementById("applicationsList");
    if (applicationsListEl) {
      applicationsListEl.addEventListener("click", function (event) {
        handleReviewEntityTaskAction(event);
      });
    }

    var candidateQueueEl = document.getElementById("candidateQueue");
    if (candidateQueueEl) {
      candidateQueueEl.addEventListener("click", function (event) {
        handleReviewEntityTaskAction(event);
      });
    }

    ["confirmationQueue", "confirmationSprint", "importBlockerSprint", "refreshQueue"].forEach(
      function (id) {
        var root = document.getElementById(id);
        if (!root) return;
        root.addEventListener("click", function (event) {
          handleReviewEntityTaskAction(event);
        });
      },
    );

    var reviewAttentionQueueEl = document.getElementById("reviewAttentionQueue");
    if (reviewAttentionQueueEl) {
      reviewAttentionQueueEl.addEventListener("click", async function (event) {
        var openButton = event.target.closest("[data-attention-open]");
        if (openButton) {
          openAttentionRecord(
            openButton.getAttribute("data-attention-open") || "",
            openButton.getAttribute("data-attention-id") || "",
          );
          return;
        }

        var assignButton = event.target.closest("[data-attention-assign-me]");
        if (assignButton) {
          var assignType = assignButton.getAttribute("data-attention-assign-me") || "";
          var assignId = assignButton.getAttribute("data-attention-id") || "";
          if (!assignType || !assignId) return;
          await claimReviewEntityTask(assignType, assignId);
          return;
        }

        var reviewedButton = event.target.closest("[data-attention-reviewed]");
        if (reviewedButton) {
          var reviewType = reviewedButton.getAttribute("data-attention-reviewed") || "";
          var reviewId = reviewedButton.getAttribute("data-attention-id") || "";
          if (!reviewType || !reviewId) return;
          var reviewTask = getReviewEntityTask(reviewType, reviewId) || {
            status: "open",
            note: "",
          };
          await persistReviewEntityTask(reviewType, reviewId, {
            status: reviewTask.status || "open",
            note: reviewTask.note || "",
            assignee_id: reviewTask.assignee_id || "",
            assignee_name: reviewTask.assignee_name || reviewTask.assignee || "",
            assignee: reviewTask.assignee || "",
            due_at: reviewTask.due_at || "",
          });
        }
      });
    }
  }

  return {
    bindEventHandlers,
    getReviewEntityTask,
    getHumanWorkQueueSnapshot,
    getPreferredReviewer,
    getReviewerRoster,
    getSavedPreference: readReviewerPreference,
    openWorkItem: openAttentionRecord,
    claimWorkItem: claimReviewEntityTask,
    assignWorkItem: assignReviewEntityTask,
    saveWorkItem: saveReviewEntityTaskState,
    updateWorkItemStatus: updateReviewEntityTaskStatus,
    renderAttentionQueue,
    renderReviewEntityTaskHtml,
    renderReviewerWorkload,
    setPreferredReviewer,
    setReviewerMyQueueMode,
    writeReviewerDirectory,
  };
}
