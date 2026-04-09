export function createAdminReviewModels(dependencies) {
  function getApplicationLinkedTherapist(item) {
    if (!item) {
      return null;
    }

    var therapistPool =
      dependencies.getDataMode() === "sanity"
        ? dependencies.getPublishedTherapists()
        : dependencies.getTherapists();
    if (!Array.isArray(therapistPool) || !therapistPool.length) {
      return null;
    }

    var targetId = String(item.target_therapist_id || "").trim();
    var targetSlug = String(item.target_therapist_slug || item.slug || "").trim();
    var providerId = String(item.provider_id || item.providerId || "").trim();
    var email = String(item.email || "")
      .trim()
      .toLowerCase();

    return (
      therapistPool.find(function (therapist) {
        return (
          (targetId && String(therapist.id || therapist._id || "").trim() === targetId) ||
          (targetSlug && String(therapist.slug || "").trim() === targetSlug) ||
          (providerId &&
            String(therapist.provider_id || therapist.providerId || "").trim() === providerId) ||
          (email &&
            String(therapist.email || "")
              .trim()
              .toLowerCase() === email)
        );
      }) || null
    );
  }

  function buildApplicationDiffRows(item, therapist) {
    if (!item || !therapist) {
      return [];
    }

    var rows = [
      {
        fieldKey: "credentials",
        label: "Credentials",
        application: dependencies.normalizeListValue(
          dependencies.getRecordValue(item, ["credentials"]),
        ),
        live: dependencies.normalizeListValue(
          dependencies.getRecordValue(therapist, ["credentials"]),
        ),
      },
      {
        fieldKey: "title",
        label: "Title",
        application: dependencies.normalizeListValue(dependencies.getRecordValue(item, ["title"])),
        live: dependencies.normalizeListValue(dependencies.getRecordValue(therapist, ["title"])),
      },
      {
        fieldKey: "location",
        label: "Location",
        application: dependencies.normalizeListValue(dependencies.formatLocationLine(item)),
        live: dependencies.normalizeListValue(dependencies.formatLocationLine(therapist)),
      },
      {
        fieldKey: "website",
        label: "Website",
        application: dependencies.normalizeListValue(
          dependencies.getRecordValue(item, ["website"]),
        ),
        live: dependencies.normalizeListValue(dependencies.getRecordValue(therapist, ["website"])),
      },
      {
        fieldKey: "email",
        label: "Email",
        application: dependencies.normalizeListValue(dependencies.getRecordValue(item, ["email"])),
        live: dependencies.normalizeListValue(dependencies.getRecordValue(therapist, ["email"])),
      },
      {
        fieldKey: "phone",
        label: "Phone",
        application: dependencies.normalizeListValue(dependencies.getRecordValue(item, ["phone"])),
        live: dependencies.normalizeListValue(dependencies.getRecordValue(therapist, ["phone"])),
      },
      {
        fieldKey: "preferred_contact_method",
        label: "Preferred contact",
        application: dependencies.normalizeListValue(
          dependencies.getRecordValue(item, ["preferred_contact_method", "preferredContactMethod"]),
        ),
        live: dependencies.normalizeListValue(
          dependencies.getRecordValue(therapist, [
            "preferred_contact_method",
            "preferredContactMethod",
          ]),
        ),
      },
      {
        fieldKey: "preferred_contact_label",
        label: "Primary CTA",
        application: dependencies.normalizeListValue(
          dependencies.getRecordValue(item, ["preferred_contact_label", "preferredContactLabel"]),
        ),
        live: dependencies.normalizeListValue(
          dependencies.getRecordValue(therapist, [
            "preferred_contact_label",
            "preferredContactLabel",
          ]),
        ),
      },
      {
        fieldKey: "insurance_accepted",
        label: "Insurance",
        application: dependencies.normalizeListValue(
          dependencies.getRecordValue(item, ["insurance_accepted", "insuranceAccepted"]),
        ),
        live: dependencies.normalizeListValue(
          dependencies.getRecordValue(therapist, ["insurance_accepted", "insuranceAccepted"]),
        ),
      },
      {
        fieldKey: "telehealth_states",
        label: "Telehealth states",
        application: dependencies.normalizeListValue(
          dependencies.getRecordValue(item, ["telehealth_states", "telehealthStates"]),
        ),
        live: dependencies.normalizeListValue(
          dependencies.getRecordValue(therapist, ["telehealth_states", "telehealthStates"]),
        ),
      },
      {
        fieldKey: "accepting_new_patients",
        label: "Accepting new patients",
        application: String(
          dependencies.getBooleanRecordValue(item, [
            "accepting_new_patients",
            "acceptingNewPatients",
          ]) === true
            ? "Yes"
            : dependencies.getBooleanRecordValue(item, [
                  "accepting_new_patients",
                  "acceptingNewPatients",
                ]) === false
              ? "No"
              : "",
        ),
        live: String(
          dependencies.getBooleanRecordValue(therapist, [
            "accepting_new_patients",
            "acceptingNewPatients",
          ]) === true
            ? "Yes"
            : dependencies.getBooleanRecordValue(therapist, [
                  "accepting_new_patients",
                  "acceptingNewPatients",
                ]) === false
              ? "No"
              : "",
        ),
      },
      {
        fieldKey: "medication_management",
        label: "Medication management",
        application: String(
          dependencies.getBooleanRecordValue(item, [
            "medication_management",
            "medicationManagement",
          ]) === true
            ? "Yes"
            : dependencies.getBooleanRecordValue(item, [
                  "medication_management",
                  "medicationManagement",
                ]) === false
              ? "No"
              : "",
        ),
        live: String(
          dependencies.getBooleanRecordValue(therapist, [
            "medication_management",
            "medicationManagement",
          ]) === true
            ? "Yes"
            : dependencies.getBooleanRecordValue(therapist, [
                  "medication_management",
                  "medicationManagement",
                ]) === false
              ? "No"
              : "",
        ),
      },
    ];

    return rows
      .map(function (row) {
        var applicationValue = row.application || "";
        var liveValue = row.live || "";
        var status =
          applicationValue && liveValue
            ? applicationValue === liveValue
              ? "match"
              : "changed"
            : applicationValue && !liveValue
              ? "new"
              : !applicationValue && liveValue
                ? "missing"
                : "empty";
        return {
          fieldKey: row.fieldKey,
          label: row.label,
          application: applicationValue || "Not provided",
          live: liveValue || "Not listed",
          status: status,
        };
      })
      .filter(function (row) {
        return row.status !== "empty";
      });
  }

  function getApplicationDiffSummary(rows) {
    var changed = rows.filter(function (row) {
      return row.status === "changed" || row.status === "new" || row.status === "missing";
    });
    if (!changed.length) {
      return "The incoming profile matches the live listing on the core operational fields shown here.";
    }
    return (
      changed.length +
      " core field" +
      (changed.length === 1 ? " needs" : "s need") +
      " review before you apply this update."
    );
  }

  function getLastAppliedLiveFieldsEntry(item) {
    var history = Array.isArray(item && item.revision_history) ? item.revision_history : [];
    for (var index = history.length - 1; index >= 0; index -= 1) {
      if (history[index] && history[index].type === "applied_live_fields") {
        return history[index];
      }
    }
    return null;
  }

  function isTrustCriticalApplicationField(fieldKey) {
    return [
      "website",
      "email",
      "phone",
      "preferred_contact_method",
      "preferred_contact_label",
      "insurance_accepted",
      "telehealth_states",
      "accepting_new_patients",
      "medication_management",
    ].includes(fieldKey);
  }

  function renderApplicationDiffHtml(item, therapist) {
    var rows = buildApplicationDiffRows(item, therapist);
    if (!rows.length) {
      return "";
    }
    var summary = getApplicationDiffSummary(rows);
    var matchedRows = rows.filter(function (row) {
      return row.status === "match";
    });
    var changedRows = rows.filter(function (row) {
      return row.status === "changed" || row.status === "new" || row.status === "missing";
    });
    var trustCriticalRows = changedRows.filter(function (row) {
      return isTrustCriticalApplicationField(row.fieldKey);
    });
    var lastAppliedEntry = getLastAppliedLiveFieldsEntry(item);
    var syncProgressText =
      matchedRows.length + " of " + rows.length + " core fields already match the live profile.";
    var lastAppliedHtml = lastAppliedEntry
      ? '<div class="mini-status" style="margin-top:0.55rem"><strong>Last applied:</strong> ' +
        dependencies.escapeHtml(
          lastAppliedEntry.message || "Live fields were applied on the previous review pass.",
        ) +
        "</div>"
      : "";
    var syncProgressHtml =
      '<div class="mini-status" style="margin-top:0.55rem"><strong>Sync progress:</strong> ' +
      dependencies.escapeHtml(syncProgressText) +
      "</div>";
    var remainingDiffHtml = changedRows.length
      ? '<div class="mini-status" style="margin-top:0.55rem"><strong>Still different:</strong> ' +
        dependencies.escapeHtml(
          changedRows
            .map(function (row) {
              return row.label;
            })
            .join(", "),
        ) +
        "</div>"
      : '<div class="mini-status" style="margin-top:0.55rem"><strong>Live sync:</strong> No remaining differences across the core operational fields shown here.</div>';
    var trustCriticalHtml = trustCriticalRows.length
      ? '<div class="mini-status" style="margin-top:0.55rem"><strong>High-value changes:</strong> ' +
        dependencies.escapeHtml(
          trustCriticalRows
            .map(function (row) {
              return row.label;
            })
            .join(", "),
        ) +
        "</div>"
      : "";
    var recentApplySummary = dependencies.applicationLiveApplySummaries()[item.id] || null;
    var recentApplyHtml = recentApplySummary
      ? '<div class="mini-status" style="margin-top:0.55rem"><strong>Just updated:</strong> ' +
        dependencies.escapeHtml(recentApplySummary.message) +
        "</div>"
      : "";
    return (
      '<div class="review-snapshot-box"><div class="review-snapshot-title">Live profile diff</div><div class="review-snapshot-copy">' +
      dependencies.escapeHtml(summary) +
      "</div>" +
      syncProgressHtml +
      recentApplyHtml +
      lastAppliedHtml +
      trustCriticalHtml +
      remainingDiffHtml +
      '</div><div class="queue-actions" style="margin-top:0.75rem;margin-bottom:0.75rem"><button class="btn-primary" type="button" data-apply-live-fields="' +
      dependencies.escapeHtml(item.id) +
      '">Apply selected fields</button><button class="btn-secondary" type="button" data-select-trust-live-fields="' +
      dependencies.escapeHtml(item.id) +
      '">Select trust-critical</button><button class="btn-secondary" type="button" data-select-all-live-fields="' +
      dependencies.escapeHtml(item.id) +
      '">Select all changes</button></div><div class="review-coach-status" data-apply-live-fields-status="' +
      dependencies.escapeHtml(item.id) +
      '"></div><div class="candidate-compare-grid" style="margin-top:0.75rem">' +
      rows
        .map(function (row) {
          var isSelectable = row.status !== "match";
          return (
            '<div class="candidate-compare-card"><div class="mini-status"><strong>' +
            (isSelectable
              ? '<label style="display:inline-flex;align-items:center;gap:0.4rem;margin-right:0.45rem"><input type="checkbox" data-application-apply-field="' +
                dependencies.escapeHtml(item.id) +
                '" value="' +
                dependencies.escapeHtml(row.fieldKey) +
                '"' +
                (isTrustCriticalApplicationField(row.fieldKey)
                  ? ' data-trust-critical="true"'
                  : "") +
                (row.status === "changed" || row.status === "new" ? " checked" : "") +
                ">Apply</label>"
              : "") +
            dependencies.escapeHtml(row.label) +
            '</strong> <span class="' +
            dependencies.escapeHtml(
              row.status === "match"
                ? "status approved"
                : row.status === "changed"
                  ? "status reviewing"
                  : "status rejected",
            ) +
            '">' +
            dependencies.escapeHtml(
              row.status === "match"
                ? "Matches"
                : row.status === "changed"
                  ? "Changed"
                  : row.status === "new"
                    ? "New data"
                    : "Live only",
            ) +
            '</span></div><div class="queue-insight-note"><strong>Incoming:</strong> ' +
            dependencies.escapeHtml(row.application) +
            '</div><div class="queue-insight-note"><strong>Live:</strong> ' +
            dependencies.escapeHtml(row.live) +
            "</div></div>"
          );
        })
        .join("") +
      "</div></div>"
    );
  }

  function getApplicationLiveSyncSnapshot(item, therapist) {
    if (!item || !therapist) {
      return null;
    }
    var rows = buildApplicationDiffRows(item, therapist);
    if (!rows.length) {
      return null;
    }
    var lastAppliedEntry = getLastAppliedLiveFieldsEntry(item);
    var recentApplySummary = dependencies.applicationLiveApplySummaries()[item.id] || null;
    var changedCount = rows.filter(function (row) {
      return row.status === "changed" || row.status === "new" || row.status === "missing";
    }).length;
    return {
      changedCount: changedCount,
      lastAppliedLabel: recentApplySummary
        ? recentApplySummary.tagLabel
        : lastAppliedEntry
          ? "Live fields applied"
          : "",
      syncLabel: changedCount ? changedCount + " fields still differ" : "Live profile in sync",
    };
  }

  function buildApplicationApplySummary(id, application, therapist, appliedFields) {
    if (!id || !application || !therapist) {
      return null;
    }
    var rows = buildApplicationDiffRows(application, therapist);
    var changedCount = rows.filter(function (row) {
      return row.status === "changed" || row.status === "new" || row.status === "missing";
    }).length;
    var labels = rows
      .filter(function (row) {
        return Array.isArray(appliedFields) && appliedFields.includes(row.fieldKey);
      })
      .map(function (row) {
        return row.label;
      });
    var labelText = labels.length ? labels.join(", ") : "selected live fields";
    return {
      tagLabel:
        "Updated " +
        (Array.isArray(appliedFields) ? appliedFields.length : 0) +
        " field" +
        (Array.isArray(appliedFields) && appliedFields.length === 1 ? "" : "s"),
      message:
        "Applied " +
        labelText +
        (changedCount
          ? ". " +
            changedCount +
            " core field" +
            (changedCount === 1 ? " still differs." : "s still differ.")
          : ". Live profile now matches on the core operational fields shown."),
      appliedAt: new Date().toISOString(),
    };
  }

  function getApplicationReviewSnapshot(item) {
    var readiness = dependencies.getTherapistMatchReadiness(item);
    var isConfirmationRefresh = dependencies.isConfirmationRefreshApplication(item);
    var isClaimConversion =
      item &&
      ["profile_submitted_after_claim", "profile_in_review_after_claim"].includes(
        item.portal_state,
      );
    var claimFollowUpUrgency = dependencies.getClaimFollowUpUrgency(item);
    var afterClaimReviewStall = dependencies.getAfterClaimReviewStall(item);
    var missingCriticalFields = [];
    var photoSourceType = item.photo_source_type || "";
    var hasPhotoAsset = Boolean(item.photo_url);
    var preferredPhotoSource = dependencies.hasPreferredPhotoSource(photoSourceType);

    if (!item.license_number) missingCriticalFields.push("license number");
    if (!item.preferred_contact_label) missingCriticalFields.push("CTA label");
    if (!item.contact_guidance) missingCriticalFields.push("contact guidance");
    if (!item.first_step_expectation) missingCriticalFields.push("first-step expectation");
    if (!item.care_approach) missingCriticalFields.push("care approach");
    if (!hasPhotoAsset) {
      missingCriticalFields.push("headshot");
    } else if (!photoSourceType) {
      missingCriticalFields.push("headshot source");
    }

    var focus = "active_review";
    var label = "Active review";
    var note =
      "Keep tightening the operational truth and make a clear decision on publish versus request changes.";

    if (claimFollowUpUrgency.tone === "urgent") {
      focus = "claim_follow_up_due";
      label = "Follow-up due now";
      note =
        "This approved claim is at risk of stalling because follow-up has not gone out in time. Treat it as immediate founder-ops work.";
    } else if (afterClaimReviewStall.stalled) {
      focus = "stalled_after_claim_review";
      label = "Stalled after-claim review";
      note = afterClaimReviewStall.note;
    } else if (isClaimConversion) {
      focus = "claim_conversion";
      label = "After-claim profile";
      note =
        "This therapist already cleared claim review and finished the fuller profile. Treat this as high-leverage follow-through work so the claim loop does not stall.";
    } else if (isConfirmationRefresh) {
      focus = "confirmation_refresh";
      label = "Confirmation refresh";
      note =
        "Treat this like upkeep on a live profile, not a brand-new listing. Prioritize confirmed operational truth and apply it back to the existing profile.";
    } else if (missingCriticalFields.length >= 3 || readiness.completeness_score < 65) {
      focus = "needs_changes";
      label = "Needs fixes";
      note =
        "This is more likely to benefit from a request-changes round before publishing because too many trust-critical basics are still thin.";
    } else if (
      readiness.score >= 75 &&
      readiness.completeness_score >= 75 &&
      missingCriticalFields.length <= 1
    ) {
      focus = "publish_ready";
      label = "Publish-ready";
      note =
        "This looks like a strong publish candidate after one final quality pass on trust and source clarity.";
    }

    return {
      focus: focus,
      label: label,
      note: note,
      photoStatusLabel: !hasPhotoAsset
        ? "No headshot uploaded"
        : dependencies.getPhotoSourceLabel(photoSourceType),
      photoNextMove: !hasPhotoAsset
        ? "Ask for a therapist- or practice-uploaded headshot before treating the profile as launch-ready."
        : !photoSourceType
          ? "Ask for a therapist- or practice-uploaded headshot before treating the profile as fully launch-ready."
          : preferredPhotoSource
            ? "The headshot source is already in the preferred uploaded tier."
            : "Treat this as a temporary photo fallback and prefer a therapist- or practice-uploaded headshot next.",
      missingCriticalFields: missingCriticalFields,
      nextMove:
        focus === "claim_follow_up_due"
          ? "Send the follow-up now or move the therapist forward if they already responded."
          : focus === "stalled_after_claim_review"
            ? "Finish the review decision now so this strong after-claim profile does not lose momentum."
            : focus === "claim_conversion"
              ? "Review the fuller profile quickly and move it toward publish or request changes."
              : focus === "confirmation_refresh"
                ? "Review as a live-profile refresh and apply confirmed fields back into the existing profile."
                : focus === "needs_changes"
                  ? "Request changes before publishing."
                  : focus === "publish_ready"
                    ? "Do a final trust pass, then publish."
                    : item.status === "pending"
                      ? "Move into reviewing and decide what still blocks trust."
                      : "Keep reviewing and make the next decision explicit.",
    };
  }

  function getApplicationPriorityScore(item) {
    var snapshot = getApplicationReviewSnapshot(item);
    var readiness = dependencies.getTherapistMatchReadiness(item);
    var score = 0;
    if (snapshot.focus === "claim_follow_up_due") score += 145;
    else if (snapshot.focus === "stalled_after_claim_review") score += 138;
    else if (snapshot.focus === "claim_conversion") score += 130;
    else if (snapshot.focus === "publish_ready") score += 120;
    else if (snapshot.focus === "confirmation_refresh") score += 95;
    else if (snapshot.focus === "active_review") score += 80;
    else if (snapshot.focus === "needs_changes") score += 40;

    if (item.status === "reviewing") score += 35;
    else if (item.status === "pending") score += 20;
    else if (item.status === "requested_changes") score -= 10;
    else if (item.status === "approved") score -= 25;
    else if (item.status === "rejected") score -= 40;

    score += Math.round((readiness.score || 0) / 5);
    score += Math.round((readiness.completeness_score || 0) / 10);
    return score;
  }

  function getApplicationReviewGoalMeta(goal) {
    if (goal === "publish_now") {
      return {
        label: "Clear publish-ready work",
        batchTitle: "Publish-Ready Batch",
        sortNote:
          "Applications are sorted to surface the fastest trustworthy publish decisions first.",
        batchIntro:
          "If you want quick wins right now, clear these publish-ready or nearly-ready applications first.",
        packetHeading: "# Recommended Review Batch — Clear Publish-Ready Work",
        primaryActionLabel: "Copy publish batch",
        primaryActionMode: "packet",
      };
    }
    if (goal === "fix_weak") {
      return {
        label: "Clean up weak applications",
        batchTitle: "Fix-First Batch",
        sortNote:
          "Applications are sorted to surface the weakest trust cases and highest-fix review work first.",
        batchIntro:
          "If this session is about cleanup, start with the applications that need the clearest trust repairs.",
        packetHeading: "# Recommended Review Batch — Clean Up Weak Applications",
        primaryActionLabel: "Copy fix requests",
        primaryActionMode: "requests",
      };
    }
    if (goal === "refresh_first") {
      return {
        label: "Handle refresh updates",
        batchTitle: "Refresh Review Batch",
        sortNote:
          "Applications are sorted to surface live-profile refresh updates and confirmation upkeep work first.",
        batchIntro:
          "If this session is about upkeep, start with these refresh-driven review actions first.",
        packetHeading: "# Recommended Review Batch — Refresh Updates First",
        primaryActionLabel: "Copy refresh batch",
        primaryActionMode: "packet",
      };
    }
    return {
      label: "Balanced review",
      batchTitle: "Recommended Review Batch",
      sortNote:
        "Applications are sorted by current review priority, so publish-ready and active high-leverage review work rises first.",
      batchIntro: "If you only clear a few items right now, start with these.",
      packetHeading: "# Recommended Review Batch",
      primaryActionLabel: "Copy balanced batch",
      primaryActionMode: "packet",
    };
  }

  function isGoalMatchedReviewCard(goal, item) {
    if (goal === "publish_now") return item.focus === "publish_ready";
    if (goal === "fix_weak") return item.focus === "needs_changes";
    if (goal === "refresh_first") return item.focus === "confirmation_refresh";
    return item.focus === "publish_ready" || item.focus === "active_review";
  }

  function getGoalAdjustedApplicationPriorityScore(item, goal) {
    var snapshot = getApplicationReviewSnapshot(item);
    var score = getApplicationPriorityScore(item);
    if (goal === "publish_now") {
      if (snapshot.focus === "claim_follow_up_due") score += 120;
      else if (snapshot.focus === "stalled_after_claim_review") score += 115;
      else if (snapshot.focus === "claim_conversion") score += 110;
      else if (snapshot.focus === "publish_ready") score += 90;
      else if (snapshot.focus === "active_review") score += 20;
      else if (snapshot.focus === "confirmation_refresh") score -= 5;
      else if (snapshot.focus === "needs_changes") score -= 40;
    } else if (goal === "fix_weak") {
      if (snapshot.focus === "needs_changes") score += 100;
      else if (snapshot.focus === "active_review") score += 20;
      else if (snapshot.focus === "publish_ready") score -= 30;
      else if (snapshot.focus === "confirmation_refresh") score -= 10;
      if (item.status === "requested_changes") score += 25;
    } else if (goal === "refresh_first") {
      if (snapshot.focus === "confirmation_refresh") score += 110;
      else if (snapshot.focus === "active_review") score += 10;
      else if (snapshot.focus === "publish_ready") score -= 15;
      else if (snapshot.focus === "needs_changes") score -= 25;
    }
    return score;
  }

  function getApplicationBatchReason(item, goal) {
    var snapshot = getApplicationReviewSnapshot(item);
    if (goal === "publish_now") {
      if (snapshot.focus === "claim_follow_up_due")
        return "This approved claim is already overdue for follow-up, so it is the fastest place to prevent drop-off in the therapist funnel.";
      if (snapshot.focus === "stalled_after_claim_review")
        return "This after-claim profile is already in review and has started aging. Clearing it now protects both supply growth and therapist trust.";
      if (snapshot.focus === "claim_conversion")
        return "This is the highest-leverage follow-through work: a therapist converted from claim to fuller profile and now needs a decisive review pass.";
      if (snapshot.focus === "publish_ready")
        return "Strong trust signals make this a fast publish decision candidate.";
      if (snapshot.focus === "active_review")
        return "This is close enough to publish-ready that one more clear decision could move it.";
      return "This stays in view as secondary review work after the fastest publish decisions.";
    }
    if (goal === "fix_weak") {
      if (snapshot.focus === "needs_changes")
        return "This is missing trust-critical basics and benefits most from explicit fixes first.";
      if (snapshot.focus === "active_review")
        return "This still needs a clear review call and could slip into a weak state without intervention.";
      return "This is lower-leverage cleanup work once the weakest applications are handled.";
    }
    if (goal === "refresh_first") {
      if (snapshot.focus === "confirmation_refresh")
        return "This is live-profile upkeep work and belongs at the top of a refresh session.";
      return "This is supporting review work after the refresh-specific items are cleared.";
    }
    if (snapshot.focus === "claim_follow_up_due")
      return "This approved claim needs an immediate follow-up send before the therapist goes cold.";
    if (snapshot.focus === "stalled_after_claim_review")
      return "This after-claim profile has been in review too long and needs a decisive next call now.";
    if (snapshot.focus === "claim_conversion")
      return "This therapist completed the fuller profile after claim approval and should be reviewed before the follow-through momentum cools.";
    if (snapshot.focus === "publish_ready")
      return "This is strong, near-finish review work that can create momentum quickly.";
    if (snapshot.focus === "confirmation_refresh")
      return "This is high-leverage upkeep work on an existing live profile.";
    if (snapshot.focus === "active_review")
      return "This already has momentum and needs a clear next review decision.";
    return "This needs more repair work before it becomes strong publish or refresh inventory.";
  }

  function getApplicationEmptyStateCopy(goal) {
    if (goal === "publish_now")
      return "No applications match the current filters for a publish-focused session. Try broadening the filters or switch back to balanced review.";
    if (goal === "fix_weak")
      return "No applications match the current filters for a fix-first session. Try broadening the filters or switch back to balanced review.";
    if (goal === "refresh_first")
      return "No applications match the current filters for a refresh-review session. Try broadening the filters or switch back to balanced review.";
    return "No applications match the current review filters. Try a different search or status.";
  }

  function getApplicationFocusLabel(value) {
    if (value === "claim_follow_up_due") return "Follow-up due now";
    if (value === "stalled_after_claim_review") return "Stalled after-claim review";
    if (value === "claimed_ready_for_profile") return "Approved claims awaiting full profile";
    if (value === "claim_conversion") return "Full profiles submitted after claim approval";
    if (value === "claim_flow") return "Claim submissions";
    if (value === "full_profile_flow") return "Full-profile submissions";
    return dependencies.formatFieldLabel(value);
  }

  function getApplicationFilterChips() {
    var chips = [];
    if (dependencies.applicationFilters.status) {
      chips.push(
        "Status: " + dependencies.formatStatusLabel(dependencies.applicationFilters.status),
      );
    }
    if (dependencies.applicationFilters.focus) {
      chips.push("Focus: " + getApplicationFocusLabel(dependencies.applicationFilters.focus));
    }
    if (dependencies.applicationFilters.q) {
      chips.push('Search: "' + dependencies.applicationFilters.q + '"');
    }
    return chips;
  }

  function getCandidateReviewChipLabel(status) {
    if (status === "ready_to_publish") return "Ready to publish";
    if (status === "needs_confirmation") return "Needs confirmation";
    if (status === "needs_review") return "Needs review";
    if (status === "published") return "Published";
    if (status === "archived") return "Archived";
    return "Queued";
  }

  function getCandidateDedupeChipLabel(status) {
    if (status === "possible_duplicate") return "Possible duplicate";
    if (status === "rejected_duplicate") return "Rejected duplicate";
    if (status === "merged") return "Merged";
    if (status === "unique") return "Unique";
    return "Unreviewed";
  }

  function getCandidateReviewLaneLabel(value) {
    if (value === "publish_now") return "Publish now";
    if (value === "needs_confirmation") return "Needs confirmation";
    if (value === "resolve_duplicates") return "Resolve duplicates";
    if (value === "archived") return "Archived";
    return "Editorial review";
  }

  function getVerificationLaneLabel(value) {
    if (value === "needs_verification") return "Needs verification";
    if (value === "needs_reconfirmation") return "Needs re-confirmation";
    if (value === "refresh_now") return "Refresh now";
    if (value === "refresh_soon") return "Refresh soon";
    return "Fresh";
  }

  function getCandidateOpsReason(item) {
    if (item.review_lane === "publish_now")
      return "High-readiness candidate with enough trust detail to be close to publish.";
    if (item.review_lane === "resolve_duplicates") {
      return item.matched_therapist_slug || item.matched_application_id
        ? "Likely duplicate found. Resolve the identity before adding anything new."
        : "Possible duplicate signals need a human merge/reject decision.";
    }
    if (item.review_lane === "needs_confirmation") {
      return "Promising candidate, but one more confirmation pass is needed before publish.";
    }
    if (item.review_status === "published") return "Already published.";
    return "Needs editorial review before the next intake step is clear.";
  }

  function getCandidateOpsEvidence(item) {
    var evidence = [];
    if (typeof item.readiness_score === "number")
      evidence.push("Readiness " + item.readiness_score + "/100");
    if (typeof item.dedupe_confidence === "number")
      evidence.push("Duplicate confidence " + item.dedupe_confidence + "/100");
    if (item.source_type) evidence.push("Source: " + item.source_type);
    return evidence.slice(0, 3).join(" · ");
  }

  function getCandidateTrustSummary(item) {
    var strong = [];
    var attention = [];
    var hasSourceTrail =
      Boolean(item.source_url) ||
      (Array.isArray(item.supporting_source_urls) && item.supporting_source_urls.length);
    var extractionConfidence = Number(item.extraction_confidence || 0);

    if (hasSourceTrail) strong.push("Source trail");
    else attention.push("Source trail");
    if (extractionConfidence >= 0.8) strong.push("Extraction confidence");
    else if (extractionConfidence > 0) attention.push("Extraction confidence");
    if (item.license_number && item.license_state) strong.push("License identity");
    else attention.push("License identity");
    if (item.website || item.booking_url || item.email || item.phone) strong.push("Contact path");
    else attention.push("Contact path");
    if (
      (Array.isArray(item.insurance_accepted) && item.insurance_accepted.length) ||
      (Array.isArray(item.telehealth_states) && item.telehealth_states.length) ||
      item.estimated_wait_time
    ) {
      strong.push("Operational details");
    } else {
      attention.push("Operational details");
    }
    if (item.dedupe_status === "possible_duplicate") attention.unshift("Duplicate risk");
    var watchFields = attention.slice(0, 3);
    var headline = watchFields.length
      ? "Watch " + watchFields.join(", ")
      : strong.length
        ? "Strong on " + strong.slice(0, 2).join(", ")
        : "Trust signals still building";
    return { strong: strong, attention: attention, watchFields: watchFields, headline: headline };
  }

  function getCandidateTrustRecommendation(item, summary) {
    var trust = summary || getCandidateTrustSummary(item);
    if (item.dedupe_status === "possible_duplicate")
      return "Resolve duplicate risk before doing any publish or confirmation work.";
    if (trust.attention.includes("Source trail") && trust.attention.includes("Contact path")) {
      return "Confirm source trail and contact path first. Without those, this is not publish-ready.";
    }
    if (trust.attention.includes("License identity")) {
      return "Tighten license identity next so the provider graph stays clean.";
    }
    if (trust.attention.includes("Operational details")) {
      return "Confirm insurance, telehealth, or wait-time details before publishing.";
    }
    if (trust.attention.includes("Extraction confidence")) {
      return "Review the source extraction next before trusting this candidate as publish-ready.";
    }
    return "This candidate has enough trust detail to move quickly if the source still looks clean.";
  }

  function getCandidatePublishPacket(item, summary) {
    var trust = summary || getCandidateTrustSummary(item);
    var strong = [];
    var watch = [];
    var blockers = [];
    if (item.dedupe_status === "possible_duplicate") blockers.push("Duplicate risk");
    if (item.review_status === "needs_confirmation") watch.push("Confirmation pass");
    if (item.review_status === "needs_review" && item.publish_recommendation !== "ready") {
      watch.push("Editorial review");
    }
    if (trust.strong.includes("Source trail")) strong.push("Source trail");
    else blockers.push("Source trail");
    if (trust.strong.includes("License identity")) strong.push("License identity");
    else blockers.push("License identity");
    if (trust.strong.includes("Contact path")) strong.push("Contact path");
    else watch.push("Contact path");
    if (trust.strong.includes("Operational details")) strong.push("Operational details");
    else watch.push("Operational details");
    if (trust.strong.includes("Extraction confidence")) strong.push("Extraction confidence");
    else if (trust.attention.includes("Extraction confidence")) watch.push("Extraction confidence");

    var uniqueStrong = Array.from(new Set(strong));
    var uniqueWatch = Array.from(new Set(watch)).filter(function (label) {
      return !blockers.includes(label);
    });
    var uniqueBlockers = Array.from(new Set(blockers));
    return {
      decision: uniqueBlockers.length
        ? "Hold publish"
        : uniqueWatch.length
          ? "Close, but verify"
          : "Publish ready",
      strong: uniqueStrong,
      watch: uniqueWatch,
      blockers: uniqueBlockers,
    };
  }

  return {
    buildApplicationApplySummary,
    getApplicationBatchReason,
    getApplicationEmptyStateCopy,
    getApplicationFilterChips,
    getApplicationFocusLabel,
    getApplicationLinkedTherapist,
    getApplicationLiveSyncSnapshot,
    getApplicationPriorityScore,
    getApplicationReviewGoalMeta,
    getApplicationReviewSnapshot,
    getCandidateDedupeChipLabel,
    getCandidateOpsEvidence,
    getCandidateOpsReason,
    getCandidatePublishPacket,
    getCandidateReviewChipLabel,
    getCandidateReviewLaneLabel,
    getCandidateTrustRecommendation,
    getCandidateTrustSummary,
    getGoalAdjustedApplicationPriorityScore,
    getVerificationLaneLabel,
    isGoalMatchedReviewCard,
    renderApplicationDiffHtml,
  };
}
