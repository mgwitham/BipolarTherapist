export function createAdminWorkQueueHelpers(config) {
  const options = config || {};
  const formatDate =
    options.formatDate ||
    function (value) {
      return String(value || "");
    };
  const getLaneScopeState =
    options.getLaneScopeState ||
    function () {
      return [];
    };

  let workQueueActionFlash = null;

  function getWorkItemTypeLabel(entityType) {
    if (entityType === "application") return "Application";
    if (entityType === "candidate") return "Candidate";
    return "Listing";
  }

  function getWorkItemLaneLabel(item) {
    if (!item) return "";
    if (item.entity_type === "application") {
      return "Review Applications";
    }
    if (item.entity_type === "candidate") {
      return "Add New Listings";
    }
    if (item.entity_type === "therapist") {
      var therapistLaneScopes = getLaneScopeState();
      for (var i = 0; i < therapistLaneScopes.length; i += 1) {
        var scope = therapistLaneScopes[i];
        if (!scope || !scope.node) continue;
        if (scope.node.querySelector('[data-review-task-id="' + String(item.id || "") + '"]')) {
          return scope.label;
        }
      }
      return "Live Listing Follow-up";
    }
    return "";
  }

  function getWorkItemDueLabel(item) {
    if (!item || !item.due_at || item.status === "done") return "";
    var dueTime = new Date(item.due_at).getTime();
    if (!Number.isFinite(dueTime)) return "";
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var tomorrow = new Date(today.getTime());
    tomorrow.setDate(tomorrow.getDate() + 1);
    var dayMs = 24 * 60 * 60 * 1000;
    if (dueTime < today.getTime()) {
      var overdueDays = Math.max(1, Math.round((today.getTime() - dueTime) / dayMs));
      return "Overdue by " + overdueDays + " day" + (overdueDays === 1 ? "" : "s");
    }
    if (dueTime < tomorrow.getTime()) {
      return "Due today";
    }
    var dayDiff = Math.round((dueTime - today.getTime()) / dayMs);
    if (dayDiff === 1) {
      return "Due tomorrow";
    }
    return "Due in " + dayDiff + " days";
  }

  function getWorkItemTriageLabel(item) {
    if (!item) return "";
    if (item.status === "done") return "Done recently";
    if (item.status === "blocked") return "Blocked";
    var dueLabel = getWorkItemDueLabel(item);
    if (dueLabel) return dueLabel;
    if (!item.assignee) return "Claim this next";
    return "In progress";
  }

  function buildWorkItemSummary(item) {
    if (!item) {
      return "";
    }
    return (
      (getWorkItemLaneLabel(item) || getWorkItemTypeLabel(item.entity_type)) +
      (item.assignee ? " · " + item.assignee : "") +
      (item.due_at ? " · " + formatDate(item.due_at) : "")
    );
  }

  function setWorkQueueActionFlash(message) {
    workQueueActionFlash = message
      ? {
          message: String(message),
          createdAt: Date.now(),
        }
      : null;
  }

  function getWorkQueueActionFlash() {
    if (!workQueueActionFlash) return null;
    if (Date.now() - Number(workQueueActionFlash.createdAt || 0) > 1000 * 60 * 5) {
      workQueueActionFlash = null;
      return null;
    }
    return workQueueActionFlash.message || "";
  }

  return {
    buildWorkItemSummary,
    getWorkItemDueLabel,
    getWorkItemLaneLabel,
    getWorkItemTriageLabel,
    getWorkItemTypeLabel,
    getWorkQueueActionFlash,
    setWorkQueueActionFlash,
  };
}
